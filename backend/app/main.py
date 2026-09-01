from __future__ import annotations

import html
import json
import os
import secrets
import threading
import urllib.parse
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, make_response, redirect, request, send_file
from werkzeug.exceptions import BadRequest, HTTPException, MethodNotAllowed, RequestEntityTooLarge

from backend.app.config import Settings
from backend.app.errors import (
    AuthModeDisabledError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RegistryError,
    UnauthorizedError,
    ValidationError,
)
from backend.app.git_export import GitExportError, GitExporter
from backend.app.git_remote import GitRemoteManager
from backend.app.github_provider import GITHUB_BINDING_COOKIE, GithubProvider
from backend.app.installation import InstallationPolicy
from backend.app.mcp import McpServer
from backend.app.oauth_server import OAuthServer
from backend.app.oidc import LOGIN_COOKIE, SESSION_COOKIE, OidcService
from backend.app.proposals import ProposalService
from backend.app.repository import RegistryRepository
from backend.app.security import digest
from backend.app.service import RegistryService
from backend.app.setup_repository import GitRepositorySelection
from backend.app.skill_archive import SkillArchiveService


CSRF_COOKIE = "registry_csrf"
CONSENT_SCOPE_LABELS = {
    "skills.read": "View published skills",
    "skills.review": "Review and publish skill proposals",
    "skills.submit": "Submit skills for review",
}
CONSENT_STYLES = """
*{box-sizing:border-box}html{min-height:100%;background:#fff;color:#0f172a}body{margin:0;min-height:100svh;display:flex;align-items:center;justify-content:center;padding:40px 20px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}.shell{display:flex;width:100%;max-width:24rem;flex-direction:column;gap:24px}.lockup{display:flex;align-items:center;justify-content:center;gap:12px}.lockup svg{width:20px;height:20px;flex:none}.lockup h1{margin:0;font-family:Manrope,ui-sans-serif,system-ui,sans-serif;font-size:20px;font-weight:600;line-height:28px;letter-spacing:-.025em}.card{display:flex;flex-direction:column;gap:24px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:24px 0;color:#0f172a;box-shadow:0 1px 2px rgb(15 23 42/.06)}.card-header{display:grid;gap:6px;padding:0 24px}.card-header h2{margin:0;font-size:20px;font-weight:600;line-height:28px;letter-spacing:-.01em}.card-header bdi{overflow-wrap:anywhere}.description{margin:0;color:#64748b;font-size:14px}.card-content{display:flex;flex-direction:column;gap:20px;padding:0 24px}.identity{display:grid;gap:2px;border-radius:8px;background:#f8fafc;padding:12px}.identity-label,.permissions-title{color:#64748b;font-size:12px;font-weight:500}.identity bdi{overflow-wrap:anywhere;font-weight:500}.permissions{display:grid;gap:8px}.permissions-title{margin:0}.permissions ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.permissions li{display:flex;align-items:flex-start;gap:8px}.permissions li::before{content:"";width:6px;height:6px;flex:none;margin-top:7px;border-radius:999px;background:#0f172a}.authorize-button{display:inline-flex;width:100%;height:36px;align-items:center;justify-content:center;border:0;border-radius:8px;background:#1e293b;color:#f8fafc;padding:8px 16px;font:500 14px/20px inherit;cursor:pointer;transition:opacity .18s ease,transform .18s ease}.authorize-button:hover{background:#27364a}.authorize-button:active{transform:scale(.98)}.authorize-button:focus-visible{outline:3px solid rgb(148 163 184/.55);outline-offset:2px}.authorize-button:disabled{cursor:not-allowed;opacity:.5}.form-status{min-height:20px;margin:0;color:#b91c1c;font-size:13px}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:400px){body{padding:28px 20px}.card-header,.card-content{padding-inline:20px}}
"""
FOLDER_TREE_PATH = "M48 24C48 10.7 37.3 0 24 0S0 10.7 0 24L0 392c0 30.9 25.1 56 56 56l184 0 0-48-184 0c-4.4 0-8-3.6-8-8l0-232 192 0 0-48-192 0 0-88zM336 224l192 0c26.5 0 48-21.5 48-48l0-96c0-26.5-21.5-48-48-48l-82.7 0c-8.5 0-16.6-3.4-22.6-9.4l-8.6-8.6c-9-9-21.2-14.1-33.9-14.1L336 0c-26.5 0-48 21.5-48 48l0 128c0 26.5 21.5 48 48 48zm0 288l192 0c26.5 0 48-21.5 48-48l0-96c0-26.5-21.5-48-48-48l-82.7 0c-8.5 0-16.6-3.4-22.6-9.4l-8.6-8.6c-9-9-21.2-14.1-33.9-14.1L336 288c-26.5 0-48 21.5-48 48l0 128c0 26.5 21.5 48 48 48z"


@dataclass
class Runtime:
    infrastructure: Settings
    policy: InstallationPolicy | None
    git_dir: Path
    finalized: bool
    setup_revision: int | None
    oidc: OidcService
    oauth: OAuthServer

    @property
    def settings(self) -> Settings:
        configured = self.policy.to_settings(self.infrastructure) if self.policy else self.infrastructure
        return replace(configured, git_dir=self.git_dir)


def create_app(
    settings: Settings | None = None,
    *,
    oidc_verifier=None,
    oidc_exchange=None,
    require_setup: bool | None = None,
) -> Flask:
    infrastructure = settings or Settings.from_environment()
    os.umask(0o077)
    repository = RegistryRepository(infrastructure.database_path)
    repository.initialize()
    workspace_root = infrastructure.database_path.parent.resolve()
    host_workspace_path = infrastructure.host_workspace_path or workspace_root
    default_repository_path = _workspace_relative(infrastructure.git_dir, workspace_root)
    must_setup = settings is None if require_setup is None else require_setup
    record = repository.installation_config()
    if record is None and not must_setup:
        seeded = InstallationPolicy.from_settings(infrastructure)
        repository.create_installation_config(
            seeded.record(), git_repository_path=default_repository_path,
        )
        record = repository.installation_config()
    legacy_explicit = settings is not None and require_setup is None
    policy = (
        InstallationPolicy.from_settings(infrastructure)
        if legacy_explicit
        else InstallationPolicy.from_record(record) if record else None
    )
    selected_git_dir = (
        _selected_git_dir(workspace_root, record["git_repository_path"])
        if record else infrastructure.git_dir
    )
    finalized = bool(record and record.get("setup_finalized_at"))
    setup_revision = record.get("setup_revision") if record else None
    initial_settings = replace(
        policy.to_settings(infrastructure) if policy else infrastructure,
        git_dir=selected_git_dir,
    )
    github_provider = GithubProvider(repository, initial_settings)
    registry = RegistryService(repository, GitExporter(selected_git_dir))
    git_remote = GitRemoteManager(
        repository, selected_git_dir, workspace_root / "git-credentials",
        github_provider.mint_installation_token,
    )
    registry.remote_pusher = lambda: git_remote.push() if repository.git_remote_config() else None
    proposals = ProposalService(repository, registry)
    archives = SkillArchiveService(repository, registry, proposals)
    runtime = Runtime(
        infrastructure,
        policy,
        selected_git_dir,
        finalized,
        setup_revision,
        OidcService(repository, initial_settings, oidc_verifier),
        OAuthServer(repository, initial_settings),
    )
    if oidc_exchange is not None:
        runtime.oidc._exchange = oidc_exchange
    mcp_server = McpServer(repository, proposals, registry)
    setup_lock = threading.Lock()
    if record is not None:
        try:
            registry.exporter.ensure_repository()
            registry.reconcile_git_history()
        except GitExportError:
            pass

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 128_000_000
    app.extensions.update(
        registry_repository=repository,
        registry_service=registry,
        registry_proposals=proposals,
        registry_archives=archives,
        registry_runtime=runtime,
        registry_git_remote=git_remote,
        registry_github_provider=github_provider,
    )

    def rebuild(
        next_policy: InstallationPolicy,
        next_git_dir: Path,
        *,
        finalized: bool,
        setup_revision: int,
    ) -> None:
        nonlocal git_remote, github_provider
        runtime.policy = next_policy
        runtime.git_dir = next_git_dir
        runtime.finalized = finalized
        runtime.setup_revision = setup_revision
        registry.exporter = GitExporter(next_git_dir)
        resolved = runtime.settings
        github_provider = GithubProvider(repository, resolved)
        git_remote = GitRemoteManager(
            repository, next_git_dir, workspace_root / "git-credentials",
            github_provider.mint_installation_token,
        )
        app.extensions["registry_git_remote"] = git_remote
        app.extensions["registry_github_provider"] = github_provider
        runtime.oidc = OidcService(repository, resolved, oidc_verifier)
        if oidc_exchange is not None:
            runtime.oidc._exchange = oidc_exchange
        runtime.oauth = OAuthServer(repository, resolved)

    @app.before_request
    def installation_gate() -> Any:
        setup_endpoints = {
            "health", "setup_status", "setup_create", "setup_github_start",
            "github_manifest", "github_manifest_callback", "github_installation_callback",
            "github_oauth_callback", "setup_github_push",
            "setup_github_disconnect",
        }
        if (
            runtime.finalized
            or request.endpoint in setup_endpoints
            or request.path == "/setup/github/start"
        ):
            return None
        if runtime.policy is not None and request.endpoint in {"google_start", "google_callback"}:
            return None
        return jsonify({"code": "SETUP_REQUIRED", "message": "Complete instance setup first."}), 503

    @app.get("/health")
    def health() -> Any:
        return jsonify({
            "status": "ok", "database": "ready", "configured": runtime.finalized,
            "pending_git_exports": repository.pending_export_count(),
        })

    @app.get("/setup/status")
    def setup_status() -> Any:
        if runtime.finalized:
            return _no_store_json({"configured": True})
        current = repository.installation_config()
        remote_required = bool(
            current and current["remote_ready_revision"] != current["setup_revision"]
        )
        remote = repository.git_remote_config()
        github_remote_pending = bool(
            remote_required and remote and remote.get("provider") == "github"
        )
        if runtime.policy is not None and runtime.policy.auth_mode == "google":
            admin_required = bool(
                current and current["admin_verified_revision"] != current["setup_revision"]
            )
            payload = {
                "configured": False, "verification_required": admin_required,
                "auth_mode": "google", "host_workspace_path": str(host_workspace_path),
            }
            if remote_required:
                payload["remote_verification_required"] = True
                payload["github_remote_pending"] = github_remote_pending
            return _no_store_json(payload)
        payload = {
            "configured": False, "verification_required": False,
            "host_workspace_path": str(host_workspace_path),
        }
        if remote_required:
            payload["remote_verification_required"] = True
            payload["github_remote_pending"] = github_remote_pending
        return _no_store_json(payload)

    @app.post("/setup")
    def setup_create() -> Any:
        with setup_lock:
            if runtime.finalized:
                raise NotFoundError("Setup is not available.")
            body = _json_body()
            repository_body = body.pop("git_repository", None)
            remote_body = body.pop("git_remote", None)
            next_policy = InstallationPolicy.from_payload(body)
            _setup_origin(next_policy.public_url)
            current = repository.installation_config()
            active_remote = repository.git_remote_config()
            if active_remote is not None and active_remote.get("provider") == "github":
                raise ConflictError("Disconnect the pending GitHub remote before editing setup.")
            selection = GitRepositorySelection.from_payload(
                repository_body,
                workspace_root=workspace_root,
                database_path=infrastructure.database_path,
            )
            provider = remote_body.get("provider", "manual") if isinstance(remote_body, dict) else None
            if provider not in {None, "manual", "github"}:
                raise ValidationError("Git remote provider must be github or manual.")
            github_remote = provider == "github"
            if github_remote:
                GithubProvider._selection({key: value for key, value in remote_body.items() if key != "provider"})
            next_remote = GitRemoteManager(
                repository, selection.absolute_path, workspace_root / "git-credentials"
            )
            manual_body = (
                {key: value for key, value in remote_body.items() if key != "provider"}
                if isinstance(remote_body, dict) and not github_remote else None
            )
            prepared_remote = next_remote.prepare(manual_body) if manual_body is not None else None
            repository_preparation = selection.prepare(
                current_path=current["git_repository_path"] if current else None,
            )
            credential_snapshot = next_remote.snapshot_credentials()
            try:
                if prepared_remote is None:
                    next_remote.clear_credentials()
                else:
                    next_remote.apply_credentials(prepared_remote)
                remote_ready = not github_remote
                finalized = next_policy.auth_mode == "none" and remote_ready
                next_revision = repository.save_setup_config(
                    next_policy.record(),
                    git_repository_path=selection.relative_path,
                    finalized=finalized,
                    git_remote=prepared_remote.row if prepared_remote else None,
                    remote_ready=remote_ready,
                )
            except Exception:
                next_remote.restore_credentials(credential_snapshot)
                repository_preparation.rollback()
                raise
            if next_revision is None:
                next_remote.restore_credentials(credential_snapshot)
                repository_preparation.rollback()
                raise NotFoundError("Setup is not available.")
            rebuild(
                next_policy,
                selection.absolute_path,
                finalized=finalized,
                setup_revision=next_revision,
            )
            registry.synchronize_git()
            return jsonify({
                **next_policy.public(),
                "git_repository_path": selection.relative_path,
                "setup_finalized": finalized,
                "github_start_required": github_remote,
            }), 201

    @app.post("/setup/github/start")
    def setup_github_start() -> Any:
        if runtime.finalized or runtime.policy is None or runtime.setup_revision is None:
            raise NotFoundError("Setup GitHub connection is not available.")
        _exact_origin(runtime.settings.public_url)
        current = repository.installation_config()
        if current is None or current["remote_ready_revision"] == current["setup_revision"]:
            raise ConflictError("Setup does not require a GitHub connection.")
        target, binding = github_provider.start(
            _json_body(), context="setup", actor_user_id=None,
            setup_revision=runtime.setup_revision,
        )
        response = jsonify({"redirect_url": target})
        _set_cookie(response, GITHUB_BINDING_COOKIE, binding, runtime.settings, max_age=3600, httponly=True)
        return response

    @app.post("/settings/git/github/start")
    def settings_github_start() -> Any:
        principal = _settings_mutation(runtime)
        target, binding = github_provider.start(
            _json_body(), context="settings", actor_user_id=principal["user_id"],
            setup_revision=None,
        )
        response = jsonify({"redirect_url": target})
        _set_cookie(response, GITHUB_BINDING_COOKIE, binding, runtime.settings, max_age=3600, httponly=True)
        return response

    @app.get("/github/manifest")
    def github_manifest() -> Any:
        endpoint, manifest = github_provider.manifest_form(
            request.args.get("state", ""), request.cookies.get(GITHUB_BINDING_COOKIE)
        )
        encoded = html.escape(json.dumps(manifest, separators=(",", ":")), quote=True)
        action = html.escape(endpoint, quote=True)
        document = (
            "<!doctype html><html><body><p>Connecting to GitHub.com…</p>"
            f'<form id="github-manifest" method="post" action="{action}">'
            f'<input type="hidden" name="manifest" value="{encoded}"></form>'
            '<script nonce="github-manifest">document.getElementById("github-manifest").submit()</script>'
            "</body></html>"
        )
        response = make_response(document)
        response.headers.update({
            "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; script-src 'nonce-github-manifest'; form-action https://github.com http://127.0.0.1:* http://host.docker.internal:*",
        })
        return response

    @app.get("/github/manifest/callback")
    def github_manifest_callback() -> Any:
        state = request.args.get("state", "")
        _github_callback_authority(runtime, repository, state)
        target = github_provider.manifest_callback(
            request.args.get("code", ""), state, request.cookies.get(GITHUB_BINDING_COOKIE)
        )
        return redirect(target)

    @app.get("/github/installation/callback")
    def github_installation_callback() -> Any:
        state = request.args.get("state", "")
        _github_callback_authority(runtime, repository, state)
        target = github_provider.installation_callback(
            request.args.get("installation_id", ""), state,
            request.cookies.get(GITHUB_BINDING_COOKIE),
        )
        return redirect(target)

    @app.get("/github/oauth/callback")
    def github_oauth_callback() -> Any:
        state = request.args.get("state", "")
        attempt = _github_callback_authority(runtime, repository, state)
        connected = github_provider.oauth_callback(
            request.args.get("code", ""), state, request.cookies.get(GITHUB_BINDING_COOKIE)
        )
        github_provider.promote(connected["id"])
        pushed = registry.synchronize_git_and_push(git_remote.push)
        if attempt["context"] == "setup" and pushed["push_status"] == "current":
            _mark_remote_and_finalize(runtime, repository, attempt["setup_revision"])
        destination = "/setup?github=connected" if attempt["context"] == "setup" else "/settings?github=connected"
        response = redirect(f"{runtime.settings.public_url}{destination}")
        _delete_cookie(response, GITHUB_BINDING_COOKIE, runtime.settings)
        return response

    @app.post("/setup/github/push")
    def setup_github_push() -> Any:
        if runtime.finalized or runtime.setup_revision is None:
            raise NotFoundError("Setup GitHub retry is not available.")
        _exact_origin(runtime.settings.public_url)
        current = repository.git_remote_config()
        if current is None or current.get("provider") != "github":
            raise ConflictError("No setup GitHub remote is pending.")
        result = registry.synchronize_git_and_push(git_remote.push)
        if result["push_status"] == "current":
            _mark_remote_and_finalize(runtime, repository, runtime.setup_revision)
        return jsonify(result)

    @app.delete("/setup/github")
    def setup_github_disconnect() -> Any:
        if runtime.finalized:
            raise NotFoundError("Setup GitHub disconnect is not available.")
        _exact_origin(runtime.settings.public_url)
        current = repository.git_remote_config()
        if current is None or current.get("provider") != "github":
            raise ConflictError("No setup GitHub remote is connected.")
        return jsonify(git_remote.disconnect())

    @app.get("/auth/google/start")
    def google_start() -> Any:
        with setup_lock:
            _google_only(runtime)
            target, binding = runtime.oidc.start(
                request.args.get("return_to", "/"),
                setup_revision=runtime.setup_revision if not runtime.finalized else None,
            )
        response = redirect(target, code=302)
        _set_cookie(response, LOGIN_COOKIE, binding, runtime.settings, max_age=600, httponly=True)
        return response

    @app.get("/auth/google/callback")
    def google_callback() -> Any:
        with setup_lock:
            _google_only(runtime)
            credentials, user, return_to = runtime.oidc.callback(
                request.args.get("code", ""),
                request.args.get("state", ""),
                request.cookies.get(LOGIN_COOKIE),
                setup_revision=runtime.setup_revision if not runtime.finalized else None,
            )
            if not runtime.finalized:
                if runtime.settings.role_for(user["email"]) != "admin":
                    runtime.oidc.revoke_session(credentials.session_token)
                    raise ForbiddenError("A configured administrator must finalize setup.")
                if runtime.setup_revision is not None:
                    repository.mark_setup_admin_verified(runtime.setup_revision)
                    if repository.finalize_ready_installation(runtime.setup_revision):
                        runtime.finalized = True
        response = redirect(f"{runtime.settings.public_url}{return_to}", code=302)
        _set_cookie(response, SESSION_COOKIE, credentials.session_token, runtime.settings, max_age=8 * 3600, httponly=True)
        _set_cookie(response, CSRF_COOKIE, credentials.csrf_token, runtime.settings, max_age=8 * 3600, httponly=False)
        _delete_cookie(response, LOGIN_COOKIE, runtime.settings)
        return response

    @app.get("/auth/session")
    def session() -> Any:
        if runtime.policy.auth_mode == "none":
            return jsonify({"auth_mode": "none", "display_name": "Open access", "email": ""})
        principal = runtime.oidc.authenticate(request.cookies.get(SESSION_COOKIE))
        csrf = request.cookies.get(CSRF_COOKIE)
        runtime.oidc.verify_csrf(request.cookies.get(SESSION_COOKIE), csrf)
        return jsonify({**principal, "csrf_token": csrf, "auth_mode": "google"})

    @app.post("/auth/logout")
    def logout() -> Any:
        _google_only(runtime)
        _browser_mutation(runtime)
        runtime.oidc.revoke_session(request.cookies.get(SESSION_COOKIE))
        response = make_response("", 204)
        _delete_cookie(response, SESSION_COOKIE, runtime.settings)
        _delete_cookie(response, CSRF_COOKIE, runtime.settings, httponly=False)
        return response

    @app.get("/skills")
    def list_skills() -> Any:
        _browser(runtime)
        return jsonify({"skills": repository.list_skills()})

    @app.get("/skills/archive")
    def download_skill_archive() -> Any:
        _browser(runtime)
        return send_file(
            archives.catalogue_zip(),
            mimetype="application/zip",
            as_attachment=True,
            download_name="skills-registry.zip",
        )

    @app.post("/skills/archive")
    def upload_skill_archive() -> Any:
        principal = _browser_mutation(runtime)
        if set(request.form):
            raise ValidationError("Archive upload accepts only the file field.")
        if set(request.files) != {"file"}:
            raise ValidationError("Archive upload requires one file field.")
        upload = request.files["file"]
        if not upload.filename or not upload.filename.lower().endswith(".zip"):
            raise ValidationError("Upload one .zip file.")
        result = archives.upload(
            upload.stream,
            auth_mode=runtime.policy.auth_mode,
            principal=principal,
        )
        return jsonify(result), 201

    @app.get("/skills/<slug>")
    def get_skill(slug: str) -> Any:
        _browser(runtime)
        return jsonify(repository.get_skill(slug))

    @app.post("/skills")
    def create_skill() -> Any:
        _open_mutation(runtime)
        return jsonify(registry.create_skill(_json_body())), 201

    @app.put("/skills/<slug>")
    def update_skill(slug: str) -> Any:
        _open_mutation(runtime)
        return jsonify(registry.update_skill(slug, _json_body()))

    @app.delete("/skills/<slug>")
    def delete_skill(slug: str) -> Any:
        principal = _browser_mutation(runtime)
        if runtime.policy.auth_mode == "google":
            _admin(principal)
        return jsonify(registry.delete_skill(slug))

    @app.post("/proposals")
    def submit_proposal() -> Any:
        _google_only(runtime)
        principal = _browser_mutation(runtime)
        return jsonify(proposals.submit(_json_body(), principal["user_id"])), 201

    @app.get("/proposals")
    def list_proposals() -> Any:
        _google_only(runtime)
        _admin(_browser(runtime))
        return jsonify({"proposals": repository.list_proposals()})

    @app.get("/proposals/<proposal_id>")
    def get_proposal(proposal_id: str) -> Any:
        _google_only(runtime)
        _admin(_browser(runtime))
        return jsonify(repository.get_proposal(proposal_id))

    @app.put("/proposals/<proposal_id>")
    def edit_proposal(proposal_id: str) -> Any:
        _google_only(runtime)
        principal = _admin(_browser_mutation(runtime))
        return jsonify(proposals.edit(proposal_id, _json_body(), principal["user_id"]))

    @app.post("/proposals/<proposal_id>/approve")
    def approve_proposal(proposal_id: str) -> Any:
        _google_only(runtime)
        principal = _admin(_browser_mutation(runtime))
        return jsonify(proposals.decide(proposal_id, _json_body(), principal["user_id"], approve=True))

    @app.post("/proposals/<proposal_id>/reject")
    def reject_proposal(proposal_id: str) -> Any:
        _google_only(runtime)
        principal = _admin(_browser_mutation(runtime))
        return jsonify(proposals.decide(proposal_id, _json_body(), principal["user_id"], approve=False))

    @app.post("/git/sync")
    def synchronize_git() -> Any:
        _google_only(runtime)
        _admin(_browser_mutation(runtime))
        return jsonify(registry.synchronize_git())

    @app.get("/settings/git")
    def git_settings() -> Any:
        _settings_access(runtime)
        return jsonify(git_remote.public())

    @app.put("/settings/git")
    def update_git_settings() -> Any:
        _settings_mutation(runtime)
        return jsonify(git_remote.configure(_json_body()))

    @app.delete("/settings/git")
    def delete_git_settings() -> Any:
        _settings_mutation(runtime)
        return jsonify(git_remote.disconnect())

    @app.post("/settings/git/test")
    def test_git_settings() -> Any:
        _settings_mutation(runtime)
        return jsonify(git_remote.test())

    @app.post("/settings/git/push")
    def push_git_settings() -> Any:
        _settings_mutation(runtime)
        return jsonify(registry.synchronize_git_and_push(git_remote.push))

    @app.get("/.well-known/oauth-protected-resource")
    @app.get("/.well-known/oauth-protected-resource/mcp")
    def protected_resource_metadata() -> Any:
        if runtime.policy.auth_mode == "none":
            return jsonify({"resource": runtime.settings.mcp_resource, "authorization_servers": []})
        return jsonify(runtime.oauth.protected_resource_metadata())

    @app.get("/.well-known/oauth-authorization-server")
    def authorization_server_metadata() -> Any:
        _google_only(runtime)
        return jsonify(runtime.oauth.authorization_server_metadata())

    @app.post("/oauth/register")
    def register_client() -> Any:
        _google_only(runtime)
        return jsonify(runtime.oauth.register(_json_body())), 201

    @app.get("/oauth/authorize")
    def authorization_page() -> Any:
        try:
            _google_only(runtime)
            principal = _browser(runtime)
        except UnauthorizedError:
            return_to = request.full_path.rstrip("?")
            query = urllib.parse.urlencode({"return_to": return_to})
            return redirect(f"{runtime.settings.public_url}/api/auth/google/start?{query}")
        validated = runtime.oauth.validate_authorization(request.args.to_dict(), principal)
        return _consent_html(validated, principal)

    @app.post("/oauth/authorize")
    def authorize_client() -> Any:
        _google_only(runtime)
        principal = _browser_mutation(runtime)
        validated = runtime.oauth.validate_authorization(request.form.to_dict(), principal)
        destination = runtime.oauth.authorize(validated, principal)
        if request.accept_mimetypes.best == "application/json":
            return jsonify({"redirect_uri": destination})
        return redirect(destination, code=302)

    @app.post("/oauth/token")
    def issue_token() -> Any:
        _google_only(runtime)
        return jsonify(runtime.oauth.token(request.form.to_dict()))

    @app.post("/oauth/revoke")
    def revoke_token() -> Any:
        _google_only(runtime)
        runtime.oauth.revoke(request.form.get("token"))
        return "", 200

    @app.post("/mcp")
    def mcp() -> Any:
        principal = (
            _open_principal()
            if runtime.policy.auth_mode == "none"
            else runtime.oauth.authenticate_access(_bearer_token())
        )
        try:
            body = request.get_json(silent=False)
        except BadRequest:
            return jsonify({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}), 400
        response = mcp_server.handle(body, principal)
        return ("", 202) if response is None else jsonify(response)

    @app.errorhandler(RegistryError)
    def registry_error(error: RegistryError) -> Any:
        response = jsonify({"code": error.code, "message": str(error)})
        if isinstance(error, UnauthorizedError):
            if runtime.policy and runtime.policy.auth_mode == "google":
                metadata = f"{runtime.settings.public_url}/.well-known/oauth-protected-resource/mcp"
                response.headers["WWW-Authenticate"] = f'Bearer resource_metadata="{metadata}"'
        return response, error.status

    @app.errorhandler(BadRequest)
    def bad_json(_error: BadRequest) -> Any:
        return jsonify({"code": "VALIDATION_ERROR", "message": "Request body must contain valid JSON."}), 400

    @app.errorhandler(RequestEntityTooLarge)
    def request_too_large(_error: RequestEntityTooLarge) -> Any:
        return jsonify({"code": "REQUEST_TOO_LARGE", "message": "Request body is too large."}), 413

    @app.errorhandler(GitExportError)
    def git_export_error(_error: GitExportError) -> Any:
        return jsonify({"code": "GIT_EXPORT_FAILED", "message": "Git export failed."}), 503

    @app.errorhandler(HTTPException)
    def http_error(error: HTTPException) -> Any:
        return jsonify({"code": error.name.upper().replace(" ", "_"), "message": error.description}), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception) -> Any:
        if app.config.get("TESTING"):
            raise error
        return jsonify({"code": "INTERNAL_ERROR", "message": "Unexpected server error."}), 500

    return app


def _json_body() -> dict:
    body = request.get_json(silent=False)
    if not isinstance(body, dict):
        raise ValidationError("Request JSON must be an object.")
    return body


def _no_store_json(payload: dict) -> Any:
    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store"
    return response


def _bearer_token() -> str | None:
    scheme, separator, token = request.headers.get("Authorization", "").partition(" ")
    return token.strip() if separator and scheme.casefold() == "bearer" and token.strip() else None


def _open_principal() -> dict:
    return {
        "auth_mode": "none",
        "user_id": "open-instance",
        "email": "",
        "display_name": "Open access",
        "scopes": {"skills.read", "skills.submit", "skills.review"},
    }


def _browser(runtime: Runtime) -> dict:
    if runtime.policy.auth_mode == "none":
        return _open_principal()
    return runtime.oidc.authenticate(request.cookies.get(SESSION_COOKIE))


def _browser_mutation(runtime: Runtime) -> dict:
    if request.headers.get("Origin") != runtime.settings.public_url:
        raise ForbiddenError("Same-origin request required.")
    if runtime.policy.auth_mode == "none":
        return _open_principal()
    return runtime.oidc.verify_csrf(
        request.cookies.get(SESSION_COOKIE), request.headers.get("X-CSRF-Token")
    )


def _open_mutation(runtime: Runtime) -> dict:
    if runtime.policy.auth_mode != "none":
        raise MethodNotAllowed("Direct publication is available only in open mode.")
    origin = request.headers.get("Origin")
    if origin is not None and origin != runtime.settings.public_url:
        raise ForbiddenError("Same-origin request required.")
    return _open_principal()


def _settings_access(runtime: Runtime) -> dict:
    principal = _browser(runtime)
    return principal if runtime.policy.auth_mode == "none" else _admin(principal)


def _settings_mutation(runtime: Runtime) -> dict:
    principal = _browser_mutation(runtime)
    return principal if runtime.policy.auth_mode == "none" else _admin(principal)


def _github_callback_authority(
    runtime: Runtime, repository: RegistryRepository, state: str,
) -> dict:
    binding = request.cookies.get(GITHUB_BINDING_COOKIE)
    if not state or not binding:
        raise UnauthorizedError("GitHub connection state is missing.")
    attempt = repository.github_attempt(digest(state), digest(binding))
    if attempt is None:
        raise UnauthorizedError("GitHub connection state is invalid or expired.")
    if attempt["context"] == "setup":
        if runtime.finalized or attempt["setup_revision"] != runtime.setup_revision:
            raise UnauthorizedError("GitHub setup state is stale.")
        return attempt
    if not runtime.finalized:
        raise UnauthorizedError("GitHub Settings state is unavailable.")
    principal = _settings_access(runtime)
    if attempt["actor_user_id"] != principal["user_id"]:
        raise ForbiddenError("The administrator who started this GitHub connection must finish it.")
    return attempt


def _mark_remote_and_finalize(
    runtime: Runtime, repository: RegistryRepository, setup_revision: int | None,
) -> None:
    if setup_revision is None or setup_revision != runtime.setup_revision:
        raise UnauthorizedError("GitHub setup revision is stale.")
    repository.mark_setup_remote_ready(setup_revision)
    if repository.finalize_ready_installation(setup_revision):
        runtime.finalized = True


def _google_only(runtime: Runtime) -> None:
    if runtime.policy.auth_mode != "google":
        raise AuthModeDisabledError("Google authentication and OAuth are disabled in open mode.")


def _setup_origin(public_url: str) -> None:
    origin = request.headers.get("Origin")
    if origin is not None and origin != public_url:
        raise ForbiddenError("Setup Origin must match public_url.")


def _exact_origin(public_url: str) -> None:
    if request.headers.get("Origin") != public_url:
        raise ForbiddenError("Same-origin request required.")


def _workspace_relative(git_dir: Path, workspace_root: Path) -> str:
    try:
        return git_dir.resolve().relative_to(workspace_root.resolve()).as_posix()
    except ValueError:
        return "registry-git"


def _selected_git_dir(workspace_root: Path, relative_path: str) -> Path:
    root = workspace_root.resolve()
    candidate = (root / relative_path).resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise RuntimeError("Stored Git repository path escapes the workspace.") from error
    return candidate


def _admin(principal: dict) -> dict:
    if principal["role"] != "admin":
        raise ForbiddenError("Administrator access is required.")
    return principal


def _set_cookie(response, name: str, value: str, settings: Settings, *, max_age: int, httponly: bool) -> None:
    response.set_cookie(name, value, max_age=max_age, secure=settings.public_url.startswith("https://"), httponly=httponly, samesite="Lax", path="/")


def _delete_cookie(response, name: str, settings: Settings, *, httponly: bool = True) -> None:
    response.delete_cookie(name, path="/", secure=settings.public_url.startswith("https://"), httponly=httponly, samesite="Lax")


def _consent_html(validated: dict, principal: dict) -> Any:
    fields = {
        "client_id": validated["client"]["client_id"], "redirect_uri": validated["redirect_uri"],
        "response_type": "code", "scope": validated["scope"], "resource": validated["resource"],
        "code_challenge": validated["code_challenge"], "code_challenge_method": "S256", "state": validated["state"],
    }
    hidden = "".join(
        f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v, quote=True)}">'
        for k, v in fields.items()
    )
    client_name = html.escape(validated["client"]["client_name"], quote=True)
    email = html.escape(principal["email"], quote=True)
    permissions = "".join(
        f"<li>{html.escape(CONSENT_SCOPE_LABELS[scope])}</li>"
        for scope in validated["scope"].split()
    )
    nonce = secrets.token_urlsafe(18)
    script = f"""<script nonce="{nonce}">const form=document.querySelector('form');const button=form.querySelector('button');const status=document.querySelector('.form-status');let submitting=false;form.addEventListener('submit',async(event)=>{{event.preventDefault();if(submitting)return;submitting=true;button.disabled=true;button.textContent='Authorizing…';status.textContent='';try{{const cookie=document.cookie.split('; ').find(value=>value.startsWith('{CSRF_COOKIE}='));if(!cookie)throw new Error('csrf');const response=await fetch(location.href,{{method:'POST',headers:{{Accept:'application/json','X-CSRF-Token':decodeURIComponent(cookie.split('=').slice(1).join('='))}},body:new FormData(form)}});const payload=await response.json();if(!response.ok||typeof payload.redirect_uri!=='string')throw new Error('authorization');location.assign(payload.redirect_uri)}}catch(_error){{submitting=false;button.disabled=false;button.textContent='Authorize';status.textContent='Authorization could not be completed. Please try again.'}}}})</script>"""
    document = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Skill Registry</title><style>{CONSENT_STYLES}</style></head><body><main class="shell" aria-labelledby="consent-title" aria-describedby="consent-description"><header class="lockup" data-ui="oauth-lockup"><svg aria-hidden="true" data-prefix="fas" data-icon="folder-tree" viewBox="0 0 576 512"><path fill="currentColor" d="{FOLDER_TREE_PATH}"></path></svg><h1>Skill Registry</h1></header><section class="card" data-ui="oauth-consent-card"><header class="card-header"><h2 id="consent-title">Authorize <bdi>{client_name}</bdi></h2><p id="consent-description" class="description"><bdi>{client_name}</bdi> is requesting access to the Skill Registry.</p></header><form class="card-content" method="post">{hidden}<div class="identity"><span class="identity-label">Signed in as</span><bdi>{email}</bdi></div><div class="permissions"><p class="permissions-title">Permissions</p><ul data-ui="oauth-permissions">{permissions}</ul></div><button class="authorize-button" data-ui="oauth-consent-action" type="submit">Authorize</button><p class="form-status" role="status" aria-live="polite"></p></form></section></main>{script}</body></html>"""
    response = make_response(document, 200)
    response.headers.update(
        {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": (
                "default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; "
                f"script-src 'nonce-{nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
            ),
        }
    )
    return response


def main() -> None:
    settings = Settings.from_environment()
    create_app(settings).run(host=settings.host, port=settings.port, debug=False)


if __name__ == "__main__":
    main()
