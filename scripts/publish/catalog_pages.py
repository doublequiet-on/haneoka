# L3 — GEB
# Input: Configured R2 credentials and completed public resource releases.
# Output: Hash-verified local catalog inputs or immutable page object operations.
# Pos: [Map](L2-2.md); R2 adapter for independent page snapshot publication.
# Effects/Dependencies: R2 reads and conditional creates; never changes resource current.
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from botocore.exceptions import ClientError
from core.contracts import RELEASE_IDENTITY_FILENAME, release_identity_descriptor
from core.manifests import write_json
from core.paths import validate_release_path
from core.storage import cas_key
from publish.r2 import R2Store, _current_pointer, _current_release_manifest, IMMUTABLE_CACHE


def store_config(server="jp"):
    return SimpleNamespace(id=server, r2_bucket=os.environ.get("R2_BUCKET", "hotdori-assets"))


def vector(store):
    result = []
    for server in ("jp", "intl"):
        pointer = _current_pointer(store, store_config(server))
        if pointer is None:
            raise ValueError(f"public source unavailable: {server}")
        result.append({"state": "published", "server": server, "releaseId": pointer["releaseId"], "sourceId": pointer["sourceId"]})
    return result


def stage(store, output):
    output = output.resolve()
    roots = {}
    captured = []
    for server in ("jp", "intl"):
        pointer, manifest = _current_release_manifest(store, store_config(server))
        if pointer is None or manifest is None:
            raise ValueError(f"public release unavailable: {server}")
        identity = release_identity_descriptor(server, pointer["releaseId"], manifest)
        if identity["sourceId"] != pointer["sourceId"]:
            raise ValueError("resource pointer source differs from release")
        root = output / server / pointer["releaseId"]
        root.mkdir(parents=True, exist_ok=True)
        write_json(root / "release.json", manifest)
        write_json(root / RELEASE_IDENTITY_FILENAME, identity)
        seen = set()
        selected = []
        for entry in manifest["entries"]:
            relative = entry["path"]
            validate_release_path(relative)
            if relative in seen:
                raise ValueError("duplicate release path")
            seen.add(relative)
            if relative.endswith(".json") and relative.startswith(("api/", "metadata/")):
                selected.append(entry)
        def download(entry):
            destination = root.joinpath(*entry["path"].split("/"))
            if not destination.resolve().is_relative_to(root.resolve()):
                raise ValueError("release path escaped output")
            store.download_file(cas_key(entry["sha256"]), destination, expected_bytes=entry["bytes"], expected_sha256=entry["sha256"])
        with ThreadPoolExecutor(max_workers=16) as pool:
            list(pool.map(download, selected))
        roots[server] = str(root)
        captured.append({"state": "published", "server": server, "releaseId": pointer["releaseId"], "sourceId": pointer["sourceId"]})
    write_json(output / "vector.json", captured)
    write_json(output / "roots.json", roots)
    return {"roots": roots, "resourceVector": captured}


def bridge(store):
    pattern = re.compile(r"catalog-pages/v1/(?:(?:objects|ready)/[a-f0-9]{64}|computed/(?:jp|intl)/r-[a-f0-9]{20}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/[a-f0-9]{40}/chart-rates-v6)\.json\Z")
    for line in sys.stdin:
        try:
            request = json.loads(line)
            key = request["key"]
            if not pattern.fullmatch(key):
                raise ValueError("invalid immutable page key")
            if request["operation"] == "read":
                body = store.get_bytes(key)
                result = {"body": None if body is None else base64.b64encode(body).decode("ascii")}
            elif request["operation"] == "create":
                body = base64.b64decode(request["body"], validate=True)
                if len(body) > 64 * 1024 * 1024:
                    raise ValueError("page object exceeds byte limit")
                if "/objects/" in key and hashlib.sha256(body).hexdigest() != key.rsplit("/", 1)[1][:-5]:
                    raise ValueError("page object hash mismatch")
                try:
                    store.client.put_object(Bucket=store.bucket, Key=key, Body=body, ContentType="application/json", CacheControl=IMMUTABLE_CACHE, IfNoneMatch="*")
                except ClientError as error:
                    if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 412 or store.get_bytes(key) != body:
                        raise
                result = {"created": True}
            else:
                raise ValueError("unknown page bridge operation")
            print(json.dumps(result), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("stage", "bridge", "check-current"))
    parser.add_argument("--output", type=Path, default=Path(".output/catalog-page-inputs"))
    args = parser.parse_args()
    store = R2Store(store_config())
    if args.mode == "bridge":
        bridge(store)
    elif args.mode == "stage":
        print(json.dumps(stage(store, args.output)))
    else:
        expected = json.loads((args.output / "vector.json").read_text(encoding="utf-8"))
        if vector(store) != expected:
            raise SystemExit(2)


if __name__ == "__main__":
    main()
