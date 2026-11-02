# Proof

## Done

- A Google-authenticated `example.com` user and allowlisted admin receive role-correct portal and MCP access, user writes remain proposals until review, published skills retain their original owner and per-version author, and every legacy authentication path is absent.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/google-oidc-registry-access --timeout-seconds 360 --note "Google OIDC, MCP OAuth, and reviewed publishing"
```

## Scenario: OIDC-only protected portal

- Producer/activation: a unique production Compose project starts with an existing published skill and the checked-in Google/domain/admin Compose structure. Chromium enters through the real frontend; a local fake Google provider supplies only authorization, token, and JWKS behavior.
- Consumer: unauthenticated visitor, ordinary `example.com` user, allowlisted administrator, and rejected external-domain identity.
- Read-back: protected API status, Font Awesome solid `folder-tree` icon beside the `Skill Registry` title and a compact default-size shadcn card with `Login`, a short Google sign-in description, and a Google button with no organization-specific copy; real profile/role shell, catalogue/detail/download, protected review API denial, logout, cookie attributes, backend restart, and schema inspection. A pre-feature database containing published versions and legacy tokens is migrated; exact published content survives while the table/index and old credentials do not.
- Fake: Google’s outer authorization/token/JWKS service only; Flask session, role, SQLite, Nginx, and browser boundaries remain real.
- Catches: public skill leakage, frontend-only role gates, unverified domain/admin email, token exposure, non-durable session, open redirects, login CSRF, cookie mutation CSRF, partial migration, and surviving password/token fallback. Negative provider cases cover missing/bad `hd`, unverified email, issuer/audience/algorithm/signature/nonce/state mismatch, expiry, state/code replay, and provider-token non-disclosure in responses, assets, database, and logs.

## Scenario: User proposal and admin portal review

- Producer/activation: the authenticated user submits complete create and update bundles through the protected proposal API and normal portal/MCP surfaces.
- Consumer: Library, user, admin Review page, SQLite, immutable skill history, ZIP download, and generated Git mirror.
- Read-back: submission is pending and absent from Library/Git; authenticated HTTP and MCP submissions containing a client-chosen `owner` are rejected without a proposal or publication effect. Admin sees author/base/files, edits with the exact revision, supplies a reason, approves once, and the exact edited bundle appears as the correct immutable version after reload. REST, MCP `skills.list`/`skills.get`, the rendered Library/detail page, SQLite, and generated Git manifests identify the original proposal author as owner and version author rather than the editing/approving administrator. A different teammate's approved update preserves the original owner while attributing only the new immutable version to that teammate. A same-provider-subject profile change preserves the stable owner ID while REST and MCP resolve the current display name and email. Rejection, stale base/revision, simultaneous double approval, and unauthorized direct POST/PUT `/skills` leave published state unchanged. A forced Git export failure records one accepted immutable version and one decision as pending; admin-only sync recovers the exact Git content.
- Fake: none beyond the already authenticated outer Google edge.
- Catches: direct user publication, fixture moderation, incomplete bundles, stale overwrite, double approval, dropping proposal identity at publication, assigning ownership to the reviewer or latest contributor, accepting a spoofed owner field, missing audit identity/reason, and database/Git divergence.

## Scenario: Codex/Claude MCP OAuth and role scopes

- Producer/activation: a standards-shaped public MCP client routes protected-resource and authorization-server discovery through Nginx, follows the discovered DCR/authorization/token/revocation endpoints, uses Authorization Code with PKCE `S256`, browser login/consent with Origin/CSRF, refresh, revocation, and the production `/mcp` transport. The portal separately verifies the exact Codex commands and Claude connector URL it presents to users.
- Consumer: OAuth client, authenticated user/admin, MCP tool discovery/calls, proposal queue, Library, and token/revocation state.
- Read-back: before granting access, the browser sees the same compact `Skill Registry` shell as portal login—the solid `folder-tree` lockup, default-size card, requesting client, signed-in email, requested permissions, and full-width authorization action—then completes the unchanged Origin/CSRF-protected consent. User sees read/submit tools only and mode-aware initialize instructions say submission remains pending; admin sees review tools and matching decision guidance only when requested, edits/approves through MCP, and the exact next version appears in portal/API/Git. Open mode separately receives direct create/update instructions without proposal claims. Current initialize headers, request metadata, and tool schemas avoid the former zero-tools/`-32602` failure. The portal distinguishes Codex shared-host configuration, Claude's public-HTTPS remote connector, and the Claude Code CLI command. Wrong resource, redirect, PKCE, code replay/expiry, access expiry, refresh replay/expiry, forbidden scope, legacy bearer, Google token, revocation, and role removal after restart fail without effects.
- Fake: Google’s outer identity endpoints only; Registry OAuth server, DCR, consent, token lifecycle, scope derivation, MCP, and proposal effects remain real.
- Catches: Google-token passthrough, arbitrary redirect registration, scope escalation, unbound access tokens, refresh-family replay, static tool lists, and direct publication tools.

## Scope

Proves:

- Google OIDC domain/admin enforcement, protected browser experience, durable sessions, OIDC-only removal, Registry-owned standards-based MCP OAuth, role-scoped tools, reviewed publication, durable owner and per-version author attribution, immutable versions, and generated Git read-back.
- `deployment/prod/compose.yaml` is the deployment configuration owner and has no prefixed variables, interpolation, env file, legacy examples/routes/UI/tool names, or Google credentials in the frontend image. The runner poisons root `.env` values and scans built assets and container logs for credential canaries.
- Compose gives only the backend one bind mount, `./workspace:/workspace`, with `DATABASE_PATH=/workspace/registry.sqlite3` and `GIT_REPOSITORY_PATH=/workspace/registry-git`. No storage initializer, path aliases, markers, named volumes, dotenv, or interpolation remain. A clean isolated project lets the backend create both artifacts, recreates it, and reads exact state back after full down/up. Workspace data is Git-ignored and excluded from Docker build contexts.

Does not prove:

- Live Google availability, a real Google client registration, execution by the installed Codex/Claude binaries, vendor uptime, production TLS/DNS/reverse-proxy behavior, or another OIDC provider.

False-green risks:

- Accepting a fake browser role without server authorization, importing application internals instead of crossing HTTP, letting fixtures satisfy catalogue/review assertions, passing Google tokens directly to MCP, testing only token issuance without resource use, publishing before visible approval, showing proposal authors while published skill attribution is absent, inspecting only SQLite without portal/MCP/Git read-back, or allowing the repository root `.env` to leak into proof configuration.

Evidence method:

- Deterministic. The outer Google provider uses a generated proof key and realistic signed ID tokens; all Registry decisions and effects cross production HTTP and persistence boundaries.

Known gaps:

- Live Google activation remains blocked until the operator supplies a real client ID/secret and registers the exact production redirect URI. Final source proof can pass with the fake outer provider; the active `5175` target cannot be called Google-ready without those external credentials.

## Environment

- Unique Compose projects, random loopback frontend/backend/provider ports, an isolated single workspace bind, generated proof signing key, and controlled Compose overrides. The runner disables root `.env` loading and cleans up containers and fake-provider processes. A second clean project uses Compose's real relative bind source from an absent workspace directory and proves backend-created storage survives a full down/up cycle.
- Timeout: 360 seconds.
- Runner stdout names the Compose project, public URLs, backend readiness, Google fake boundary, browser engine, protocol clients, proposal/version result, schema removal, and cleanup-safe PASS summary without printing credentials or tokens.
