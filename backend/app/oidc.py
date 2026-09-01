from __future__ import annotations

import json
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Callable

import jwt

from backend.app.config import Settings
from backend.app.errors import ForbiddenError, UnauthorizedError, ValidationError
from backend.app.repository import RegistryRepository
from backend.app.security import active, digest, expires_in, secret, timestamp


SESSION_COOKIE = "registry_session"
LOGIN_COOKIE = "registry_login"


@dataclass(frozen=True)
class BrowserCredentials:
    session_token: str
    csrf_token: str
    expires_at: str


class OidcService:
    def __init__(
        self,
        repository: RegistryRepository,
        settings: Settings,
        verifier: Callable[[str, str], dict] | None = None,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self._verifier = verifier or self._verify_id_token

    def start(self, return_to: str, *, setup_revision: int | None = None) -> tuple[str, str]:
        return_to = _return_path(return_to)
        state, binding, nonce = secret(), secret(), secret()
        now = timestamp()
        self.repository.create_oidc_state(
            {
                "id": uuid.uuid4().hex,
                "state_hash": digest(state),
                "binding_hash": digest(binding),
                "nonce": nonce,
                "return_to": return_to,
                "setup_revision": setup_revision,
                "created_at": now,
                "expires_at": expires_in(minutes=10),
            }
        )
        query = urllib.parse.urlencode(
            {
                "client_id": self.settings.google_client_id,
                "redirect_uri": self.settings.redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "nonce": nonce,
                "hd": self.settings.allowed_google_domains[0],
                "prompt": "select_account",
            }
        )
        return f"{self.settings.google_authorization_endpoint}?{query}", binding

    def callback(
        self,
        code: str,
        state: str,
        binding: str | None,
        *,
        setup_revision: int | None = None,
    ) -> tuple[BrowserCredentials, dict, str]:
        if not code or not state or not binding:
            raise UnauthorizedError("Google login could not be verified.")
        now = timestamp()
        record = self.repository.consume_oidc_state(
            digest(state), digest(binding), now, setup_revision,
        )
        if record is None:
            raise UnauthorizedError("Google login state is invalid, expired, or already used.")
        token_payload = self._exchange(code)
        id_token = token_payload.get("id_token")
        if not isinstance(id_token, str):
            raise UnauthorizedError("Google did not return an ID token.")
        claims = self._verifier(id_token, record["nonce"])
        identity = self._identity(claims)
        user = self.repository.upsert_user(identity, uuid.uuid4().hex, now)
        credentials = self.create_session(user["id"])
        return credentials, user, record["return_to"]

    def create_session(self, user_id: str) -> BrowserCredentials:
        token, csrf = secret("bs_"), secret("csrf_")
        expires_at = expires_in(hours=8)
        self.repository.create_browser_session(
            {
                "id": uuid.uuid4().hex,
                "token_hash": digest(token),
                "csrf_hash": digest(csrf),
                "user_id": user_id,
                "created_at": timestamp(),
                "expires_at": expires_at,
            }
        )
        return BrowserCredentials(token, csrf, expires_at)

    def authenticate(self, token: str | None) -> dict:
        if not token:
            raise UnauthorizedError("Authentication required.")
        session = self.repository.browser_session(digest(token), timestamp())
        if session is None or session["disabled"]:
            raise UnauthorizedError("Authentication required.")
        return _principal(session, self.settings)

    def verify_csrf(self, session_token: str | None, csrf_token: str | None) -> dict:
        principal = self.authenticate(session_token)
        session = self.repository.browser_session(digest(session_token or ""), timestamp())
        if not csrf_token or session is None or digest(csrf_token) != session["csrf_hash"]:
            raise ForbiddenError("CSRF validation failed.")
        return principal

    def revoke_session(self, token: str | None) -> None:
        if token:
            self.repository.revoke_browser_session(digest(token), timestamp())

    def _exchange(self, code: str) -> dict:
        data = urllib.parse.urlencode(
            {
                "code": code,
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
                "redirect_uri": self.settings.redirect_uri,
                "grant_type": "authorization_code",
            }
        ).encode()
        request = urllib.request.Request(
            self.settings.google_token_endpoint,
            data=data,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read())
        except Exception as error:
            raise UnauthorizedError("Google token exchange failed.") from error

    def _verify_id_token(self, token: str, nonce: str) -> dict:
        try:
            signing_key = jwt.PyJWKClient(self.settings.google_jwks_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self.settings.google_client_id,
                issuer=self.settings.google_issuer,
                options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]},
            )
        except Exception as error:
            raise UnauthorizedError("Google ID token validation failed.") from error
        if claims.get("nonce") != nonce:
            raise UnauthorizedError("Google login nonce does not match.")
        return claims

    def _identity(self, claims: dict) -> dict:
        email = claims.get("email")
        domain = claims.get("hd")
        if claims.get("email_verified") is not True:
            raise UnauthorizedError("Google email is not verified.")
        if not isinstance(email, str) or not isinstance(domain, str):
            raise UnauthorizedError("Google Workspace identity is incomplete.")
        if domain.casefold() not in self.settings.allowed_google_domains:
            raise ForbiddenError("This Google Workspace domain is not allowed.")
        return {
            "issuer": claims["iss"],
            "subject": claims["sub"],
            "email": email.strip().casefold(),
            "display_name": str(claims.get("name") or email),
            "picture_url": claims.get("picture") if isinstance(claims.get("picture"), str) else None,
        }


def _principal(row: dict, settings: Settings) -> dict:
    return {
        "user_id": row["user_id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "picture_url": row.get("picture_url"),
        "role": settings.role_for(row["email"]),
    }


def _return_path(value: str) -> str:
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc:
        raise ValidationError("return_to must be a same-origin path.")
    return value
