from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from backend.app.config import Settings
from backend.app.errors import ConflictError, UnauthorizedError, ValidationError
from backend.app.repository import RegistryRepository
from backend.app.security import digest, expires_in, secret


GITHUB_BINDING_COOKIE = "registry_github_binding"
REPOSITORY_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


class GithubProvider:
    def __init__(self, repository: RegistryRepository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    def start(
        self,
        body: dict,
        *,
        context: str,
        actor_user_id: str | None,
        setup_revision: int | None,
    ) -> tuple[str, str]:
        name, visibility, branch = self._selection(body)
        state, binding = secret("ghs_"), secret("ghb_")
        attempt_id = uuid.uuid4().hex
        self.repository.create_github_attempt(
            {
                "id": attempt_id,
                "state_hash": digest(state),
                "binding_hash": digest(binding),
                "context": context,
                "actor_user_id": actor_user_id,
                "setup_revision": setup_revision,
                "repository_name": name,
                "visibility": visibility,
                "branch": branch,
                "expires_at": expires_in(hours=1),
            }
        )
        query = urllib.parse.urlencode({"state": state})
        return f"{self.settings.public_url}/api/github/manifest?{query}", binding

    def manifest_form(self, state: str, binding: str | None) -> tuple[str, dict]:
        attempt = self._attempt(state, binding, "manifest_pending")
        callback = f"{self.settings.public_url}/api/github/manifest/callback?state={urllib.parse.quote(state)}"
        setup = f"{self.settings.public_url}/api/github/installation/callback?state={urllib.parse.quote(state)}"
        manifest = {
            "name": f"Skill Registry {attempt['id'][:8]}",
            "url": self.settings.public_url,
            "redirect_url": callback,
            "callback_urls": [f"{self.settings.public_url}/api/github/oauth/callback"],
            "setup_url": setup,
            "setup_on_update": False,
            "public": True,
            "default_permissions": {
                "administration": "write",
                "contents": "write",
                "metadata": "read",
            },
        }
        return f"{self.settings.github_web_base}/settings/apps/new", manifest

    def manifest_callback(self, code: str, state: str, binding: str | None) -> str:
        attempt = self._attempt(state, binding, "manifest_pending")
        if not code:
            raise UnauthorizedError("GitHub App creation was not completed.")
        result = self._json(
            "POST", f"{self.settings.github_api_base}/app-manifests/{urllib.parse.quote(code)}/conversions",
            {},
        )
        required = ("id", "client_id", "client_secret", "pem", "slug")
        if any(not result.get(field) for field in required):
            raise ConflictError("GitHub returned incomplete app credentials.")
        advanced = self.repository.transition_github_attempt(
            attempt["id"], "manifest_pending", "installation_pending",
            {
                "app_id": str(result["id"]),
                "client_id": str(result["client_id"]),
                "client_secret": str(result["client_secret"]),
                "private_key": str(result["pem"]),
                "app_slug": str(result["slug"]),
            },
        )
        if not advanced:
            raise UnauthorizedError("GitHub connection state was already used.")
        query = urllib.parse.urlencode({"state": state})
        return f"{self.settings.github_web_base}/apps/{result['slug']}/installations/new?{query}"

    def installation_callback(
        self, installation_id: str, state: str, binding: str | None,
    ) -> str:
        attempt = self._attempt(state, binding, "installation_pending")
        if not installation_id.isdigit():
            self._terminal_failure(attempt, "GitHub installation was cancelled.")
            raise UnauthorizedError("GitHub installation was not completed.")
        installation = self._app_json(
            attempt, "GET", f"{self.settings.github_api_base}/app/installations/{installation_id}"
        )
        account = installation.get("account") or {}
        login, account_type = account.get("login"), account.get("type")
        if not isinstance(login, str) or account_type not in {"User", "Organization"}:
            raise ConflictError("GitHub returned an invalid installation account.")
        if not self.repository.transition_github_attempt(
            attempt["id"], "installation_pending", "oauth_pending",
            {
                "installation_id": installation_id,
                "account_login": login,
                "account_type": account_type,
            },
        ):
            raise UnauthorizedError("GitHub connection state was already used.")
        query = urllib.parse.urlencode(
            {"client_id": attempt["client_id"], "state": state}
        )
        return f"{self.settings.github_web_base}/login/oauth/authorize?{query}"

    def oauth_callback(self, code: str, state: str, binding: str | None) -> dict:
        attempt = self._attempt(state, binding, "oauth_pending")
        if not code:
            self._terminal_failure(attempt, "GitHub authorization was cancelled.")
            raise UnauthorizedError("GitHub authorization was not completed.")
        token_payload = self._json(
            "POST", f"{self.settings.github_token_base}/login/oauth/access_token",
            {
                "client_id": attempt["client_id"],
                "client_secret": attempt["client_secret"],
                "code": code,
            },
        )
        user_token = token_payload.get("access_token")
        if not isinstance(user_token, str) or not user_token:
            raise UnauthorizedError("GitHub did not return a user authorization token.")
        authorized_installation = self._json(
            "GET",
            f"{self.settings.github_api_base}/user/installations/"
            f"{urllib.parse.quote(attempt['installation_id'])}",
            None,
            bearer=user_token,
        )
        authorized_account = authorized_installation.get("account") or {}
        authorized_id = authorized_installation.get("id")
        if (
            str(authorized_id) != attempt["installation_id"]
            or authorized_account.get("login", "").casefold()
            != attempt["account_login"].casefold()
            or authorized_account.get("type") != attempt["account_type"]
        ):
            self._terminal_failure(
                attempt,
                "Authorize with a GitHub user who can access the selected installation.",
            )
            raise ConflictError(
                "GitHub authorization cannot access the selected installation account."
            )
        if attempt["account_type"] == "User":
            identity = self._json(
                "GET", f"{self.settings.github_api_base}/user", None,
                bearer=user_token,
            )
            login = identity.get("login")
            if not isinstance(login, str) or login.casefold() != attempt["account_login"].casefold():
                self._terminal_failure(
                    attempt,
                    "Authorize with the same GitHub account selected for installation.",
                )
                raise ConflictError(
                    "GitHub authorization account does not match the selected installation account."
                )
        if not self.repository.transition_github_attempt(
            attempt["id"], "oauth_pending", "external_effect_unknown",
            {"client_secret": None},
        ):
            raise UnauthorizedError("GitHub connection state was already used.")
        url = (
            f"{self.settings.github_api_base}/orgs/{urllib.parse.quote(attempt['account_login'])}/repos"
            if attempt["account_type"] == "Organization"
            else f"{self.settings.github_api_base}/user/repos"
        )
        try:
            created = self._json(
                "POST", url,
                {
                    "name": attempt["repository_name"],
                    "private": attempt["visibility"] == "private",
                    "auto_init": False,
                },
                bearer=user_token,
            )
        except urllib.error.HTTPError as error:
            message = "GitHub repository creation was rejected. Choose another name or check permissions."
            self.repository.transition_github_attempt(
                attempt["id"], "external_effect_unknown", "failed",
                {"last_error": message, "private_key": None}
            )
            raise ConflictError(message) from error
        repository_id = created.get("id")
        html_url = created.get("html_url")
        owner = created.get("owner") or {}
        created_owner = owner.get("login")
        if (
            repository_id is None
            or not isinstance(html_url, str)
            or not isinstance(created_owner, str)
        ):
            raise ConflictError(
                "GitHub repository creation outcome is unknown. Inspect GitHub before trying another name."
            )
        if created_owner.casefold() != attempt["account_login"].casefold():
            message = "GitHub created the repository under an unexpected account; it was not connected."
            self.repository.transition_github_attempt(
                attempt["id"], "external_effect_unknown", "failed",
                {
                    "repository_id": str(repository_id), "repository_url": html_url,
                    "last_error": message, "private_key": None,
                },
            )
            raise ConflictError(message)
        if not self.repository.transition_github_attempt(
            attempt["id"], "external_effect_unknown", "repository_created",
            {"repository_id": str(repository_id), "repository_url": html_url},
        ):
            raise ConflictError("GitHub repository was created but could not be recorded.")
        return self.repository.github_attempt_by_id(attempt["id"]) or {}

    def promote(self, attempt_id: str) -> dict:
        attempt = self.repository.github_attempt_by_id(attempt_id)
        if attempt is None:
            raise ConflictError("GitHub connection attempt was not found.")
        remote_url = (
            f"{self.settings.github_git_base}/{attempt['account_login']}/"
            f"{attempt['repository_name']}.git"
        )
        return self.repository.promote_github_remote(attempt_id, remote_url)

    def mint_installation_token(self) -> str:
        config = self.repository.github_app_config()
        if config is None:
            raise ConflictError("GitHub App credentials are unavailable.")
        payload = self._json(
            "POST",
            f"{self.settings.github_api_base}/app/installations/{config['installation_id']}/access_tokens",
            {"repositories": [config["repository_name"]]},
            bearer=self._app_jwt(config["app_id"], config["private_key"]),
        )
        token = payload.get("token")
        if not isinstance(token, str) or not token:
            raise ConflictError("GitHub did not return an installation token.")
        return token

    def _app_json(self, attempt: dict, method: str, url: str) -> dict:
        return self._json(
            method, url, None,
            bearer=self._app_jwt(attempt["app_id"], attempt["private_key"]),
        )

    @staticmethod
    def _app_jwt(app_id: str, private_key: str) -> str:
        now = datetime.now(UTC)
        return jwt.encode(
            {"iat": int((now - timedelta(seconds=30)).timestamp()), "exp": int((now + timedelta(minutes=9)).timestamp()), "iss": app_id},
            private_key,
            algorithm="RS256",
        )

    def _attempt(self, state: str, binding: str | None, stage: str) -> dict:
        if not state or not binding:
            raise UnauthorizedError("GitHub connection state is missing.")
        attempt = self.repository.github_attempt(digest(state), digest(binding))
        if attempt is None or attempt["stage"] != stage:
            raise UnauthorizedError("GitHub connection state is invalid, expired, or already used.")
        return attempt

    def _terminal_failure(self, attempt: dict, message: str) -> None:
        self.repository.transition_github_attempt(
            attempt["id"], attempt["stage"], "failed",
            {"last_error": message, "client_secret": None, "private_key": None},
        )

    @staticmethod
    def _selection(body: dict) -> tuple[str, str, str]:
        if not isinstance(body, dict) or not set(body).issubset({"repository_name", "visibility", "branch"}):
            raise ValidationError("GitHub connection fields do not match the declared schema.")
        name = body.get("repository_name")
        visibility = body.get("visibility", "private")
        branch = body.get("branch", "skills-registry")
        if not isinstance(name, str) or not REPOSITORY_NAME.fullmatch(name) or name.endswith("."):
            raise ValidationError("GitHub repository name is invalid.")
        if visibility not in {"private", "public"}:
            raise ValidationError("GitHub visibility must be private or public.")
        if not isinstance(branch, str) or not branch or len(branch) > 200:
            raise ValidationError("GitHub export branch is invalid.")
        return name, visibility, branch

    def _json(
        self, method: str, url: str, body: dict | None, *, bearer: str | None = None,
    ) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "skills-registry",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=15) as response:
            payload: Any = json.loads(response.read() or b"{}")
        if not isinstance(payload, dict):
            raise ConflictError("GitHub returned an invalid response.")
        return payload
