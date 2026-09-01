from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from unicodedata import category
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_path: Path
    git_dir: Path
    host_workspace_path: Path | None = None
    public_url: str = "http://127.0.0.1:5174"
    google_client_id: str = ""
    google_client_secret: str = ""
    allowed_google_domains: tuple[str, ...] = ("scaleuplabs.vc",)
    admin_emails: tuple[str, ...] = ("marco.cello@scaleuplabs.vc",)
    host: str = "127.0.0.1"
    port: int = 8000
    google_issuer: str = "https://accounts.google.com"
    google_authorization_endpoint: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_token_endpoint: str = "https://oauth2.googleapis.com/token"
    google_jwks_url: str = "https://www.googleapis.com/oauth2/v3/certs"
    github_web_base: str = "https://github.com"
    github_api_base: str = "https://api.github.com"
    github_git_base: str = "https://github.com"
    github_token_base: str = "https://github.com"
    github_proof_endpoints: bool = False

    @classmethod
    def from_environment(cls) -> "Settings":
        settings = cls(
            database_path=Path(
                os.environ.get("DATABASE_PATH", "./data/registry.sqlite3")
            ).resolve(),
            git_dir=Path(
                os.environ.get("GIT_REPOSITORY_PATH", "./data/registry-git")
            ).resolve(),
            host_workspace_path=_host_workspace_path(
                os.environ.get("HOST_WORKSPACE_PATH")
            ),
            public_url=os.environ.get("PUBLIC_URL", "http://127.0.0.1:5174").rstrip("/"),
            google_client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
            google_client_secret=os.environ.get("GOOGLE_CLIENT_SECRET", ""),
            allowed_google_domains=_csv(os.environ.get("ALLOWED_GOOGLE_DOMAINS", "scaleuplabs.vc")),
            admin_emails=_csv(os.environ.get("ADMIN_EMAILS", "marco.cello@scaleuplabs.vc")),
            host=os.environ.get("HOST", "127.0.0.1"),
            port=int(os.environ.get("PORT", "8000")),
            google_issuer=os.environ.get("GOOGLE_ISSUER", "https://accounts.google.com"),
            google_authorization_endpoint=os.environ.get(
                "GOOGLE_AUTHORIZATION_ENDPOINT", "https://accounts.google.com/o/oauth2/v2/auth"
            ),
            google_token_endpoint=os.environ.get(
                "GOOGLE_TOKEN_ENDPOINT", "https://oauth2.googleapis.com/token"
            ),
            google_jwks_url=os.environ.get(
                "GOOGLE_JWKS_URL", "https://www.googleapis.com/oauth2/v3/certs"
            ),
            github_web_base=os.environ.get("GITHUB_WEB_BASE", "https://github.com").rstrip("/"),
            github_api_base=os.environ.get("GITHUB_API_BASE", "https://api.github.com").rstrip("/"),
            github_git_base=os.environ.get("GITHUB_GIT_BASE", "https://github.com").rstrip("/"),
            github_token_base=os.environ.get("GITHUB_TOKEN_BASE", "https://github.com").rstrip("/"),
            github_proof_endpoints=os.environ.get("GITHUB_PROOF_ENDPOINTS") == "1",
        )
        _validate_public_url(settings.public_url)
        _validate_github_endpoints(settings)
        return settings

    @property
    def redirect_uri(self) -> str:
        return f"{self.public_url}/api/auth/google/callback"

    @property
    def mcp_resource(self) -> str:
        return f"{self.public_url}/mcp"

    def role_for(self, email: str) -> str:
        return "admin" if email.strip().casefold() in self.admin_emails else "user"


def _csv(value: str) -> tuple[str, ...]:
    return tuple(sorted({item.strip().casefold() for item in value.split(",") if item.strip()}))


def _host_workspace_path(value: str | None) -> Path:
    if not value or any(category(char) in {"Cc", "Cf"} for char in value):
        raise ValueError("HOST_WORKSPACE_PATH must be an absolute non-root path.")
    candidate = Path(value)
    if not candidate.is_absolute():
        raise ValueError("HOST_WORKSPACE_PATH must be an absolute non-root path.")
    resolved = candidate.resolve(strict=False)
    if resolved.parent == resolved:
        raise ValueError("HOST_WORKSPACE_PATH must be an absolute non-root path.")
    return resolved


def _validate_public_url(value: str) -> None:
    parsed = urlsplit(value)
    loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if (
        parsed.scheme not in ({"http", "https"} if loopback else {"https"})
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("PUBLIC_URL must be a canonical HTTPS origin (loopback HTTP is allowed).")


def _validate_github_endpoints(settings: Settings) -> None:
    if not settings.github_proof_endpoints:
        if (
            settings.github_web_base != "https://github.com"
            or settings.github_api_base != "https://api.github.com"
            or settings.github_git_base != "https://github.com"
            or settings.github_token_base != "https://github.com"
        ):
            raise ValueError("GitHub endpoints are fixed to GitHub.com outside proof mode.")
        return
    for value in (settings.github_web_base, settings.github_api_base, settings.github_token_base):
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "host.docker.internal"}:
            raise ValueError("Proof GitHub endpoints must use loopback HTTP.")
    git = urlsplit(settings.github_git_base)
    if git.scheme not in {"http", "file"}:
        raise ValueError("Proof GitHub Git endpoint must use loopback HTTP or file.")
