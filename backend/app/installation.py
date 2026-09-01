from __future__ import annotations

import json
from dataclasses import asdict, dataclass, replace

from backend.app.config import Settings, _csv, _validate_public_url
from backend.app.errors import ValidationError


@dataclass(frozen=True)
class InstallationPolicy:
    auth_mode: str
    public_url: str
    google_client_id: str = ""
    google_client_secret: str = ""
    allowed_google_domains: tuple[str, ...] = ()
    admin_emails: tuple[str, ...] = ()

    @classmethod
    def from_record(cls, record: dict) -> "InstallationPolicy":
        return cls(
            auth_mode=record["auth_mode"],
            public_url=record["public_url"],
            google_client_id=record.get("google_client_id") or "",
            google_client_secret=record.get("google_client_secret") or "",
            allowed_google_domains=tuple(json.loads(record.get("allowed_google_domains_json") or "[]")),
            admin_emails=tuple(json.loads(record.get("admin_emails_json") or "[]")),
        )

    @classmethod
    def from_payload(
        cls, body: dict, *, current: "InstallationPolicy | None" = None
    ) -> "InstallationPolicy":
        allowed = {
            "auth_mode", "public_url", "google_client_id", "google_client_secret",
            "allowed_google_domains", "admin_emails",
        }
        if not isinstance(body, dict) or not set(body).issubset(allowed):
            raise ValidationError("Installation fields do not match the declared schema.")
        mode = body.get("auth_mode")
        public_url = body.get("public_url")
        if mode not in {"none", "google"}:
            raise ValidationError("auth_mode must be none or google.")
        if not isinstance(public_url, str):
            raise ValidationError("public_url is required.")
        public_url = public_url.rstrip("/")
        _validate_public_url(public_url)
        if mode == "none":
            if any(body.get(field) for field in allowed - {"auth_mode", "public_url"}):
                raise ValidationError("Open mode cannot retain Google configuration.")
            return cls("none", public_url)
        client_id = _text(body.get("google_client_id"), "google_client_id")
        supplied_secret = body.get("google_client_secret")
        if supplied_secret is None and current and current.auth_mode == "google":
            client_secret = current.google_client_secret
        else:
            client_secret = _text(supplied_secret, "google_client_secret")
        domains = _string_list(body.get("allowed_google_domains"), "allowed_google_domains")
        admins = _string_list(body.get("admin_emails"), "admin_emails")
        if not domains or not admins:
            raise ValidationError("Google mode requires allowed domains and administrator emails.")
        if any(email.rsplit("@", 1)[-1] not in domains for email in admins if "@" in email):
            raise ValidationError("Every administrator email must belong to an allowed domain.")
        if any("@" not in email for email in admins):
            raise ValidationError("Administrator emails must be valid email addresses.")
        return cls("google", public_url, client_id, client_secret, domains, admins)

    @classmethod
    def from_settings(cls, settings: Settings) -> "InstallationPolicy":
        return cls(
            "google", settings.public_url, settings.google_client_id,
            settings.google_client_secret, settings.allowed_google_domains,
            settings.admin_emails,
        )

    @classmethod
    def open(cls, public_url: str) -> "InstallationPolicy":
        return cls("none", public_url)

    def to_settings(self, infrastructure: Settings) -> Settings:
        return replace(
            infrastructure,
            public_url=self.public_url,
            google_client_id=self.google_client_id,
            google_client_secret=self.google_client_secret,
            allowed_google_domains=self.allowed_google_domains,
            admin_emails=self.admin_emails,
        )

    def record(self) -> dict:
        return {
            "auth_mode": self.auth_mode,
            "public_url": self.public_url,
            "google_client_id": self.google_client_id,
            "google_client_secret": self.google_client_secret,
            "allowed_google_domains_json": json.dumps(self.allowed_google_domains),
            "admin_emails_json": json.dumps(self.admin_emails),
        }

    def snapshot(self) -> str:
        payload = asdict(self)
        payload["allowed_google_domains"] = list(self.allowed_google_domains)
        payload["admin_emails"] = list(self.admin_emails)
        return json.dumps(payload, sort_keys=True)

    @classmethod
    def from_snapshot(cls, value: str) -> "InstallationPolicy":
        payload = json.loads(value)
        return cls(
            payload["auth_mode"], payload["public_url"],
            payload.get("google_client_id", ""), payload.get("google_client_secret", ""),
            tuple(payload.get("allowed_google_domains", [])),
            tuple(payload.get("admin_emails", [])),
        )

    def public(self) -> dict:
        return {
            "auth_mode": self.auth_mode,
            "public_url": self.public_url,
            "google_client_id": self.google_client_id,
            "google_client_secret_configured": bool(self.google_client_secret),
            "allowed_google_domains": list(self.allowed_google_domains),
            "admin_emails": list(self.admin_emails),
            "google_redirect_uri": f"{self.public_url}/api/auth/google/callback",
        }


def _text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1000:
        raise ValidationError(f"{name} is required.")
    return value.strip()


def _string_list(value: object, name: str) -> tuple[str, ...]:
    if isinstance(value, str):
        result = _csv(value)
    elif isinstance(value, list) and all(isinstance(item, str) for item in value):
        result = tuple(sorted({item.strip().casefold() for item in value if item.strip()}))
    else:
        raise ValidationError(f"{name} must be a list of strings.")
    if len(result) > 100:
        raise ValidationError(f"{name} contains too many values.")
    return result
