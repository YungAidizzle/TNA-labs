from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if SRC.exists():
    sys.path.insert(0, str(SRC))


def _load_module() -> Any:
    try:
        return importlib.import_module("telegram_ingest.auth_flow")
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise AssertionError(
            "Expected telegram_ingest.auth_flow to exist under telegram_ingestion/src/telegram_ingest"
        ) from exc


class _FakeClient:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.updates = [
            {"@type": "updateAuthorizationState", "authorization_state": {"@type": "authorizationStateWaitTdlibParameters"}},
            {"@type": "updateAuthorizationState", "authorization_state": {"@type": "authorizationStateWaitEncryptionKey"}},
            {"@type": "updateAuthorizationState", "authorization_state": {"@type": "authorizationStateReady"}},
        ]

    def get_authorization_state(self) -> dict[str, Any]:
        return {"@type": "authorizationStateWaitTdlibParameters"}

    def request(self, payload: dict[str, Any], timeout: float = 60.0) -> dict[str, Any]:
        self.requests.append(dict(payload))
        return {"@type": "ok"}

    def get_update(self, timeout: float = 0.0) -> dict[str, Any] | None:
        if self.updates:
            return self.updates.pop(0)
        return None


class AuthFlowTests(unittest.TestCase):
    def test_authenticate_ignores_duplicate_wait_tdlib_parameters_update(self) -> None:
        module = _load_module()
        parameters_cls = importlib.import_module("telegram_ingest.tdlib_client").TelegramTdlibParameters

        client = _FakeClient()
        flow = module.TelegramAuthFlow(
            client,
            parameters_cls(
                api_id=123456,
                api_hash="deadbeefcafefeed",
                database_directory=ROOT / "runtime" / "test-tdlib",
            ),
        )

        final_state = flow.authenticate(timeout=1.0)

        self.assertEqual(final_state.get("@type"), "authorizationStateReady")
        self.assertEqual([request["@type"] for request in client.requests], ["setTdlibParameters", "setDatabaseEncryptionKey"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
