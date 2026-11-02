from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PROVIDER = ROOT / 'docs/features/google-oidc-registry-access/proof'
spec = importlib.util.spec_from_file_location('compose_proof', PROVIDER / 'runtime.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def wait_health(frontend):
    # During restart Nginx can return an HTML 502 before Flask is healthy.
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            status, body = helpers._request(f"{frontend}/api/health")
            if status == 200 and body.get("status") == "ok":
                return
        except (OSError, json.JSONDecodeError):
            pass
        time.sleep(1)
    raise AssertionError("Production gateway did not recover after startup/restart")


def main():
    project = 'registry-diffs-' + uuid.uuid4().hex[:10]
    backend_port, frontend_port, provider_port = [helpers._port() for _ in range(3)]
    frontend = f'http://127.0.0.1:{frontend_port}'
    with tempfile.TemporaryDirectory(prefix='registry-diffs-') as directory:
        root = Path(directory)
        workspace = root / 'workspace'
        workspace.mkdir()
        override = root / 'override.yaml'
        override.write_text(f'''services:
  backend:
    environment:
      DATABASE_PATH: /workspace/registry.sqlite3
      GIT_REPOSITORY_PATH: /workspace/registry-git
      HOST: 0.0.0.0
      PORT: 8000
      GOOGLE_ISSUER: http://fake-google:9000
      GOOGLE_AUTHORIZATION_ENDPOINT: http://127.0.0.1:{provider_port}/authorize
      GOOGLE_TOKEN_ENDPOINT: http://fake-google:9000/token
      GOOGLE_JWKS_URL: http://fake-google:9000/jwks
    ports: !override
      - 127.0.0.1:{backend_port}:8000
    volumes: !override
      - {workspace}:/workspace
  frontend:
    ports: !override
      - 127.0.0.1:{frontend_port}:80
  fake-google:
    build:
      context: {ROOT}
      dockerfile: backend/Dockerfile
    command: python /proof/fake_google.py
    environment:
      PROOF_GOOGLE_ISSUER: http://fake-google:9000
      PROOF_GOOGLE_CLIENT_ID: proof-client
      PROOF_GOOGLE_CLIENT_SECRET: proof-secret-canary
    ports:
      - 127.0.0.1:{provider_port}:9000
    volumes:
      - {PROVIDER}:/proof:ro
''')
        print(f'Production target={frontend} project={project} fake=Google-only', flush=True)
        try:
            helpers._compose(project, override, 'up', '--build', '--detach', '--wait')
            wait_health(frontend)
            subprocess.run(['node', 'docs/verification/review-history/proof/ui.mjs'], cwd=ROOT,
                           env={**os.environ, 'PROOF_FRONTEND_URL': frontend,
                                'PROOF_PROVIDER_URL': f'http://127.0.0.1:{provider_port}'},
                           check=True, timeout=180)
            with sqlite3.connect(workspace / 'registry.sqlite3') as connection:
                rows = connection.execute('SELECT version, files_json FROM skill_versions WHERE skill_id=(SELECT id FROM skills WHERE slug=?) ORDER BY version', ('diff-proof',)).fetchall()
                assert len(rows) == 6
                assert rows[0][1] == rows[2][1], 'restoration changed original bundle'
                assert rows[1][1] != rows[2][1]
            git_dir = workspace / 'registry-git'
            assert (git_dir / 'skills/diff-proof/scripts/nested/check.sh').read_text() == 'echo old\n'
            assert not (git_dir / 'skills/diff-proof/references/added.md').exists()
            exported = json.loads((git_dir / 'registry.json').read_text())
            assert any(skill['slug'] == 'diff-proof' and skill['version'] == 6 for skill in exported['skills'])
            print('PASS storage: immutable SQLite versions and restored Git current bundle', flush=True)
            helpers._compose(project, override, 'restart', 'backend')
            wait_health(frontend)
            subprocess.run(['node', 'docs/verification/review-history/proof/ui.mjs', '--reopen'], cwd=ROOT,
                           env={**os.environ, 'PROOF_FRONTEND_URL': frontend,
                                'PROOF_PROVIDER_URL': f'http://127.0.0.1:{provider_port}'}, check=True, timeout=60)
        finally:
            helpers._compose(project, override, 'down', '--volumes', '--remove-orphans', check=False)


if __name__ == '__main__':
    main()
