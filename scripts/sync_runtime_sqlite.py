from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync runtime JSON artifacts into SQLite.")
    parser.add_argument("--db", required=True, help="SQLite database path.")
    parser.add_argument("--bundle", required=True, help="Runtime bundle JSON path.")
    parser.add_argument(
        "--refresh-state",
        required=True,
        help="Refresh state JSON path.",
    )
    return parser.parse_args()


def load_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS build_history (
            generated_at TEXT PRIMARY KEY,
            origin TEXT NOT NULL,
            source_snapshot_generated_at TEXT,
            latest_fetched_at TEXT,
            raw_posts INTEGER NOT NULL,
            raw_comments INTEGER NOT NULL,
            raw_public_items INTEGER NOT NULL,
            raw_bluesky_posts INTEGER NOT NULL,
            raw_bluesky_interactions INTEGER NOT NULL,
            raw_bluesky_snapshots INTEGER NOT NULL,
            raw_bluesky_profiles INTEGER NOT NULL,
            raw_youtube_comments INTEGER NOT NULL,
            raw_youtube_snapshots INTEGER NOT NULL,
            bundle_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_freshness (
            source_id TEXT PRIMARY KEY,
            source_label TEXT NOT NULL,
            platform_id TEXT NOT NULL,
            item_count INTEGER NOT NULL,
            last_fetched_at TEXT,
            latest_created_at TEXT,
            age_minutes INTEGER
        );
        """
    )
    existing_columns = {
        row[1]
        for row in connection.execute("PRAGMA table_info(build_history)")
    }
    for column_name in (
        "raw_bluesky_posts",
        "raw_bluesky_interactions",
        "raw_bluesky_snapshots",
        "raw_bluesky_profiles",
    ):
        if column_name in existing_columns:
            continue
        connection.execute(
            f"ALTER TABLE build_history ADD COLUMN {column_name} INTEGER NOT NULL DEFAULT 0"
        )


def upsert_app_state(
    connection: sqlite3.Connection,
    *,
    key: str,
    payload: Any,
    updated_at: str,
) -> None:
    connection.execute(
        """
        INSERT INTO app_state (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        """,
        (key, json.dumps(payload), updated_at),
    )


def sync_bundle(
    connection: sqlite3.Connection,
    *,
    bundle: dict[str, Any],
    bundle_path: Path,
    updated_at: str,
) -> None:
    upsert_app_state(
        connection,
        key="latest_bundle",
        payload={
            "generatedAt": bundle.get("generatedAt"),
            "origin": bundle.get("origin"),
            "sourceSnapshotGeneratedAt": bundle.get("sourceSnapshotGeneratedAt"),
            "latestFetchedAt": bundle.get("latestFetchedAt"),
            "runtimeSnapshotPath": str(bundle_path),
        },
        updated_at=updated_at,
    )

    raw_counts = bundle.get("rawCounts") or {}
    connection.execute(
        """
        INSERT OR REPLACE INTO build_history (
            generated_at,
            origin,
            source_snapshot_generated_at,
            latest_fetched_at,
            raw_posts,
            raw_comments,
            raw_public_items,
            raw_bluesky_posts,
            raw_bluesky_interactions,
            raw_bluesky_snapshots,
            raw_bluesky_profiles,
            raw_youtube_comments,
            raw_youtube_snapshots,
            bundle_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            bundle.get("generatedAt"),
            bundle.get("origin"),
            bundle.get("sourceSnapshotGeneratedAt"),
            bundle.get("latestFetchedAt"),
            int(raw_counts.get("posts", 0) or 0),
            int(raw_counts.get("comments", 0) or 0),
            int(raw_counts.get("publicItems", 0) or 0),
            int(raw_counts.get("blueskyPosts", 0) or 0),
            int(raw_counts.get("blueskyInteractions", 0) or 0),
            int(raw_counts.get("blueskyPostSnapshots", 0) or 0),
            int(raw_counts.get("blueskyProfiles", 0) or 0),
            int(raw_counts.get("youtubeComments", 0) or 0),
            int(raw_counts.get("youtubeVideoSnapshots", 0) or 0),
            str(bundle_path),
        ),
    )

    connection.execute("DELETE FROM source_freshness")
    for row in bundle.get("sourceFreshness") or []:
        connection.execute(
            """
            INSERT OR REPLACE INTO source_freshness (
                source_id,
                source_label,
                platform_id,
                item_count,
                last_fetched_at,
                latest_created_at,
                age_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(row.get("sourceId") or ""),
                str(row.get("sourceLabel") or ""),
                str(row.get("platformId") or ""),
                int(row.get("itemCount", 0) or 0),
                row.get("lastFetchedAt"),
                row.get("latestCreatedAt"),
                int(row.get("ageMinutes", 0) or 0)
                if row.get("ageMinutes") is not None
                else None,
            ),
        )


def main() -> int:
    args = parse_args()
    db_path = Path(args.db)
    bundle_path = Path(args.bundle)
    refresh_state_path = Path(args.refresh_state)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    bundle = load_json(bundle_path) if bundle_path.exists() else None
    refresh_state = load_json(refresh_state_path) if refresh_state_path.exists() else None

    connection = sqlite3.connect(db_path)
    try:
        ensure_schema(connection)
        updated_at = datetime.now(timezone.utc).isoformat()
        if bundle and isinstance(bundle, dict):
            sync_bundle(
                connection,
                bundle=bundle,
                bundle_path=bundle_path,
                updated_at=updated_at,
            )
        if refresh_state and isinstance(refresh_state, dict):
            upsert_app_state(
                connection,
                key="refresh_state",
                payload=refresh_state,
                updated_at=updated_at,
            )
        connection.commit()
    finally:
        connection.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
