from __future__ import annotations

import importlib
import json
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


def _load_sync_module() -> Any:
    try:
        return importlib.import_module("telegram_ingest.channel_sync")
    except ModuleNotFoundError as exc:  # pragma: no cover - helps diagnose missing implementation
        raise AssertionError(
            "Expected telegram_ingest.channel_sync to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


def _load_storage_module() -> Any:
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
    raise AssertionError(f"Expected one of {names!r} in {module.__name__}")


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
    if hasattr(row, "__getitem__"):
        try:
            return row[key]
        except Exception:
            pass
    if hasattr(row, key):
        return getattr(row, key)
    raise AssertionError(f"Cannot read {key!r} from {row!r}")


class FakeTelegramClient:
    def __init__(self, pages: list[list[dict[str, Any]]], channel_id: int = 777001) -> None:
        self.pages = pages
        self.channel_id = channel_id
        self.resolve_calls: list[str] = []
        self.history_calls: list[dict[str, Any]] = []

    def resolve_channel(self, channel_name: str) -> dict[str, Any]:
        self.resolve_calls.append(channel_name)
        return {"id": self.channel_id, "name": channel_name, "title": channel_name}

    def search_public_chat(self, channel_name: str) -> dict[str, Any]:
        return self.resolve_channel(channel_name)

    def get_chat(self, channel_name: str) -> dict[str, Any]:
        return self.resolve_channel(channel_name)

    def get_history(self, channel_id: int, *, offset_message_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
        self.history_calls.append({"channel_id": channel_id, "offset_message_id": offset_message_id, "limit": limit})
        if self.pages:
            return self.pages.pop(0)
        return []

    def fetch_history(self, channel_id: int, *, offset_message_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
        return self.get_history(channel_id, offset_message_id=offset_message_id, limit=limit)

    def get_chat_history(self, channel_id: int, *, offset_message_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
        return self.get_history(channel_id, offset_message_id=offset_message_id, limit=limit)


class ChannelSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "telegram.sqlite3"
        storage_module = _load_storage_module()
        storage_cls = _pick_class(storage_module, "TelegramStorage", "SQLiteTelegramStorage", "TelegramStore")
        self.storage = storage_cls(self.db_path)
        _call_first(self.storage, ("initialize", "create_schema", "setup"))
        sync_module = _load_sync_module()
        self.sync_cls = _pick_class(sync_module, "TelegramChannelSync", "TelegramSyncService", "ChannelSyncService")
        self.sync_module = sync_module

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _message(self, message_id: int, text: str, ts: int) -> dict[str, Any]:
        return {
            "id": message_id,
            "date": ts,
            "chat_id": 777001,
            "text": text,
            "views": 10 + message_id,
            "forward_count": 1,
            "reply_count": 2,
            "media_type": "text",
            "message_url": f"https://t.me/acme/{message_id}",
            "raw_json": json.dumps({"id": message_id, "text": text}),
        }

    def test_backfill_pages_history_and_updates_sync_state(self) -> None:
        fake_client = FakeTelegramClient(
            pages=[
                [self._message(10, "newest", 1710766800), self._message(9, "next", 1710766700)],
                [self._message(8, "older", 1710766600), self._message(7, "oldest", 1710766500)],
                [],
            ]
        )
        service = self.sync_cls(client=fake_client, storage=self.storage)

        result = _call_first(service, ("backfill_channel", "backfill"), "acme", limit=4, batch_size=2)

        rows = _as_rows(_call_first(self.storage, ("fetch_messages", "list_messages", "inspect_channel"), channel_id=777001, limit=10))
        self.assertEqual(len(rows), 4)
        self.assertEqual([_row_value(row, "message_id") for row in rows], [10, 9, 8, 7])
        self.assertGreaterEqual(len(fake_client.history_calls), 2)
        self.assertEqual(fake_client.history_calls[0]["offset_message_id"], None)
        self.assertEqual(fake_client.history_calls[1]["offset_message_id"], 9)

        state = _call_first(self.storage, ("get_sync_state", "fetch_sync_state"), 777001)
        self.assertEqual(_row_value(state, "last_backfilled_message_id"), 7)
        self.assertEqual(_row_value(state, "last_incremental_message_id"), 10)
        self.assertEqual(_row_value(state, "last_status"), "ok")
        self.assertTrue(result is None or isinstance(result, dict))

    def test_sync_once_updates_incremental_checkpoint(self) -> None:
        fake_client = FakeTelegramClient(
            pages=[
                [self._message(11, "fresh", 1710766900), self._message(12, "fresher", 1710766950)],
                [],
            ]
        )
        service = self.sync_cls(client=fake_client, storage=self.storage)

        seed_state = {
            "channel_id": 777001,
            "channel_name": "acme",
            "last_backfilled_message_id": 7,
            "last_incremental_message_id": 10,
            "last_synced_at": datetime.fromtimestamp(1710763200, tz=timezone.utc).isoformat(),
            "last_status": "ok",
            "last_error": None,
        }
        _call_first(self.storage, ("upsert_sync_state", "save_sync_state"), seed_state)

        result = _call_first(service, ("sync_once", "sync_channel_once", "sync_channel"), "acme")

        rows = _as_rows(_call_first(self.storage, ("fetch_messages", "list_messages", "inspect_channel"), channel_id=777001, limit=10))
        self.assertEqual(len(rows), 2)
        self.assertEqual([_row_value(row, "message_id") for row in rows], [11, 12])
        state = _call_first(self.storage, ("get_sync_state", "fetch_sync_state"), 777001)
        self.assertEqual(_row_value(state, "last_backfilled_message_id"), 7)
        self.assertEqual(_row_value(state, "last_incremental_message_id"), 12)
        self.assertEqual(_row_value(state, "last_status"), "ok")
        self.assertTrue(result is None or isinstance(result, dict))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
