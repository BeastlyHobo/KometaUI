from __future__ import annotations

import base64
import binascii
import secrets
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .settings import Settings


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        if not request.url.path.startswith("/api"):
            return await call_next(request)

        if self.settings.auth_mode == "none":
            return await call_next(request)

        auth_header = request.headers.get("authorization")
        if not auth_header:
            return _unauthorized(self.settings.auth_mode)

        if self.settings.auth_mode == "basic":
            if _check_basic(auth_header, self.settings):
                return await call_next(request)
            return _unauthorized("basic")

        if self.settings.auth_mode == "token":
            if _check_token(auth_header, self.settings):
                return await call_next(request)
            return _unauthorized("token")

        return _unauthorized(self.settings.auth_mode)


def _unauthorized(mode: str) -> JSONResponse:
    challenge = "Basic" if mode == "basic" else "Bearer"
    return JSONResponse(
        {"detail": "Unauthorized"},
        status_code=401,
        headers={"WWW-Authenticate": challenge},
    )


def _check_basic(auth_header: str, settings: Settings) -> bool:
    if not auth_header.lower().startswith("basic "):
        return False
    encoded = auth_header.split(" ", 1)[1].strip()
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return False
    if ":" not in decoded:
        return False
    user, password = decoded.split(":", 1)
    return secrets.compare_digest(user, settings.basic_user or "") and secrets.compare_digest(
        password, settings.basic_pass or ""
    )


def _check_token(auth_header: str, settings: Settings) -> bool:
    if not auth_header.lower().startswith("bearer "):
        return False
    token = auth_header.split(" ", 1)[1].strip()
    return secrets.compare_digest(token, settings.api_token or "")
