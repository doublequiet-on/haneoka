# L3 — GEB
# Input: A private stdin job with one origin-bound account configuration and board identity.
# Output: A public official board or a short failure kind on stdout.
# Pos: [Map](../../L2.md); bounded query adapter for the encrypted account-pool CLI.
# Effects/Dependencies: Temporary private files and official HTTPS/HTTP2 via the shared catalog and Sampler.
from datetime import datetime, timezone
import json
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

from lifecycle import authentication_failed, read_credentials, retry_delay, targets
from official_catalog import OfficialCatalog, CatalogRequestError
from transport import Sampler, VersionError


def query(job):
    region = job['region']
    config = job['config']
    kind, identity = job['kind'], job['id']
    proxy = job.get('proxy', '')
    deadline = time.time() + 45
    receipt = None
    authenticated = False
    with tempfile.TemporaryDirectory(prefix='haneoka-pool-') as directory:
        root = Path(directory)
        credentials = root / 'credentials.json'
        master = root / 'master.json'
        for path, value in ((credentials, config['credentials']), (master, config['masterConfig'])):
            with path.open('x', encoding='utf-8') as stream:
                path.chmod(0o600)
                json.dump(value, stream)
        account, _, auth = read_credentials(credentials, region)
        try:
            catalog = OfficialCatalog(master, root, proxy, config['clientVersion'],
                deadline=deadline, region=region, api_origin=auth['origin'])()
            boards = targets(catalog, int(time.time() * 1000))
            expected = ('total', '') if kind == 'total' else ('challenge', identity)
            if expected not in boards or kind == 'total' and identity != catalog['event']['id']:
                return {'ok': False, 'kind': 'inactive_board'}
            sampler = Sampler(SimpleNamespace(region=region,
                descriptors=Path(__file__).parent / ('total-descriptors.pb' if region == 'jp' else 'intl-descriptors.pb'),
                output=root / 'receipts', client_version=config['clientVersion'], proxy=proxy,
                credentials=credentials, credential_identity=account, api_origin=auth['origin'], deadline=deadline))
            sampler.version()
            if (sampler.master_version != catalog['masterVersion'] or sampler.resource_version != catalog['resourceVersion']):
                return {'ok': False, 'kind': 'version'}
            method = 'GetChallengeMusicTotalRanking' if kind == 'total' else 'GetChallengeMusicRanking'
            request = sampler.message('app.event.' + method + 'Request',
                {'event_id': identity} if kind == 'total' else {'challenge_music_id': identity})
            authenticated = True
            receipt, response, _ = sampler.rpc('/app.event.EventService/' + method, request,
                'app.event.' + method + 'Response', 'pool-board')
            if response is None:
                if authentication_failed(receipt):
                    return {'ok': False, 'kind': 'authentication'}
                if receipt.get('status') is None:
                    return {'ok': False, 'kind': 'auth_uncertain'}
                return {'ok': False, 'kind': 'upstream', 'retryAfterSeconds': retry_delay(receipt, 60)}
            from google.protobuf import json_format
            body = json_format.MessageToDict(response, preserving_proto_field_name=True)
            players = body.get('players', [])
            if len(players) > 100 or any(int(player.get('score', 0)) < 0 for player in players):
                return {'ok': False, 'kind': 'protocol'}
            return {'ok': True, 'result': {'data': {'players': players}, 'meta': {
                'region': region, 'kind': kind, 'entityId': identity, 'source': 'official-account-pool',
                'fetchedAtMs': int(datetime.now(timezone.utc).timestamp() * 1000),
                'apiOrigin': auth['origin'], 'masterVersion': sampler.master_version,
                'resourceVersion': sampler.resource_version, 'httpStatus': receipt['status'],
                'grpcStatus': receipt['grpc_status']}}}
        except (VersionError, CatalogRequestError) as error:
            receipt = error.receipt
            return {'ok': False, 'kind': 'authentication' if authenticated and authentication_failed(receipt) else 'catalog_unavailable',
                'retryAfterSeconds': retry_delay(receipt, 60)}
        except Exception:
            return {'ok': False, 'kind': 'auth_uncertain' if authenticated else 'query_failed'}


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(196609)
        if len(raw) > 196608:
            raise ValueError('job too large')
        result = query(json.loads(raw))
    except Exception:
        result = {'ok': False, 'kind': 'query_failed'}
    print(json.dumps(result, ensure_ascii=False))
