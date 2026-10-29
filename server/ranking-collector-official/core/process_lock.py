# L3 — GEB
# Input: Runtime lock path and optional acquisition timeout.
# Output: A shared Windows/POSIX exclusive process-lock context.
# Pos: [Map](../../L2.md); collector process coordination.
# Effects/Dependencies: Opens a local lock file and holds an OS lock until context or process exit.
from contextlib import contextmanager
import errno
import os
from pathlib import Path
import time


def try_lock(stream):
    try:
        if os.name=='nt':
            import msvcrt
            stream.seek(0)
            msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError as error:
        if error.errno in (errno.EACCES,errno.EAGAIN,errno.EDEADLK) or getattr(error,'winerror',None) in (32,33):
            raise BlockingIOError(errno.EWOULDBLOCK,'Collector lock is already held') from None
        raise


@contextmanager
def process_lock(path,timeout=0):
    with Path(path).open('a+b') as stream:
        if stream.seek(0,os.SEEK_END)==0:
            stream.write(b'0')
            stream.flush()
        deadline=time.monotonic()+timeout
        while True:
            try:
                try_lock(stream)
                break
            except BlockingIOError:
                if time.monotonic()>=deadline:raise
                time.sleep(min(.02,max(0,deadline-time.monotonic())))
        try:
            yield
        finally:
            if os.name=='nt':
                import msvcrt
                stream.seek(0)
                msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(),fcntl.LOCK_UN)
