"""Structured logging helpers for Telegram ingestion."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from typing import Any, TextIO

_STANDARD_RECORD_FIELDS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
}


class StructuredLogFormatter(logging.Formatter):
    """Render log records as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_FIELDS or key.startswith("_"):
                continue
            payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = record.stack_info

        return json.dumps(payload, default=str, ensure_ascii=True)


def configure_logging(
    level: str | int = "INFO",
    *,
    json_output: bool = True,
    stream: TextIO | None = None,
) -> None:
    """Configure root logging for the ingestion service."""

    handler = logging.StreamHandler(stream)
    handler.setFormatter(StructuredLogFormatter() if json_output else logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"
    ))

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


def get_logger(name: str, **context: Any) -> logging.LoggerAdapter:
    """Return a logger adapter that automatically attaches structured context."""

    return logging.LoggerAdapter(logging.getLogger(name), context)


__all__ = ["StructuredLogFormatter", "configure_logging", "get_logger"]
