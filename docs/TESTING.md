# Testing

- Run Python checks through `.venv/bin/python`.
- Unit and route tests run with `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider`.
- Product acceptance uses the black-box runner in `docs/features/google-oidc-registry-access/proof/run.sh`.
- Acceptance must launch real production Compose boundaries and use temporary real SQLite and Git repositories.
- Frontend acceptance runs with `cd frontend/app && pnpm run test:e2e`.
- The browser proof verifies the OIDC login gate, protected catalogue access, server-derived role boundaries, proposal outcomes, and the OAuth connection guide.
- Lint, imports, builds, and direct service calls are supporting checks, not feature proof.
- Google OIDC and MCP OAuth acceptance uses `docs/features/google-oidc-registry-access/proof/run.sh`; it runs an isolated production Compose project, fakes only Google's outer authorization/token/JWKS edge, and crosses real Chromium, Flask, SQLite, Git, OAuth discovery/DCR/PKCE/token lifecycle, MCP, proposal, approval, immutable-version, and legacy-rejection boundaries.
- First-run configuration acceptance uses `docs/features/first-run-instance-setup/proof/run.sh`; it starts isolated production Compose/Nginx targets and crosses tokenless rendered open and provisional-Google setup journeys, separate access/repository cards, exact absolute-host/container mount-path preview with pre-seal-only disclosure, new-only named Git creation, adoption/overwrite rejection, revision-bound Google state replacement, setup sealing, open publication/MCP, initial and later remote management, Git credential hardening, and restart boundaries.
- GitHub remote acceptance uses `docs/features/github-one-click-remote/proof/run.sh`; it drives Chromium through production Compose/Nginx/Flask and a deterministic outer GitHub web/API/Git edge. It proves the rendered GitHub.com/Manual-only choices, public least-permission manifest, installation/account read-back, user authorization, new repository creation, short-lived installation-token push, provider ref, credential/state log redaction, focused replay/ambiguous-effect checks, and local-only disconnect.
- Companion installation acceptance uses `docs/features/companion-client-installation/proof/run.sh`; it executes the built self-hosted tarball through real `npx`, verifies idempotent user-scoped Codex installation with only the outer Codex executable faked, downloads the Claude ZIP through Chromium, and validates the extracted package with Claude's installed plugin validator.
