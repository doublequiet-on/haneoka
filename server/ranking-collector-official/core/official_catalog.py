"""L3: server/L2.md; official Master acquisition and JP event projection."""
from datetime import datetime, timezone, timedelta
import gzip
import base64
import hashlib
import json
from pathlib import Path
import re
import time
from types import SimpleNamespace
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request
from urllib.error import HTTPError

TABLES = ('MasterEvent', 'MasterChallengeMusic', 'MasterParameter')

class CatalogRequestError(RuntimeError):
    def __init__(self, stage, receipt):
        self.receipt=receipt
        super().__init__('catalog %s: HTTP=%s gRPC=%s' %
                         (stage,receipt.get('status'),receipt.get('grpc_status')))

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

def date(value):
    return int(datetime.strptime(value, '%Y/%m/%d %H:%M:%S').replace(
        tzinfo=timezone(timedelta(hours=9))).timestamp()*1000)

def project(tables, version, now_ms):
    from lifecycle import identifier
    events=tables['MasterEvent']['_allData']; songs=tables['MasterChallengeMusic']['_allData']
    params=[r for r in tables['MasterParameter']['_allData'] if r['_id']=='event_ranking_aggregation_time']
    if len(params)!=1 or not str(params[0]['_value']).isdecimal(): raise ValueError('missing aggregation parameter')
    aggregation=int(params[0]['_value'])
    if not 0<=aggregation<=604800: raise ValueError('invalid aggregation duration')
    candidates=[];seen=set()
    for e in events:
        eid=identifier(e['_id'])
        if eid in seen: raise ValueError('duplicate event')
        seen.add(eid)
        start,end=date(e['_startAt']),date(e['_endAt'])
        if end<=start: raise ValueError('invalid event window')
        if start<=now_ms<end+aggregation*1000: candidates.append((start,end,e))
    # Prefer a currently held event to a previous event still aggregating.
    held=[e for e in candidates if now_ms<e[1]]
    selected=held or candidates
    if len(selected)>1: raise ValueError('ambiguous current event')
    result=dict(region='jp',catalogSource='official-master',masterVersion=version,
                catalogObservedAtMs=now_ms,fetchedAtMs=None,stale=False,event=None)
    if not selected:return result
    start,end,e=selected[0];eid=identifier(e['_id']);challenges=[];seen=set()
    for key in ('_isMusicRankingDisabled','_isTotalMusicRankingDisabled'):
        if type(e.get(key)) is not bool:raise ValueError('ranking flag missing')
    for row in songs:
        if identifier(row['_eventId'])!=eid:continue
        cid=identifier(row['_id'])
        if cid in seen:raise ValueError('duplicate challenge')
        seen.add(cid)
        a=date(row['_stratAt']) if row['_stratAt'] else start
        b=date(row['_endAt']) if row['_endAt'] else end
        if not start<=a<b<=end:raise ValueError('challenge outside event')
        challenges.append(dict(id=cid,musicId=identifier(row['_liveMusicId']),
            enabled=not e['_isMusicRankingDisabled'],startAtMs=a,endAtMs=b,
            status='nowOn' if now_ms<end else 'aggregation'))
    if not challenges and (not e['_isMusicRankingDisabled'] or not e['_isTotalMusicRankingDisabled']):
        raise ValueError('enabled event has no challenges')
    result['event']=dict(id=eid,startAtMs=start,endAtMs=end,aggregationSeconds=aggregation,
        status='nowOn' if now_ms<end else 'aggregation',totalRankingEnabled=not e['_isTotalMusicRankingDisabled'],
        pointRankingEnabled=False,challenges=challenges)
    return result

class OfficialCatalog:
    def __init__(self, config_file, output, proxy, client_version):
        self.config_file=Path(config_file);self.output=Path(output)/'master';self.proxy=proxy
        self.client_version=client_version

    def __call__(self):
        if not self.config_file.is_file():raise ValueError('official Master configuration is missing')
        config=json.loads(self.config_file.read_text(encoding='utf-8-sig'))
        if config.get('masterRemoteRoot')!='https://static.bang-dream-on.jp/master':
            raise ValueError('unverified official Master origin')
        username=config.get('cdnUsername')
        crypto=config.get('masterCrypto',{})
        if not isinstance(username,str) or not username or ':' in username or set(crypto)!={'salt','key','iv'}:
            raise ValueError('official CDN authorization or Master crypto missing')
        from py3rijndael import RijndaelCbc, Pkcs7Padding
        from transport import Sampler, VersionError
        self.output.mkdir(parents=True,exist_ok=True)
        sampler=Sampler(SimpleNamespace(descriptors=Path(__file__).parent/'total-descriptors.pb',
            output=self.output/'version-receipts',client_version=self.client_version,proxy=self.proxy))
        try:sampler.version(include_cdn=True)
        except VersionError as error:raise CatalogRequestError('version',error.receipt) from None
        version=sampler.master_version
        cdn=sampler.cdn or {}
        if cdn.get('x-sirius-env','').rstrip('/')!='https://static.bang-dream-on.jp':
            raise ValueError('unverified Version CDN origin')
        password=cdn.get('x-sirius-cred')
        if not isinstance(password,str) or not password:
            raise ValueError('Version CDN credential missing')
        authorization='Basic '+base64.b64encode((username+':'+password).encode()).decode()
        sampler.cdn=None
        if not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',version) or '..' in version:raise ValueError('invalid Master version')
        directory=self.output/hashlib.sha256(version.encode()).hexdigest();directory.mkdir(exist_ok=True)
        opener=build_opener(ProxyHandler({'https':self.proxy} if self.proxy else {}),NoRedirect())
        def fetch(name,limit):
            request=Request(config['masterRemoteRoot']+'/'+version+'/'+name,headers={'Authorization':authorization})
            try:
                with opener.open(request,timeout=20) as response: raw=response.read(limit+1)
            except HTTPError as error:
                receipt={'status':error.code,'headers':{'retry-after':error.headers.get('Retry-After','')}}
                error.close()
                raise CatalogRequestError(name,receipt) from None
            if len(raw)>limit:raise ValueError('Master download too large')
            return raw
        # Recheck manifest each discovery; table blobs are reused only after digest verification.
        manifest=json.loads(fetch('MasterManifest.json',1048576))
        if manifest.get('version')!=version:raise ValueError('Master manifest version mismatch')
        tables={};digests={}
        cipher=RijndaelCbc(bytes.fromhex(crypto['key']),bytes.fromhex(crypto['iv']),Pkcs7Padding(32),block_size=32)
        for table in TABLES:
            rows=[r for r in manifest['files'] if r['name']==table+'.bin']
            if len(rows)!=1:raise ValueError('Master table missing or duplicated')
            entry=rows[0];size=entry['size'];digest=entry['hash']
            if type(size) is not int or not 0<size<=8388608 or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('invalid table manifest')
            path=directory/(table+'.bin')
            raw=path.read_bytes() if path.exists() else fetch(table+'.bin',size)
            if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Master table checksum mismatch')
            if raw[:64]!=bytes.fromhex(crypto['salt'])+bytes.fromhex(crypto['iv']):raise ValueError('Master crypto prefix mismatch')
            import io
            with gzip.GzipFile(fileobj=io.BytesIO(cipher.decrypt(raw[64:]))) as stream: decoded=stream.read(16777217)
            if len(decoded)>16777216:raise ValueError('decoded table too large')
            tables[table]=json.loads(decoded)
            if not isinstance(tables[table].get('_allData'),list):raise ValueError('invalid Master table')
            if not path.exists():path.write_bytes(raw)
            digests[table]=digest
        result=project(tables,version,int(time.time()*1000));result['tableHashes']=digests
        (directory/'catalog.json').write_text(json.dumps(result),encoding='utf-8')
        return result
