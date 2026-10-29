"""L3: server/L2.md -> ranking-collector-official; catalog discovery and credential generation."""
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request

def identifier(value):
    value=str(value)
    if not re.fullmatch('[1-9][0-9]{0,18}',value):raise ValueError('invalid catalog identity')
    return value

def targets(definition, now_ms):
    event=definition['event']
    if event is None:return []
    if not event['startAtMs']<=now_ms<event['endAtMs']+event.get('aggregationSeconds',0)*1000:
        return []
    if event['status'] not in ('nowOn','aggregation'):return []
    result=[('challenge',c['id']) for c in event['challenges'] if c['enabled']
        and c['startAtMs']<=now_ms<c['endAtMs']+event.get('aggregationSeconds',0)*1000]
    if event.get('totalRankingEnabled',True):result.append(('total',''))
    return result

def accept_catalog(previous, candidate):
    if previous and previous.get('event') and candidate.get('event'):
        old=previous['event'];new=candidate['event']
        if int(new['id'])<int(old['id']):raise ValueError('catalog event regressed')
        if new['id']==old['id']:
            old_ids={(c['id'],c['musicId']) for c in old['challenges']}
            new_ids={(c['id'],c['musicId']) for c in new['challenges']}
            if not old_ids<=new_ids:raise ValueError('catalog identity changed')
    return candidate

def credential_generation(path):
    path=Path(path)
    if path.is_symlink() or path.stat().st_size>65536:raise ValueError('invalid credential file')
    raw=path.read_bytes();value=json.loads(raw.decode('utf-8-sig'))
    if value.get('region')!='jp' or value.get('origin')!='https://api.bang-dream-on.jp':
        raise ValueError('credential origin mismatch')
    credentials=value.get('credentials',{})
    for key in ('player_id','credential'):
        if not isinstance(credentials.get(key),str) or not credentials[key]:raise ValueError('incomplete credential')
    if credentials.get('bid'):raise ValueError('international identity rejected')
    identity=hashlib.sha256(credentials['player_id'].encode()).hexdigest()
    auth={key:credentials[key] for key in ('player_id','credential')}
    auth['device_id']=credentials.get('device_id') or None
    if auth['device_id'] is not None and not isinstance(auth['device_id'],str):raise ValueError('invalid device identity')
    generation=hashlib.sha256(json.dumps(auth,sort_keys=True).encode()).hexdigest()
    return identity,generation

def credential_ready(state, identity, generation):
    if state.get('identity') not in (None,identity):raise ValueError('collector account changed')
    state['identity']=identity
    return state.get('blockedGeneration')!=generation

def retry_delay(receipt, minimum):
    from email.utils import parsedate_to_datetime
    headers={k.lower():v for k,v in receipt.get('headers',{}).items()}
    value=headers.get('retry-after','')
    try:delay=int(value)
    except ValueError:
        try:delay=int(parsedate_to_datetime(value).timestamp()-time.time())
        except (ValueError,TypeError,OverflowError):delay=minimum
    return max(minimum,delay)
