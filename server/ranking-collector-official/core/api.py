"""L3: server/L2.md -> ranking-collector-official; loopback observation API."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from history import History

def server(history, port):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url=urlsplit(self.path)
            status=200
            if url.path=='/api/v2/game/records/jp/status':
                state_path=Path(history.path).parent/'collector-state.json'
                state=json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
                now=int(time.time()*1000)
                with history.connect() as db:
                    latest=db.execute('SELECT max(observed_ms) FROM observations WHERE error IS NULL').fetchone()[0]
                age=now-latest if latest is not None else None
                body=dict(contract='haneoka:ranking-status/1',serverTimeMs=now,
                    collectorStatus=state.get('status','not_started'),samplingIntervalSeconds=state.get('interval'),
                    lastSuccessfulObservationAtMs=latest,ageMs=age,stale=age is None or age>600000,
                    pollAfterSeconds=15,catalogProvider='official-master')
            elif url.path=='/api/v2/game/records/jp/events/current':
                body=history.catalog()
                if body is None: status=404
                else:
                    now=int(time.time()*1000)
                    observed=body.get('catalogObservedAtMs')
                    age=now-observed if observed is not None else None
                    event=body.get('event')
                    expired=bool(event and now>=event['endAtMs']+
                        (event.get('aggregationSeconds',0)*1000 if event['status']=='aggregation' else 0))
                    body.update(serverTimeMs=now,ageMs=age,
                        stale=bool(body.get('stale')) or age is None or age<0 or age>600000 or expired)
            else:
                match=re.fullmatch(r'/api/v2/game/records/jp/events/([1-9][0-9]*)/(total|challenges/([1-9][0-9]*))/(latest|history)',url.path)
                if not match:
                    status,body=404,{'error':'not_found'}
                else:
                    event,_,challenge,operation=match.groups()
                    query=parse_qs(url.query)
                    try:
                        after=int(query.get('after',['0'])[0]) if operation=='history' else None
                        if after is not None and after<0: raise ValueError()
                        rows=history.read(('jp',event,'challenge' if challenge else 'total',challenge or ''),after)
                        body=({'observations':rows,'nextCursor':rows[-1]['cursor'] if rows else after}
                              if operation=='history' else (rows[0] if rows else None))
                        if body is None: status=404
                    except ValueError:
                        status,body=400,{'error':'invalid_query_or_payload'}
            raw=json.dumps(body,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def log_message(self,*args): pass
    return ThreadingHTTPServer(('127.0.0.1',port),Handler)
