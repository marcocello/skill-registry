from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta


def secret(prefix: str = "") -> str:
    return prefix + secrets.token_urlsafe(32)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def matches(value: str, expected_hash: str) -> bool:
    return hmac.compare_digest(digest(value), expected_hash)


def now() -> datetime:
    return datetime.now(UTC)


def timestamp(value: datetime | None = None) -> str:
    return (value or now()).isoformat()


def expires_in(**kwargs: int) -> str:
    return timestamp(now() + timedelta(**kwargs))


def active(expires_at: str) -> bool:
    return datetime.fromisoformat(expires_at) > now()


def pkce_challenge(verifier: str) -> str:
    raw = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
