from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if SRC.exists():
    sys.path.insert(0, str(SRC))


def _load_module():
    try:
        return importlib.import_module("telegram_ingest.cli")
    except ModuleNotFoundError as exc:  # pragma: no cover - helps diagnose missing implementation
        raise AssertionError(
            "Expected telegram_ingest.cli to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


def _invoke_main(module, argv):
    main = getattr(module, "main", None)
    if main is None:
        raise AssertionError("Expected a main(argv) entrypoint in telegram_ingest.cli")
    try:
        return main(argv)
    except SystemExit as exc:
        return exc.code


def _result_code(value):
    return 0 if value is None else value


def _kwargs_or_args(record):
    _, args, kwargs = record
    if kwargs:
        return kwargs
    if len(args) == 2 and isinstance(args[0], str) and isinstance(args[1], int):
        return {"channel": args[0], "limit": args[1]}
    if len(args) == 1 and isinstance(args[0], str):
        return {"channel": args[0]}
    return kwargs or {}


class CliTests(unittest.TestCase):
    def test_parser_accepts_backfill_arguments(self) -> None:
        module = _load_module()
        build_parser = getattr(module, "build_parser", None) or getattr(module, "create_parser", None)
        self.assertIsNotNone(build_parser, "Expected build_parser() or create_parser() in telegram_ingest.cli")

        parser = build_parser()
        args = parser.parse_args(["backfill", "--channel", "newsroom", "--limit", "25"])

        self.assertEqual(getattr(args, "command", getattr(args, "subcommand", None)), "backfill")
        self.assertEqual(getattr(args, "channel", None), "newsroom")
        self.assertEqual(getattr(args, "limit", None), 25)

    def test_main_dispatches_auth_and_backfill_without_real_telegram_calls(self) -> None:
        module = _load_module()
        calls: list[tuple[str, tuple, dict]] = []

        def fake_auth(*args, **kwargs):
            calls.append(("auth", args, kwargs))
            return 0

        def fake_backfill(*args, **kwargs):
            calls.append(("backfill", args, kwargs))
            return 0

        with patch.object(module, "run_auth", side_effect=fake_auth), patch.object(
            module, "run_backfill", side_effect=fake_backfill
        ):
            rc_auth = _invoke_main(module, ["auth"])
            rc_backfill = _invoke_main(module, ["backfill", "--channel", "newsroom", "--limit", "50"])

        self.assertEqual(_result_code(rc_auth), 0)
        self.assertEqual(_result_code(rc_backfill), 0)
        self.assertEqual(calls[0][0], "auth")
        self.assertEqual(calls[1][0], "backfill")
        backfill_kwargs = _kwargs_or_args(calls[1])
        self.assertEqual(backfill_kwargs["channel"], "newsroom")
        self.assertEqual(backfill_kwargs["limit"], 50)

    def test_main_dispatches_channel_validation_and_inspect(self) -> None:
        module = _load_module()
        calls: list[tuple[str, tuple, dict]] = []

        def fake_validate(*args, **kwargs):
            calls.append(("validate", args, kwargs))
            return 0

        def fake_inspect(*args, **kwargs):
            calls.append(("inspect", args, kwargs))
            return 0

        with patch.object(module, "run_channels_validate", side_effect=fake_validate), patch.object(
            module, "run_inspect_channel", side_effect=fake_inspect
        ):
            rc_validate = _invoke_main(module, ["channels", "validate"])
            rc_inspect = _invoke_main(module, ["inspect-channel", "--channel", "newsroom", "--limit", "5"])

        self.assertEqual(_result_code(rc_validate), 0)
        self.assertEqual(_result_code(rc_inspect), 0)
        self.assertEqual(calls[0][0], "validate")
        self.assertEqual(calls[1][0], "inspect")
        inspect_kwargs = _kwargs_or_args(calls[1])
        self.assertEqual(inspect_kwargs["channel"], "newsroom")
        self.assertEqual(inspect_kwargs["limit"], 5)

    def test_parser_accepts_trends_group_arguments(self) -> None:
        module = _load_module()
        parser = module.build_parser()

        args = parser.parse_args(
            [
                "trends",
                "group",
                "--hours",
                "12",
                "--limit",
                "60",
                "--per-channel-limit",
                "10",
                "--max-trends",
                "5",
            ]
        )

        self.assertEqual(args.command, "trends")
        self.assertEqual(args.trends_command, "group")
        self.assertEqual(args.hours, 12)
        self.assertEqual(args.limit, 60)
        self.assertEqual(args.per_channel_limit, 10)
        self.assertEqual(args.max_trends, 5)

    def test_main_dispatches_trends_group(self) -> None:
        module = _load_module()
        calls: list[tuple[str, tuple, dict]] = []

        def fake_trends_group(*args, **kwargs):
            calls.append(("trends_group", args, kwargs))
            return 0

        with patch.object(module, "run_trends_group", side_effect=fake_trends_group):
            rc = _invoke_main(
                module,
                [
                    "trends",
                    "group",
                    "--hours",
                    "12",
                    "--limit",
                    "50",
                    "--per-channel-limit",
                    "7",
                    "--min-text-length",
                    "30",
                    "--max-text-length",
                    "200",
                    "--max-trends",
                    "4",
                ],
            )

        self.assertEqual(_result_code(rc), 0)
        self.assertEqual(calls[0][0], "trends_group")
        kwargs = _kwargs_or_args(calls[0])
        self.assertEqual(kwargs["hours"], 12)
        self.assertEqual(kwargs["limit"], 50)
        self.assertEqual(kwargs["per_channel_limit"], 7)
        self.assertEqual(kwargs["min_text_length"], 30)
        self.assertEqual(kwargs["max_text_length"], 200)
        self.assertEqual(kwargs["max_trends"], 4)

    def test_ensure_authorized_initializes_tdlib_then_accepts_ready_session(self) -> None:
        module = _load_module()
        tdlib_module = importlib.import_module("telegram_ingest.tdlib_client")
        parameters = tdlib_module.TelegramTdlibParameters(
            api_id=123456,
            api_hash="deadbeefcafefeed",
            database_directory=ROOT / "runtime" / "test-tdlib-cli",
        )

        class FakeClient:
            def __init__(self) -> None:
                self.parameters = parameters
                self.states = [
                    {"@type": "authorizationStateWaitTdlibParameters"},
                    {"@type": "authorizationStateWaitEncryptionKey"},
                    {"@type": "authorizationStateReady"},
                ]
                self.requests: list[dict] = []

            def get_authorization_state(self):
                return self.states.pop(0)

            def request(self, payload, timeout=60.0):
                self.requests.append(dict(payload))
                return {"@type": "ok"}

        client = FakeClient()
        module._ensure_authorized(client)

        self.assertEqual(
            [request["@type"] for request in client.requests],
            ["setTdlibParameters", "setDatabaseEncryptionKey"],
        )

    def test_ensure_authorized_raises_if_session_still_not_ready_after_initialization(self) -> None:
        module = _load_module()
        tdlib_module = importlib.import_module("telegram_ingest.tdlib_client")
        parameters = tdlib_module.TelegramTdlibParameters(
            api_id=123456,
            api_hash="deadbeefcafefeed",
            database_directory=ROOT / "runtime" / "test-tdlib-cli-not-ready",
        )

        class FakeClient:
            def __init__(self) -> None:
                self.parameters = parameters
                self.states = [
                    {"@type": "authorizationStateWaitTdlibParameters"},
                    {"@type": "authorizationStateWaitEncryptionKey"},
                    {"@type": "authorizationStateWaitPhoneNumber"},
                ]

            def get_authorization_state(self):
                return self.states.pop(0)

            def request(self, payload, timeout=60.0):
                return {"@type": "ok"}

        with self.assertRaises(RuntimeError):
            module._ensure_authorized(FakeClient())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
