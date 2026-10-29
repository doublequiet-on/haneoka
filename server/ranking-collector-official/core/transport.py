"""L3: server/L2.md -> ranking-collector-official; framed JP read-only RPC transport with account and stop boundaries."""
import base64
import json
from pathlib import Path
import shutil
import subprocess
import time
import uuid
from google.protobuf import descriptor_pb2, descriptor_pool, json_format, message_factory
BASE = Path(__file__).resolve().parent
VERSION = '/app.masterdata.MasterdataService/Version'


class VersionError(RuntimeError):
    def __init__(self, receipt):
        headers={k.lower():v for k,v in receipt.get('headers',{}).items()}
        self.receipt={'status':receipt.get('status'),'grpc_status':receipt.get('grpc_status'),
                      'headers':{'retry-after':headers.get('retry-after','')}}
        super().__init__('Anonymous Version failed: HTTP=%s gRPC=%s' %
                         (self.receipt['status'],self.receipt['grpc_status']))

def pool_from_file(path):
    descriptor_set = descriptor_pb2.FileDescriptorSet.FromString(path.read_bytes())
    pool = descriptor_pool.DescriptorPool()
    pending = list(descriptor_set.file)
    while pending:
        remaining = []
        for file in pending:
            try:
                pool.Add(file)
            except TypeError:
                remaining.append(file)
        if len(remaining) == len(pending):
            raise ValueError('Unresolved descriptor dependencies: ' + ', '.join(f.name for f in remaining))
        pending = remaining
    return pool

def frame(payload):
    return b'\0' + len(payload).to_bytes(4, 'big') + payload

def unframe(raw):
    if len(raw) < 5 or raw[0] != 0:
        raise ValueError('Missing or unsupported gRPC frame')
    length = int.from_bytes(raw[1:5], 'big')
    if length != len(raw) - 5:
        raise ValueError('Truncated or multiple gRPC frames')
    return raw[5:]

class Sampler:
    def __init__(self, args):
        self.args = args
        self.pool = pool_from_file(args.descriptors)
        self.pwsh = shutil.which('pwsh')
        if not self.pwsh:
            raise RuntimeError('PowerShell 7 is required by this verified transport')
        self.run_id = uuid.uuid4().hex
        self.output = args.output / self.run_id
        self.output.mkdir(parents=True)
        self.master_version = None
        self.last_request = None

    def check_control(self):
        stop_file=getattr(self.args,'stop_file',None)
        deadline=getattr(self.args,'deadline',None)
        if (stop_file is not None and Path(stop_file).exists()) or (deadline is not None and time.time()>=deadline):
            raise InterruptedError('Collector stopped')

    def wait(self, seconds):
        until=time.monotonic()+max(0,seconds)
        while True:
            self.check_control()
            remaining=until-time.monotonic()
            if remaining<=0:return
            time.sleep(min(.2,remaining))

    def message(self, name, data=None):
        message = message_factory.GetMessageClass(self.pool.FindMessageTypeByName(name))()
        if data:
            json_format.ParseDict(data, message)
        return message

    def rpc(self, name, request, response_name, label, include_cdn=False):
        self.check_control()
        if self.last_request is not None:
            self.wait(2 - (time.monotonic() - self.last_request))
        spec = {
            'path': name, 'client_version': self.args.client_version,
            'proxy': self.args.proxy,
            'connect_ip': getattr(self.args, 'connect_ip', None),
            'body_base64': base64.b64encode(frame(request.SerializeToString())).decode(),
            'include_cdn': include_cdn and name == VERSION,
        }
        if name != VERSION:
            spec.update(credential_file=str(self.args.credentials.resolve()), master_version=self.master_version,
                        credential_identity=self.args.credential_identity)
        for attempt in range(1, 4):
            self.check_control()
            attempt_label = label if attempt == 1 else f'{label}-attempt-{attempt}'
            request_file = self.output / (attempt_label + '-request.json')
            response_file = self.output / (attempt_label + '-response.json')
            request_file.write_text(json.dumps(spec, indent=2) + '\n', encoding='utf-8')
            self.last_request = time.monotonic()
            process = subprocess.run([
                self.pwsh, '-NoProfile', '-File', str(BASE / 'grpc-request.ps1'),
                '-RequestFile', str(request_file), '-ResponseFile', str(response_file),
            ], capture_output=True, timeout=30)
            if process.returncode or not response_file.exists():
                raise RuntimeError('Transport process failed; inspect local execution without printing credentials')
            receipt = json.loads(response_file.read_text(encoding='utf-8-sig'))
            self.cdn = json.loads(process.stdout.decode('utf-8-sig')).get('cdn') if include_cdn else None
            # Retry only transport failures before an HTTP response; HTTP/gRPC failures stop.
            if receipt.get('status') is not None or not receipt.get('error_type') or attempt == 3:
                break
            print(json.dumps({'operation': label, 'transport_attempt': attempt, 'retry_after_seconds': 5 * attempt}), flush=True)
            self.wait(5 * attempt)
        headers = {k.lower(): v for k, v in receipt['headers'].items()}
        trailers = {k.lower(): v for k, v in receipt['trailers'].items()}
        status = trailers.get('grpc-status', headers.get('grpc-status'))
        receipt['grpc_status'] = status
        if receipt.get('status') != 200 or status != '0':
            return receipt, None, response_file
        response = self.message(response_name)
        response.ParseFromString(unframe(base64.b64decode(receipt['body_base64'], validate=True)))
        return receipt, response, response_file

    def version(self, include_cdn=False):
        receipt, response, path = self.rpc(VERSION, self.message('app.masterdata.VersionRequest'),
                                          'app.masterdata.VersionResponse', 'version', include_cdn=include_cdn)
        if response is None or not response.version:
            raise VersionError(receipt)
        self.master_version = response.version
        return {'master_version': self.master_version, 'receipt': str(path),
                'http_status': receipt['status'], 'grpc_status': receipt['grpc_status']}
