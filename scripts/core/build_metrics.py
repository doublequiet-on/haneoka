# L3 — GEB
# Input: CLI stage identity, explicit initial cache declaration and existing stage results.
# Output: Separate per-invocation timing, counts and reuse/transfer diagnostics.
# Pos: [Map](L2-2.md); resource build observability outside resource identities.
# Effects/Dependencies: Writes an opt-in report directory; never edits release manifests.
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

_results = []


def observe(value):
    if not os.environ.get("PIPELINE_MEASUREMENTS_DIR") or not isinstance(value, dict):
        return
    selected = {key: value[key] for key in (
        "sourceId", "releaseId", "buildId", "transfer", "reuse", "reuseStats",
        "downloaded", "downloadedBytes", "reused", "reusedBytes", "skipped",
        "pendingShards", "reason", "status", "counts", "cache", "metrics",
    ) if key in value}
    if selected:
        _results.append(selected)


@contextmanager
def measure(args):
    directory = os.environ.get("PIPELINE_MEASUREMENTS_DIR")
    if not directory:
        yield
        return
    _results.clear()
    started, cpu = time.perf_counter(), time.process_time()
    state = "failed"
    try:
        yield
        state = "completed"
    finally:
        commit = subprocess.run(["git", "-C", str(Path(__file__).resolve().parents[2]), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        identity = {key: getattr(args, key, None) for key in ("command", "server", "source", "build", "release")}
        options = json.loads(os.environ.get("HANEOKA_RESOURCE_BUILD_OPTIONS", "{}"))
        report = {
            "schema": "haneoka-resource-measurement-v1", "commit": commit,
            "run": os.environ.get("GITHUB_RUN_ID", "local"), "attempt": os.environ.get("GITHUB_RUN_ATTEMPT", "1"),
            "identity": identity, "options": options,
            "recipeSource": commit,
            "invocationIdentitySha256": hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest(),
            "initialCache": os.environ.get("PIPELINE_INITIAL_CACHE", "unspecified; not a controlled comparison"),
            "elapsedMs": (time.perf_counter() - started) * 1000,
            "processCpuMs": (time.process_time() - cpu) * 1000,
            "childCpuIncluded": False, "state": state, "stageResults": _results,
        }
        target = Path(directory)
        target.mkdir(parents=True, exist_ok=True)
        (target / f"{args.command}-{uuid.uuid4().hex}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
