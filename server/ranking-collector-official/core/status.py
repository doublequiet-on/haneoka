"""L3: server/L2.md -> ranking-collector-official; read-only run evidence."""
import argparse
import json
from pathlib import Path
import sqlite3
import time
from history import decode_payload

def report(output,verify=False):
    output=Path(output).resolve()
    state=json.loads((output/'collector-state.json').read_text(encoding='utf-8'))
    db=sqlite3.connect((output/'history.sqlite3').as_uri()+'?mode=ro',uri=True)
    try:
        cycles=dict(db.execute('SELECT status,count(*) FROM collector_cycles GROUP BY status'))
        boards=[dict(eventId=e,kind=k,challenge=c or None,count=n,firstAt=a,lastAt=b)
            for e,k,c,n,a,b in db.execute('''SELECT event_id,board_kind,challenge_id,count(*),min(observed_ms),max(observed_ms)
              FROM observations WHERE error IS NULL GROUP BY event_id,board_kind,challenge_id''')]
        failures=db.execute('SELECT count(*) FROM observations WHERE error IS NOT NULL').fetchone()[0]
        max_gap=db.execute('''SELECT max(gap) FROM (SELECT observed_ms-lag(observed_ms) OVER
            (PARTITION BY region,event_id,board_kind,challenge_id ORDER BY sequence) AS gap
            FROM observations WHERE error IS NULL)''').fetchone()[0]
        verified=0
        if verify:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('database integrity failed')
            if db.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('database foreign key check failed')
            if db.execute('SELECT 1 FROM observations WHERE (payload_hash IS NULL)=(error IS NULL) LIMIT 1').fetchone():
                raise ValueError('observation payload status mismatch')
            for digest,body in db.execute('SELECT hash,body FROM payloads'):
                decode_payload(digest,body);verified+=1
        return dict(runId=state['runId'],status=state['status'],pid=state['pid'],
            startedAt=state['startedAt'],deadline=state['deadline'],updatedAt=state.get('updatedAt'),
            elapsedHours=round((min(time.time(),state.get('updatedAt',time.time()))-state['startedAt'])/3600,3),
            interval=state['interval'],cycles=cycles,boards=boards,failedObservations=failures,
            maxObservedGapSeconds=max_gap/1000 if max_gap is not None else None,verifiedPayloads=verified,
            dbBytes=(output/'history.sqlite3').stat().st_size,
            walBytes=(output/'history.sqlite3-wal').stat().st_size if (output/'history.sqlite3-wal').exists() else 0)
    finally:db.close()
