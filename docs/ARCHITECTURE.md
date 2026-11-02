# Architecture

## Ownership

- `backend/app/main.py`: HTTP application construction and routes.
- `backend/app/service.py`: create, update, and synchronization use cases.
- `backend/app/validation.py`: payload, slug, and path rules.
- `backend/app/repository.py`: SQLite schema and persistence.
- `backend/app/oidc.py`: Google provider integration, signed ID-token validation, hosted-domain enforcement, and browser login state.
- `backend/app/oauth_server.py`: Registry OAuth discovery, client registration, authorization codes, PKCE, access/refresh credentials, and revocation for MCP.
- `backend/app/proposals.py`: proposal submission, editing, decisions, and atomic reviewed publication.
- `backend/app/mcp.py`: role- and scope-filtered streamable HTTP JSON-RPC tools.
- `backend/app/git_export.py`: generated Git snapshot and direct commits.
- `backend/app/git_remote.py`: Manual credentials, provider-aware push, fast-forward checks, and local-only disconnect.
- `backend/app/github_provider.py`: GitHub.com App Manifest, installation, user authorization, repository creation, and short-lived installation tokens.
- `frontend/app/src/registry`: portal routes, role-aware workflows, live Registry API consumption, and the explicitly selected demo adapter.
- `frontend/app/companion/codex-installer`: dependency-free user-scoped Codex MCP and companion installer, packed into the production frontend as a self-hosted npm tarball.
- `frontend/app/src/components/reui/data-grid`: installed ReUI DataGrid primitive and virtual/infinite table implementation.
- `frontend/app/src/components/ui`: shadcn primitives used by the portal.

Routes contain no persistence or Git decisions. The registry service serializes mutations inside one process. SQLite is committed before Git export; export failure is stored as pending and exposed honestly.

Ordinary publication incrementally writes the new immutable version, its latest-skill projection, and the compact catalogue index under one Git operation lock. Explicit synchronization, dirty generated content, multiple pending exports, and startup reconciliation rebuild the complete SQLite-owned snapshot.

The portal is a separate React/Vite consumption target. Nginx sends same-origin `/api/*`, OAuth metadata, and `/mcp` traffic to Flask, so the browser does not bypass server authority. Catalogue summaries, versioned bundles, identity, and proposals flow from Flask through typed clients; no fixture or authentication fallback is allowed.

Connect derives package configuration from the rendered same-origin portal URL. The frontend build serves the Codex installer tarball, while the browser generates the Claude plugin ZIP with that exact MCP endpoint and the static companion instruction source. Neither package embeds provider or Registry credentials.

## Data flow

```text
Google OIDC -> Registry user + browser session -> role from sealed administrator emails

User bundle -> validate -> durable pending proposal
Admin approval -> revalidate status/base -> SQLite immutable version -> Git snapshot attempt
                                                               |                    |
                                                               |                    +-> exported commit
                                                               +-> accepted + pending on failure

POST /git/sync -> read complete SQLite state -> replace generated Git surfaces -> commit if changed

MCP discovery -> bounded client registration -> authorization + PKCE
Browser Google session -> consent -> single-use code -> Registry access/refresh credentials
Registry credential + resource/scope/user revalidation -> role-filtered MCP tools
```

The former access-token table is dropped during initialization. Browser sessions, OAuth codes, access credentials, and refresh credentials store only one-way hashes and have explicit expiry/revocation boundaries.

## Git ownership

The exporter owns `skills/`, `versions/`, and `registry.json` inside the configured Git working repository. It preserves every other committed or untracked path. Direct edits inside generated paths are replaced from SQLite on synchronization.

First-run setup accepts a single safe repository name and creates the Git working repository directly beneath the backend-owned workspace. Compose derives `${PWD}/workspace` once and uses it for both the bind source and backend metadata; the backend normalizes and validates it as an absolute non-root path before serving. Incomplete setup status exposes it with `Cache-Control: no-store` so the UI can show the exact mapping from `<absolute-host-workspace>/<name>` to `/workspace/<name>`. It is never compiled into frontend assets or returned after setup finalizes, whose status response is also non-cacheable. Setup cannot adopt or overwrite an existing repository or non-empty directory. The selected path is sealed with the access policy; previously finalized stored paths remain compatible.

Protected Settings may later manage one optional GitHub.com or Manual remote and dedicated export branch. GitHub connection attempts are revision- or administrator-bound monotonic SQLite records. Repository creation commits an `external_effect_unknown` stage before the irreversible provider call, preventing ambiguous-response retries from creating twice. Successful promotion stores the App private key separately, while every test or push mints a new installation token through ephemeral askpass. Manual retains HTTPS token and SSH deploy-key strategies. Disconnect removes only local configuration and credentials. Local Git export remains separate from remote `pending`/`current` state; push is always fast-forward/no-force, and failures retain the accepted SQLite version and retry the same managed commit.

## Runtime

The supported topology is one Flask process with SQLite and a local Git executable. Multi-process write coordination is intentionally deferred.

The Compose deployment preserves that topology with one Gunicorn worker, one backend-owned `./workspace:/workspace` bind, and a separate Nginx container serving the production portal bundle and gateway routes. SQLite owns the persistent installation policy, selected Git path, monotonic setup revision, independent administrator-verification and remote-readiness facts, and finalization state. Incomplete setup intentionally requires only network access; operators restrict exposure until it is sealed. Open mode seals when its remote prerequisite is ready. Google mode binds OIDC and GitHub state to the current setup revision and seals only after both a configured administrator login and remote readiness are recorded for that revision, in either order. After sealing, setup, access policy, public origin, and repository location are immutable through the application; only the remote remains configurable. Compose owns only infrastructure defaults and the optional host-facing frontend bind/port interpolation; provider credentials and public origin never enter frontend build configuration.

The portal runs independently from `frontend/app`. Its library owns vertical and horizontal grid scrolling, loads catalogue pages asynchronously, and virtualizes mounted rows through ReUI/TanStack Table v9. The repository has no fallback application, compatibility layer, or retained legacy runtime. Git history is repository metadata, not an executable product surface.
