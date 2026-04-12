from __future__ import annotations

import importlib
import json
import sys
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
        return importlib.import_module("telegram_ingest.normalize")
    except ModuleNotFoundError as exc:  # pragma: no cover - helps diagnose missing implementation
        raise AssertionError(
            "Expected telegram_ingest.normalize to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


def _normalize(module: Any, raw: dict[str, Any], channel_id: int, channel_name: str) -> dict[str, Any]:
    fn = getattr(module, "normalize_message", None) or getattr(module, "normalize_telegram_message", None)
    self_check = getattr(module, "normalize", None)
    fn = fn or self_check
    if fn is None:
        raise AssertionError(
            "Expected normalize_message(), normalize_telegram_message(), or normalize() in telegram_ingest.normalize"
        )
    try:
        normalized = fn(raw, channel_id=channel_id, channel_name=channel_name)
    except TypeError:
        normalized = fn(raw, channel_id, channel_name)
    if not isinstance(normalized, dict):
        normalized = dict(normalized)
    return normalized


def _coerce_timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned).astimezone(timezone.utc)
    raise AssertionError(f"Unsupported timestamp value: {value!r}")


class NormalizeTests(unittest.TestCase):
    def test_normalize_message_produces_required_schema(self) -> None:
        module = _load_module()
        raw = {
            "id": 42,
            "date": 1710763200,
            "chat_id": 777001,
            "text": "A new launch is coming",
            "views": 3210,
            "forward_count": 8,
            "reply_count": 14,
            "media_type": "image",
            "message_url": "https://t.me/acme/42",
            "extra": {"nested": True},
        }

        normalized = _normalize(module, raw, channel_id=777001, channel_name="acme")

        self.assertEqual(normalized["platform"], "telegram")
        self.assertEqual(normalized["channel_id"], 777001)
        self.assertEqual(normalized["channel_name"], "acme")
        self.assertEqual(normalized["message_id"], 42)
        self.assertEqual(normalized["text"], "A new launch is coming")
        self.assertEqual(normalized["views"], 3210)
        self.assertEqual(normalized["forward_count"], 8)
        self.assertEqual(normalized["reply_count"], 14)
        self.assertEqual(normalized["media_type"], "image")
        self.assertEqual(normalized["message_url"], "https://t.me/acme/42")
        self.assertIn("raw_json", normalized)
        self.assertEqual(json.loads(normalized["raw_json"]), raw)
        self.assertEqual(_coerce_timestamp(normalized["timestamp"]), datetime.fromtimestamp(1710763200, tz=timezone.utc))

    def test_normalize_message_handles_missing_metadata(self) -> None:
        module = _load_module()
        raw = {
            "id": 99,
            "date": 1710766800,
            "text": "Short update",
        }

        normalized = _normalize(module, raw, channel_id=1234, channel_name="shorts")

        self.assertEqual(normalized["platform"], "telegram")
        self.assertEqual(normalized["channel_id"], 1234)
        self.assertEqual(normalized["channel_name"], "shorts")
        self.assertEqual(normalized["message_id"], 99)
        self.assertEqual(normalized["text"], "Short update")
        self.assertIsNotNone(normalized["raw_json"])
        self.assertEqual(json.loads(normalized["raw_json"]), raw)
        self.assertEqual(_coerce_timestamp(normalized["timestamp"]), datetime.fromtimestamp(1710766800, tz=timezone.utc))
        self.assertIn(normalized["forward_count"], (0, None))
        self.assertIn(normalized["reply_count"], (0, None))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
