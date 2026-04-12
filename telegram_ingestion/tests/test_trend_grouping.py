from __future__ import annotations

import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if SRC.exists():
    sys.path.insert(0, str(SRC))


def _load_module():
    try:
        return importlib.import_module("telegram_ingest.trend_grouping")
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise AssertionError(
            "Expected telegram_ingest.trend_grouping to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


def _load_storage_module():
    try:
        return importlib.import_module("telegram_ingest.storage")
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise AssertionError(
            "Expected telegram_ingest.storage to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


class _FakeResponse:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text


class _FakeClient:
    def __init__(self, *, api_key: str, base_url: str | None = None) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.requests: list[dict] = []
        self.responses = self

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return _FakeResponse(
            json.dumps(
                {
                    "trends": [
                        {
                            "id": "btc-etf-flows",
                            "label": "BTC ETF Flows",
                            "summary": "Messages cluster around ETF flows and price action.",
                            "why_now": "Multiple channels are posting the same move and its implications.",
                            "keywords": ["Bitcoin", "ETF", "flows"],
                            "message_ids": ["100:2", "200:8"],
                        }
                    ],
                    "ignored_message_ids": ["100:1"],
                }
            )
        )


class TrendGroupingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.project = self.base / "project"
        self.telegram_dir = self.project / "telegram_ingestion"
        self.runtime = self.telegram_dir / "runtime"
        self.runtime.mkdir(parents=True)
        self.sqlite_path = self.runtime / "telegram.sqlite3"

        storage_module = _load_storage_module()
        self.storage = storage_module.TelegramStorage(self.sqlite_path)

        self.storage.upsert_raw_messages(
            [
                {
                    "platform": "telegram",
                    "channel_id": 100,
                    "channel_name": "Watcher Guru",
                    "message_id": 1,
                    "timestamp": "2099-01-01T00:00:00+00:00",
                    "text": "gm",
                    "views": 10,
                    "forward_count": 0,
                    "reply_count": 0,
                    "media_type": "text",
                    "message_url": "https://t.me/example/1",
                    "raw_json": "{}",
                },
                {
                    "platform": "telegram",
                    "channel_id": 100,
                    "channel_name": "Watcher Guru",
                    "message_id": 2,
                    "timestamp": "2099-01-01T00:05:00+00:00",
                    "text": "Bitcoin ETF inflows spike as traders price in another leg higher.",
                    "views": 500,
                    "forward_count": 6,
                    "reply_count": 2,
                    "media_type": "text",
                    "message_url": "https://t.me/example/2",
                    "raw_json": "{}",
                },
                {
                    "platform": "telegram",
                    "channel_id": 200,
                    "channel_name": "unfolded.",
                    "message_id": 8,
                    "timestamp": "2099-01-01T00:06:00+00:00",
                    "text": "Spot bitcoin ETF demand keeps trending as issuers log another strong session.",
                    "views": 900,
                    "forward_count": 11,
                    "reply_count": 3,
                    "media_type": "text",
                    "message_url": "https://t.me/example/8",
                    "raw_json": "{}",
                },
            ]
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_load_openai_runtime_env_merges_parent_repo_env(self) -> None:
        module = _load_module()
        (self.project / ".env.local").write_text("OPENAI_API_KEY=root-key\nOPENAI_TREND_MODEL=gpt-5-mini\n", encoding="utf-8")
        (self.telegram_dir / ".env.local").write_text("OPENAI_TREND_MODEL=gpt-5.1-mini\n", encoding="utf-8")

        env = module.load_openai_runtime_env(cwd=self.telegram_dir)

        self.assertEqual(env["OPENAI_API_KEY"], "root-key")
        self.assertEqual(env["OPENAI_TREND_MODEL"], "gpt-5.1-mini")

    def test_group_recent_messages_calls_openai_and_writes_runtime_snapshot(self) -> None:
        module = _load_module()
        fake_client = _FakeClient(api_key="test-key")

        grouper = module.TelegramTrendGrouper(
            sqlite_path=self.sqlite_path,
            env={"OPENAI_API_KEY": "test-key", "OPENAI_TELEGRAM_TREND_MODEL": "gpt-5-mini"},
            client_factory=lambda **kwargs: fake_client,
        )

        payload = grouper.group_recent_messages(hours=24, limit=10, per_channel_limit=5, min_text_length=20)

        self.assertEqual(payload["model"], "gpt-5-mini")
        self.assertEqual(payload["source_message_count"], 2)
        self.assertEqual(len(payload["trends"]), 1)
        self.assertEqual(len(payload["sampled_messages"]), 2)
        self.assertEqual(payload["trends"][0]["label"], "BTC ETF Flows")
        self.assertEqual(payload["trends"][0]["message_count"], 2)
        self.assertEqual(payload["trends"][0]["channel_names"], ["unfolded.", "Watcher Guru"])
        self.assertEqual(
            payload["sampled_messages"][0]["assigned_trend_label"],
            "BTC ETF Flows",
        )
        self.assertTrue(grouper.output_path.exists())

        written = json.loads(grouper.output_path.read_text(encoding="utf-8"))
        self.assertEqual(written["trends"][0]["id"], "btc-etf-flows")
        self.assertEqual(written["sampled_messages"][1]["assigned_trend_id"], "btc-etf-flows")
        self.assertEqual(fake_client.requests[0]["model"], "gpt-5-mini")
        self.assertEqual(fake_client.requests[0]["text"]["format"]["type"], "json_schema")

    def test_group_recent_messages_raises_without_api_key(self) -> None:
        module = _load_module()
        grouper = module.TelegramTrendGrouper(sqlite_path=self.sqlite_path, env={})

        with self.assertRaises(RuntimeError):
            grouper.group_recent_messages(hours=24, limit=10, per_channel_limit=5, min_text_length=20)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
