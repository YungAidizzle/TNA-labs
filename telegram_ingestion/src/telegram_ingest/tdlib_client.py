from __future__ import annotations

import base64
import ctypes
import json
import logging
import platform
import queue
import threading
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from .tdjson_loader import TdJsonBindings, load_tdjson

__all__ = [
    "TdLibClient",
    "TdLibError",
    "TdLibRequestError",
    "TelegramTdlibParameters",
]

logger = logging.getLogger(__name__)


class TdLibError(RuntimeError):
    """Base TDLib wrapper error."""


class TdLibRequestError(TdLibError):
    def __init__(self, code: int, message: str, request: Mapping[str, Any] | None = None) -> None:
        self.code = code
        self.message = message
        self.request = dict(request or {})
        super().__init__(f"TDLib error {code}: {message}")


@dataclass(frozen=True, slots=True)
class TelegramTdlibParameters:
    api_id: int
    api_hash: str
    database_directory: Path | str
    files_directory: Path | str | None = None
    database_encryption_key: bytes = b""
    use_test_dc: bool = False
    use_file_database: bool = True
    use_chat_info_database: bool = True
    use_message_database: bool = True
    use_secret_chats: bool = False
    system_language_code: str = "en"
    device_model: str = field(default_factory=lambda: platform.node() or "Windows")
    system_version: str = field(default_factory=platform.platform)
    application_version: str = "0.1.0"
    log_verbosity: int = 2
    log_file_path: Path | str | None = None
    library_path: Path | str | None = None

    def resolved(self) -> "TelegramTdlibParameters":
        database_directory = Path(self.database_directory).expanduser().resolve()
        files_directory = (
            Path(self.files_directory).expanduser().resolve()
            if self.files_directory
            else database_directory / "files"
        )
        database_directory.mkdir(parents=True, exist_ok=True)
        files_directory.mkdir(parents=True, exist_ok=True)
        return TelegramTdlibParameters(
            api_id=self.api_id,
            api_hash=self.api_hash,
            database_directory=database_directory,
            files_directory=files_directory,
            database_encryption_key=self.database_encryption_key,
            use_test_dc=self.use_test_dc,
            use_file_database=self.use_file_database,
            use_chat_info_database=self.use_chat_info_database,
            use_message_database=self.use_message_database,
            use_secret_chats=self.use_secret_chats,
            system_language_code=self.system_language_code,
            device_model=self.device_model,
            system_version=self.system_version,
            application_version=self.application_version,
            log_verbosity=self.log_verbosity,
            log_file_path=self.log_file_path,
            library_path=self.library_path,
        )

    def tdlib_parameters_request(self) -> dict[str, Any]:
        resolved = self.resolved()
        return {
            "@type": "setTdlibParameters",
            "use_test_dc": resolved.use_test_dc,
            "database_directory": str(resolved.database_directory),
            "files_directory": str(resolved.files_directory or resolved.database_directory),
            "database_encryption_key": resolved.database_encryption_key,
            "use_file_database": resolved.use_file_database,
            "use_chat_info_database": resolved.use_chat_info_database,
            "use_message_database": resolved.use_message_database,
            "use_secret_chats": resolved.use_secret_chats,
            "api_id": resolved.api_id,
            "api_hash": resolved.api_hash,
            "system_language_code": resolved.system_language_code,
            "device_model": resolved.device_model,
            "system_version": resolved.system_version,
            "application_version": resolved.application_version,
        }


def _json_dumps(payload: Mapping[str, Any]) -> bytes:
    def encode_bytes(value: Any) -> Any:
        if isinstance(value, (bytes, bytearray, memoryview)):
            return base64.b64encode(bytes(value)).decode("ascii")
        if isinstance(value, (Path, os.PathLike)):
            return str(value)
        raise TypeError(f"Unsupported value for TDLib JSON serialization: {type(value)!r}")

    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=encode_bytes).encode("utf-8")


def _json_loads(raw: bytes | str) -> dict[str, Any]:
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    else:
        text = raw
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise TdLibError(f"Unexpected TDLib payload type: {type(payload)!r}")
    return payload


class TdLibClient:
    def __init__(
        self,
        *,
        bindings: TdJsonBindings | None = None,
        parameters: TelegramTdlibParameters | None = None,
        log_verbosity: int | None = None,
        log_file_path: str | os.PathLike[str] | None = None,
    ) -> None:
        self._bindings = bindings or load_tdjson(parameters.library_path if parameters else None)
        self._parameters = parameters
        self._client = self._bindings.create_client()
        self._pending: dict[str, queue.Queue[dict[str, Any]]] = {}
        self._pending_lock = threading.Lock()
        self._updates: queue.Queue[dict[str, Any]] = queue.Queue()
        self._stop_event = threading.Event()
        self._closed = False
        self._receiver = threading.Thread(target=self._receive_loop, name="TdLibReceiveLoop", daemon=True)

        verbosity = log_verbosity if log_verbosity is not None else (parameters.log_verbosity if parameters else None)
        if verbosity is not None and self._bindings.set_log_verbosity_level is not None:
            self._bindings.set_log_verbosity_level(int(verbosity))

        file_path = log_file_path if log_file_path is not None else (parameters.log_file_path if parameters else None)
        if file_path is not None and self._bindings.set_log_file_path is not None:
            self._bindings.set_log_file_path(str(file_path).encode("utf-8"))

        self._receiver.start()

    @property
    def parameters(self) -> TelegramTdlibParameters | None:
        return self._parameters

    @property
    def library_path(self) -> Path:
        return self._bindings.library_path

    @property
    def is_closed(self) -> bool:
        return self._closed

    def _receive_loop(self) -> None:
        while not self._stop_event.is_set():
            raw = self._bindings.receive(self._client, 1.0)
            if not raw:
                continue

            try:
                message = _json_loads(ctypes.string_at(raw))
            except Exception:
                logger.exception("Failed to decode TDLib payload")
                continue

            extra = message.get("@extra")
            if extra is not None:
                key = str(extra)
                with self._pending_lock:
                    pending = self._pending.get(key)
                if pending is not None:
                    pending.put(message)
                    continue

            self._updates.put(message)

            if message.get("@type") == "updateAuthorizationState":
                state = message.get("authorization_state") or {}
                if isinstance(state, dict) and state.get("@type") == "authorizationStateClosed":
                    self._stop_event.set()
                    self._closed = True

    def _register_pending(self, request_id: str) -> queue.Queue[dict[str, Any]]:
        pending: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[request_id] = pending
        return pending

    def _clear_pending(self, request_id: str) -> None:
        with self._pending_lock:
            self._pending.pop(request_id, None)

    def send(self, payload: Mapping[str, Any]) -> None:
        self._bindings.send(self._client, _json_dumps(dict(payload)))

    def request(self, payload: Mapping[str, Any], timeout: float = 60.0) -> dict[str, Any]:
        request = dict(payload)
        request_id = str(uuid.uuid4())
        request["@extra"] = request_id
        pending = self._register_pending(request_id)
        try:
            self._bindings.send(self._client, _json_dumps(request))
            response = pending.get(timeout=timeout)
        except queue.Empty as exc:
            raise TimeoutError(f"TDLib request timed out: {request.get('@type')}") from exc
        finally:
            self._clear_pending(request_id)

        if response.get("@type") == "error":
            error = TdLibRequestError(
                code=int(response.get("code", 500)),
                message=str(response.get("message", "TDLib error")),
                request=request,
            )
            raise error
        return response

    def get_update(self, timeout: float = 0.0) -> dict[str, Any] | None:
        try:
            return self._updates.get(timeout=timeout)
        except queue.Empty:
            return None

    def drain_updates(self) -> list[dict[str, Any]]:
        updates: list[dict[str, Any]] = []
        while True:
            update = self.get_update(timeout=0.0)
            if update is None:
                return updates
            updates.append(update)

    def execute(self, payload: Mapping[str, Any]) -> dict[str, Any] | None:
        raw = self._bindings.execute(_json_dumps(payload))
        if not raw:
            return None
        return _json_loads(ctypes.string_at(raw))

    def get_authorization_state(self) -> dict[str, Any]:
        response = self.request({"@type": "getAuthorizationState"}, timeout=30.0)
        if response.get("@type") in {"authorizationStateWaitTdlibParameters", "authorizationStateWaitEncryptionKey", "authorizationStateWaitPhoneNumber", "authorizationStateWaitCode", "authorizationStateWaitOtherDeviceConfirmation", "authorizationStateWaitEmailAddress", "authorizationStateWaitEmailCode", "authorizationStateWaitPassword", "authorizationStateWaitRegistration", "authorizationStateReady", "authorizationStateLoggingOut", "authorizationStateClosing", "authorizationStateClosed"}:
            return response
        if response.get("@type") == "updateAuthorizationState":
            state = response.get("authorization_state")
            if isinstance(state, dict):
                return state
        raise TdLibError(f"Unexpected authorization state payload: {response!r}")

    def close(self, timeout: float = 30.0) -> None:
        if self._closed:
            return

        try:
            self.request({"@type": "close"}, timeout=timeout)
        except TdLibRequestError as exc:
            if exc.code != 500:
                raise
        finally:
            self._stop_event.set()
            self._receiver.join(timeout=timeout)
            if not self._closed:
                try:
                    self._bindings.destroy_client(self._client)
                finally:
                    self._closed = True

    def search_public_chat(self, channel_ref: str, timeout: float = 30.0) -> dict[str, Any]:
        response = self.request(
            {"@type": "searchPublicChat", "username": str(channel_ref).removeprefix("@")},
            timeout=timeout,
        )
        return self._flatten_chat(response)

    def resolve_channel(self, channel_ref: str, timeout: float = 30.0) -> dict[str, Any]:
        return self.search_public_chat(channel_ref, timeout=timeout)

    def get_chat(self, chat_id: int, timeout: float = 30.0) -> dict[str, Any]:
        response = self.request({"@type": "getChat", "chat_id": int(chat_id)}, timeout=timeout)
        return self._flatten_chat(response)

    def get_chat_history(
        self,
        chat_id: int,
        from_message_id: int = 0,
        offset: int = 0,
        limit: int = 100,
        only_local: bool = False,
        timeout: float = 60.0,
    ) -> list[dict[str, Any]]:
        response = self.request(
            {
                "@type": "getChatHistory",
                "chat_id": int(chat_id),
                "from_message_id": int(from_message_id),
                "offset": int(offset),
                "limit": int(limit),
                "only_local": bool(only_local),
            },
            timeout=timeout,
        )
        messages = response.get("messages", [])
        if isinstance(messages, list):
            return [message for message in messages if isinstance(message, dict)]
        return []

    def get_history(
        self,
        chat_id: int,
        *,
        offset_message_id: int | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return self.get_chat_history(
            chat_id,
            from_message_id=int(offset_message_id or 0),
            offset=0,
            limit=limit,
            only_local=False,
        )

    fetch_history = get_history

    def __enter__(self) -> "TdLibClient":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()

    @staticmethod
    def _flatten_chat(payload: Mapping[str, Any]) -> dict[str, Any]:
        chat = dict(payload.get("chat", payload))
        usernames = chat.get("usernames")
        username = chat.get("username")
        if isinstance(usernames, dict):
            editable = usernames.get("editable_username")
            active = usernames.get("active_usernames")
            if isinstance(editable, str) and editable.strip():
                username = editable
            elif isinstance(active, list):
                for candidate in active:
                    if isinstance(candidate, str) and candidate.strip():
                        username = candidate
                        break

        flattened = {
            "channel_id": chat.get("id"),
            "channel_name": username or chat.get("title") or chat.get("name"),
            "username": username,
            "title": chat.get("title") or chat.get("name"),
            "public_url": f"https://t.me/{username}" if isinstance(username, str) and username.strip() else None,
            "raw_json": chat,
        }
        flattened.update(chat)
        return flattened
