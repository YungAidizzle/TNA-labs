from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def enable_live_loop_defaults() -> None:
    os.environ.setdefault("PYTHONUNBUFFERED", "1")


def _parse_response_body(payload: bytes) -> Any:
    text = payload.decode("utf-8", errors="replace").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def request_dashboard_refresh(url: str) -> dict[str, Any]:
    request = urllib_request.Request(
        url,
        data=b"{}",
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=20) as response:
            body = _parse_response_body(response.read())
            return {
                "statusCode": int(getattr(response, "status", 200) or 200),
                "body": body,
            }
    except urllib_error.HTTPError as exc:
        return {
            "statusCode": int(exc.code),
            "body": _parse_response_body(exc.read()),
        }


def print_firehose_boot_mode() -> None:
    from backend.bluesky_config import BLUESKY_FIREHOSE_COLLECTIONS, BLUESKY_FIREHOSE_ENDPOINT

    stream_mode = "full" if not BLUESKY_FIREHOSE_COLLECTIONS else "filtered"
    collection_behavior = (
        "all Jetstream collections (wantedCollections omitted)"
        if stream_mode == "full"
        else ", ".join(BLUESKY_FIREHOSE_COLLECTIONS)
    )
    # Full Jetstream means no wantedCollections filter. That is broader than filtered
    # Jetstream, but it is still distinct from the raw subscribeRepos repo firehose.
    print(f"[bluesky-firehose] Jetstream mode: {stream_mode}")
    print(
        "[bluesky-firehose] endpoint="
        f"{BLUESKY_FIREHOSE_ENDPOINT} collections={collection_behavior}"
    )


def write_worker_heartbeat(
    *,
    status: str,
    health_status: str,
    last_error: str | None = None,
    last_sync_started_at: str | None = None,
) -> dict[str, Any]:
    from backend.bluesky_config import BLUESKY_FIREHOSE_COLLECTIONS, BLUESKY_FIREHOSE_ENDPOINT
    from backend.bluesky_raw_store import summarize_recent_raw_events
    from backend.reddit_persistence import (
        load_bluesky_firehose_state,
        save_bluesky_firehose_state,
    )

    current_state = load_bluesky_firehose_state()
    raw_summary = summarize_recent_raw_events()
    heartbeat_at = datetime.now(timezone.utc).isoformat()
    last_received_at = raw_summary.get("lastReceivedAt") or current_state.get("lastReceivedAt")
    wall_clock_lag_minutes = current_state.get("wallClockLagMinutes")
    if isinstance(last_received_at, str) and last_received_at:
        try:
            wall_clock_lag_minutes = max(
                0.0,
                round(
                    (
                        datetime.now(timezone.utc)
                        - datetime.fromisoformat(last_received_at.replace("Z", "+00:00"))
                    ).total_seconds()
                    / 60.0,
                    1,
                ),
            )
        except Exception:
            pass
    stream_mode = "full" if not BLUESKY_FIREHOSE_COLLECTIONS else "filtered"
    stream_mode_label = (
        "Bluesky full firehose" if stream_mode == "full" else "Bluesky firehose"
    )
    if status == "running":
        connection_status = "connecting"
        source_status = "active"
    elif status in {"failed", "disabled"}:
        connection_status = "disconnected"
        source_status = "disabled"
    else:
        connection_status = "idle"
        source_status = "disabled"
    next_state = {
        **current_state,
        **raw_summary,
        "enabled": True,
        "sourceStatus": source_status,
        "provider": "jetstream",
        "endpoint": BLUESKY_FIREHOSE_ENDPOINT,
        "streamMode": stream_mode,
        "streamModeLabel": stream_mode_label,
        "collectionBehavior": (
            "all_collections"
            if stream_mode == "full"
            else f"filtered:{','.join(BLUESKY_FIREHOSE_COLLECTIONS)}"
        ),
        "wantedCollections": list(BLUESKY_FIREHOSE_COLLECTIONS),
        "status": status,
        "healthStatus": health_status,
        "connectionStatus": connection_status,
        "lastError": last_error,
        "workerPid": os.getpid(),
        "workerHeartbeatAt": heartbeat_at,
        "workerAlive": status not in {"failed", "idle", "disabled"},
        "reconnectCount": int(current_state.get("reconnectCount") or 0),
        "lastPersistenceAt": current_state.get("lastPersistenceAt"),
        "lastAggregateRefreshAt": current_state.get("lastAggregateRefreshAt"),
        "wallClockLagMinutes": wall_clock_lag_minutes,
    }
    if last_sync_started_at:
        next_state["lastSyncStartedAt"] = last_sync_started_at
    save_bluesky_firehose_state(next_state)
    return next_state


def run_sync() -> dict[str, Any]:
    from backend.bluesky_firehose import sync_bluesky_firehose
    from backend.bluesky_raw_store import summarize_recent_raw_events
    from backend.reddit_persistence import (
        load_bluesky_firehose_state,
        load_bluesky_interactions,
        load_bluesky_post_snapshots,
        load_bluesky_posts,
        load_bluesky_profiles,
        save_bluesky_firehose_state,
        save_bluesky_interactions,
        save_bluesky_post_snapshots,
        save_bluesky_posts,
        save_bluesky_profiles,
    )

    existing_state = load_bluesky_firehose_state()

    def write_sync_progress(progress_state: dict[str, Any]) -> None:
        nonlocal existing_state
        existing_state = {
            **existing_state,
            **progress_state,
            **summarize_recent_raw_events(),
        }
        save_bluesky_firehose_state(existing_state)

    result = sync_bluesky_firehose(
        existing_posts=load_bluesky_posts(),
        existing_snapshots=load_bluesky_post_snapshots(),
        existing_profiles=load_bluesky_profiles(),
        existing_interactions=load_bluesky_interactions(),
        existing_state=existing_state,
        progress_callback=write_sync_progress,
    )
    raw_summary = summarize_recent_raw_events()
    state = {
        **dict(result.get("state") or {}),
        **raw_summary,
    }
    result["state"] = state

    save_bluesky_posts(list(result.get("posts") or []))
    save_bluesky_post_snapshots(list(result.get("snapshots") or []))
    save_bluesky_profiles(list(result.get("profiles") or []))
    save_bluesky_interactions(list(result.get("interactions") or []))
    persisted_at = datetime.now(timezone.utc).isoformat()
    state = {
        **state,
        "lastPersistenceAt": persisted_at,
        "lastAggregateRefreshAt": persisted_at,
        "wallClockLagMinutes": state.get("wallClockLagMinutes"),
        "connectionStatus": state.get("connectionStatus") or ("connected" if state.get("status") != "failed" else "disconnected"),
        "reconnectCount": int(state.get("reconnectCount") or 0),
    }
    save_bluesky_firehose_state(state)

    return {
        "status": "success" if state.get("status") != "failed" else "failed",
        "postsStored": len(result.get("posts") or []),
        "interactionsStored": len(result.get("interactions") or []),
        "profilesStored": len(result.get("profiles") or []),
        "snapshotCount": len(result.get("snapshots") or []),
        "stats": result.get("stats") or {},
        "timings": result.get("timings") or {},
        "state": state,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--sleep-seconds", type=float, default=5.0)
    parser.add_argument("--retry-seconds", type=float, default=5.0)
    parser.add_argument("--dashboard-refresh-url", type=str, default="")
    parser.add_argument("--dashboard-refresh-min-interval-seconds", type=float, default=None)
    return parser.parse_args()


def main() -> int:
    print(
        "Legacy Bluesky firehose ingestion is disabled. "
        "Use node scripts/run_ai_native_narrative_refresh.mjs --force instead.",
        file=sys.stderr,
    )
    return 1

    enable_live_loop_defaults()
    args = parse_args()
    print_firehose_boot_mode()

    default_refresh_url = (
        "http://localhost:3000/api/dashboard/trends/refresh"
        "?mode=local_rebuild&trigger=bluesky-firehose-live&force=true"
    )
    refresh_url = args.dashboard_refresh_url.strip() or default_refresh_url
    refresh_interval_seconds = (
        args.dashboard_refresh_min_interval_seconds
        if args.dashboard_refresh_min_interval_seconds is not None
        else float(os.getenv("BLUESKY_DASHBOARD_REFRESH_MIN_INTERVAL_SECONDS", "20") or "20")
    )
    refresh_interval_seconds = max(0.0, refresh_interval_seconds)

    if not args.loop:
        result = run_sync()
        print(json.dumps(result, indent=2))
        return 0 if result.get("status") == "success" else 1

    last_successful_refresh_at = 0.0

    while True:
        started_at = datetime.now(timezone.utc).isoformat()
        try:
            write_worker_heartbeat(
                status="running",
                health_status="connecting",
                last_sync_started_at=started_at,
            )
            result = run_sync()
            if refresh_url:
                now = time.monotonic()
                should_refresh = (
                    last_successful_refresh_at <= 0
                    or refresh_interval_seconds <= 0
                    or (now - last_successful_refresh_at) >= refresh_interval_seconds
                )
                if should_refresh:
                    refresh_result = request_dashboard_refresh(refresh_url)
                    result["dashboardRefresh"] = refresh_result
                    if int(refresh_result.get("statusCode") or 0) < 400:
                        last_successful_refresh_at = now
                else:
                    result["dashboardRefresh"] = {
                        "status": "throttled",
                        "minIntervalSeconds": refresh_interval_seconds,
                    }
            print(json.dumps(result, indent=2))
            time.sleep(max(0.0, args.sleep_seconds))
        except KeyboardInterrupt:
            write_worker_heartbeat(
                status="idle",
                health_status="disconnected",
            )
            return 0
        except Exception as exc:  # pragma: no cover - live loop safety
            write_worker_heartbeat(
                status="failed",
                health_status="disconnected",
                last_error=str(exc),
                last_sync_started_at=started_at,
            )
            print(f"[bluesky-firehose] loop error: {exc}", file=sys.stderr)
            time.sleep(max(0.0, args.retry_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
