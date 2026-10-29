"""L3: server/L2.md -> ranking-collector-official; JP board acquisition with account and run controls."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import time
from types import SimpleNamespace
import uuid
from history import History
from lifecycle import targets, credential_generation
from process_lock import process_lock

def run(args):
    import transport
    from google.protobuf import json_format
    output=Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True)
    history=History(output/'history.sqlite3')
    configured_descriptor=Path(__file__).resolve().parent/'total-descriptors.pb'
    with process_lock(output/'sampler.lock'):
        count=0
        failures=0
        acquired=0
        def stopped():
            return (output/'STOP').exists() or time.time()>=args.deadline
        while args.rounds==0 or count<args.rounds:
            if stopped():break
            start=time.monotonic();count+=1
            definition=json.loads(Path(args.event).read_text(encoding='utf-8-sig'))
            event=definition['event']
            if definition['region']!='jp' or not str(event['id']).isdecimal():
                raise ValueError('JP event catalog required')
            boards=targets(definition,int(time.time()*1000))
            history.catalog(definition)
            if not boards:
                break
            credential=credential_generation(args.credentials)
            if credential[0]!=args.credential_identity:raise ValueError('collector account changed')
            sampler=transport.Sampler(SimpleNamespace(descriptors=configured_descriptor,
                output=output/'receipts',client_version=args.client_version,proxy=args.proxy,connect_ip=None,
                credentials=Path(args.credentials),credential_identity=credential[0],
                stop_file=output/'STOP',deadline=args.deadline))
            try:sampler.version()
            except InterruptedError:break
            if definition.get('catalogSource')!='official-master' or definition.get('masterVersion')!=sampler.master_version:
                raise RuntimeError('Master version changed; rediscover the official catalog next cycle')
            for kind,challenge in boards:
                if stopped():break
                if (kind,challenge) not in targets(definition,int(time.time()*1000)):continue
                oid=uuid.uuid4().hex;identity=('jp',str(event['id']),kind,challenge)
                receipt=None
                window_end=(event['endAtMs'] if kind=='total' else next(
                    row['endAtMs'] for row in event['challenges'] if row['id']==challenge))
                sampler.args.deadline=min(args.deadline,window_end/1000+event.get('aggregationSeconds',0))
                try:
                    if credential_generation(args.credentials)!=credential:raise RuntimeError('credential changed during round')
                    method='GetChallengeMusicRanking' if challenge else 'GetChallengeMusicTotalRanking'
                    request=sampler.message('app.event.'+method+'Request',
                        {'challenge_music_id':challenge} if challenge else {'event_id':str(event['id'])})
                    receipt,response,_=sampler.rpc('/app.event.EventService/'+method,request,
                        'app.event.'+method+'Response',oid)
                    if credential_generation(args.credentials)!=credential:raise RuntimeError('credential changed during request')
                    observed=int(datetime.fromisoformat(receipt['received_at']).timestamp()*1000)
                    if response is None:
                        raise RuntimeError('upstream HTTP=%s gRPC=%s'%(receipt.get('status'),receipt.get('grpc_status')))
                    body=json_format.MessageToDict(response,preserving_proto_field_name=True)
                    players=body.get('players',[])
                    if len(players)>100 or any(int(p.get('score',0))<0 for p in players):
                        raise ValueError('invalid ranking payload')
                    history.record(identity,oid,observed,{'players':players,'provenance':{
                        'clientVersion':args.client_version,'masterVersion':sampler.master_version,
                        'catalogSource':definition.get('catalogSource','operator-file'),
                        'catalogMasterVersion':definition.get('masterVersion'),
                        'catalogTableHashes':definition.get('tableHashes'),
                        'descriptorSha256':hashlib.sha256(configured_descriptor.read_bytes()).hexdigest()
                    }},receipt)
                    acquired+=1
                    print(json.dumps({'board':kind,'challenge':challenge,'snapshotId':oid,'players':len(players)}),flush=True)
                except InterruptedError:
                    if stopped():break
                    continue
                except Exception as error:
                    failures+=1
                    history.record(identity,oid,int(time.time()*1000),receipt=receipt,error=type(error).__name__)
                    print(json.dumps({'board':kind,'challenge':challenge,'error':type(error).__name__}),flush=True)
                    if receipt and (receipt.get('status') in (401,403,429) or receipt.get('grpc_status') in ('7','8','16')):
                        raise RuntimeError('Identity or rate limit requires intervention') from None
                finally:
                    sampler.args.deadline=args.deadline
            if args.rounds==0 or count<args.rounds:
                try:sampler.wait(max(0,args.interval-(time.monotonic()-start)))
                except InterruptedError:break
        if failures:
            raise RuntimeError(f'{failures} board acquisitions failed; inspect local history')
        return acquired
