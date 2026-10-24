# L3 — GEB
# Input: Explicit current release identities and their immutable Master/catalog objects.
# Output: Chat customization catalog and repaired reward references in the selected catalogs.
# Pos: [Publish map](L2-2.md); bounded catalog projection using the canonical reward producer.
# Effects/Dependencies: Reads R2; dry-run emits a candidate, publication conditionally promotes it.
"""Project missing reward objects and links from one pinned release per server."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build.catalog_storage import _compile_resource
from build.collectibles import build_chat_customizations
from build.game_systems import _resource
from core.config import load_server_config
from core.manifests import stable_json, write_json
from core.master_values import RESOURCE_TYPES, _image_variants
from core.storage import cas_key
from publish.band_descriptions import document, publish
from publish.missions import PinnedMissionData
from publish.r2 import R2Store, _validate_release_manifest_for_gc
from publish.runtime_projection import _ReleasedInputs
from verify.release import release_entries, write_release_identity_files

REWARD_CATALOGS = (
    "passes", "login-campaigns", "events", "shop", "exchange", "gacha", "missions", "tgw-card", "studio",
)
MASTER_TABLES = (
    "MasterText", "MasterGacha", "MasterDegree", "MasterBiliChatTheme", "MasterBiliChatBubble", "MasterBiliChatFrame",
)
RESOURCE_TYPES_TO_REPAIR = {7, 17, 19, 1001, 1002, 1003}


def project(base, read_entry, staging):
    records = _validate_release_manifest_for_gc(
        base, f"servers/{base['server']}/releases/{base['releaseId']}/release.json", base["server"], base["releaseId"],
    )
    entries = {row["path"]: row for row in records}
    with tempfile.TemporaryDirectory(prefix="reward-catalog-inputs-") as directory:
        inputs = _ReleasedInputs(base, read_entry, Path(directory))
        catalog = inputs.json("api/v1/catalog/manifest.json")
        tables = {name: inputs.json(f"objects/master/{name}.json") for name in MASTER_TABLES}
        data = PinnedMissionData(base["server"], tables, entries)
        documents = {"stories": inputs.json(catalog["resources"]["stories"]["index"])}
        chat = build_chat_customizations(data)
        for row in chat["entries"].values():
            variants = _image_variants(data, row)
            if variants:
                row["imageVariants"] = variants
        changed_rewards = {}

        def repair(value):
            count = 0
            if isinstance(value, list):
                return sum(repair(child) for child in value)
            if not isinstance(value, dict):
                return 0
            if value.get("resourceType") in RESOURCE_TYPES_TO_REPAIR and "resourceId" in value:
                resolved = _resource(data, documents, RESOURCE_TYPES, int(value["resourceType"]), int(value["resourceId"]))
                before = copy.deepcopy(value)
                for field in ("kind", "name", "secondary", "image", "href"):
                    if not value.get(field) or isinstance(value[field], list) and not any(value[field]):
                        if resolved[field]:
                            value[field] = resolved[field]
                count += value != before
            return count + sum(repair(child) for key, child in value.items() if key != "raw")

        api = staging / "api/v1/catalog"
        updated = copy.deepcopy(catalog)
        descriptor, _ = _compile_resource("chat-customizations", chat, api)
        updated["resources"]["chat-customizations"] = descriptor
        for name in REWARD_CATALOGS:
            descriptor = catalog["resources"].get(name)
            if descriptor is None:
                continue
            value = inputs.resource(name, descriptor)
            count = repair(value)
            changed_rewards[name] = count
            if count:
                updated["resources"][name], _ = _compile_resource(name, value, api)
        write_json(api / "manifest.json", updated, pretty=True)
        selected = release_entries(staging)
        allowed_resources = set(REWARD_CATALOGS) | {"chat-customizations"}
        def allowed(path):
            return path == "api/v1/catalog/manifest.json" or any(
                path.startswith(f"api/v1/catalog/{name}/") for name in allowed_resources)
        if any(not allowed(row["path"]) for row in selected):
            raise ValueError("reward projection escaped its catalog scope")
        replaced = {row["path"] for row in selected}
        reused = [row for row in records if row["path"] not in replaced]
        manifest = write_release_identity_files(staging, base["server"], base["sourceId"],
                                                sorted(reused + selected, key=lambda row: row["path"]))
        _validate_release_manifest_for_gc(manifest,
            f"servers/{base['server']}/releases/{manifest['releaseId']}/release.json", base["server"], manifest["releaseId"])
        uploads = [row for row in selected if row != entries.get(row["path"])]
        return {"manifest": manifest, "sourceId": base["sourceId"], "changedEntries": uploads,
                "reusedEntryCount": len(reused), "noOp": not uploads, "chat": chat,
                "changedRewards": changed_rewards, "inputs": list(inputs.inputs.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pin = os.environ["PRODUCER_PIN"]
    if not re.fullmatch(r"[a-f0-9]{40}", pin) or subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != pin:
        raise ValueError("reward producer pin differs")
    config = load_server_config(os.environ["RESOURCE_SERVER"])
    projection = json.loads(os.environ["CATALOG_PROJECTION_JSON"])[config.id]
    identity = projection["identity"]
    store = R2Store(config, concurrency=4)
    key = f"servers/{config.id}/current.json"
    head = store.head(key)
    pointer = document(store, key, 4096)
    if any(pointer.get(field) != identity.get(field) for field in ("server", "sourceId", "releaseId")):
        raise ValueError("current changed since reward review")
    etag = head["ETag"]
    manifest_key = f"servers/{config.id}/releases/{identity['releaseId']}/release.json"
    if pointer.get("releaseManifest") != manifest_key:
        raise ValueError("reward current manifest path differs")
    base = document(store, manifest_key)
    if base["sourceId"] != identity["sourceId"]:
        raise ValueError("reward parent source differs")
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="current-reward-catalog-") as directory:
        staging = Path(directory)
        prepared = project(base, lambda row: store.get_bytes(cas_key(row["sha256"])), staging)
        if store.get_json(key) != pointer or store.head(key)["ETag"] != etag:
            raise ValueError("current changed during reward projection")
        prepared.update(pointer=pointer, pointerETag=etag)
        candidate_sha = hashlib.sha256((staging / "release.json").read_bytes()).hexdigest()
        receipt = {"producerPin": pin, "server": config.id, "sourceId": base["sourceId"],
                   "baseReleaseId": base["releaseId"], "releaseId": prepared["manifest"]["releaseId"],
                   "candidateManifestSha256": candidate_sha, "changedRewards": prepared["changedRewards"],
                   "chatCount": len(prepared["chat"]["entries"]), "changedEntries": prepared["changedEntries"],
                   "reusedEntries": prepared["reusedEntryCount"], "inputs": prepared["inputs"], "published": False}
        write_json(args.output / "publication-receipt.json", receipt, pretty=True)
        write_json(args.output / "chat-customizations.json", prepared["chat"], pretty=True)
        write_json(args.output / "candidate-release.json", prepared["manifest"])
        if os.environ.get("PUBLISH") == "true":
            if (projection.get("candidateReleaseId") != receipt["releaseId"]
                    or projection.get("candidateManifestSha256") != candidate_sha):
                raise ValueError("reward publication requires its reviewed candidate identity")
            if not prepared["noOp"]:
                receipt["pointer"] = publish(store, config, prepared, staging)
                receipt["published"] = True
                write_json(args.output / "publication-receipt.json", receipt, pretty=True)
        print(stable_json({key: receipt[key] for key in ("server", "releaseId", "chatCount", "changedRewards", "published")}))


if __name__ == "__main__":
    main()
