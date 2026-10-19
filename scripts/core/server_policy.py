"""Public server classification and resource-pipeline admission policy."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


SERVER_REGISTRY = Path(__file__).resolve().parents[1] / "config" / "servers"
PIPELINE_CLASSES = {"production", "validation", "retained"}


def server_reference(server: str, registry: Path | None = None) -> dict:
    if not isinstance(server, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", server):
        raise ValueError("invalid server configuration identity")
    registry = registry or SERVER_REGISTRY / f"{server}.json"
    reference = json.loads(registry.read_text("utf-8"))
    if (
        not isinstance(reference, dict)
        or set(reference) - {"$schema", "id", "configurationEnv", "pipelineClass", "dailyScheduled"}
        or reference.get("id") != server
        or reference.get("configurationEnv") != "RESOURCE_PIPELINE_CONFIG"
        or not isinstance(reference.get("pipelineClass"), str)
        or reference.get("pipelineClass") not in PIPELINE_CLASSES
        or type(reference.get("dailyScheduled", False)) is not bool
    ):
        raise ValueError(f"invalid server configuration reference: {registry.name}")
    return reference


def server_pipeline_class(server: str) -> str:
    return server_reference(server)["pipelineClass"]


def require_pipeline_audience(server: str, audience: str, *, scheduled: bool = False) -> None:
    pipeline_class = server_pipeline_class(server)
    if audience == "production":
        allowed = pipeline_class == "production" and server in {"jp", "intl"}
    elif audience == "restricted":
        allowed = (pipeline_class == "validation" and (not scheduled or server_reference(server).get("dailyScheduled", False))) or (pipeline_class == "retained" and not scheduled)
    else:
        allowed = False
    if not allowed:
        raise ValueError(f"server {server} is not admitted to this pipeline audience")


def pipeline_servers(selection: str, audience: str, *, scheduled: bool = False) -> list[str]:
    if selection != "all":
        require_pipeline_audience(selection, audience, scheduled=scheduled)
        return [selection]
    if audience not in {"production", "restricted"}:
        raise ValueError("invalid pipeline audience")
    servers = []
    for registry in sorted(SERVER_REGISTRY.glob("*.json")):
        server = registry.stem
        pipeline_class = server_pipeline_class(server)
        if audience == "production" and pipeline_class != "production":
            continue
        if audience == "restricted" and (
            pipeline_class == "production" or (scheduled and not server_reference(server).get("dailyScheduled", False))
        ):
            continue
        require_pipeline_audience(server, audience, scheduled=scheduled)
        servers.append(server)
    if not servers:
        raise ValueError("no servers are admitted to this pipeline audience")
    return servers


def is_validation_source(server: str) -> bool:
    return server_pipeline_class(server) == "validation"


def project_catalog(server: str, name: str, build, *args, fallback=None):
    try:
        return build(*args)
    except (ValueError, FileNotFoundError, KeyError, TypeError) as error:
        if not is_validation_source(server):
            raise
        print(f"warning: validation projection {name} unavailable: {error}", file=sys.stderr)
        return {} if fallback is None else fallback


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Select publicly classified resource-pipeline servers.")
    parser.add_argument("--server", required=True)
    parser.add_argument("--audience", choices=("production", "restricted"), required=True)
    parser.add_argument("--scheduled", action="store_true")
    args = parser.parse_args()
    try:
        servers = pipeline_servers(args.server, args.audience, scheduled=args.scheduled)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps(servers, separators=(",", ":")))


if __name__ == "__main__":
    main()
