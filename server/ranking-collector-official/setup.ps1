# L3: server/L2.md -> ranking-collector-official; isolated offline installation.
param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath "$PSScriptRoot/wheelhouse")) { throw 'Missing offline wheelhouse; see README' }
& $Python -c "import sys,platform; assert sys.version_info[:2] == (3,12) and platform.machine() == 'AMD64', 'Python 3.12 x64 required'"
if ($LASTEXITCODE -ne 0) { throw 'Unsupported Python runtime' }
& $Python -m venv "$PSScriptRoot/.venv"
if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed' }
$taskPython = [System.IO.Path]::GetFullPath("$PSScriptRoot/.venv/Scripts/python.exe")
# setuptools includes deeply nested package data; retain Windows extended paths during installation.
if ($taskPython.StartsWith('\\')) { $taskPython = '\\?\UNC\' + $taskPython.Substring(2) }
else { $taskPython = '\\?\' + $taskPython }
& $taskPython -m pip install --disable-pip-version-check --no-index --no-cache-dir --find-links "$PSScriptRoot/wheelhouse" --require-hashes -r "$PSScriptRoot/build-requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Offline build dependencies failed' }
& $taskPython -m pip install --disable-pip-version-check --no-index --no-cache-dir --no-build-isolation --find-links "$PSScriptRoot/wheelhouse" --require-hashes -r "$PSScriptRoot/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Offline runtime dependencies failed' }
& $taskPython "$PSScriptRoot/collector.py" doctor
if ($LASTEXITCODE -ne 0) { throw 'Collector prerequisites failed' }
