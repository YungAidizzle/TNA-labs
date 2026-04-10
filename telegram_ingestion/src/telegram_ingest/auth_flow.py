from __future__ import annotations

import getpass
import logging
from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from .tdlib_client import TdLibClient, TelegramTdlibParameters, TdLibRequestError

__all__ = [
    "AuthFlowError",
    "InteractiveTelegramPrompts",
    "TelegramAuthFlow",
    "TelegramAuthPrompts",
]

logger = logging.getLogger(__name__)


class AuthFlowError(RuntimeError):
    """Raised when Telegram authorization cannot proceed."""


class TelegramAuthPrompts(Protocol):
    def prefer_qr_login(self, state: Mapping[str, Any]) -> bool: ...

    def bot_token(self, state: Mapping[str, Any]) -> str: ...

    def phone_number(self, state: Mapping[str, Any]) -> str: ...

    def verification_code(self, state: Mapping[str, Any]) -> str: ...

    def password(self, state: Mapping[str, Any]) -> str: ...

    def email_address(self, state: Mapping[str, Any]) -> str: ...

    def email_code(self, state: Mapping[str, Any]) -> str: ...

    def registration_name(self, state: Mapping[str, Any]) -> tuple[str, str]: ...

    def on_other_device_confirmation(self, state: Mapping[str, Any]) -> None: ...


@dataclass(slots=True)
class InteractiveTelegramPrompts:
    def prefer_qr_login(self, state: Mapping[str, Any]) -> bool:
        reply = input("Use QR login instead of phone number? [y/N]: ").strip().lower()
        return reply in {"y", "yes"}

    def bot_token(self, state: Mapping[str, Any]) -> str:
        return ""

    def phone_number(self, state: Mapping[str, Any]) -> str:
        return input("Telegram phone number in international format: ").strip()

    def verification_code(self, state: Mapping[str, Any]) -> str:
        code_info = state.get("code_info")
        if isinstance(code_info, dict):
            logger.info("Telegram verification code requested: %s", code_info)
        return input("Telegram authentication code: ").strip()

    def password(self, state: Mapping[str, Any]) -> str:
        hint = state.get("password_hint_") or state.get("password_hint")
        prompt = "Telegram 2-step password"
        if hint:
            prompt += f" (hint: {hint})"
        prompt += ": "
        return getpass.getpass(prompt)

    def email_address(self, state: Mapping[str, Any]) -> str:
        return input("Telegram login email address: ").strip()

    def email_code(self, state: Mapping[str, Any]) -> str:
        code_info = state.get("code_info")
        if isinstance(code_info, dict):
            logger.info("Telegram email code requested: %s", code_info)
        return input("Telegram email verification code: ").strip()

    def registration_name(self, state: Mapping[str, Any]) -> tuple[str, str]:
        first_name = input("Telegram first name: ").strip()
        last_name = input("Telegram last name (optional): ").strip()
        return first_name, last_name

    def on_other_device_confirmation(self, state: Mapping[str, Any]) -> None:
        link = state.get("link")
        if isinstance(link, str):
            print(f"Confirm Telegram login on another device: {link}")


class TelegramAuthFlow:
    def __init__(
        self,
        client: TdLibClient,
        parameters: TelegramTdlibParameters,
        prompts: TelegramAuthPrompts | None = None,
    ) -> None:
        self._client = client
        self._parameters = parameters.resolved()
        self._prompts = prompts or InteractiveTelegramPrompts()

    def authenticate(self, timeout: float = 60.0) -> dict[str, Any]:
        state = self._client.get_authorization_state()
        logger.info("Initial Telegram authorization state: %s", state.get("@type"))

        while True:
            state_type = state.get("@type")
            if state_type == "authorizationStateReady":
                logger.info("Telegram authorization complete")
                return state
            if state_type in {"authorizationStateClosing", "authorizationStateClosed"}:
                raise AuthFlowError("TDLib closed before authorization finished")
            if state_type == "authorizationStateWaitTdlibParameters":
                self._client.request(self._parameters.tdlib_parameters_request(), timeout=timeout)
                state = self._next_authorization_state(timeout, ignore_types={state_type})
                continue
            if state_type == "authorizationStateWaitEncryptionKey":
                self._client.request(
                    {
                        "@type": "setDatabaseEncryptionKey",
                        "new_encryption_key": self._parameters.database_encryption_key,
                    },
                    timeout=timeout,
                )
                state = self._next_authorization_state(timeout, ignore_types={state_type})
                continue
            if state_type == "authorizationStateWaitPhoneNumber":
                state = self._handle_phone_number_state(state, timeout)
                continue
            if state_type == "authorizationStateWaitCode":
                state = self._handle_code_state(state, timeout)
                continue
            if state_type == "authorizationStateWaitPassword":
                state = self._handle_password_state(state, timeout)
                continue
            if state_type == "authorizationStateWaitEmailAddress":
                state = self._handle_email_address_state(state, timeout)
                continue
            if state_type == "authorizationStateWaitEmailCode":
                state = self._handle_email_code_state(state, timeout)
                continue
            if state_type == "authorizationStateWaitRegistration":
                state = self._handle_registration_state(state, timeout)
                continue
            if state_type == "authorizationStateWaitOtherDeviceConfirmation":
                self._prompts.on_other_device_confirmation(state)
                logger.info("Waiting for QR confirmation on another device")
                state = self._next_authorization_state(timeout)
                continue
            if state_type == "authorizationStateWaitPremiumPurchase":
                logger.info("Premium purchase gate encountered; falling back to standard login path")
                state = self._handle_phone_number_state(state, timeout)
                continue

            raise AuthFlowError(f"Unsupported Telegram authorization state: {state_type!r}")

    def _next_authorization_state(
        self,
        timeout: float,
        *,
        ignore_types: set[str] | None = None,
    ) -> dict[str, Any]:
        ignored = ignore_types or set()
        while True:
            update = self._client.get_update(timeout=timeout)
            if update is None:
                raise TimeoutError("Timed out waiting for TDLib authorization update")
            if update.get("@type") != "updateAuthorizationState":
                logger.debug("Ignoring non-authorization TDLib update: %s", update.get("@type"))
                continue
            state = update.get("authorization_state")
            if not isinstance(state, dict):
                raise AuthFlowError(f"Malformed authorization update: {update!r}")
            state_type = str(state.get("@type"))
            if state_type in ignored:
                logger.debug("Ignoring duplicate Telegram authorization state: %s", state_type)
                continue
            logger.info("Telegram authorization state changed to %s", state_type)
            return state

    def _handle_phone_number_state(self, state: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        if self._prompts.prefer_qr_login(state):
            logger.info("Requesting QR code authentication")
            self._client.request({"@type": "requestQrCodeAuthentication", "other_user_ids": []}, timeout=timeout)
            return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})

        bot_token = self._prompts.bot_token(state).strip()
        if bot_token:
            logger.info("Attempting bot-token authentication")
            self._client.request({"@type": "checkAuthenticationBotToken", "token": bot_token}, timeout=timeout)
            return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})

        phone_number = self._prompts.phone_number(state).strip()
        if not phone_number:
            raise AuthFlowError("Phone number is required for Telegram login")

        logger.info("Submitting phone number to Telegram")
        self._client.request({"@type": "setAuthenticationPhoneNumber", "phone_number": phone_number}, timeout=timeout)
        return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})

    def _handle_code_state(self, state: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        while True:
            code = self._prompts.verification_code(state).strip()
            if not code:
                raise AuthFlowError("Telegram authentication code is required")
            try:
                logger.info("Submitting Telegram authentication code")
                self._client.request({"@type": "checkAuthenticationCode", "code": code}, timeout=timeout)
                return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})
            except TdLibRequestError as exc:
                logger.warning("Telegram code rejected: %s", exc)
                if exc.code in {400, 401}:
                    continue
                raise

    def _handle_password_state(self, state: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        while True:
            password = self._prompts.password(state)
            if not password:
                raise AuthFlowError("Telegram 2-step password is required")
            try:
                logger.info("Submitting Telegram 2-step password")
                self._client.request({"@type": "checkAuthenticationPassword", "password": password}, timeout=timeout)
                return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})
            except TdLibRequestError as exc:
                logger.warning("Telegram password rejected: %s", exc)
                if exc.code in {400, 401}:
                    continue
                raise

    def _handle_email_address_state(self, state: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        email_address = self._prompts.email_address(state).strip()
        if not email_address:
            raise AuthFlowError("Email address is required for Telegram login")
        logger.info("Submitting Telegram email address")
        self._client.request({"@type": "setAuthenticationEmailAddress", "email_address": email_address}, timeout=timeout)
        return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})

    def _handle_email_code_state(self, state: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        while True:
            code = self._prompts.email_code(state).strip()
            if not code:
                raise AuthFlowError("Telegram email verification code is required")
            try:
                logger.info("Submitting Telegram email verification code")
                self._client.request(
                    {
                        "@type": "checkAuthenticationEmailCode",
                        "code": {"@type": "emailAddressAuthenticationCode", "code": code},
                    },
                    timeout=timeout,
                )
                return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})
            except TdLibRequestError as exc:
                logger.warning("Telegram email code rejected: %s", exc)
                if exc.code in {400, 401}:
                    continue
                raise

    def _handle_registration_state(self, state: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        first_name, last_name = self._prompts.registration_name(state)
        first_name = first_name.strip()
        last_name = last_name.strip()
        if not first_name:
            raise AuthFlowError("Telegram registration requires a first name")
        logger.info("Submitting Telegram registration name")
        self._client.request(
            {
                "@type": "registerUser",
                "first_name": first_name,
                "last_name": last_name,
                "disable_notification": False,
            },
            timeout=timeout,
        )
        return self._next_authorization_state(timeout, ignore_types={str(state.get("@type"))})
