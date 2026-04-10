from __future__ import annotations

import importlib
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if SRC.exists():
    sys.path.insert(0, str(SRC))


def _load_module() -> Any:
    try:
        return importlib.import_module("telegram_ingest.storage")
    except ModuleNotFoundError as exc:  # pragma: no cover - helps diagnose missing implementation
        raise AssertionError(
            "Expected telegram_ingest.storage to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


def _pick_class(module: Any, *names: str) -> type[Any]:
    for name in names:
        candidate = getattr(module, name, None)
        if candidate is not None:
            return candidate
    raise AssertionError(f"Expected one of {names!r} to exist in {module.__name__}")


def _call_first(obj: Any, names: tuple[str, ...], *args: Any, **kwargs: Any) -> Any:
    for name in names:
        method = getattr(obj, name, None)
        if method is not None:
            return method(*args, **kwargs)
    raise AssertionError(f"Expected one of {names!r} on {obj!r}")


def _as_rows(result: Any) -> list[Any]:
    if isinstance(result, list):
        return result
    if isinstance(result, tuple):
        return list(result)
    if hasattr(result, "fetchall"):
        return list(result.fetchall())
    if result is None:
        return []
    return [result]


def _row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row[key]
    if isinstance(row, sqlite3.Row):
        return row[key]
    if hasattr(row, "__getitem__"):
        try:
            return row[key]
        except Exception:
            pass
    if hasattr(row, key):
        return getattr(row, key)
    raise AssertionError(f"Cannot read {key!r} from {row!r}")


class StorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "telegram.sqlite3"
        module = _load_module()
        storage_cls = _pick_class(module, "TelegramStorage", "SQLiteTelegramStorage", "TelegramStore")
        self.storage = storage_cls(self.db_path)
        _call_first(self.storage, ("initialize", "create_schema", "setup"))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _message(self, message_id: int, text: str, timestamp: int, views: int = 0) -> dict[str, Any]:
        return {
            "platform": "telegram",
            "channel_id": 777001,
            "channel_name": "acme",
            "message_id": message_id,
            "timestamp": datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(),
            "text": text,
            "views": views,
            "forward_count": 2,
            "reply_count": 3,
            "media_type": "text",
            "message_url": f"https://t.me/acme/{message_id}",
            "raw_json": json.dumps({"id": message_id, "text": text}),
        }

    def test_upsert_message_replaces_duplicate_row(self) -> None:
        _call_first(self.storage, ("upsert_message", "save_message", "insert_message"), self._message(1, "first", 1710763200, 10))
        _call_first(self.storage, ("upsert_message", "save_message", "insert_message"), self._message(1, "updated", 1710763200, 99))

        rows = _as_rows(_call_first(self.storage, ("fetch_messages", "list_messages", "inspect_channel"), channel_id=777001, limit=10))
        self.assertEqual(len(rows), 1)
        self.assertEqual(_row_value(rows[0], "message_id"), 1)
        self.assertEqual(_row_value(rows[0], "text"), "updated")
        self.assertEqual(_row_value(rows[0], "views"), 99)

        with sqlite3.connect(self.db_path) as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM raw_telegram_messages WHERE channel_id = ? AND message_id = ?",
                (777001, 1),
            ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_sync_state_upsert_is_idempotent(self) -> None:
        state_a = {
            "channel_id": 777001,
            "channel_name": "acme",
            "last_backfilled_message_id": 10,
            "last_incremental_message_id": 20,
            "last_synced_at": datetime.fromtimestamp(1710763200, tz=timezone.utc).isoformat(),
            "last_status": "ok",
            "last_error": None,
        }
        state_b = {
            "channel_id": 777001,
            "channel_name": "acme",
            "last_backfilled_message_id": 8,
            "last_incremental_message_id": 22,
            "last_synced_at": datetime.fromtimestamp(1710766800, tz=timezone.utc).isoformat(),
            "last_status": "ok",
            "last_error": "",
        }

        _call_first(self.storage, ("upsert_sync_state", "save_sync_state"), state_a)
        _call_first(self.storage, ("upsert_sync_state", "save_sync_state"), state_b)

        state = _call_first(self.storage, ("get_sync_state", "fetch_sync_state"), 777001)
        self.assertEqual(_row_value(state, "channel_id"), 777001)
        self.assertEqual(_row_value(state, "last_backfilled_message_id"), 8)
        self.assertEqual(_row_value(state, "last_incremental_message_id"), 22)
        self.assertEqual(_row_value(state, "last_status"), "ok")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
