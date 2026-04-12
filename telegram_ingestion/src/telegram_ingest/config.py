"""Configuration loading and validation for Telegram ingestion."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping

import os

DEFAULT_LOG_LEVEL = "INFO"
VALID_LOG_LEVELS = ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET")
DEFAULT_ENV_FILENAMES = (".env.local", ".env")

_CHANNEL_DELIMITERS = (",", "\n", ";")


class ConfigError(ValueError):
    """Raised when Telegram ingestion configuration is invalid."""


def _read_env(env: Mapping[str, str], key: str) -> str:
    value = env.get(key)
    if value is None:
        raise ConfigError(f"Missing required environment variable: {key}")
    stripped = value.strip()
    if not stripped:
        raise ConfigError(f"Environment variable {key} cannot be empty")
    return stripped


def _read_optional_env(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _parse_int(value: str, key: str) -> int:
    try:
        parsed = int(value, 10)
    except ValueError as exc:
        raise ConfigError(f"Environment variable {key} must be an integer") from exc
    if parsed <= 0:
        raise ConfigError(f"Environment variable {key} must be greater than zero")
    return parsed


def _normalize_channel_name(raw_value: str) -> str:
    value = raw_value.strip()
    if not value:
        raise ConfigError("TELEGRAM_CHANNELS cannot contain empty entries")

    value = value.removeprefix("@")
    lower = value.lower()
    if lower.startswith("https://t.me/"):
        value = value[len("https://t.me/") :]
    elif lower.startswith("http://t.me/"):
        value = value[len("http://t.me/") :]
    elif lower.startswith("t.me/"):
        value = value[len("t.me/") :]

    value = value.strip().strip("/")
    if value.startswith("s/"):
        value = value[2:].strip()
    if not value:
        raise ConfigError("TELEGRAM_CHANNELS contains an invalid public channel name")
    if any(marker in value for marker in ("joinchat", "+", "invite", "c/")):
        raise ConfigError(
            "TELEGRAM_CHANNELS must contain public channel identifiers, not invite links"
        )
    if "/" in value:
        value = value.split("/", 1)[0].strip()
    if not value:
        raise ConfigError("TELEGRAM_CHANNELS contains an invalid public channel name")
    return value


def _parse_channels(raw_value: str) -> tuple[str, ...]:
    pieces: list[str] = [raw_value]
    for delimiter in _CHANNEL_DELIMITERS:
        expanded: list[str] = []
        for piece in pieces:
            expanded.extend(piece.split(delimiter))
        pieces = expanded

    channels: list[str] = []
    seen: set[str] = set()
    for piece in pieces:
        normalized = _normalize_channel_name(piece)
        if normalized in seen:
            continue
        seen.add(normalized)
        channels.append(normalized)

    if not channels:
        raise ConfigError("TELEGRAM_CHANNELS must contain at least one public channel")
    return tuple(channels)


def _parse_path(env: Mapping[str, str], key: str) -> Path:
    value = _read_env(env, key)
    return Path(value).expanduser().resolve()


def _parse_optional_path(env: Mapping[str, str], key: str) -> Path | None:
    value = _read_optional_env(env, key)
    if value is None:
        return None
    return Path(value).expanduser().resolve()


def _normalize_log_level(raw_value: str) -> str:
    value = raw_value.strip().upper()
    if value not in VALID_LOG_LEVELS:
        raise ConfigError(
            f"LOG_LEVEL must be one of {', '.join(VALID_LOG_LEVELS)}"
        )
    return value


def _strip_wrapping_quotes(value: str) -> str:
    stripped = value.strip()
    if len(stripped) >= 2 and stripped[0] == stripped[-1] and stripped[0] in {"'", '"'}:
        return stripped[1:-1]
    return stripped


def load_env_file(path: Path) -> dict[str, str]:
    """Parse a minimal .env file."""

    parsed: dict[str, str] = {}
    if not path.exists():
        return parsed

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        parsed[key] = _strip_wrapping_quotes(value)
    return parsed


def merge_env_with_local_files(
    *,
    cwd: Path | None = None,
    filenames: Iterable[str] = DEFAULT_ENV_FILENAMES,
) -> dict[str, str]:
    """Merge process environment variables over local .env files."""

    base_dir = (cwd or Path.cwd()).resolve()
    merged: dict[str, str] = {}
    for filename in filenames:
        merged.update(load_env_file(base_dir / filename))
    merged.update(os.environ)
    return merged


@dataclass(frozen=True, slots=True)
class TelegramIngestionConfig:
    """Validated runtime configuration for Telegram ingestion."""

    api_id: int
    api_hash: str
    tdlib_database_dir: Path
    sqlite_path: Path
    telegram_channels: tuple[str, ...]
    log_level: str = DEFAULT_LOG_LEVEL
    tdlib_library_path: Path | None = None
    tdlib_library_dir: Path | None = None
    tdlib_files_dir: Path | None = None
    tdlib_session_name: str = "telegram_ingestion"

    def channel_count(self) -> int:
        return len(self.telegram_channels)

    @property
    def tdlib_session_dir(self) -> Path:
        return self.tdlib_database_dir / self.tdlib_session_name

    @property
    def tdlib_files_directory(self) -> Path:
        return self.tdlib_files_dir or (self.tdlib_session_dir / "files")


def load_config(
    env: Mapping[str, str] | None = None,
    *,
    cwd: Path | None = None,
) -> TelegramIngestionConfig:
    """Load and validate environment-driven configuration."""

    source = env if env is not None else merge_env_with_local_files(cwd=cwd)

    api_id = _parse_int(_read_env(source, "TELEGRAM_API_ID"), "TELEGRAM_API_ID")
    api_hash = _read_env(source, "TELEGRAM_API_HASH")
    tdlib_database_dir = _parse_path(source, "TDLIB_DATABASE_DIR")
    sqlite_path = _parse_path(source, "SQLITE_PATH")
    telegram_channels = _parse_channels(_read_env(source, "TELEGRAM_CHANNELS"))
    log_level = _normalize_log_level(
        _read_optional_env(source, "LOG_LEVEL") or DEFAULT_LOG_LEVEL
    )

    tdlib_library_path = _parse_optional_path(source, "TDLIB_LIBRARY_PATH")
    tdlib_library_dir = _parse_optional_path(source, "TDLIB_LIBRARY_DIR")
    tdlib_files_dir = _parse_optional_path(source, "TDLIB_FILES_DIR")
    tdlib_session_name = _read_optional_env(source, "TDLIB_SESSION_NAME") or "telegram_ingestion"

    return TelegramIngestionConfig(
        api_id=api_id,
        api_hash=api_hash,
        tdlib_database_dir=tdlib_database_dir,
        sqlite_path=sqlite_path,
        telegram_channels=telegram_channels,
        log_level=log_level,
        tdlib_library_path=tdlib_library_path,
        tdlib_library_dir=tdlib_library_dir,
        tdlib_files_dir=tdlib_files_dir,
        tdlib_session_name=tdlib_session_name,
    )


def ensure_runtime_directories(config: TelegramIngestionConfig) -> None:
    """Create the required TDLib and SQLite directories."""

    config.tdlib_session_dir.mkdir(parents=True, exist_ok=True)
    config.tdlib_files_directory.mkdir(parents=True, exist_ok=True)
    config.sqlite_path.parent.mkdir(parents=True, exist_ok=True)


__all__ = [
    "ConfigError",
    "DEFAULT_LOG_LEVEL",
    "DEFAULT_ENV_FILENAMES",
    "TelegramIngestionConfig",
    "VALID_LOG_LEVELS",
    "ensure_runtime_directories",
    "load_env_file",
    "load_config",
    "merge_env_with_local_files",
]
