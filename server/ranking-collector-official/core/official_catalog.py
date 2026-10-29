"""L3: server/L2.md; official Master acquisition and regional event projection."""
from datetime import datetime, timezone, timedelta
import gzip
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid
from types import SimpleNamespace
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request
from urllib.error import HTTPError
from urllib.parse import urlsplit
from regions import region_config

TABLES = ('MasterEvent', 'MasterChallengeMusic', 'MasterParameter')

class CatalogRequestError(RuntimeError):
    def __init__(self, stage, receipt):
        self.receipt=receipt
        super().__init__('catalog %s: HTTP=%s gRPC=%s' %
                         (stage,receipt.get('status'),receipt.get('grpc_status')))

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

def atomic_write(path, data):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.partial')
    try:
        with temporary.open('xb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        temporary.unlink(missing_ok=True)

def date(value):
    return int(datetime.strptime(value, '%Y/%m/%d %H:%M:%S').replace(
        tzinfo=timezone(timedelta(hours=9))).timestamp()*1000)

def project(tables, version, now_ms, region='jp'):
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
    result=dict(region=region,catalogSource='official-master',masterVersion=version,
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
        status=('upcoming' if now_ms<a else 'nowOn' if now_ms<b
                else 'aggregation' if now_ms<b+aggregation*1000 else 'finished')
        challenges.append(dict(id=cid,musicId=identifier(row['_liveMusicId']),
            enabled=not e['_isMusicRankingDisabled'],startAtMs=a,endAtMs=b,
            status=status))
    if not challenges and (not e['_isMusicRankingDisabled'] or not e['_isTotalMusicRankingDisabled']):
        raise ValueError('enabled event has no challenges')
    result['event']=dict(id=eid,startAtMs=start,endAtMs=end,aggregationSeconds=aggregation,
        status='nowOn' if now_ms<end else 'aggregation',totalRankingEnabled=not e['_isTotalMusicRankingDisabled'],
        pointRankingEnabled=False,challenges=challenges)
    return result

class OfficialCatalog:
    def __init__(self, config_file, output, proxy, client_version, stop_file=None, deadline=None, region='jp'):
        from lifecycle import normalize_proxy
        self.config_file=Path(config_file);self.output=Path(output)/'master';self.proxy=normalize_proxy(proxy)
        self.client_version=client_version
        self.region=region
        self.region_config=region_config(region)
        self.stop_file=stop_file;self.deadline=deadline

    def __call__(self):
        if not self.config_file.is_file():raise ValueError('official Master configuration is missing')
        config=json.loads(self.config_file.read_text(encoding='utf-8-sig'))
        if self.region=='jp' and config.get('masterRemoteRoot')!='https://static.bang-dream-on.jp/master':
            raise ValueError('unverified official Master origin')
        username=config.get('cdnUsername')
        crypto=config.get('masterCrypto',{})
        if set(crypto)!={'salt','key','iv'} or (self.region=='jp' and (not isinstance(username,str) or not username or ':' in username)):
            raise ValueError('official CDN authorization or Master crypto missing')
        from py3rijndael import RijndaelCbc, Pkcs7Padding
        from transport import Sampler, VersionError
        self.output.mkdir(parents=True,exist_ok=True)
        sampler=Sampler(SimpleNamespace(region=self.region,descriptors=Path(__file__).parent/self.region_config.descriptor,
            output=self.output/'version-receipts',client_version=self.client_version,proxy=self.proxy,
            stop_file=self.stop_file,deadline=self.deadline))
        try:sampler.version(include_cdn=self.region=='jp')
        except VersionError as error:raise CatalogRequestError('version',error.receipt) from None
        version=sampler.master_version
        cdn=sampler.cdn or {}
        headers={}
        if self.region=='jp':
            if cdn.get('x-sirius-env','').rstrip('/')!='https://static.bang-dream-on.jp':
                raise ValueError('unverified Version CDN origin')
            password=cdn.get('x-sirius-cred')
            if not isinstance(password,str) or not password:raise ValueError('Version CDN credential missing')
            headers['Authorization']='Basic '+base64.b64encode((username+':'+password).encode()).decode()
            master_root=config['masterRemoteRoot']
        else:
            master_root=self.international_root(sampler)
        sampler.cdn=None
        if not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',version) or '..' in version:raise ValueError('invalid Master version')
        directory=self.output/hashlib.sha256(version.encode()).hexdigest();directory.mkdir(exist_ok=True)
        opener=build_opener(ProxyHandler({'https':self.proxy} if self.proxy else {}),NoRedirect())
        def fetch(name,limit):
            sampler.check_control()
            request=Request(master_root+'/'+version+'/'+name,headers=headers)
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
            sampler.check_control()
            rows=[r for r in manifest['files'] if r['name']==table+'.bin']
            if len(rows)!=1:raise ValueError('Master table missing or duplicated')
            entry=rows[0];size=entry['size'];digest=entry['hash']
            if type(size) is not int or not 0<size<=8388608 or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('invalid table manifest')
            path=directory/(table+'.bin')
            raw=path.read_bytes() if path.exists() else None
            cached=raw is not None and len(raw)==size and hashlib.sha256(raw).hexdigest()==digest
            if not cached:
                raw=fetch(table+'.bin',size)
                if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Master table checksum mismatch')
            if raw[:64]!=bytes.fromhex(crypto['salt'])+bytes.fromhex(crypto['iv']):raise ValueError('Master crypto prefix mismatch')
            import io
            with gzip.GzipFile(fileobj=io.BytesIO(cipher.decrypt(raw[64:]))) as stream: decoded=stream.read(16777217)
            if len(decoded)>16777216:raise ValueError('decoded table too large')
            tables[table]=json.loads(decoded)
            if not isinstance(tables[table].get('_allData'),list):raise ValueError('invalid Master table')
            if not cached:atomic_write(path,raw)
            digests[table]=digest
        result=project(tables,version,int(time.time()*1000),self.region);result['tableHashes']=digests
        atomic_write(directory/'catalog.json',json.dumps(result).encode('utf-8'))
        return result

    def international_root(self, sampler):
        from transport import SERVERS
        receipt, response, _=sampler.rpc(SERVERS, sampler.message('app.playerlogin.GetServerListRequest'),
            'app.playerlogin.GetServerListResponse', 'server-list')
        if response is None:raise CatalogRequestError('server-list',receipt)
        area={'tw':2,'en':3,'kr':4}[self.region]
        rows=[row for row in response.servers if str(row.areaID)==str(area)]
        if len(rows)!=1:raise ValueError('Missing or ambiguous official region')
        row=rows[0]
        if self.region_config.origin not in row.apiServerRoot.split('|'):
            raise ValueError('Official discovery API region mismatch')
        allowed=({'l14-prod-hk-patch-sirius.gamerfusiontech.com','l12-prod-hk-patch-sirius.gamerfusiontech.com'}
            if self.region=='tw' else {'l14-prod-sg-patch-sirius.bilibiligame.net','l12-prod-sg-patch-sirius.bilibiligame.net'})
        roots=row.cdnRoot.split('|')
        prefix={'tw':'hk','en':'en','kr':'kr'}[self.region]
        for root in roots:
            url=urlsplit(root)
            if (url.scheme!='https' or url.hostname not in allowed or url.netloc!=url.hostname
                or url.query or url.fragment or not re.fullmatch('/prod/'+prefix+'_[a-f0-9]{32}',url.path)):
                raise ValueError('Unverified international CDN region')
        return roots[0]+'/master'
