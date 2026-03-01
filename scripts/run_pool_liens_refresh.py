#!/usr/bin/env python3
"""
Run county lien refresh in batches for the pool-100 list and summarize results.

Defaults:
  - IDs file: logs/pool_100_ids_2026-01-31.txt
  - Chunk size: 10
  - Timeout: 600000 ms
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


ROOT = Path("/home/astre/command-center/src/greenlit/auditor")
LOG_DIR = ROOT / "logs"


def load_env(env_path: Path) -> Dict[str, str]:
    env = os.environ.copy()
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key and key not in env:
            env[key] = value
    return env


def chunked(items: List[int], size: int) -> Iterable[List[int]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def parse_refresh_log(path: Path) -> Tuple[Dict[str, int], int, int]:
    counts = {"success": 0, "not_found": 0, "error": 0}
    refreshed = 0
    with_records = 0
    if not path.exists():
        return counts, refreshed, with_records
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("event") != "refreshed":
            continue
        refreshed += 1
        status = obj.get("status")
        if status in counts:
            counts[status] += 1
        total_records = obj.get("total_records")
        if isinstance(total_records, int) and total_records > 0:
            with_records += 1
    return counts, refreshed, with_records


def newest_refresh_log(known: set[str]) -> Path | None:
    candidates = sorted(
        (p for p in LOG_DIR.glob("refresh_county_liens_*.jsonl") if p.name not in known),
        key=lambda p: p.stat().st_mtime,
    )
    return candidates[-1] if candidates else None


def run_batch(ids: List[int], timeout_ms: int, env: Dict[str, str]) -> Path | None:
    cmd = [
        "node",
        str(ROOT / "bin" / "refresh_county_liens.js"),
        "--ids",
        ",".join(str(i) for i in ids),
        "--timeout-ms",
        str(timeout_ms),
    ]
    known_logs = {p.name for p in LOG_DIR.glob("refresh_county_liens_*.jsonl")}
    subprocess.run(cmd, cwd=str(ROOT), env=env, check=False)
    return newest_refresh_log(known_logs)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids-file", default=str(LOG_DIR / "pool_100_ids_2026-01-31.txt"))
    parser.add_argument("--chunk-size", type=int, default=10)
    parser.add_argument("--timeout-ms", type=int, default=600000)
    parser.add_argument("--dry-run", action="store_true", help="Only show batch plan")
    args = parser.parse_args()

    ids_path = Path(args.ids_file)
    if not ids_path.exists():
        raise SystemExit(f"IDs file not found: {ids_path}")

    ids = [int(line.strip()) for line in ids_path.read_text().splitlines() if line.strip()]
    if not ids:
        raise SystemExit("No IDs provided.")

    env = load_env(ROOT / ".env")

    print(f"Pool lien refresh: {len(ids)} contractors")
    print(f"Chunk size: {args.chunk_size} | Timeout: {args.timeout_ms}ms")

    total_counts = {"success": 0, "not_found": 0, "error": 0}
    total_refreshed = 0
    total_with_records = 0
    batch_logs: List[str] = []

    for idx, batch in enumerate(chunked(ids, args.chunk_size), start=1):
        print(f"\nBatch {idx}: {len(batch)} IDs")
        if args.dry_run:
            print(",".join(str(i) for i in batch))
            continue

        log_path = run_batch(batch, args.timeout_ms, env)
        if not log_path:
            print("  -> No log file detected for batch.")
            continue

        counts, refreshed, with_records = parse_refresh_log(log_path)
        batch_logs.append(log_path.name)
        total_refreshed += refreshed
        total_with_records += with_records
        for key in total_counts:
            total_counts[key] += counts.get(key, 0)

        print(
            f"  -> {log_path.name}: refreshed={refreshed}, "
            f"success={counts['success']}, not_found={counts['not_found']}, error={counts['error']}, "
            f"with_records={with_records}"
        )

    if args.dry_run:
        return

    summary = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "total_ids": len(ids),
        "total_refreshed": total_refreshed,
        "success": total_counts["success"],
        "not_found": total_counts["not_found"],
        "error": total_counts["error"],
        "with_records": total_with_records,
        "batch_logs": batch_logs,
    }

    out_path = LOG_DIR / f"pool_100_liens_refresh_summary_{datetime.utcnow().isoformat().replace(':','-')}.json"
    out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print("\nSummary:")
    print(json.dumps(summary, indent=2))
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
