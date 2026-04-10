"""CLI entrypoint for the standalone Telegram ingestion subsystem."""

from __future__ import annotations

import argparse
import json
import os
from typing import Any, Sequence

from .auth_flow import TelegramAuthFlow
from .channel_sync import TelegramChannelSync
from .config import TelegramIngestionConfig, ensure_runtime_directories, load_config
from .logging_utils import configure_logging, get_logger
from .storage import TelegramStorage
from .tdlib_client import TdLibClient, TelegramTdlibParameters
from .trend_grouping import (
    DEFAULT_HOURS,
    DEFAULT_LIMIT,
    DEFAULT_MAX_TEXT_LENGTH,
    DEFAULT_MAX_TRENDS,
    DEFAULT_MIN_TEXT_LENGTH,
    DEFAULT_PER_CHANNEL_LIMIT,
    TelegramTrendGrouper,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="telegram-ingest", description="TDLib-based Telegram ingestion")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("auth", help="Authenticate and persist the local TDLib session")

    channels_parser = subparsers.add_parser("channels", help="Channel validation commands")
    channels_subparsers = channels_parser.add_subparsers(dest="channels_command", required=True)
    channels_subparsers.add_parser("validate", help="Resolve configured public channels")

    backfill_parser = subparsers.add_parser("backfill", help="Backfill one configured public channel")
    backfill_parser.add_argument("--channel", required=True)
    backfill_parser.add_argument("--limit", type=int, default=1000)
    backfill_parser.add_argument("--batch-size", type=int, default=100)

    backfill_all_parser = subparsers.add_parser("backfill-all", help="Backfill all configured channels")
    backfill_all_parser.add_argument("--limit", type=int, default=1000)
    backfill_all_parser.add_argument("--batch-size", type=int, default=100)

    sync_once_parser = subparsers.add_parser("sync-once", help="Fetch new messages once for all configured channels")
    sync_once_parser.add_argument("--batch-size", type=int, default=100)

    sync_loop_parser = subparsers.add_parser("sync-loop", help="Run incremental sync repeatedly")
    sync_loop_parser.add_argument("--interval", type=int, default=300)
    sync_loop_parser.add_argument("--batch-size", type=int, default=100)

    trends_parser = subparsers.add_parser("trends", help="Trend grouping commands")
    trends_subparsers = trends_parser.add_subparsers(dest="trends_command", required=True)
    trends_group_parser = trends_subparsers.add_parser("group", help="Group recent Telegram messages into trends")
    trends_group_parser.add_argument("--hours", type=int, default=DEFAULT_HOURS)
    trends_group_parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    trends_group_parser.add_argument("--per-channel-limit", type=int, default=DEFAULT_PER_CHANNEL_LIMIT)
    trends_group_parser.add_argument("--min-text-length", type=int, default=DEFAULT_MIN_TEXT_LENGTH)
    trends_group_parser.add_argument("--max-text-length", type=int, default=DEFAULT_MAX_TEXT_LENGTH)
    trends_group_parser.add_argument("--max-trends", type=int, default=DEFAULT_MAX_TRENDS)

    subparsers.add_parser("stats", help="Show local storage and sync diagnostics")

    inspect_parser = subparsers.add_parser("inspect-channel", help="Inspect recent stored messages for one channel")
    inspect_parser.add_argument("--channel", required=True)
    inspect_parser.add_argument("--limit", type=int, default=10)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.command == "auth":
        return _result_code(run_auth())
    if args.command == "channels" and args.channels_command == "validate":
        return _result_code(run_channels_validate())
    if args.command == "backfill":
        return _result_code(run_backfill(channel=args.channel, limit=args.limit, batch_size=args.batch_size))
    if args.command == "backfill-all":
        return _result_code(run_backfill_all(limit=args.limit, batch_size=args.batch_size))
    if args.command == "sync-once":
        return _result_code(run_sync_once(batch_size=args.batch_size))
    if args.command == "sync-loop":
        return _result_code(run_sync_loop(interval=args.interval, batch_size=args.batch_size))
    if args.command == "trends" and args.trends_command == "group":
        return _result_code(
            run_trends_group(
                hours=args.hours,
                limit=args.limit,
                per_channel_limit=args.per_channel_limit,
                min_text_length=args.min_text_length,
                max_text_length=args.max_text_length,
                max_trends=args.max_trends,
            )
        )
    if args.command == "stats":
        return _result_code(run_stats())
    if args.command == "inspect-channel":
        return _result_code(run_inspect_channel(channel=args.channel, limit=args.limit))

    parser.error("Unsupported command")
    return 2


def run_auth() -> int:
    config = _load_runtime_config()
    logger = get_logger("telegram_ingest.cli")
    with _open_tdlib_client(config) as client:
        flow = TelegramAuthFlow(client, _build_tdlib_parameters(config))
        flow.authenticate()
        logger.info("telegram_auth_complete", extra={"tdlib_library": str(client.library_path)})
    print("Telegram authorization complete.")
    return 0


def run_channels_validate() -> int:
    config, storage = _load_runtime_storage()
    with _open_tdlib_client(config) as client:
        _ensure_authorized(client)
        service = TelegramChannelSync(client=client, storage=storage, config=config)
        results = service.validate_channels(config.telegram_channels)
    _print_json(results)
    return 0 if all(result.get("status") == "ok" for result in results) else 1


def run_backfill(*, channel: str, limit: int, batch_size: int = 100) -> int:
    config, storage = _load_runtime_storage()
    with _open_tdlib_client(config) as client:
        _ensure_authorized(client)
        service = TelegramChannelSync(client=client, storage=storage, config=config)
        result = service.backfill_channel(channel, limit=limit, batch_size=batch_size)
    _print_json(result)
    return 0


def run_backfill_all(*, limit: int, batch_size: int = 100) -> int:
    config, storage = _load_runtime_storage()
    with _open_tdlib_client(config) as client:
        _ensure_authorized(client)
        service = TelegramChannelSync(client=client, storage=storage, config=config)
        results = service.backfill_all(config.telegram_channels, limit=limit, batch_size=batch_size)
    _print_json(results)
    return 0 if all(result.get("errors") in (None, [], "") for result in results) else 1


def run_sync_once(*, batch_size: int = 100) -> int:
    config, storage = _load_runtime_storage()
    with _open_tdlib_client(config) as client:
        _ensure_authorized(client)
        service = TelegramChannelSync(client=client, storage=storage, config=config)
        results = service.sync_all_once(config.telegram_channels, batch_size=batch_size)
    _print_json(results)
    return 0 if all(result.get("errors") in (None, [], "") for result in results) else 1


def run_sync_loop(*, interval: int, batch_size: int = 100) -> int:
    config, storage = _load_runtime_storage()
    logger = get_logger("telegram_ingest.cli")
    try:
        with _open_tdlib_client(config) as client:
            _ensure_authorized(client)
            service = TelegramChannelSync(client=client, storage=storage, config=config)
            logger.info("starting_sync_loop", extra={"interval_seconds": interval, "channel_count": len(config.telegram_channels)})
            service.sync_loop(config.telegram_channels, interval_seconds=interval, batch_size=batch_size)
    except KeyboardInterrupt:
        logger.info("sync_loop_interrupted")
        return 130
    return 0


def run_stats() -> int:
    config, storage = _load_runtime_storage()
    payload = _build_stats_payload(storage, config)
    _print_json(payload)
    return 0


def run_trends_group(
    *,
    hours: int,
    limit: int,
    per_channel_limit: int,
    min_text_length: int,
    max_text_length: int,
    max_trends: int,
) -> int:
    config = _load_runtime_config()
    grouper = TelegramTrendGrouper(sqlite_path=config.sqlite_path)
    payload = grouper.group_recent_messages(
        hours=hours,
        limit=limit,
        per_channel_limit=per_channel_limit,
        min_text_length=min_text_length,
        max_text_length=max_text_length,
        max_trends=max_trends,
    )
    _print_json(payload)
    return 0


def run_inspect_channel(*, channel: str, limit: int) -> int:
    _, storage = _load_runtime_storage()
    payload = _build_inspect_payload(storage, channel, limit=limit)
    _print_json(payload)
    return 0


def _load_runtime_config() -> TelegramIngestionConfig:
    config = load_config()
    ensure_runtime_directories(config)
    configure_logging(config.log_level)
    return config


def _load_runtime_storage() -> tuple[TelegramIngestionConfig, TelegramStorage]:
    config = _load_runtime_config()
    storage = TelegramStorage(config.sqlite_path)
    storage.initialize()
    return config, storage


def _open_tdlib_client(config: TelegramIngestionConfig) -> TdLibClient:
    if config.tdlib_library_dir is not None and "TDLIB_LIBRARY_DIR" not in os.environ:
        os.environ["TDLIB_LIBRARY_DIR"] = str(config.tdlib_library_dir)
    if config.tdlib_library_path is not None and "TDLIB_LIBRARY_PATH" not in os.environ:
        os.environ["TDLIB_LIBRARY_PATH"] = str(config.tdlib_library_path)
    return TdLibClient(parameters=_build_tdlib_parameters(config))


def _build_tdlib_parameters(config: TelegramIngestionConfig) -> TelegramTdlibParameters:
    return TelegramTdlibParameters(
        api_id=config.api_id,
        api_hash=config.api_hash,
        database_directory=config.tdlib_session_dir,
        files_directory=config.tdlib_files_directory,
        log_verbosity=_tdlib_verbosity_from_log_level(config.log_level),
        library_path=config.tdlib_library_path,
    )


def _print_json(payload: Any) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=True))


def _ensure_authorized(client: TdLibClient) -> None:
    parameters = client.parameters
    state = client.get_authorization_state()
    while state.get("@type") in {"authorizationStateWaitTdlibParameters", "authorizationStateWaitEncryptionKey"}:
        state_type = state.get("@type")
        if state_type == "authorizationStateWaitTdlibParameters":
            if parameters is None:
                raise RuntimeError("TDLib parameters are required to initialize the Telegram client session.")
            client.request(parameters.tdlib_parameters_request(), timeout=60.0)
        elif state_type == "authorizationStateWaitEncryptionKey":
            encryption_key = parameters.database_encryption_key if parameters is not None else b""
            client.request({"@type": "setDatabaseEncryptionKey", "new_encryption_key": encryption_key}, timeout=60.0)
        state = client.get_authorization_state()

    if state.get("@type") != "authorizationStateReady":
        raise RuntimeError(
            "Telegram session is not authorized. Run `telegram-ingest auth` first using the same TDLIB_DATABASE_DIR."
        )


def _tdlib_verbosity_from_log_level(level: str) -> int:
    normalized = level.strip().upper()
    if normalized == "DEBUG":
        return 4
    if normalized == "INFO":
        return 2
    if normalized == "WARNING":
        return 1
    return 0


def _build_stats_payload(storage: TelegramStorage, config: TelegramIngestionConfig) -> dict[str, Any]:
    overview_rows = storage.channel_overview()
    overview_by_name: dict[str, dict[str, Any]] = {}
    for row in overview_rows:
        channel_name = str(row["channel_name"]).lower()
        overview_by_name[channel_name] = row
        source_username = row.get("source_username")
        if source_username:
            overview_by_name[str(source_username).lower()] = row
    channels: list[dict[str, Any]] = []
    resolved_count = 0
    for channel_name in config.telegram_channels:
        row = overview_by_name.get(channel_name.lower())
        if row is not None:
            resolved_count += 1
            channels.append(
                {
                    "channel_id": row["channel_id"],
                    "channel_name": row["channel_name"],
                    "resolved": True,
                    "total_messages": row["message_count"] or 0,
                    "latest_message_timestamp": row["latest_timestamp"],
                    "last_status": row["last_status"],
                    "last_error": row["last_error"],
                    "last_backfilled_message_id": row["last_backfilled_message_id"],
                    "last_incremental_message_id": row["last_incremental_message_id"],
                }
            )
        else:
            channels.append(
                {
                    "channel_id": None,
                    "channel_name": channel_name,
                    "resolved": False,
                    "total_messages": 0,
                    "latest_message_timestamp": None,
                    "last_status": None,
                    "last_error": None,
                    "last_backfilled_message_id": None,
                    "last_incremental_message_id": None,
                }
            )

    return {
        "total_channels_configured": len(config.telegram_channels),
        "channels_resolved": resolved_count,
        "total_messages_stored": storage.count_messages(),
        "channels": channels,
    }


def _build_inspect_payload(storage: TelegramStorage, channel: str, *, limit: int) -> dict[str, Any]:
    channel_name = channel.strip().removeprefix("@")
    registry = next(
        (record for record in storage.list_channel_registry() if record.channel_name.lower() == channel_name.lower()),
        None,
    )
    sync_state = storage.get_sync_state_by_name(channel_name)
    messages = storage.fetch_messages(channel_name=channel_name, limit=limit)
    return {
        "channel": None
        if registry is None
        else {
            "channel_id": registry.channel_id,
            "channel_name": registry.channel_name,
            "source_username": registry.source_username,
            "resolved_title": registry.resolved_title,
            "is_active": registry.is_active,
        },
        "sync_state": None
        if sync_state is None
        else {
            "channel_id": sync_state.channel_id,
            "channel_name": sync_state.channel_name,
            "last_backfilled_message_id": sync_state.last_backfilled_message_id,
            "last_incremental_message_id": sync_state.last_incremental_message_id,
            "last_synced_at": sync_state.last_synced_at,
            "last_status": sync_state.last_status,
            "last_error": sync_state.last_error,
        },
        "messages": [message.to_dict() if hasattr(message, "to_dict") else dict(message) for message in messages],
    }


def _result_code(value: Any) -> int:
    return 0 if value is None else int(value)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
