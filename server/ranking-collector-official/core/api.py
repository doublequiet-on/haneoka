# L3 — GEB
# Input: A fixed-region history database and loopback HTTP requests.
# Output: Read-only observations, catalog freshness and collector status.
# Pos: [Map](../../L2.md); region and local-origin boundary for history reads.
# Effects/Dependencies: Binds loopback HTTP; GET never writes or contacts the game.
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

def server(history, port, region='jp'):
    from regions import region_config
    region_config(region)
    prefix='/api/v2/game/records/'+region
    history.assert_region(region)
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body):
            raw=json.dumps(body,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            authorities={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
            if self.server.server_port==80: authorities.update(('127.0.0.1','localhost'))
            hosts=self.headers.get_all('Host',[])
            if len(hosts)!=1 or hosts[0].lower() not in authorities:
                self.respond(403,{'error':'local_host_required'})
                return
            origins=self.headers.get_all('Origin',[])
            if origins and (len(origins)!=1 or origins[0].lower() not in {'http://'+host for host in authorities}):
                self.respond(403,{'error':'local_origin_required'})
                return
            try:
                status,body=self.read_response()
            except (OSError,ValueError,TypeError,KeyError,sqlite3.Error):
                status,body=500,{'error':'history_unavailable'}
            self.respond(status,body)

        def read_response(self):
            url=urlsplit(self.path)
            if not url.path.startswith(prefix+'/'):
                return 404,{'error':'not_found'}
            history.assert_region(region, audit=False)
            status=200
            if url.path==prefix+'/status':
                state_path=Path(history.path).parent/'collector-state.json'
                state=json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
                if not isinstance(state,dict):raise ValueError('invalid collector state')
                if state and state.get('region','jp')!=region:
                    raise ValueError('collector state region changed')
                now=int(time.time()*1000)
                with history.connect() as db:
                    latest=db.execute('SELECT max(observed_ms) FROM observations WHERE error IS NULL AND region=?',(region,)).fetchone()[0]
                age=now-latest if latest is not None else None
                body=dict(contract='haneoka:ranking-status/1',region=region,serverTimeMs=now,
                    collectorStatus=state.get('status','not_started'),samplingIntervalSeconds=state.get('interval'),
                    lastSuccessfulObservationAtMs=latest,ageMs=age,stale=age is None or age<0 or age>600000,
                    pollAfterSeconds=15,catalogProvider='official-master')
            elif url.path==prefix+'/events/current':
                body=history.catalog()
                if body is None: status=404
                else:
                    if body['region']!=region:raise ValueError('catalog region changed')
                    now=int(time.time()*1000)
                    observed=body.get('catalogObservedAtMs')
                    age=now-observed if observed is not None else None
                    event=body.get('event')
                    expired=bool(event and now>=event['endAtMs']+
                        (event.get('aggregationSeconds',0)*1000 if event['status']=='aggregation' else 0))
                    body.update(serverTimeMs=now,ageMs=age,
                        stale=bool(body.get('stale')) or age is None or age<0 or age>600000 or expired)
            else:
                match=re.fullmatch(prefix+r'/events/([1-9][0-9]*)/(total|challenges/([1-9][0-9]*))/(latest|history)',url.path)
                if not match:
                    status,body=404,{'error':'not_found'}
                else:
                    event,_,challenge,operation=match.groups()
                    query=parse_qs(url.query)
                    try:
                        after=int(query.get('after',['0'])[0]) if operation=='history' else None
                        if after is not None and not 0<=after<=9223372036854775807: raise ValueError()
                    except ValueError:
                        return 400,{'error':'invalid_query'}
                    rows=history.read((region,event,'challenge' if challenge else 'total',challenge or ''),after)
                    body=({'observations':rows,'nextCursor':rows[-1]['cursor'] if rows else after}
                          if operation=='history' else (rows[0] if rows else None))
                    if body is None: status=404
            return status,body
        def log_message(self,*args): pass
    return ThreadingHTTPServer(('127.0.0.1',port),Handler)
