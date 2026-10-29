# L3 — GEB
# Input: Fixed package hashes, local wheelhouse and the selected Python interpreter.
# Output: An isolated collector virtual environment with a completed doctor check.
# Pos: [Map](../L2.md); portable offline installation entry point.
# Effects/Dependencies: Verifies local files, recreates the tool-owned venv and runs offline pip subprocesses.
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from build import DISTRIBUTIONS

ROOT=Path(__file__).resolve().parent


def executable(path):
    value=str(path.absolute())
    if os.name=='nt' and not value.startswith('\\\\?\\'):
        return '\\\\?\\UNC\\'+value[2:] if value.startswith('\\\\') else '\\\\?\\'+value
    return value


def install(python):
    wheelhouse=ROOT/'wheelhouse'
    if not wheelhouse.is_dir():raise ValueError('Missing offline wheelhouse; see README')
    manifest=ROOT/'MANIFEST.json'
    if manifest.exists():
        for relative,expected in json.loads(manifest.read_text(encoding='utf-8')).items():
            path=(ROOT/relative).resolve()
            if not path.is_relative_to(ROOT):raise ValueError('Invalid bundle path')
            with path.open('rb') as stream:
                if hashlib.file_digest(stream,'sha256').hexdigest()!=expected:raise ValueError('Bundle checksum mismatch')
    for name,expected in DISTRIBUTIONS.items():
        with (wheelhouse/name).open('rb') as stream:
            if hashlib.file_digest(stream,'sha256').hexdigest()!=expected:
                raise ValueError('Pinned distribution checksum mismatch: '+name)
    environment=ROOT/'.venv'
    if environment.is_symlink() or environment.is_junction():
        raise ValueError('Refuse a linked virtual environment')
    if environment.exists() and environment.samefile(sys.prefix):
        raise ValueError('Run setup with Python outside the tool virtual environment')
    probe=subprocess.run([python,'-c',"import json,sys;print(json.dumps(dict(version=list(sys.version_info[:3]),prefix=sys.prefix)))"],
                         check=True,capture_output=True,text=True)
    selected=json.loads(probe.stdout)
    if tuple(selected['version'])<(3,12):raise ValueError('Python 3.12 or newer required')
    if environment.exists() and environment.samefile(selected['prefix']):
        raise ValueError('Select Python outside the tool virtual environment')
    subprocess.run([python,'-m','venv','--clear',str(environment)],check=True)
    interpreter=executable(ROOT/'.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python'))
    pip=[interpreter,'-m','pip','install','--disable-pip-version-check','--no-index','--no-cache-dir',
         '--find-links',str(wheelhouse),'--require-hashes']
    subprocess.run([*pip,'-r',str(ROOT/'build-requirements.txt')],check=True)
    subprocess.run([*pip,'--no-build-isolation','-r',str(ROOT/'requirements.txt')],check=True)
    subprocess.run([interpreter,str(ROOT/'collector.py'),'doctor'],check=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Install the collector from its offline wheelhouse')
    parser.add_argument('--python',default=sys.executable)
    arguments=parser.parse_args()
    try:install(arguments.python)
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        print(f'{type(error).__name__}: {error}',file=sys.stderr)
        sys.exit(1)
