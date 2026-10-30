"""L3: server/L2.md -> ranking-collector-official; standalone Python operator entry point."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import ssl
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'core'))
from process_lock import process_lock as lock_file
from lifecycle import normalize_proxy
from regions import REGIONS, region_config
FORMAT = 'haneoka:official-ranking-collector/2'
LEGACY_FORMAT = 'haneoka:official-jp-collector/1'
DESCRIPTOR_SHA256 = 'e8225c67eb066c1cdb2232a4c95f661a460d54dd88420f634ea2c8242de71adf'


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2), flush=True)


def doctor():
    if sys.version_info<(3,12) or os.name not in ('nt','posix'):
        raise ValueError('Python 3.12 or newer on Windows, Linux or macOS required')
    if not ssl.HAS_ALPN:
        raise ValueError('Python TLS must support ALPN for HTTP/2')
    import google.protobuf
    from importlib.metadata import version as dependency_version
    dependencies={'protobuf':'6.33.0','py3rijndael':'0.3.3','h2':'4.4.1','hpack':'4.2.0','hyperframe':'6.1.0'}
    for name,expected in dependencies.items():
        if dependency_version(name)!=expected:
            raise ValueError(f'Install {name}=={expected} with setup.py')
    descriptor = ROOT / 'core' / 'total-descriptors.pb'
    if hashlib.sha256(descriptor.read_bytes()).hexdigest() != DESCRIPTOR_SHA256:
        raise ValueError('Bundled descriptor checksum mismatch')
    from transport import pool_from_file
    pool = pool_from_file(descriptor)
    for name in ('app.masterdata.VersionResponse', 'app.event.GetChallengeMusicRankingResponse',
                 'app.event.GetChallengeMusicTotalRankingResponse', 'app.arena.ArenaRankingResponse'):
        pool.FindMessageTypeByName(name)
    intl=ROOT/'core'/'intl-descriptors.pb'
    if hashlib.sha256(intl.read_bytes()).hexdigest()!='2c0fd5de69765a544861a6e63da43f28e679da53c50f52e612b72fee2182147a':
        raise ValueError('Bundled international descriptor checksum mismatch')
    intl_pool=pool_from_file(intl)
    for name in ('app.playerlogin.GetServerListResponse','app.event.GetChallengeMusicRankingResponse','app.event.GetChallengeMusicTotalRankingResponse','app.arena.ArenaRankingResponse'):
        intl_pool.FindMessageTypeByName(name)
    manifest = ROOT / 'MANIFEST.json'
    if manifest.exists():
        for relative, expected in json.loads(manifest.read_text(encoding='utf-8')).items():
            path = (ROOT / relative).resolve()
            if not path.is_relative_to(ROOT) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError('Bundle checksum mismatch')
    return dict(status='ready', python=platform.python_version(), platform=platform.system(),
                tls=ssl.OPENSSL_VERSION,dependencies=dependencies,
                protobuf=google.protobuf.__version__, descriptorSha256=DESCRIPTOR_SHA256,
                networkRequests=0)


def validate_settings(config):
    if set(config)-{'region'} != {'format', 'credentials', 'interval', 'hours', 'client_version', 'proxy', 'master_config'}:
        raise ValueError('Unexpected configuration fields')
    region=config.get('region','jp')
    region_config(region)
    if config['format']==LEGACY_FORMAT:
        if region!='jp':raise ValueError('Legacy runtime is fixed to jp')
    elif config['format']!=FORMAT or 'region' not in config:
        raise ValueError('Not a standalone collector runtime')
    if type(config['interval']) is not int or config['interval'] < 60:
        raise ValueError('interval must be at least 60 seconds')
    if type(config['hours']) not in (int, float) or not 0 < config['hours'] <= 48:
        raise ValueError('hours must be in (0,48]')
    if not isinstance(config['client_version'], str) or not re.fullmatch(r'\d+\.\d+\.\d+', config['client_version']):
        raise ValueError('Invalid client version')
    normalize_proxy(config['proxy'])
    if not isinstance(config['credentials'], str) or not Path(config['credentials']).is_absolute():
        raise ValueError('An absolute external credential path is required')
    if not isinstance(config['master_config'], str) or not Path(config['master_config']).is_absolute():
        raise ValueError('An absolute external Master config path is required')


def initialize(args):
    output = Path(args.output).resolve()
    credentials = Path(args.credentials).resolve()
    master_config = Path(args.master_config).resolve()
    if master_config.is_relative_to(output) or master_config.is_relative_to(ROOT):
        raise ValueError('Keep Master config outside the runtime and tool directories')
    if credentials.is_relative_to(output) or credentials.is_relative_to(ROOT):
        raise ValueError('Keep credentials outside the runtime and tool directories')
    config = dict(format=FORMAT, region=args.region, credentials=str(credentials), interval=args.interval,
                  hours=args.hours, client_version=args.client_version, proxy=normalize_proxy(args.proxy),
                  master_config=str(Path(args.master_config).resolve()))
    validate_settings(config)
    from lifecycle import credential_generation
    credential_generation(credentials,args.region)
    # Refusing every existing directory prevents adopting an active legacy soak.
    output.mkdir(parents=True, exist_ok=False)
    from continuous import atomic_json
    from history import History
    History(output/'history.sqlite3',region=args.region)
    atomic_json(output / 'runtime.json', config)
    emit(dict(status='initialized', output=str(output), started=False))


def runtime(path):
    output = Path(path).resolve()
    config = json.loads((output / 'runtime.json').read_text(encoding='utf-8'))
    validate_settings(config)
    if Path(config['credentials']).resolve().is_relative_to(output):
        raise ValueError('Credentials must remain external to the runtime')
    region=config.get('region','jp')
    state_path=output/'collector-state.json'
    if state_path.exists() and json.loads(state_path.read_text(encoding='utf-8')).get('region','jp')!=region:
        raise ValueError('Runtime region changed')
    database=output/'history.sqlite3'
    if database.exists():
        from history import History
        History(database,read_only=True,region=region)
    return output, config


def running(output):
    try:
        with lock_file(output / 'continuous.lock'):
            return False
    except BlockingIOError:
        return True


def run_collector(output, config, launch_token=None):
    doctor()
    from lifecycle import credential_generation
    from continuous import run
    if not Path(config['master_config']).is_file():
        raise ValueError('official Master configuration is missing')
    credential_generation(config['credentials'],config.get('region','jp'))
    identity = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    run(SimpleNamespace(output=str(output), config_identity=identity, launch_token=launch_token,
                        **{key: value for key, value in config.items() if key != 'format'}))


def start(output, config):
    doctor()
    from lifecycle import credential_generation
    if not Path(config['master_config']).is_file():
        raise ValueError('official Master configuration is missing')
    credential_generation(config['credentials'],config.get('region','jp'))
    with lock_file(output / 'launch.lock'):
        if running(output):
            raise ValueError('This runtime already has a collector')
        if (output / 'STOP').exists():
            raise ValueError('STOP exists; use resume after checking status')
        launch_token = uuid.uuid4().hex
        process_options=({'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt'
                         else {'start_new_session':True})
        with (output / 'stdout.log').open('ab') as out, (output / 'stderr.log').open('ab') as err:
            process = subprocess.Popen([sys.executable, str(ROOT / 'collector.py'), 'run', '--output', str(output),
                '--launch-token', launch_token],
                stdin=subprocess.DEVNULL, stdout=out, stderr=err, cwd=ROOT,
                **process_options)
        until = time.monotonic() + 20
        while time.monotonic() < until:
            if process.poll() is not None:
                raise RuntimeError('Collector exited at startup; inspect this runtime stderr.log')
            state_file = output / 'collector-state.json'
            if state_file.exists():
                state = json.loads(state_file.read_text(encoding='utf-8'))
                if state.get('launchToken') == launch_token and running(output):
                    emit(dict(status='started', pid=state['pid'], output=str(output)))
                    return
            time.sleep(0.2)
        raise RuntimeError('Startup acknowledgement timed out; check status before retrying')


def verify_database(path):
    from history import decode_payload
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Backup integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('Backup foreign key check failed')
        if db.execute('SELECT 1 FROM observations WHERE (payload_hash IS NULL)=(error IS NULL) LIMIT 1').fetchone():
            raise ValueError('Backup observation payload mismatch')
        count = 0
        for digest, body in db.execute('SELECT hash,body FROM payloads'):
            decode_payload(digest,body)
            count += 1
        return count


def backup(output, destination):
    source = output / 'history.sqlite3'
    target = Path(destination).resolve()
    if target.is_relative_to(output) or target.is_relative_to(ROOT) or target.exists():
        raise ValueError('Use a new backup filename outside the runtime and tool')
    temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.partial')
    try:
        src = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
        try:
            dst = sqlite3.connect(temporary)
            try:
                src.backup(dst, pages=256, sleep=0.05)
                dst.execute('PRAGMA journal_mode=DELETE')
            finally:
                dst.close()
        finally:
            src.close()
        count = verify_database(temporary)
        os.link(temporary,target)
    finally:
        temporary.unlink(missing_ok=True)
    with target.open('rb') as stream:
        digest=hashlib.file_digest(stream,'sha256').hexdigest()
    emit(dict(status='backed_up', file=str(target), bytes=target.stat().st_size,
              verifiedPayloads=count, sha256=digest))


def main():
    parser = argparse.ArgumentParser(description='Local four-region ranking collector (Python 3.12+)')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('doctor', help='Check dependencies and bundled protocol without networking')
    catalog = commands.add_parser('catalog', help='Refresh official catalog in a separate directory, without game credentials or ranking requests')
    catalog.add_argument('--region', choices=tuple(REGIONS), default='jp')
    catalog.add_argument('--output', required=True)
    catalog.add_argument('--master-config', required=True)
    catalog.add_argument('--client-version', default='1.1.0')
    catalog.add_argument('--proxy', default='')
    init = commands.add_parser('init', help='Create a new isolated runtime; never starts sampling')
    init.add_argument('--region', choices=tuple(REGIONS), default='jp')
    init.add_argument('--output', required=True)
    init.add_argument('--credentials', required=True)
    init.add_argument('--master-config', required=True)
    init.add_argument('--hours', type=float, default=24)
    init.add_argument('--interval', type=int, default=300)
    init.add_argument('--client-version', default='1.1.0')
    init.add_argument('--proxy', default='')
    for name in ('run', 'start', 'stop', 'resume', 'status', 'serve', 'backup'):
        sub = commands.add_parser(name)
        sub.add_argument('--output', required=True)
        if name == 'status':
            sub.add_argument('--verify', action='store_true')
        elif name == 'run':
            sub.add_argument('--launch-token', help=argparse.SUPPRESS)
        elif name == 'serve':
            sub.add_argument('--port', type=int, default=18779)
        elif name == 'backup':
            sub.add_argument('--destination', required=True)
    args = parser.parse_args()
    if args.command == 'doctor':
        emit(doctor())
        return
    if args.command == 'init':
        initialize(args)
        return
    if args.command == 'catalog':
        doctor()
        args.proxy=normalize_proxy(args.proxy)
        output=Path(args.output).resolve()
        output.mkdir(parents=True,exist_ok=True)
        if (output/'runtime.json').exists() or (output/'collector-state.json').exists():
            raise ValueError('Use a separate catalog-only directory')
        args.output=str(output)
        from continuous import refresh_catalog, atomic_json
        from history import History
        with lock_file(output/'catalog.lock'):
            state_path=output/'catalog-state.json'
            state=json.loads(state_path.read_text()) if state_path.exists() else {}
            if state_path.exists() and state.get('region','jp')!=args.region:raise ValueError('Catalog region changed')
            definition=refresh_catalog(args,History(output/'history.sqlite3',region=args.region),state)
            atomic_json(state_path,state)
        emit(definition)
        return
    output, config = runtime(args.output)
    if args.command == 'run':
        if (output / 'STOP').exists():
            raise ValueError('STOP exists; use resume after checking status')
        run_collector(output, config, args.launch_token)
    elif args.command == 'start':
        start(output, config)
    elif args.command == 'stop':
        with lock_file(output / 'launch.lock'):
            (output / 'STOP').touch()
        emit(dict(status='stop_requested', running=running(output)))
    elif args.command == 'resume':
        with lock_file(output / 'launch.lock'):
            if running(output):
                raise ValueError('Cannot resume a running collector')
            (output / 'STOP').unlink(missing_ok=True)
        start(output, config)
    elif args.command == 'status':
        if not (output / 'collector-state.json').exists():
            emit(dict(status='initialized', running=running(output)))
        else:
            from status import report
            emit(dict(**report(output, args.verify), running=running(output)))
    elif args.command == 'serve':
        if not 1 <= args.port <= 65535:
            raise ValueError('port must be in [1,65535]')
        if not (output / 'history.sqlite3').is_file():
            raise ValueError('No observations database yet; run sampling first')
        from history import History
        from api import server
        with server(History(output / 'history.sqlite3', read_only=True,region=config.get('region','jp')), args.port,config.get('region','jp')) as http:
            emit(dict(status='serving', url=f'http://127.0.0.1:{http.server_port}'))
            http.serve_forever()
    elif args.command == 'backup':
        backup(output, args.destination)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        sys.exit(1)
