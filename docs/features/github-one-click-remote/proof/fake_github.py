from __future__ import annotations

import json
import subprocess
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


class FakeGithub:
    def __init__(self, port: int, remote_root: Path) -> None:
        self.port = port
        self.remote_root = remote_root
        self.manifest: dict = {}
        self.calls: list[tuple[str, str]] = []
        self.pending_repository_name = ""
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.private_key = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args) -> None:
                return

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length)
                owner.calls.append(("POST", self.path))
                if self.path == "/settings/apps/new":
                    form = urllib.parse.parse_qs(raw.decode())
                    owner.manifest = json.loads(form["manifest"][0])
                    return self._html("Confirm GitHub App", "/approve-manifest", "Create GitHub App")
                if self.path.startswith("/api/app-manifests/"):
                    return self._json({
                        "id": 42, "client_id": "proof-client", "client_secret": "proof-client-secret-canary",
                        "pem": owner.private_key, "slug": "skills-registry-proof",
                    })
                if self.path == "/login/oauth/access_token":
                    return self._json({"access_token": "proof-user-token-canary"})
                if self.path == "/api/user/repos":
                    payload = json.loads(raw or b"{}")
                    owner.pending_repository_name = payload["name"]
                    return self._json({
                        "id": 99,
                        "html_url": f"https://github.com/proof-owner/{payload['name']}",
                        "owner": {"login": "proof-owner"},
                    })
                if self.path.endswith("/access_tokens"):
                    return self._json({"token": f"proof-installation-token-{len(owner.calls)}"})
                self.send_error(404)

            def do_GET(self) -> None:
                owner.calls.append(("GET", self.path))
                parsed = urllib.parse.urlsplit(self.path)
                query = urllib.parse.parse_qs(parsed.query)
                if parsed.path == "/approve-manifest":
                    return self._redirect(owner.manifest["redirect_url"] + "&code=proof-manifest-code")
                if parsed.path.startswith("/apps/") and parsed.path.endswith("/installations/new"):
                    state = query["state"][0]
                    return self._html("Install GitHub App", f"/approve-install?state={urllib.parse.quote(state)}", "Install app")
                if parsed.path == "/approve-install":
                    return self._redirect(owner.manifest["setup_url"] + "&installation_id=77")
                if parsed.path == "/api/app/installations/77":
                    return self._json({"id": 77, "account": {"login": "proof-owner", "type": "User"}})
                if parsed.path == "/api/user/installations/77":
                    return self._json({"id": 77, "account": {"login": "proof-owner", "type": "User"}})
                if parsed.path == "/api/user":
                    return self._json({"login": "proof-owner"})
                if parsed.path == "/login/oauth/authorize":
                    state = query["state"][0]
                    return self._html("Authorize repository", f"/approve-oauth?state={urllib.parse.quote(state)}", "Authorize repository")
                if parsed.path == "/approve-oauth":
                    state = query["state"][0]
                    callback = owner.manifest["callback_urls"][0]
                    return self._redirect(callback + "?code=proof-oauth-code&state=" + urllib.parse.quote(state))
                if parsed.path == "/materialize-git":
                    remote = owner.remote_root / "proof-owner" / f"{owner.pending_repository_name}.git"
                    remote.parent.mkdir(parents=True, exist_ok=True)
                    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
                    return self._json({"ready": True})
                self.send_error(404)

            def _json(self, payload: dict) -> None:
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _html(self, title: str, href: str, label: str) -> None:
                body = f"<!doctype html><title>{title}</title><h1>{title}</h1><a href='{href}'>{label}</a>".encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _redirect(self, target: str) -> None:
                self.send_response(302)
                self.send_header("Location", target)
                self.end_headers()

        self.server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
