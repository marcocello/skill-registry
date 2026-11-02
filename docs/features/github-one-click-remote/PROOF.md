# Proof

## Done

- A clean portal can configure GitHub.com or Manual during setup, and an authorized operator can later disconnect and connect either option without exposing credentials, replacing an active remote implicitly, or deleting provider resources.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/github-one-click-remote --timeout-seconds 480 --note "GitHub manifest connection and protected remote switching"
```

## Scenario: Rendered GitHub.com setup creates and pushes one repository

- Producer/activation: an isolated production Compose project starts with a clean workspace and proof-controlled public origin. Chromium selects GitHub.com in first-run setup, submits an open-mode provisional installation, follows the manifest, install, and user-authorization redirects through a deterministic outer GitHub service, chooses the provider-owned installation account, and returns to the portal.
- Consumer: production Nginx/React setup UI, Flask setup and provider routes, setup-revision/state/binding validation, SQLite installation/attempt/credential state, provider repository creation adapter, local Git exporter, and credential subprocess boundary.
- Read-back: the rendered setup offers only No remote, GitHub.com, and Manual; GitHub asks for name/visibility/branch but no PAT, client ID, or secret; the outer provider receives `public: true`, the exact least permissions, and canonical callbacks; the browser completes every redirect; one empty proof repository is created for the provider-selected account; the local managed commit reaches the requested export branch using a freshly minted installation credential; setup seals only after promotion; rendered output, retained output, and Compose logs omit the private key, client secret, user token, installation token, state, and binding.
- Fake: only GitHub.com's web/API pages and Git network edge. Production browser, Nginx, Flask routes, authorization, SQLite, setup revision, local Git history, askpass construction, and lifecycle transitions remain real. The fake records non-secret request shape and exposes a proof-owned bare repository for durable ref read-back.
- Catches: a hardcoded PAT/client ID field, frontend-only provider state, unbound callbacks, overbroad manifest permissions, owner text trusted instead of installation identity, duplicate creation, initialized provider history, long-lived token persistence, token in rendered output or Compose logs, sealing before connection, false rollback, or stale production assets.

## Scenario: Failure, stale callback, and retry preserve honest external state

- Producer/activation: black-box HTTP starts two provider attempts around a provisional setup revision, replays the older manifest/install/OAuth callbacks, injects provider denial and a repository-name collision, loses the response after a repository-create request, then lets a fresh current attempt create a repository before the first push fails and later retries.
- Consumer: provider attempt state machine, setup gate/finalization, external-effect journal, active remote promotion, Git pending/current status, and provider retry adapter.
- Read-back: stale/mismatched/expired state and binding cannot call repository creation or alter setup; a personal OAuth identity different from the selected installation account and a user without access to the selected organization installation are rejected before creation; expiry scrubs incomplete App credentials on SQLite reopen without touching an active remote; denial/collision remains correctable and never adopts an existing repository; a lost create response leaves `external_effect_unknown` across SQLite reopen and never issues a second create request; exactly one known externally created repository identity is durably retained; failed push reports `pending` without creating another repository; retry mints a different installation token, advances the same Git commit, and finalizes open setup once.
- Fake: deterministic GitHub denial/collision/token/repository responses and the outer Git transport only.
- Catches: callback replay, setup-revision confusion, provider-account mismatch, duplicate external effects, secret retention after terminal failure, false disabled/current status, retry creating a second repository, or an external effect lost between provider success and SQLite promotion.

## Scenario: Post-setup authorization, disconnect, and provider switching

- Producer/activation: focused production-route tests verify a finalized Google-mode non-admin cannot start or mutate Git Settings, an administrator needs exact origin plus CSRF to start GitHub, and losing the initiating session rejects the callback. The rendered open-mode journey completes GitHub, disconnects it, and configures Manual without a user role.
- Consumer: protected Git Settings UI/API, Google session and CSRF authority, open-mode origin authority, provider attempt actor binding, active-remote exclusivity, credential cleanup, and external provider audit.
- Read-back: every non-admin mutation is forbidden; an admin start is same-origin/CSRF protected and actor-bound; provider cards remain hidden while a remote is active; after disconnect, Settings renders the same three-card `No remote`/`GitHub.com`/`Manual` selector and inset provider reveals as setup; open callers can switch to Manual; disconnect removes local GitHub secrets and configuration while local Git and provider repository/ref remain; the fake GitHub service receives no delete-repository, delete-app, or uninstall call; existing pre-feature rows read back as Manual after migration.
- Fake: only outer GitHub and Git network edges. Registry authorization, sessions, CSRF/origin enforcement, SQLite migration/transactions, rendered Settings UI, and local repository remain real.
- Catches: UI-only admin restriction, open-mode regression, implicit replacement, orphaned local credentials, provider deletion on disconnect, local mirror deletion, or migration relabeling/loss.

## Scenario: Google and GitHub prerequisites finalize in either order

- Producer/activation: focused persistence tests create two clean Google-mode provisional installations. One records current administrator verification before remote readiness; the other records remote readiness before administrator verification. Both reopen SQLite between prerequisites, while route tests separately pressure stale/replayed Google and GitHub callback state.
- Consumer: durable setup prerequisite facts, revision binding, Google/GitHub callbacks, compare-and-set finalizer, setup gate, and restart reconstruction.
- Read-back: neither first prerequisite seals setup; the second current-revision prerequisite seals exactly once; both orderings produce the same finalized state; stale/replayed callbacks cannot satisfy a newer revision; Settings remains unavailable until finalization.
- Fake: only the outer Google verifier/exchange and GitHub web/API/Git edge; prerequisite-order persistence uses the real SQLite compare-and-set owner directly.
- Catches: either callback finalizing unconditionally, in-memory-only readiness, order dependence, revision confusion, and restart loss.

## Scope

Proves:

- GitHub.com manifest bootstrap, installation/user authorization orchestration, provider-owned account selection, repository creation, short-lived credential push, setup finalization, post-setup authorization, Manual compatibility, explicit switching, disconnect semantics, retry/idempotency, SQLite reopen behavior, and secret non-disclosure in rendered output and Compose logs.
- Production endpoint pinning, POST-only start mutation, no GitHub calls for Manual, and both Google/GitHub prerequisite orderings.

Does not prove:

- Live GitHub.com availability, a real personal/organization installation policy, GitHub billing/rate limits, organization-owner approval, GitHub Enterprise, or live provider-side app/repository deletion behavior because deletion is intentionally never called.

False-green risks:

- Replacing provider routes with inner mocks, asserting only redirect strings, skipping rendered provider selection, using a static token instead of minting per operation, checking only a local commit without the provider ref, omitting SQLite reopen/replay/non-admin pressure, or masking secrets in one response while retaining them in Compose logs.

Evidence method:

- Deterministic. The unsafe GitHub web/API and remote-network edges are fake; application routes, authorization, persistence, local Git, subprocess credential delivery, production rendering, and read-back are real.

Known gaps:

- A live GitHub account is required for final provider activation. The deterministic proof cannot establish organization-specific approval policy or provider availability.

## Environment

- Unique production Compose project, isolated workspace/database/local Git mirror, Chromium, deterministic loopback GitHub web/API service, proof-owned bare provider repository, short-lived canary credentials, pre-feature SQLite fixture, Google outer-edge verifier, and random loopback ports.
- Runner stdout identifies the Compose project, Python executable, portal origin, provider account/repository, final remote provider/status, and provider ref without printing credentials.
- Timeout: 480 seconds.
