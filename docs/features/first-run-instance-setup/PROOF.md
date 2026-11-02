# Proof

## Done

- A clean production Compose instance completes one-time portal setup, creates the named workspace repository, optionally stores its first remote, seals setup, survives restart, and exposes only protected remote management afterward.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/first-run-instance-setup --timeout-seconds 420 --note "sealed setup, named repository creation, and remote-only administration"
```

## Scenario: One-time production setup and named repository creation

- Producer/activation: a unique production Compose project starts with an isolated workspace. Chromium enters through Nginx without a bootstrap credential, observes separate Portal access and Git repository cards, enters a repository name, reads the host/container mount mapping, and completes open-mode setup.
- Consumer: setup browser/router, Flask setup/status boundaries, SQLite installation state, the newly created Git working tree, normal portal, and a full backend restart.
- Read-back: Compose config expands the proof-controlled `PWD` to the same absolute workspace value for both the bind source and backend metadata; missing, relative, root, or control-character metadata is rejected by backend configuration; the access controls remain ordered and no bootstrap or existing-repository option is rendered; selecting conditional setup options exposes their fields through the setup reveal transition, while reduced-motion preferences suppress the animation; incomplete setup status returns the exact proof workspace with `Cache-Control: no-store`, and the repository name produces the displayed `<absolute-proof-workspace>/<name>` and `/workspace/<name>` mapping plus the same persisted container-relative path; frontend assets contain no host path; the obsolete `mode/path` schema, invalid/reserved/case-colliding names, a symlink target, and pre-existing directories containing visible or hidden content are rejected without mutation; generated Registry surfaces appear only in the newly created repository; an invalid initial remote leaves no repository artifact and can be corrected using the same name; finalized setup status carries `Cache-Control: no-store` and no host path; `/setup` routes to `/`; replayed setup, installation Settings, and rollback APIs are unavailable; no bootstrap or recovery token is logged.
- Fake: none. Host port and isolated workspace are proof-controlled.
- Catches: hardcoded repository location, retained existing-repository adoption, host/container path-preview drift, destructive overwrite, invalid name poisoning a new repository path, frontend-only setup flags, reusable setup writes, retained authentication Settings, recovery backdoors, non-durable sealing, and stale production frontend assets.

## Scenario: Provisional Google setup finalizes only through administrator login

- Producer/activation: black-box Flask HTTP uses a real temporary SQLite database and Git working tree with only the outer Google token/ID-token verification replaced. Setup submits Google policy, a repository name, and an optional proof-local remote. An administrator login starts, provisional setup is replaced while reusing its own recorded repository, and the stale callback is rejected; a permitted non-admin and then a configured administrator complete fresh authorize/callback sequences.
- Consumer: setup status/gate, revision-bound OIDC state and browser session persistence, installation finalization, sealed setup replay boundary, and remote Settings authorization.
- Read-back: provisional setup keeps Registry and Settings unavailable and can be corrected without a token; replacement increments the persisted setup revision, reuses only its recorded Git repository, and invalidates the earlier Google state; its stale admin callback does not finalize; a non-admin callback does not finalize; a fresh admin callback finalizes once; setup creation and authentication Settings remain unavailable afterward; the administrator can still read and mutate the Git remote. Existing finalized rows with a pre-change nested path remain usable after migration but that shape cannot be submitted through setup.
- Fake: the outer Google authorization/token/JWKS edge only.
- Catches: sealing before credentials are proven, stale policy-A login finalizing policy B, any allowed user finalizing, permanent bad-credential lockout, setup remaining writable after admin verification, or loss of remote administration.

## Scenario: Concurrent setup admits exactly one winner

- Producer/activation: two real unauthenticated Flask setup requests race while a deterministic coordination seam pauses the SSH-configured winner immediately after its conditional SQLite save. A second open-mode request attempts setup before the winner returns.
- Consumer: the in-process setup/finalization critical section, SQLite finalization condition, runtime sealed state, and SSH credential filesystem.
- Read-back: exactly one request returns 201; the loser returns 404; the persisted remote still belongs to the winner; and the winning private key remains present after both requests finish.
- Fake: only scheduling is coordinated; request validation, credential writes, SQLite transactions, runtime rebuild, and responses are real.
- Catches: a losing first-run request clearing or replacing the winner's credentials, two admitted setup writers, or runtime finalization lag exposing a post-commit mutation window.

## Scenario: Setup remote and durable post-setup retry

- Producer/activation: setup configures a dedicated branch and proof-local bare remote through the proof-only file transport. Publication crosses the real Registry service, local Git CLI commit, and Git CLI push. After setup, the Git-only Settings boundary replaces the remote with an unavailable target and retries after it becomes reachable.
- Consumer: remote branch read-back, local export status, Git-only Settings UI/API, and Registry version state.
- Read-back: the setup remote is persisted; the exact generated snapshot reaches the remote; unavailable push remains `pending`; retry advances the same commit without another Registry version; disconnect preserves the local repository; Settings contains no public-origin or authentication controls. Concurrent SSH/HTTPS Settings requests finish in one serial state, and simulated post-commit configure and post-delete disconnect failures restore both the prior row and SSH key. Credential subprocess checks retain HTTPS/SSH hardening and secret redaction.
- Fake: only the external Git host and deterministic concurrency/failure scheduling. Production HTTP requests, Git commands, database, credential files, export, and status transitions remain real.
- Catches: delaying all Git configuration until after setup, treating Git as transaction authority, losing publications on push failure, split SQLite/filesystem credential state, returning secrets, force push, duplicate versions on retry, or retaining auth controls beside remote controls.

## Scope

Proves:

- Production Compose/Nginx setup from an incomplete workspace, separate rendered setup cards, named repository creation and exact absolute-host/container mount mapping, pre-seal-only host-path disclosure, rejection of adoption/overwrite, persisted sealing across restart, unavailable setup/auth-settings/rollback boundaries, open-mode portal behavior, real local Git export, initial remote configuration, post-setup remote replacement/failure/retry/disconnect, and secret non-disclosure.
- Google provisional/finalized state and administrator-only finalization through the public HTTP/OIDC callback boundary with only Google’s outer provider replaced.
- Concurrent first-run sealing across the HTTP, SQLite, runtime, and credential-filesystem boundaries.
- Serialized post-setup Git Settings mutation and rollback across SQLite and SSH credential files.
- The checked-in Compose file retains exactly one backend workspace bind, exposes only the frontend by default, and keeps provider credentials and public origin out of Compose.

Does not prove:

- Live Google availability or registration, production TLS/DNS/reverse proxy behavior, a live provider HTTPS token, live SSH host availability, provider-side deploy-key installation, offline recovery, or inbound Git import.

False-green risks:

- Setting installation state directly in SQLite, checking only a source route while the production SPA still serves setup, displaying a hardcoded or relative host path instead of the actual bind source, checking only the path preview without reading the created host directory and persisted path back, finalizing Google without an admin callback, inspecting only a local commit without the remote ref, omitting an actual competing setup writer, or asserting masking while a secret remains in logs/assets/URLs.

Evidence method:

- Deterministic. Only Google and the external Git host edges are replaced; setup, authorization, persistence, browser behavior, Git CLI, and application effects cross real boundaries.

Known gaps:

- Live Google and live provider Git credentials remain operator-owned activation. Existing repositories cannot be adopted through setup. Restricting network access to an unconfigured instance is operator-owned because setup intentionally has no bootstrap credential.

## Environment

- Unique Compose project, isolated workspace, random loopback frontend port, a proof-owned occupied directory, proof-local bare remotes, deterministic fake Google edge, executable Git credential/SSH shims, and Chromium.
- Runner stdout identifies the Compose project, selected workspace-relative repository, Python executable, frontend origin, final setup state, and remote commit without printing secrets.
- Timeout: 420 seconds.
