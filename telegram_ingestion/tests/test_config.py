from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from typing import Any, Mapping
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if SRC.exists():
    sys.path.insert(0, str(SRC))


def _load_module() -> Any:
    try:
        return importlib.import_module("telegram_ingest.config")
    except ModuleNotFoundError as exc:  # pragma: no cover - helps diagnose missing implementation
        raise AssertionError(
            "Expected telegram_ingest.config to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


def _call_loader(loader: Any, env: Mapping[str, str]) -> Any:
    try:
        return loader(env)
    except TypeError:
        with patch.dict(os.environ, env, clear=True):
            return loader()


def _pick(obj: Any, *names: str) -> Any:
    for name in names:
        if hasattr(obj, name):
            return getattr(obj, name)
    raise AssertionError(f"None of {names!r} exist on {obj!r}")


class ConfigTests(unittest.TestCase):
    def test_load_config_parses_required_env_and_channel_list(self) -> None:
        module = _load_module()
        loader = getattr(module, "load_config", None) or getattr(module, "from_env", None)
        self.assertIsNotNone(loader, "Expected load_config() or from_env() in telegram_ingest.config")

        env = {
            "TELEGRAM_API_ID": "123456",
            "TELEGRAM_API_HASH": "deadbeefcafefeed",
            "TDLIB_DATABASE_DIR": r"C:\\telegram\\tdlib",
            "SQLITE_PATH": r"C:\\telegram\\telegram.db",
            "TELEGRAM_CHANNELS": "  @newsroom, world\ncrypto  ",
            "LOG_LEVEL": "info",
        }
        config = _call_loader(loader, env)

        self.assertEqual(_pick(config, "telegram_api_id", "api_id"), 123456)
        self.assertEqual(_pick(config, "telegram_api_hash", "api_hash"), "deadbeefcafefeed")
        self.assertEqual(
            Path(_pick(config, "tdlib_database_dir", "tdlib_dir", "database_dir")),
            Path(r"C:\telegram\tdlib"),
        )
        self.assertEqual(Path(_pick(config, "sqlite_path", "sqlite_db_path")), Path(r"C:\telegram\telegram.db"))
        self.assertEqual(
            list(_pick(config, "telegram_channels", "channels")),
            ["newsroom", "world", "crypto"],
        )
        self.assertEqual(str(_pick(config, "log_level", "logging_level")).upper(), "INFO")

    def test_missing_required_env_var_raises_helpful_error(self) -> None:
        module = _load_module()
        loader = getattr(module, "load_config", None) or getattr(module, "from_env", None)
        self.assertIsNotNone(loader, "Expected load_config() or from_env() in telegram_ingest.config")
        error_type = getattr(module, "ConfigError", ValueError)

        env = {
            "TELEGRAM_API_ID": "123456",
            "TELEGRAM_API_HASH": "deadbeefcafefeed",
            "TDLIB_DATABASE_DIR": r"C:\\telegram\\tdlib",
            "SQLITE_PATH": r"C:\\telegram\\telegram.db",
            "TELEGRAM_CHANNELS": "newsroom",
            "LOG_LEVEL": "INFO",
        }
        env.pop("TELEGRAM_API_HASH")

        with self.assertRaises(error_type) as ctx:
            _call_loader(loader, env)

        self.assertIn("TELEGRAM_API_HASH", str(ctx.exception))

    def test_invalid_api_id_is_rejected(self) -> None:
        module = _load_module()
        loader = getattr(module, "load_config", None) or getattr(module, "from_env", None)
        self.assertIsNotNone(loader, "Expected load_config() or from_env() in telegram_ingest.config")
        error_type = getattr(module, "ConfigError", ValueError)

        env = {
            "TELEGRAM_API_ID": "not-an-int",
            "TELEGRAM_API_HASH": "deadbeefcafefeed",
            "TDLIB_DATABASE_DIR": r"C:\\telegram\\tdlib",
            "SQLITE_PATH": r"C:\\telegram\\telegram.db",
            "TELEGRAM_CHANNELS": "newsroom",
            "LOG_LEVEL": "INFO",
        }

        with self.assertRaises(error_type) as ctx:
            _call_loader(loader, env)

        self.assertTrue(
            "TELEGRAM_API_ID" in str(ctx.exception) or "api id" in str(ctx.exception).lower(),
            str(ctx.exception),
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
