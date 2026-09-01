from __future__ import annotations

import json
import re
import unicodedata
import urllib.parse
import uuid
from ipaddress import ip_address
from urllib.parse import urlsplit

from backend.app.config import Settings
from backend.app.errors import ForbiddenError, UnauthorizedError, ValidationError
from backend.app.repository import RegistryRepository
from backend.app.security import digest, expires_in, pkce_challenge, secret, timestamp


USER_SCOPES = {"skills.read", "skills.submit"}
ADMIN_SCOPES = USER_SCOPES | {"skills.review"}
PKCE_CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43}")
PKCE_VERIFIER = re.compile(r"[A-Za-z0-9._~-]{43,128}")


class OAuthServer:
    def __init__(self, repository: RegistryRepository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    def protected_resource_metadata(self) -> dict:
        return {
            "resource": self.settings.mcp_resource,
            "authorization_servers": [self.settings.public_url],
            "bearer_methods_supported": ["header"],
            "scopes_supported": sorted(ADMIN_SCOPES),
        }

    def authorization_server_metadata(self) -> dict:
        base = self.settings.public_url
        return {
            "issuer": base,
            "authorization_endpoint": f"{base}/oauth/authorize",
            "token_endpoint": f"{base}/oauth/token",
            "registration_endpoint": f"{base}/oauth/register",
            "revocation_endpoint": f"{base}/oauth/revoke",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": sorted(ADMIN_SCOPES),
        }

    def register(self, body: dict) -> dict:
        name = body.get("client_name")
        redirects = body.get("redirect_uris")
        if not isinstance(name, str) or not _valid_client_name(name):
            raise ValidationError("client_name must contain 1 to 100 characters.")
        if not isinstance(redirects, list) or not 1 <= len(redirects) <= 5:
            raise ValidationError("One to five redirect_uris are required.")
        if any(not isinstance(uri, str) or not _allowed_redirect(uri) for uri in redirects):
            raise ValidationError("Every redirect URI must be HTTPS or loopback HTTP.")
        if body.get("token_endpoint_auth_method", "none") != "none":
            raise ValidationError("Only public OAuth clients are supported.")
        grants = body.get("grant_types", ["authorization_code", "refresh_token"])
        if set(grants) not in ({"authorization_code"}, {"authorization_code", "refresh_token"}):
            raise ValidationError("Only authorization_code and refresh_token grants are supported.")
        if body.get("response_types", ["code"]) != ["code"]:
            raise ValidationError("Only the code response type is supported.")
        client_id = secret("client_")
        self.repository.create_oauth_client(
            {
                "client_id": client_id,
                "client_name": name.strip(),
                "redirect_uris_json": json.dumps(sorted(set(redirects))),
                "created_at": timestamp(),
            }
        )
        return {
            "client_id": client_id,
            "client_name": name.strip(),
            "redirect_uris": redirects,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }

    def validate_authorization(self, query: dict, principal: dict) -> dict:
        client = self.repository.oauth_client(str(query.get("client_id", "")))
        redirect_uri = str(query.get("redirect_uri", ""))
        if client is None or redirect_uri not in json.loads(client["redirect_uris_json"]):
            raise ValidationError("OAuth client or redirect URI is invalid.")
        if query.get("response_type") != "code" or query.get("code_challenge_method") != "S256":
            raise ValidationError("Authorization Code with PKCE S256 is required.")
        challenge = query.get("code_challenge")
        if not isinstance(challenge, str) or PKCE_CHALLENGE.fullmatch(challenge) is None:
            raise ValidationError("A valid PKCE challenge is required.")
        if query.get("resource") != self.settings.mcp_resource:
            raise ValidationError("The MCP resource is invalid.")
        requested = set(str(query.get("scope", "")).split()) or USER_SCOPES
        allowed = ADMIN_SCOPES if principal["role"] == "admin" else USER_SCOPES
        unknown = requested - ADMIN_SCOPES
        if unknown:
            raise ForbiddenError("An unsupported OAuth scope was requested.")
        return {
            "client": client,
            "redirect_uri": redirect_uri,
            "scope": " ".join(sorted(requested & allowed)),
            "resource": self.settings.mcp_resource,
            "code_challenge": challenge,
            "state": str(query.get("state", "")),
        }

    def authorize(self, validated: dict, principal: dict) -> str:
        code = secret("code_")
        self.repository.create_oauth_code(
            {
                "id": uuid.uuid4().hex,
                "code_hash": digest(code),
                "client_id": validated["client"]["client_id"],
                "user_id": principal["user_id"],
                "redirect_uri": validated["redirect_uri"],
                "scope": validated["scope"],
                "resource": validated["resource"],
                "code_challenge": validated["code_challenge"],
                "created_at": timestamp(),
                "expires_at": expires_in(minutes=2),
            }
        )
        return _append_redirect_params(
            validated["redirect_uri"], {"code": code, "state": validated["state"]}
        )

    def token(self, form: dict) -> dict:
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            return self._authorization_code(form)
        if grant_type == "refresh_token":
            return self._refresh(form)
        raise ValidationError("Unsupported OAuth grant_type.")

    def authenticate_access(self, raw_token: str | None) -> dict:
        if not raw_token:
            raise UnauthorizedError("Authentication required.")
        row = self.repository.access_token(digest(raw_token), timestamp())
        if row is None or row["disabled"] or row["resource"] != self.settings.mcp_resource:
            raise UnauthorizedError("OAuth credential is invalid or expired.")
        role = self.settings.role_for(row["email"])
        allowed = ADMIN_SCOPES if role == "admin" else USER_SCOPES
        return {
            "user_id": row["user_id"],
            "email": row["email"],
            "display_name": row["display_name"],
            "role": role,
            "scopes": set(row["scope"].split()) & allowed,
        }

    def revoke(self, token: str | None) -> None:
        if token:
            self.repository.revoke_oauth_token(digest(token), timestamp())

    def _authorization_code(self, form: dict) -> dict:
        verifier = form.get("code_verifier")
        if not isinstance(verifier, str) or PKCE_VERIFIER.fullmatch(verifier) is None:
            raise ValidationError(
                "code_verifier must contain 43 to 128 RFC 7636 unreserved characters."
            )
        challenge = pkce_challenge(verifier)
        code = self.repository.consume_oauth_code(
            digest(str(form.get("code", ""))),
            timestamp(),
            str(form.get("client_id", "")),
            str(form.get("redirect_uri", "")),
            str(form.get("resource", "")),
            challenge,
        )
        if code is None:
            raise UnauthorizedError("Authorization code is invalid, expired, or already used.")
        return self._issue(code, uuid.uuid4().hex)

    def _refresh(self, form: dict) -> dict:
        raw_refresh = str(form.get("refresh_token", ""))
        refresh_hash = digest(raw_refresh)
        row, replay = self.repository.consume_refresh_token(
            refresh_hash,
            timestamp(),
            str(form.get("client_id", "")),
        )
        if row is None or replay:
            raise UnauthorizedError("Refresh token is invalid, expired, or replayed.")
        user = self.repository.get_user(row["user_id"])
        if user["disabled"]:
            self.repository.revoke_oauth_token(refresh_hash, timestamp())
            raise UnauthorizedError("Refresh token user is disabled.")
        allowed = ADMIN_SCOPES if self.settings.role_for(user["email"]) == "admin" else USER_SCOPES
        row["scope"] = " ".join(sorted(set(row["scope"].split()) & allowed))
        return self._issue(row, row["family_id"])

    def _issue(self, source: dict, family_id: str) -> dict:
        access_raw, refresh_raw = secret("oa_"), secret("or_")
        now = timestamp()
        common = {
            "family_id": family_id,
            "client_id": source["client_id"],
            "user_id": source["user_id"],
            "scope": source["scope"],
            "resource": source["resource"],
            "created_at": now,
        }
        self.repository.create_oauth_tokens(
            {**common, "id": uuid.uuid4().hex, "token_hash": digest(access_raw), "expires_at": expires_in(minutes=15)},
            {**common, "id": uuid.uuid4().hex, "token_hash": digest(refresh_raw), "expires_at": expires_in(days=30)},
        )
        return {
            "access_token": access_raw,
            "token_type": "Bearer",
            "expires_in": 900,
            "refresh_token": refresh_raw,
            "scope": source["scope"],
        }


def _allowed_redirect(value: str) -> bool:
    parsed = urlsplit(value)
    if parsed.fragment or not parsed.netloc or parsed.username or parsed.password:
        return False
    if parsed.scheme == "https":
        return True
    if parsed.scheme != "http" or not parsed.hostname:
        return False
    try:
        return ip_address(parsed.hostname).is_loopback
    except ValueError:
        return parsed.hostname == "localhost"


def _valid_client_name(value: str) -> bool:
    stripped = value.strip()
    return 1 <= len(stripped) <= 100 and all(
        unicodedata.category(character) not in {"Cc", "Cf", "Cs"} for character in stripped
    )


def _append_redirect_params(redirect_uri: str, values: dict[str, str]) -> str:
    parsed = urllib.parse.urlsplit(redirect_uri)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.extend(values.items())
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), "")
    )
