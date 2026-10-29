"""L3: server/L2.md -> ranking-collector-official; bounded runner and durable cycle evidence."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import os
import subprocess
import time
from types import SimpleNamespace
import uuid
from history import History
from lifecycle import accept_catalog, targets, credential_generation, credential_ready, retry_delay
from sample import run as sample
from official_catalog import CatalogRequestError
from transport import VersionError
from process_lock import process_lock

def code_identity(args):
    root=Path(__file__).resolve().parent
    files=[root/name for name in ('continuous.py','lifecycle.py','sample.py','history.py',
        'official_catalog.py','transport.py','http2.py','process_lock.py','total-descriptors.pb')]
    files += [root.parent/'collector.py']
    return {str(path.relative_to(root.parent)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}

def atomic_json(path,value):
    temp=path.with_suffix('.partial')
    with temp.open('w',encoding='utf-8') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2)
        stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)

def refresh_catalog(args,history,state,discover_fn=None):
    if discover_fn is None:
        from official_catalog import OfficialCatalog
        discover_fn=OfficialCatalog(args.master_config,args.output,args.proxy,args.client_version,
            stop_file=Path(args.output)/'STOP',deadline=state.get('deadline'))
    previous=history.catalog()
    definition=accept_catalog(previous,discover_fn())
    highest=max(state.get('highestEventId',0),(previous or {}).get('highestEventId',0))
    if previous and previous.get('event'):
        highest=max(highest,int(previous['event']['id']))
    candidate=definition.get('event')
    if candidate:
        if int(candidate['id'])<highest:raise ValueError('event regressed across idle period')
        highest=int(candidate['id'])
    # The catalog commit must preserve this even if the separate state checkpoint is lost.
    definition['highestEventId']=highest
    history.catalog(definition)
    state['highestEventId']=highest
    event=definition.get('event')
    state['eventId']=event['id'] if event else None
    event_file=Path(args.output)/'discovered-event.json'
    atomic_json(event_file,definition)
    return definition


def cycle(args,history,state,discover_fn=None,sample_fn=sample):
    now=time.time();status='waiting';detail=None
    if now<state.get('retryAfter',0):return 'cooldown',None
    identity,generation=credential_generation(args.credentials)
    if not credential_ready(state,identity,generation):return 'credentials_required',None
    try:definition=refresh_catalog(args,history,state,discover_fn)
    except InterruptedError:
        return ('stopped' if (Path(args.output)/'STOP').exists() else 'deadline'),None
    except CatalogRequestError as error:
        if error.receipt.get('status')==429 or error.receipt.get('grpc_status')=='8':
            state['retryAfter']=time.time()+retry_delay(error.receipt,args.interval)
            return 'catalog_rate_limited',str(error)
        return 'catalog_failed',str(error)
    if not targets(definition,int(time.time()*1000)):return 'between_events',None
    if (Path(args.output)/'STOP').exists():return 'stopped',None
    if time.time()>=state['deadline']:return 'deadline',None
    identity,generation=credential_generation(args.credentials)
    if not credential_ready(state,identity,generation):return 'credentials_required',None
    event_file=Path(args.output)/'discovered-event.json'
    with history.connect() as db:
        cursor=db.execute('SELECT COALESCE(MAX(sequence),0) FROM observations').fetchone()[0]
    try:
        acquired=sample_fn(SimpleNamespace(credentials=args.credentials,event=str(event_file),
            output=args.output,client_version=args.client_version,proxy=args.proxy,rounds=1,
            interval=args.interval,credential_identity=identity,deadline=state['deadline']))
        status=('success' if acquired else 'stopped' if (Path(args.output)/'STOP').exists()
                else 'deadline' if time.time()>=state['deadline'] else 'between_events')
    except (RuntimeError,ValueError,OSError,subprocess.SubprocessError) as error:
        status='sampling_failed';detail=type(error).__name__
        if isinstance(error,VersionError):
            detail=str(error)
            if error.receipt.get('status')==429 or error.receipt.get('grpc_status')=='8':
                state['retryAfter']=time.time()+retry_delay(error.receipt,args.interval)
                status='rate_limited'
    with history.connect() as db:
        rows=db.execute('SELECT error,receipt FROM observations WHERE sequence>? ORDER BY sequence',(cursor,)).fetchall()
    for row in rows:
        if not row['error'] or not row['receipt']:continue
        receipt=json.loads(gzip.decompress(row['receipt']))
        headers={k.lower():v for k,v in receipt.get('headers',{}).items()}
        trailers={k.lower():v for k,v in receipt.get('trailers',{}).items()}
        grpc=trailers.get('grpc-status',headers.get('grpc-status'))
        if receipt.get('status')==401 or grpc=='16':
            state['blockedGeneration']=generation;status='credentials_required'
        elif receipt.get('status')==429 or grpc=='8':
            state['retryAfter']=time.time()+retry_delay(receipt,args.interval);status='rate_limited'
        elif receipt.get('status')==403 or grpc=='7':
            state['blockedGeneration']=generation;status='permission_required'
    if status=='success':
        state.pop('blockedGeneration',None)
        state['lastSuccessAt']=time.time()
    return status,detail

def run(args):
    output=Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True)
    state_file=output/'collector-state.json'
    with process_lock(output/'continuous.lock',timeout=1):
        history=History(output/'history.sqlite3')
        if state_file.exists():
            state=json.loads(state_file.read_text(encoding='utf-8'))
            if state['status']=='complete':raise ValueError('completed run requires a new output directory')
        else:
            state=dict(runId=uuid.uuid4().hex,startedAt=time.time(),deadline=time.time()+args.hours*3600,
                cycles=0,status='starting',interval=args.interval,codeIdentity=code_identity(args),
                configIdentity=args.config_identity)
        if state.get('configIdentity')!=args.config_identity:raise ValueError('resume configuration changed')
        if state['interval']!=args.interval:raise ValueError('resume interval changed')
        if state.get('codeIdentity')!=code_identity(args):raise ValueError('run source changed; use a new output directory')
        identity,generation=credential_generation(args.credentials)
        credential_ready(state,identity,generation)
        with history.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS collector_cycles(id INTEGER PRIMARY KEY,run_id TEXT,started REAL,finished REAL,status TEXT,detail TEXT)')
            db.execute("UPDATE collector_cycles SET status='interrupted',finished=? WHERE finished IS NULL",(time.time(),))
        state['pid']=os.getpid();state['status']='starting';state['launchToken']=args.launch_token
        atomic_json(state_file,state)
        try:
            while time.time()<state['deadline'] and not (output/'STOP').exists():
                if state['codeIdentity']!=code_identity(args):raise ValueError('run source changed')
                started=time.time()
                with history.connect() as db:
                    row_id=db.execute('INSERT INTO collector_cycles(run_id,started,status) VALUES(?,?,?)',
                        (state['runId'],started,'running')).lastrowid
                try:
                    status,detail=cycle(args,history,state)
                except (OSError,ValueError,RuntimeError) as error:
                    status,detail='cycle_failed',type(error).__name__
                with history.connect() as db:
                    db.execute('UPDATE collector_cycles SET finished=?,status=?,detail=? WHERE id=?',
                        (time.time(),status,detail,row_id))
                state['cycles']+=1;state['status']=status;state['updatedAt']=time.time()
                atomic_json(state_file,state)
                print(json.dumps(dict(cycle=state['cycles'],status=status,eventId=state.get('eventId'))),flush=True)
                next_tick=started+args.interval
                while time.time()<min(next_tick,state['deadline']) and not (output/'STOP').exists():
                    time.sleep(min(5,max(0,min(next_tick,state['deadline'])-time.time())))
            state['status']='stopped' if (output/'STOP').exists() else 'complete'
        except KeyboardInterrupt:
            state['status']='stopped'
        except Exception:
            state['status']='crashed'
            raise
        finally:
            state['updatedAt']=time.time();atomic_json(state_file,state)
