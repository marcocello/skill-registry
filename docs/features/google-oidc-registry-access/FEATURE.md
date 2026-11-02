# Google OIDC Registry access and reviewed publishing

## Outcome

A `example.com` teammate signs into Skill Registry with Google, browses and downloads the protected catalogue, and connects Codex or Claude to the same Registry identity through MCP OAuth. Teammate-created or edited skill bundles enter a durable review queue and cannot change the published Library until an administrator approves them. `admin@example.com` is automatically an administrator and can inspect, edit, approve, or reject proposals from the portal or MCP.

## Identity and roles

- Google OpenID Connect is the only human identity provider. The application requests only `openid email profile`, uses Authorization Code flow, validates signature, issuer, audience, expiry, nonce/state, `email_verified`, and the Google `hd` claim, and accepts only `example.com`.
- Email comparisons are trimmed and case-insensitive. `ADMIN_EMAILS` is a comma-separated allowlist; the initial Compose value is `admin@example.com`. An accepted allowlisted identity receives role `admin`; every other accepted Workspace identity receives role `user`.
- A first successful login creates or updates a durable user record keyed by Google issuer and subject. Email changes never change identity ownership. Locally disabled or wrong-domain identities fail closed. Without Google Admin API integration, a Google-side account disablement is observed at the next login and an existing Registry session remains bounded by its own expiry.
- Browser authentication uses an opaque, hashed, revocable eight-hour server session in an HttpOnly, SameSite=Lax cookie. The cookie is Secure whenever `PUBLIC_URL` uses HTTPS; plain HTTP is accepted only for loopback development. The frontend never receives Google tokens, stores bearer credentials, or infers authority from UI state.
- Login `state` and `nonce` expire after ten minutes and are single use. `state` is also bound to a one-time HttpOnly transient browser cookie so a valid state created by another browser cannot log the victim in. Every cookie-authenticated mutation and OAuth consent POST requires a same-origin `Origin` plus a session-bound CSRF header.
- Every catalogue, bundle, download, proposal, review, Git-sync, and MCP operation requires current authenticated authority. Only `/health`, OIDC start/callback, OAuth discovery/registration/authorize/token/revoke, and the static login shell are reachable without a Registry session or Registry-issued MCP credential.

## OIDC-only removal

- The environment administrator password, in-memory administrator sessions, manually generated or defined access tokens, token-management portal, role preview switcher, bearer-token setup instructions, and their HTTP routes are removed.
- Existing `access_tokens` rows and the table itself are removed during schema initialization. Former password/session, token-management, claim, and direct bearer publication endpoints remain absent rather than deprecated.
- A former `admin_*`, `sr_*`, defined bearer, Google access token, or Google ID token is never accepted at `/mcp` or protected Registry APIs. There is no legacy/fallback authentication mode or configuration switch.

## Portal journey

- An unauthenticated visitor sees the Font Awesome solid `folder-tree` icon beside the `Skill Registry` title above a compact default-size shadcn card containing a `Login` heading, a short Google sign-in description, and a standard full-width `Continue with Google` button. The login surface contains no organization, domain, or Google Workspace policy copy. After Google callback, the user returns only to a relative path beginning with one `/` and sees their real display name, email, and server-derived role. Logout revokes the current session and returns to login.
- A user can search, inspect, and download published skills and open Connect. Admin-only navigation and proposal data are not rendered and direct access is rejected server-side.
- Connect presents one self-hosted `npx` command for Codex that installs the exact `/mcp` connection and `$skills-registry-guide` companion; OAuth login remains a separate command and never uses an environment bearer token. Claude presents one generated plugin download containing the exact MCP endpoint and `/skills-registry:guide`, followed by Claude's required upload and approval. Local HTTP support is described as local-only; cloud surfaces require public HTTPS.
- After upstream Google sign-in, MCP authorization uses the same compact visual shell as the portal login: the Font Awesome solid `folder-tree` icon beside `Skill Registry`, the same default-size card, typography, border, spacing, and full-width primary action. The card remains an authorization surface rather than another login form: it names the requesting OAuth client, shows the signed-in email and requested permissions, and submits the existing same-origin/CSRF-protected consent without exposing OAuth parameters.
- An admin sees Review with the durable pending count. Review shows action, author, base version, complete proposed bundle, and safe timestamps. The admin can edit the pending bundle, approve with a required reason, or reject with a required reason.
- Refresh/restart preserves the signed-in session and review queue until their own expiry or revocation boundaries. Authentication/provider errors never fall back to public catalogue data.

## Proposal lifecycle

- `create` proposals contain a new slug and a complete validated bundle. `update` proposals contain an existing slug, its exact published base version, and a complete replacement bundle.
- Submission validates the same slug, `SKILL.md`, path, bundle-size, and content rules as publication. It records immutable author identity and timestamps but does not create a skill/version, change Git, or appear in Library.
- The HTTP and MCP submission schema is `{action, slug, base_version, name, description, files}`. `action` is `create` or `update`; create requires `base_version: null`, update requires the exact positive published version, and `files` is a complete replacement bundle. Pending proposals may be edited only by an admin using `{revision, name, description, files}`; the current integer revision is mandatory to prevent lost updates. Edits retain original author identity and record the editing admin and edit timestamp. Every decision uses `{revision, reason}`, requires a non-empty reason, and increments the revision exactly once.
- Approval is a single transaction that revalidates status and current base version, creates version 1 or the next immutable version, records reviewer/decision metadata, and closes the proposal exactly once. A create approval makes the immutable proposal author the durable skill owner and the first-version author. An update approval preserves that owner and records the update proposal's original author on the new version; an administrator edit or approval never transfers ownership or replaces the version author. Ownership and version authorship are stored by durable Registry user ID, while protected API and MCP responses resolve the current display name and email.
- Library summaries, skill details, immutable version history, MCP `skills.list`/`skills.get`, and generated Git manifests expose the recorded owner or version author. The live Library and detail page render the resolved owner identity. Clients cannot submit or override an owner field.
- Git export runs after the accepted database transition and retains the existing pending-on-export-failure behavior.
- A stale update proposal, conflicting create slug, repeated decision, concurrent second approval, rejected proposal, or unauthorized edit/decision cannot publish. Rejection closes the proposal without changing published state or Git.

## MCP OAuth and tools

- Skill Registry is both the MCP resource server and its OAuth authorization server. Google is only the upstream login provider; Google credentials are never passed through to MCP clients.
- `/mcp` returns a standards-compliant `401` challenge and publishes protected-resource and authorization-server metadata. OAuth uses Authorization Code plus PKCE `S256`, exact resource indicators, exact registered redirect URIs, short-lived single-use codes, short-lived access tokens, rotating refresh tokens, and revocation.
- Dynamic Client Registration is bounded to 100 clients and supports the exact public-client metadata needed by Codex and Claude: `authorization_code` plus refresh, `code` response type, `none` token authentication, client names of 1–100 characters, and at most five exact redirect URIs. Production redirects require HTTPS; loopback HTTP is accepted for local clients. Invalid metadata, redirects, PKCE, resources, replay, and expired/revoked credentials fail without a Registry or proposal effect.
- Authorization codes live two minutes, access tokens fifteen minutes, and refresh tokens thirty days. Authorization codes are single use. Refresh rotation revokes the complete token family when an already-used refresh token is replayed.
- Registry stores only one-way verifiers/hashes for OAuth codes and credentials. Authorization parameters, Google tokens, codes, verifiers, access tokens, refresh tokens, and client secrets are never logged or returned from safe listing endpoints.
- User grants may receive `skills.read` and `skills.submit`. Admin grants may additionally receive `skills.review`. Issued scopes are the intersection of requested scopes and current role capability, so an admin who does not request review does not receive it and caller-requested scopes cannot elevate authority.
- User MCP tools are `skills.list`, `skills.get`, `skills.submit`. Admin discovery additionally exposes `proposals.list`, `proposals.get`, `proposals.update`, `proposals.approve`, and `proposals.reject`. Direct `skills.create` and `skills.update` publication tools are removed for every role.
- MCP initialization returns concise, mode-aware Registry instructions assembled from the exact tools exposed to the current credential. Callers with read tools are told to search and inspect; callers with write tools are told to send the complete bundle including `SKILL.md`, avoid inventing omitted files or credentials, and confirm returned state. Open-access callers are guided only to direct create/update publication; protected callers with submit scope are told submissions remain pending until review; protected administrators with review scope additionally receive proposal decision guidance. Instructions never name tools unavailable to that principal, including for partial OAuth grants.
- Every MCP request revalidates credential, user status, role, resource, client, grant, and scope. After configuration reload/restart, removing an email from `ADMIN_EMAILS` removes browser and MCP admin capability on the first subsequent request and refresh without changing the underlying Google identity.

## Configuration and deployment

- `deployment/prod/compose.yaml` directly declares all runtime configuration without any `SKILLS_REGISTRY_*` or `VITE_SKILLS_REGISTRY_*` name, `env_file`, `.env` dependency, or `${...}` interpolation. It contains replace-before-deployment placeholders for the two Google credentials and concrete initial domain/admin values.
- Durable state uses one backend-owned bind mount, `./workspace:/workspace`. The backend directly declares `DATABASE_PATH=/workspace/registry.sqlite3` and `GIT_REPOSITORY_PATH=/workspace/registry-git`; it does not export Git's reserved `GIT_DIR` variable. There is no storage initializer, path alias, marker scheme, named volume, dotenv value, or Compose interpolation.
- The backend creates the SQLite file and generated Git repository inside the mounted workspace. `workspace/` is excluded from Git and every Docker build context. Operators stop the stack and archive the single directory for a consistent backup. The database is authoritative and the Git mirror is recoverable, but both are retained together for straightforward VM restore.
- `PUBLIC_URL` owns the externally reachable HTTPS origin. The Google redirect URI is exactly `${PUBLIC_URL}/api/auth/google/callback`; the MCP resource is exactly `${PUBLIC_URL}/mcp`.
- `PUBLIC_URL` must be one canonical origin with no credentials, query, fragment, or non-root path. HTTPS is required except for loopback HTTP development.
- Google credentials exist only in the backend container configuration and never become Vite build arguments, frontend assets, API responses, or logs. Documentation tells the operator to replace the Compose placeholders locally and register the exact redirect URI in Google Cloud.
- Provider-specific Google code implements a small OIDC interface so another provider can be added later without changing Registry principals, sessions, roles, proposals, MCP grants, or tool authorization.

## Compatibility and migration

- Existing published skills and immutable versions remain byte-identical and readable after OIDC migration once authenticated.
- Schema initialization adds nullable ownership and version-author references without rewriting existing bundles or hashes. A pre-attribution skill or version remains explicitly unattributed until trustworthy provenance exists; startup never fabricates an owner from the current administrator, latest editor, or unrelated proposal.
- Existing access-token data and its indexes are transactionally deleted during schema initialization because fallback authentication is explicitly removed. Startup never leaves a partially migrated authority model. There is no compatibility mode for clients configured with bearer-token environment variables; they must reconnect through OAuth.
- Demo fixtures may remain an explicitly selected presentation-only development surface, but they never bypass the OIDC gate or satisfy live Registry authorization/proposal behavior.

## Non-goals

- Username/password accounts, password recovery, personal Gmail access, domain-wide Google Admin API integration, group lookup, multiple upstream providers, service accounts, device flow, client credentials, token exchange, or accepting Google tokens at MCP.
- Live Google credential creation or Google Cloud console mutation by this implementation.
- Email notifications, comments/conversation threads, pull requests, arbitrary diff patch formats, automatic proposal merging, or administrator impersonation.

## References

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
