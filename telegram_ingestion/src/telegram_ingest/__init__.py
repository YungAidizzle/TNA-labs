"""Standalone local-first Telegram ingestion built around TDLib and SQLite."""

from __future__ import annotations

from .config import ConfigError, TelegramIngestionConfig, ensure_runtime_directories, load_config
from .logging_utils import configure_logging, get_logger
from .models import TelegramMessageRecord, TelegramSyncState

__all__ = [
    "__version__",
    "ConfigError",
    "TelegramIngestionConfig",
    "TelegramMessageRecord",
    "TelegramSyncState",
    "configure_logging",
    "ensure_runtime_directories",
    "get_logger",
    "load_config",
]

__version__ = "0.1.0"
