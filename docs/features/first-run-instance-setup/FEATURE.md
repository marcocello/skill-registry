# First-run instance setup

## Outcome

An operator can clone the repository and run `docker compose -f deployment/prod/compose.yaml up --build --detach --wait` without editing application credentials in `deployment/prod/compose.yaml`. A new instance opens a direct setup journey with separate Portal access and Git repository cards. It defines the portal access policy and public URL, then names the new Registry-owned Git mirror created inside the mounted workspace and optionally configures its first remote. Once setup is finalized, the setup page, public origin, access policy, and repository location are sealed. Only Git remote operations remain configurable afterward.

## Installation lifecycle

- The checked-in Compose topology remains two application services with the backend owning the single `${PWD}/workspace:/workspace` bind. There is no init command, storage initializer, marker container, named volume, or second authority.
- SQLite stores the installation policy, the selected workspace-relative Git repository path, and whether setup is finalized. Existing configured rows migrate as finalized and retain `registry-git` as their repository path.
- Each accepted provisional setup has a monotonically increasing revision. Google login state is bound to that revision; replacing provisional setup invalidates all outstanding login states, and only a callback for the current revision may finalize the instance.
- While setup is incomplete, setup creation requires no bootstrap token or other pre-existing credential. Network access to the unconfigured portal is sufficient to act as the installer, so operators must restrict exposure until setup is sealed.
- Before an access policy is submitted, the instance serves health and setup status/creation only. Registry, OAuth, MCP, proposal, and Settings routes return `SETUP_REQUIRED`; the frontend routes every browser path to setup.
- Open-mode setup finalizes immediately. Google setup remains provisional until a configured administrator completes a valid Google OIDC login. During that provisional state, only health, setup status/creation, and Google login/callback are available. The provisional setup may be replaced without a token so incorrect Google credentials cannot permanently lock out the operator.
- The first successful login by a configured Google administrator atomically finalizes setup. A permitted non-administrator login does not finalize it or gain portal access.
- Once finalized, setup creation is unavailable, `/setup` routes to the normal portal/login, and no authentication or repository-location Settings API exists. Restart preserves the sealed state.
- Destructive reset is not part of setup or Settings. Re-running Compose, retrying provisional Google setup, or reopening `/setup` never deletes Registry data or an existing finalized repository.

## Portal access policy

- `auth_mode` is exactly `none` or `google` and is writable only during incomplete setup.
- The rendered setup uses separate Portal access and Git repository cards. Portal access contains access mode first and public URL second. Git repository contains one repository-name field and no mode or existing-repository option.
- Conditional setup fields reveal with a short state transition that preserves form and keyboard semantics. The transition is disabled when reduced motion is requested.
- `public_url` is one canonical origin with no credentials, query, fragment, or non-root path. HTTPS is supported and required away from loopback; loopback HTTP is accepted for local use. It is sealed with setup.
- Google mode requires a client ID, client secret, at least one allowed Google Workspace domain, and at least one administrator email. Every administrator email belongs to an allowed domain. The redirect URI shown by setup is exactly `<public_url>/api/auth/google/callback`.
- Open mode stores no Google credential or allowlist. Google-only fields supplied with open mode are rejected rather than retained invisibly.
- Setup browser writes carry an exact `Origin` matching the submitted canonical `public_url`. The backend does not claim to observe the outer transport after Nginx. Production TLS termination is operator-owned and must preserve the external HTTPS `Origin`/`Host` to Nginx.
- Google client secrets and HTTPS Git tokens are stored only in SQLite. The backend creates the database with process umask `077`, enforces database/WAL/journal mode `0600` where present, and never returns secrets through setup status, Settings reads, errors, logs, retained proof, or frontend assets.
- No recovery token, authentication rollback, authentication editor, mode switch, public-origin editor, or administrator-list editor exists after finalization. Recovery from a sealed bad installation is an operator-owned offline workspace operation, not a network endpoint.

## Authorization modes

- In Google mode, the existing OIDC validation, durable browser sessions, users, administrators, proposal review, MCP OAuth, and role-derived scopes remain in force. Only a current administrator can manage the Git remote after setup.
- In open mode, there is no anonymous browse-only tier, login, logout, user/admin distinction, proposal review requirement, OAuth grant, or MCP credential. Every network caller has the same full instance capability, including Git remote management.
- Open-mode browser mutations with a present `Origin` require an exact match to `public_url`; cross-origin and `Origin: null` requests are rejected. An absent `Origin` is accepted for non-browser JSON/API and MCP clients.
- Open-mode HTTP publication uses direct create/update endpoints. Open-mode MCP exposes direct `skills.create` and `skills.update` tools in addition to read tools; it does not expose proposal tools.
- Google mode retains proposal-only writes for users and review tools for administrators. Direct publication endpoints and direct MCP tools remain forbidden.

## Local Git repository

- Setup requires one repository name, default `registry-git`. A name is a single safe directory segment; absolute paths, nested paths, traversal, control characters, the workspace root, the SQLite database filename, and the credential directory are rejected.
- The setup request schema is exactly `git_repository: {"name": "<name>"}`. Names are 1–80 characters, start and end with an ASCII letter or digit, and contain only ASCII letters, digits, `.`, `_`, or `-` between them. Leading-dot names, separators, traversal, trailing whitespace, control characters, symlinks, and case-insensitive collisions with the SQLite database filename or `git-credentials` are rejected.
- The backend derives the sealed repository path as `<workspace>/<name>` and initializes a Git working repository only when that directory is absent or completely empty, including hidden files. Setup never adopts or overwrites a non-empty directory or existing repository. The obsolete `mode/path` request schema is rejected.
- A provisional Google correction may reuse only the working repository already recorded by that same provisional installation. If the correction changes the repository name, setup creates the new repository and leaves the former provisional directory untouched; it never deletes or adopts it.
- Compose derives one host workspace value as `${PWD}/workspace` and uses that exact value for both the bind source and backend runtime metadata. The backend requires a normalized absolute, non-root path with no control characters and fails startup on an invalid or missing value. While setup is incomplete, setup status returns that path and the Git repository card shows the exact mount mapping before submission: `<absolute-host-workspace>/<name>` on the machine and `/workspace/<name>` inside the backend container. The path is not compiled into frontend assets and is no longer returned after finalization.
- Every setup-status response, incomplete or finalized, carries `Cache-Control: no-store` so the pre-seal host path cannot be reused from browser or intermediary caches after setup seals.
- The absolute host workspace path is intentionally visible to anyone who can reach an unconfigured instance. Operators must keep the instance network-restricted until setup is sealed.
- SQLite remains the catalogue and version authority. The exporter owns `skills/`, `versions/`, and `registry.json` inside the created repository.
- Existing finalized installations keep their previously persisted repository path for compatibility. New setup cannot select, move, replace, or adopt that path. Moving an existing finalized repository is an offline operator action and is not exposed through the portal.

## Git remote setup and administration

- A Git remote is optional during setup. Local export continues when no remote is configured.
- Setup and the later Git-only Settings page offer `GitHub.com` one-click or `Manual`; GitLab one-click is absent. Manual configures one remote URL, a dedicated export branch (default `skills-registry`), and either SSH or HTTPS authentication. GitHub provider behavior is owned by `docs/features/github-one-click-remote/FEATURE.md`. Setup may omit the remote and an authorized operator may add it later.
- Branch names must pass `git check-ref-format --branch`, contain no control characters or leading option prefix, and force push is never used.
- HTTPS remote URLs must use `https://`, contain a hostname, and contain no userinfo, control characters, query, fragment, or Git helper/protocol syntax. SSH remote URLs must use `ssh://user@host/path` or the bounded scp form `user@host:path`, with no control characters, local path, `file:`, `git:`, `ext::`, option injection, shell metacharacters, or URL password. Local/file transport exists only behind an explicit proof-only environment flag.
- HTTPS credentials are a non-empty username plus token. The token is supplied through an ephemeral `GIT_ASKPASS` executable and environment, never embedded in the remote URL, Git config, command arguments, stdout, or retained stderr.
- SSH uses an instance-generated Ed25519 deploy key under `/workspace/git-credentials`. The operator supplies validated `known_hosts` lines for the exact remote host. Push uses strict host-key verification; the private key is never returned.
- A remote ref may be created when absent. An existing ref is accepted only when it is already an ancestor of the local managed history. An unrelated or ahead/non-fast-forward history is rejected without force.
- Remote state is `disabled`, `pending`, or `current`. Saving validates and stores configuration without claiming connectivity. Test performs read-only discovery and compatibility checks. Push/retry reconciles pending local export and pushes the same current commit without creating a Registry version. Disconnect removes remote configuration/credentials and preserves the local repository and Registry data.
- After setup, the Settings surface contains Git remote management only: read, add/replace, test, retry push, and disconnect. Setup policy and repository location are neither returned nor writable there.

## Compose and operator journey

- `docker compose -f deployment/prod/compose.yaml up` starts an incomplete instance; it does not refuse to start or require a special Compose verb.
- `FRONTEND_PORT` and `FRONTEND_BIND_ADDRESS` are optional Compose interpolation inputs for the host-facing portal mapping only. Defaults remain `5175` and `127.0.0.1`.
- Compose requires `PWD` and passes `${PWD}/workspace` for the documented clone-and-run journey. Operators must launch Compose from the cloned repository root; launching the checked-in Compose file from another directory is unsupported because it would describe a different host workspace.
- The backend is private to the Compose network. Nginx remains the public gateway for `/api`, `/mcp`, OAuth metadata, and the SPA.
- The public URL is entered in setup, not inferred from the host port and not a frontend build argument.
- A finalized `docker compose -f deployment/prod/compose.yaml up` goes directly to the normal portal. Visiting `/setup` replaces the browser path with `/`; `POST /setup`, installation Settings, and rollback endpoints are unavailable.

## Compatibility and migration

- Existing finalized installations retain Registry data, authentication policy, local Git content, and remote configuration. Their repository path migrates to `registry-git`, matching the prior Compose path.
- Existing Registry tables, content, and finalized repository paths are not rewritten by installation migration.
- Existing Google deployments that have no installation row still complete setup once after upgrade; accepted Registry content remains intact.
- The prior Google-only feature remains the Google-mode contract except where this feature seals first-run configuration and moves repository/remote selection into setup.

## Non-goals

- Automatic DNS, TLS certificates, reverse-proxy provisioning, Google Cloud client creation, Git provider account mutation, or deploy-key installation.
- Existing-repository adoption, inbound repository import or synchronization, automatic clone, multiple remotes, arbitrary branch synchronization, pull requests, force push, or using Git as the write authority.
- Changing portal access, public origin, administrator allowlists, or repository location after finalization.
- An automatic or setup-triggered destructive reset.
