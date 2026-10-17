"""Small client for the Keylink HTTP API. Uses the standard library only."""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


class KeylinkError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class Keylink:
    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        if not api_key:
            raise ValueError("api_key is required")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def upsert_user(self, external_id: str, display_name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if display_name is not None:
            body["displayName"] = display_name
        return self._request("PUT", f"/v1/users/{_path(external_id)}", body)

    def get_user(self, external_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/users/{_path(external_id)}")

    def create_session(self, external_id: str, purpose: str, display_name: str | None = None) -> dict[str, Any]:
        if purpose not in ("enroll", "verify"):
            raise ValueError('purpose must be "enroll" or "verify"')
        body: dict[str, Any] = {"purpose": purpose}
        if display_name is not None:
            body["displayName"] = display_name
        return self._request("POST", f"/v1/users/{_path(external_id)}/sessions", body)

    def get_session(self, session_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/sessions/{_path(session_id)}")

    def consume_session(self, session_id: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/sessions/{_path(session_id)}/consume", {})

    def verify_code(self, external_id: str, code: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/users/{_path(external_id)}/verify", {"code": code})

    def regenerate_backup_codes(self, external_id: str) -> dict[str, Any]:
        return self._request("POST", f"/v1/users/{_path(external_id)}/backup-codes", {})

    def disable_totp(self, external_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/v1/users/{_path(external_id)}/totp")

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(self.base_url + path, data=data, method=method)
        request.add_header("Authorization", f"Bearer {self.api_key}")
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raw = error.read().decode("utf-8")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {}
            detail = payload.get("error") or {}
            raise KeylinkError(
                error.code,
                str(detail.get("code") or "request_failed"),
                str(detail.get("message") or f"Keylink request failed ({error.code})"),
            ) from None


def _path(value: str) -> str:
    return quote(value, safe="")
