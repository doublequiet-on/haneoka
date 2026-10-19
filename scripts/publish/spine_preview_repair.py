"""Render current Spine previews without rebuilding Unity, CRI or model graphs."""
from __future__ import annotations

import argparse
import copy
import json
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build.catalog_storage import _compile_resource
from build.spine import (
    PREVIEW_OUTPUT_PREFIX, PREVIEW_SCHEMA, _model_preview_job,
    _recipe_preview_job, _render_previews, count_visible_png_pixels,
)
from build.spine_catalog import build_spine_catalog, spine_records
from core.config import PROJECT_ROOT, load_server_config
from core.hashes import sha256_file
from core.manifests import read_json, write_json
from core.paths import BuildLayout, safe_id, validate_release_path
from core.process import hardlink_or_copy
from publish.band_descriptions import document, publish
from publish.r2 import R2Store, _validate_release_manifest_for_gc
from publish.runtime_projection import _ReleasedInputs
from verify.release import release_entries, write_release_identity_files

SPINE = "metadata/spine.json"
CATALOG = "api/v1/catalog/manifest.json"
RECEIPT = "metadata/projections/spine-previews.json"
MIN_PREVIEWS = 230
PRODUCERS = (
    "scripts/publish/spine_preview_repair.py", "scripts/build/spine.py",
    "scripts/build/spine_catalog.py", "scripts/build/catalog_storage.py",
)


def owned(path: str) -> bool:
    return (path in {SPINE, CATALOG, RECEIPT}
            or path.startswith((PREVIEW_OUTPUT_PREFIX + "/", "api/v1/catalog/spine/")))


def graph(value: dict) -> dict:
    """Remove only preview-owned fields when checking the inherited graph."""
    result = copy.deepcopy(value)
    for name in ("previewRenderedCount", "previewUnavailableCount", "previewReusedCount",
                 "previewReuseRestoreFailureCount", "renderRecipePreviewRenderedCount",
                 "renderRecipePreviewUnavailableCount", "previewSchema"):
        result.pop(name, None)
    for name in ("models", "unavailableModels", "renderRecipes", "unavailableRenderRecipes"):
        for record in spine_records(result.get(name), name).values():
            record.pop("preview", None)
            record.pop("previewInputSha256", None)
    result.get("browserRuntime", {}).pop("preview", None)
    return result


def bootstrap_node(output: Path) -> None:
    """Install only the exact renderer packages from the existing frozen lock."""
    catalog = (PROJECT_ROOT / "pnpm-workspace.yaml").read_text()
    names = ("esbuild", "three", "@esotericsoftware/spine-threejs")
    lock = (PROJECT_ROOT / "pnpm-lock.yaml").read_text()
    root = re.search(r"(?ms)^  \.:\n(.*?)(?=^  \S|\Z)", lock)
    if root is None:
        raise ValueError("Spine renderer root lock importer is absent")
    dependencies, records = {}, []
    for name in names:
        version = re.search(rf"(?m)^  ['\"]?{re.escape(name)}['\"]?: ([0-9]+\.[0-9]+\.[0-9]+)\s*$", catalog)
        if version is None:
            raise ValueError("Spine renderer dependency requires an exact catalog version")
        version = version[1]
        resolved = re.findall(rf"(?m)^      ['\"]?{re.escape(name)}['\"]?:\n        specifier: [^\n]+\n        version: ([^\n]+)", root[1])
        if len(resolved) != 1 or resolved[0].split("(", 1)[0] != version:
            raise ValueError("Spine renderer lock differs from its catalog version")
        dependencies[name] = version
        records.append(f"      '{name}':\n        specifier: {version}\n        version: {resolved[0]}\n")
    # Keep the existing package integrity records and resolved snapshots; only
    # select a standalone importer without unrelated workspace overrides.
    selected_lock = lock.split("\ncatalogs:", 1)[0] + "\nimporters:\n\n  .:\n    dependencies:\n"
    selected_lock += "".join(records) + "\npackages:" + lock.split("\npackages:", 1)[1]
    output.mkdir(parents=True, exist_ok=True)
    package = {"private": True, "packageManager": read_json(PROJECT_ROOT / "package.json")["packageManager"],
               "dependencies": dependencies}
    write_json(output / "package.json", package)
    (output / "pnpm-lock.yaml").write_text(selected_lock)
    (output / "pnpm-workspace.yaml").write_text("packages: ['.']\nallowBuilds:\n  esbuild: true\n")


def project(base: dict, read_entry, staging: Path, config, producer: dict, diagnostics: Path) -> dict:
    """Run the normal renderer and catalog compiler on one real released graph."""
    server, source = base["server"], base["sourceId"]
    records = _validate_release_manifest_for_gc(
        base, f"servers/{server}/releases/{base['releaseId']}/release.json", server, base["releaseId"],
    )
    entries = {row["path"]: row for row in records}
    if server not in {"intl", "jp"} or config.id != server:
        raise ValueError("Spine preview repair requires the selected production server")
    with tempfile.TemporaryDirectory(prefix="current-spine-preview-") as directory:
        root = Path(directory)
        inputs = _ReleasedInputs(base, read_entry, root)
        original = inputs.json(SPINE)
        if original.get("server") != server or original.get("sourceId") != source:
            raise ValueError("Spine graph belongs to a different source")
        metadata = copy.deepcopy(original)
        models = spine_records(metadata.get("models"), "models")
        recipes = spine_records(metadata.get("renderRecipes"), "renderRecipes")
        jobs = [job for model in models.values() if (job := _model_preview_job(model))]
        jobs.extend(job for recipe in recipes.values() if (job := _recipe_preview_job(recipe, models)))
        paths = set()
        for job in jobs:
            for component in job["components"]:
                paths.update(validate_release_path(component[key]["path"]) for key in ("json", "atlas"))
                paths.update(validate_release_path(page["path"]) for page in component["pages"])
        inputs.prefetch(sorted(paths))
        # Restore the complete authentic index for the normal asset-membership
        # semantics of the catalog projector; it never enters the overlay.
        data = inputs.data(base)
        layout = BuildLayout(root, root / "shards", root / "unity.sqlite", root / "assets",
                             root / "runtime", root / "objects", root / "master",
                             root / "api/v1/catalog", root / "metadata", root / "reports", root / "build.json")
        rendered, rendered_recipes, reuse = _render_previews(config, layout, list(models.values()), list(recipes.values()))
        write_json(diagnostics / "render-result.json", {
            "server": server, "sourceId": source, "baseReleaseId": base["releaseId"],
            "renderedModelPreviews": rendered, "renderedRecipePreviews": rendered_recipes,
            "minimumModelPreviews": MIN_PREVIEWS,
            "unavailable": {identity: model.get("preview") for identity, model in models.items()
                            if model.get("preview", {}).get("status") != "rendered"},
        }, pretty=True)
        if rendered < MIN_PREVIEWS:
            raise ValueError(f"Spine preview threshold failed: {rendered} < {MIN_PREVIEWS}")
        preview_files = {}
        for kind, collection in (("models", models), ("recipes", recipes)):
            for identity, model in collection.items():
                preview = model.get("preview", {})
                if preview.get("status") != "rendered":
                    continue
                relative = validate_release_path(preview["path"])
                if (relative != f"{PREVIEW_OUTPUT_PREFIX}/{kind}/{identity}.png"
                        or relative in preview_files or preview.get("schema") != PREVIEW_SCHEMA):
                    raise ValueError("Spine preview path/schema differs from its model")
                file = root / relative
                body = file.read_bytes()
                from PIL import Image
                with Image.open(file) as image:
                    image.load()
                    if image.format != "PNG" or list(image.size) != [preview.get("width"), preview.get("height")]:
                        raise ValueError("Spine preview PNG dimensions differ")
                if (len(body) != preview.get("bytes") or sha256_file(file) != preview.get("sha256")
                        or count_visible_png_pixels(body) != preview.get("visiblePixelCount")
                        or preview.get("visiblePixelCount", 0) <= 0):
                    raise ValueError("Spine preview PNG SHA/bytes/pixels differ")
                preview_files[relative] = {"sha256": preview["sha256"], "bytes": preview["bytes"]}
                hardlink_or_copy(file, staging / relative)
        if len(preview_files) != rendered + rendered_recipes:
            raise ValueError("Spine rendered count differs from its verified PNG files")
        metadata.update(previewSchema=PREVIEW_SCHEMA, previewRenderedCount=rendered,
                        previewUnavailableCount=len(models) - rendered, previewReusedCount=0,
                        previewReuseRestoreFailureCount=reuse["failed"],
                        renderRecipePreviewRenderedCount=rendered_recipes,
                        renderRecipePreviewUnavailableCount=len(recipes) - rendered_recipes)
        metadata["browserRuntime"]["preview"].pop("reason", None)
        metadata["browserRuntime"]["preview"].update(status="rendered", schema=PREVIEW_SCHEMA)
        if graph(metadata) != graph(original):
            raise ValueError("Spine preview repair changed the inherited model graph")
        write_json(root / SPINE, metadata, pretty=True)
        hardlink_or_copy(root / SPINE, staging / SPINE)
        catalog = inputs.json(CATALOG)
        if catalog.get("server") != server or catalog.get("sourceId") != source:
            raise ValueError("Spine catalog belongs to a different source")
        api = staging / "api/v1/catalog"
        projected = build_spine_catalog(data, source)
        descriptor, count = _compile_resource("spine", projected, api)
        if count != len(models) or descriptor["count"] != catalog["resources"]["spine"]["count"]:
            raise ValueError("Spine preview repair changed the catalog model count")
        emitted = {}
        for shard in descriptor.get("entities", {}).get("shards", []):
            rows = read_json(staging / (descriptor["entities"]["prefix"] + shard + ".json"))
            if emitted.keys() & rows.keys():
                raise ValueError("Spine entity partitions repeat a model")
            emitted.update(rows)
        if emitted != projected["models"]:
            raise ValueError("Spine entity partitions differ from the complete projection")
        catalog["resources"]["spine"] = descriptor
        write_json(api / "manifest.json", catalog, pretty=True)
        receipt = {"schema": "haneoka-current-spine-preview-projection-v1", "producer": producer,
                   "server": server, "sourceId": source, "baseReleaseId": base["releaseId"],
                   "originalSpine": entries[SPINE], "originalGraphProducer": entries["metadata/pipeline-recipes/spine.json"],
                   "originalPipelineProducer": entries["metadata/pipeline-recipes/pipeline.json"],
                   "inputs": sorted(inputs.inputs.values(), key=lambda row: row["path"]),
                   "modelCount": len(models), "renderedModelPreviews": rendered,
                   "renderedRecipePreviews": rendered_recipes, "verifiedPNGs": preview_files,
                   "modelGraphUnchanged": True, "rawBuildRun": False}
        write_json(staging / RECEIPT, receipt, pretty=True)
        write_json(diagnostics / "projection-receipt.json", receipt, pretty=True)
        changed = release_entries(staging)
        if any(not owned(row["path"]) for row in changed):
            raise ValueError("Spine preview repair escaped its path scope")
        preserved = [row for row in records if not owned(row["path"])]
        manifest = write_release_identity_files(staging, server, source,
                                                sorted([*preserved, *changed], key=lambda row: row["path"]))
        _validate_release_manifest_for_gc(manifest,
            f"servers/{server}/releases/{manifest['releaseId']}/release.json", server, manifest["releaseId"])
        after = {row["path"]: row for row in manifest["entries"]}
        if {path: row for path, row in after.items() if not owned(path)} != {row["path"]: row for row in preserved}:
            raise ValueError("Spine preview repair changed a protected release entry")
        for path, expected in preview_files.items():
            if any(after[path][key] != expected[key] for key in ("sha256", "bytes")):
                raise ValueError("Spine preview manifest identity differs")
        return {"manifest": manifest, "sourceId": source, "changedEntries": changed,
                "reusedEntryCount": len(preserved), "projection": receipt}


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--bootstrap-node":
        bootstrap_node(Path(sys.argv[2]))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", choices=("intl", "jp"), required=True)
    parser.add_argument("--base-release", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--producer-pin", required=True)
    parser.add_argument("--mode", choices=("prepare", "publish"), default="prepare")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"r-[a-f0-9]{20}", args.base_release):
        raise ValueError("Spine repair needs an exact base release id")
    safe_id(args.source, "source id")
    pin = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", args.producer_pin) or pin != args.producer_pin:
        raise ValueError("Spine preview producer commit differs from checkout")
    producer = {"gitSha": pin, "sources": {path: sha256_file(PROJECT_ROOT / path) for path in PRODUCERS}}
    for path, digest in producer["sources"].items():
        committed = subprocess.check_output(["git", "show", f"{pin}:{path}"], cwd=PROJECT_ROOT)
        if hashlib.sha256(committed).hexdigest() != digest:
            raise ValueError("Spine preview producer source differs from its commit")
    config = load_server_config(args.server)
    store = R2Store(config, 4)
    key = f"servers/{args.server}/current.json"
    head = store.head(key)
    pointer = document(store, key, 4096)
    etag = head.get("ETag") if head else None
    manifest_key = f"servers/{args.server}/releases/{args.base_release}/release.json"
    if (not isinstance(etag, str) or re.fullmatch(r'"[^"\r\n]+"', etag) is None
            or pointer.get("server") != args.server or pointer.get("sourceId") != args.source
            or pointer.get("releaseId") != args.base_release or pointer.get("releaseManifest") != manifest_key):
        raise ValueError("Spine preview current base/source/strong ETag differs")
    base = document(store, manifest_key)
    if base.get("sourceId") != args.source:
        raise ValueError("Spine preview base source differs")
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="spine-preview-overlay-") as directory:
        staging = Path(directory)
        from core.storage import cas_key
        prepared = project(base, lambda row: store.get_bytes(cas_key(row["sha256"])), staging, config, producer, args.output)
        prepared.update(pointer=pointer, pointerETag=etag)
        result = {"schema": "haneoka-spine-preview-repair-publication-v1", "producer": producer,
                  "server": args.server, "sourceId": args.source, "baseReleaseId": args.base_release,
                  "releaseId": prepared["manifest"]["releaseId"],
                  "renderedModelPreviews": prepared["projection"]["renderedModelPreviews"],
                  "changedEntries": prepared["changedEntries"], "preservedEntryCount": prepared["reusedEntryCount"],
                  "published": False}
        write_json(args.output / "publication-receipt.json", result, pretty=True)
        if args.mode == "publish":
            result["pointer"] = publish(store, config, prepared, staging)
            result["published"] = True
            if store.get_json(key) != result["pointer"]:
                raise ValueError("Spine preview promoted pointer readback differs")
            write_json(args.output / "publication-receipt.json", result, pretty=True)
        print(json.dumps({key: result[key] for key in ("server", "sourceId", "releaseId", "renderedModelPreviews", "preservedEntryCount", "published")}))


if __name__ == "__main__":
    main()
