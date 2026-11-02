# GitHub.com one-click remote

## Outcome

An operator can select GitHub.com or Manual when configuring the optional one-way Git remote during first-run setup or later Git Settings. GitHub.com is a guided provider flow: the portal bootstraps a dedicated public GitHub App from a manifest, guides the operator through GitHub installation and authorization, creates the selected account's repository, configures the generated local mirror to push to it, and never asks the operator for a personal access token, OAuth client ID, or client secret. Manual retains the existing HTTPS-token and SSH-deploy-key paths.

After setup, every remote action remains protected by the portal's established access policy: only a current administrator may manage it in Google mode, while every caller may manage it in open mode. Disconnecting removes only the portal's remote configuration and credentials. It never deletes the provider repository, GitHub App, GitHub App installation, local mirror, or Registry data. A different provider or repository may be connected only after the active remote is disconnected.

## Provider selection and UI

- Setup's Git repository card offers `No remote`, `GitHub.com`, and `Manual`. GitLab and generic provider-specific OAuth choices do not exist.
- While no remote is active, Git Settings reuses setup's `No remote`, `GitHub.com`, and `Manual` three-card provider selector and inset reveal structure. While a remote is active it shows its provider, credential state, account/repository, branch, push status, last error, Test, Retry push, and Disconnect actions.
- The GitHub form asks only for repository name, visibility (`private` by default or `public`), and export branch (`skills-registry` by default). The GitHub installation page owns personal-account or organization selection; the portal reads the selected installation account back from GitHub rather than trusting a typed owner.
- Manual configuration retains credential-free HTTPS/SSH URLs, branch validation, HTTPS username/token, SSH deploy-key generation, verified `known_hosts`, connectivity testing, pending/current status, and no-force push behavior.
- An active Manual remote may update its own URL, branch, or credentials. Switching between Manual and GitHub.com, or selecting a different GitHub repository, requires an explicit disconnect first.
- Conditional provider fields and connection progress use the existing setup reveal motion and reduced-motion behavior. Provider errors are actionable and never render secrets or raw provider responses.

## First-run lifecycle

- No remote and successfully prepared Manual remote preserve the existing finalization rules: open mode seals immediately; Google mode seals only after a configured administrator completes a current Google login.
- Selecting GitHub.com saves the access policy and new-only local repository as a provisional setup, regardless of access mode. Setup remains available while GitHub is incomplete and reports the exact provider connection state needed by the rendered page.
- The GitHub connection is bound to the current setup revision. Replacing provisional setup invalidates every older GitHub state, callback, and pending credential. A stale callback cannot create a repository, configure a remote, push, or finalize setup.
- A successful GitHub connection finalizes open mode. In Google mode it satisfies the remote prerequisite but setup remains provisional until a configured administrator completes a fresh Google login for the same setup revision.
- A failed, cancelled, denied, or expired GitHub flow leaves setup correctable. The operator may retry GitHub, change the desired repository name, choose Manual, or choose No remote. Cleanup of local pending secrets is automatic; a GitHub App or repository already created before a later failure is never deleted silently.
- Setup correction reuses only its own recorded local repository. Once a GitHub remote is durably connected, changing or removing it requires the explicit Disconnect action rendered in setup; ordinary access-policy correction does not silently replace it.

## GitHub App bootstrap

- The portal uses GitHub.com's personal-account App Manifest flow. It posts a server-generated manifest to GitHub, the operator confirms the app on GitHub, and the portal exchanges the one-hour manifest code for the generated App ID, client identity, client secret, private key, and app slug.
- The generated app is public but dedicated to this portal instance, so GitHub can offer personal-account or organization installation without asking the operator to select an app owner before leaving the portal. Public does not imply Marketplace listing. The manifest requests only repository Administration write, Contents write, and Metadata read, uses no active webhook, and contains callback/setup URLs derived from the sealed or provisional canonical `public_url`.
- After manifest conversion, the portal redirects to the new app's GitHub installation page. GitHub owns authentication, account/organization selection, permission disclosure, installation approval, and organization-owner request behavior.
- After installation, the portal starts a state-bound GitHub App user authorization. The short-lived user token is used only to create the requested personal or organization repository and is never persisted after that request.
- The created repository is empty, uses the requested `private` or `public` visibility, and is never initialized with provider content. The local Registry mirror remains the initial history and is pushed to the dedicated export branch.
- The portal stores the App ID, installation ID, installation account identity, repository identity, and GitHub App private key needed to mint short-lived installation tokens. It discards the manifest client secret and user access token immediately after promotion or terminal failure.
- Every GitHub test or push mints a new installation token. Installation tokens, user tokens, manifest codes, client secrets, private keys, state values, and binding cookies never appear in URLs beyond provider-required opaque codes, public responses, logs, frontend assets, retained proof, Git configuration, or Git command arguments.
- Git authentication uses the short-lived installation token through the existing ephemeral askpass boundary with username `x-access-token`. The credential-free remote URL is exactly `https://github.com/<account>/<repository>.git`.

## Connection state and external effects

- SQLite remains the connection authority. A provider attempt records a one-way-hashed state/binding, context (`setup` or `settings`), actor/setup revision, desired repository, expiry, and non-secret progress. Temporary provider credentials are stored only in the mode-`0600` SQLite database and are deleted when the attempt is promoted, replaced, expired, or terminally rejected.
- Manifest conversion, installation, user authorization, repository creation, connection promotion, and first push are explicit monotonic stages. Replayed callbacks are idempotently rejected and cannot repeat repository creation.
- GitHub repository creation is an external irreversible effect. Before making the create request, the attempt commits `external_effect_unknown`; after GitHub returns a repository ID, it durably records that identity before promotion. If the request outcome is lost or ambiguous, automatic creation retry is forbidden and the UI asks the operator to inspect GitHub and reconnect with a new repository name. If promotion or first push fails after the identity is known, the UI reports that the GitHub repository exists and offers retry; it never claims rollback or creates another repository automatically.
- A name collision or insufficient provider permission does not adopt an existing repository. The operator must choose another name or resolve permissions and retry.
- Provider/API timeouts are bounded. Slow or unavailable GitHub never blocks `/health`, setup status, normal catalogue reads, or an already configured local Registry mirror.
- Disconnect atomically removes the local Git remote row and GitHub credential row. It does not call GitHub repository deletion, GitHub App deletion, or installation deletion APIs. The UI explains that provider-side cleanup is manual.

## Authorization and request integrity

- Before setup finalization, GitHub start/install/callback routes are available only for the current provisional GitHub setup and require revision-bound state plus a secure HttpOnly binding cookie. Other Registry and Settings routes remain gated.
- After finalization, starting, completing, testing, retrying, or disconnecting a remote uses the same server-enforced Git Settings authority as today: exact same-origin is required for every mutation, with administrator browser session plus CSRF in Google mode. Starting a GitHub flow is a POST mutation; a GET start route cannot create an attempt or redirect to GitHub.
- A post-setup GitHub attempt is bound to the initiating authenticated administrator in Google mode. Session expiry, role loss, state mismatch, binding mismatch, setup revision change, or provider account mismatch rejects completion without changing the active remote.
- Provider callback destinations are canonical paths under `public_url`; arbitrary return URLs and provider-supplied redirect destinations are rejected.

## Setup prerequisite finalization

- The installation row records `admin_verified_revision` and `remote_ready_revision` independently. No remote and prepared Manual mark the remote prerequisite ready when setup is saved; GitHub marks it only after connection promotion.
- Open mode requires only remote readiness. Google mode requires both a current configured administrator login and remote readiness for the same setup revision. A single compare-and-set finalizer runs after either prerequisite changes, so Google-first and GitHub-first completion are equivalent and restart-safe.
- Correcting setup advances the revision and clears both prerequisite facts. A stale Google or GitHub callback cannot satisfy a newer revision.

## Persistence and compatibility

- Existing `git_remote_config` rows migrate as provider `manual` without changing their URL, branch, credentials, push state, or last pushed commit.
- Production GitHub web/API endpoints are fixed to GitHub.com. Loopback endpoint overrides exist only behind an explicit proof/test setting and never come from setup or Settings input.
- Provider attempts, GitHub credentials, active-remote promotion, and disconnect use separate tables and `BEGIN IMMEDIATE` compare-and-set transitions. GitHub credentials are minted through a provider strategy and never populate the Manual token column.
- Manual secrets retain current SQLite and filesystem permissions. GitHub private keys receive the same database `0600` protection and are never returned through Git Settings.
- Restart preserves an active Manual or GitHub remote and any externally-created/pending-retry state. Expired incomplete attempts are unusable and cleaned without affecting the last active remote.
- SQLite skill/version authority, local repository ownership, generated Git surfaces, fast-forward compatibility, pending export semantics, and no-force guarantees are unchanged.

## Non-goals

- GitLab one-click, GitHub Enterprise, self-managed GitLab, Bitbucket, additional provider OAuth integrations, importing or adopting existing repositories, cloning provider content, pull synchronization, pull requests, multiple simultaneous remotes, force push, or deleting provider resources.
- Hiding provider approval or organization-owner steps that GitHub requires.
- Guaranteeing installation into an organization where the operator lacks permission or an owner denies the request.
- Offline recovery for lost GitHub App ownership or a deleted provider-side app/installation.
