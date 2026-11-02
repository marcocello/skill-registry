# Role-aware skill deletion proof

## Done

- Open-access visitors and Google-mode administrators see no per-row delete actions, receive one bottom action bar only after selecting Library rows, can delete multiple selected skills, and can still delete from skill detail after explicit confirmation.
- Google-mode regular users see no delete controls and receive `403 Forbidden` when calling the deletion API directly.
- Confirmed deletion survives reload, returns `404` from detail read-back, cascades immutable versions, and removes generated latest/history paths plus catalogue entries from the Git mirror.
- Cancelled deletion leaves the visible and durable skill unchanged.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/role-aware-skill-deletion --timeout-seconds 180 --note "role-aware skill deletion candidate"
```

## Scenario: Delete skills in open access

- Producer/activation: start a real Flask HTTP server in open mode with temporary SQLite and Git repositories, serve the production Vite build through its normal API proxy, select two Library rows, use the resulting bottom action bar, and click the detail delete control in Chromium.
- Consumer: open-access Library selection state and bottom action bar, skill detail users, the Flask delete route, SQLite catalogue reads, and the generated Git catalogue.
- Read-back: verify every Library row lacks a delete control before and after selection; select two rows and observe one fixed bar at the bottom of the viewport with the exact count, clear action, and delete action; cancel plural confirmation and observe the selection and rows remain; inject a failure only for the second DELETE and observe the first row disappear while the surviving row remains selected in the bar; retry the surviving row successfully and observe the bar disappear; delete a third skill from detail with singular copy; reload the portal; read `404` from each deleted detail route; query SQLite for skills, versions, and pending deletions; and inspect generated Git paths plus `registry.json`.
- Fake: the second selected browser DELETE receives one deterministic `503` response to exercise frontend partial-failure recovery; every successful deletion crosses real Flask, SQLite, and Git boundaries.
- Catches: retained per-row delete icons, a permanently visible or misplaced delete action, selection count drift, cancellation clearing selection, deleting only one selected skill, row-click leakage, deletion without confirmation, stale frontend state, version rows surviving, or a Git mirror that retains deleted skills.

## Scenario: Enforce Google roles

- Producer/activation: start the same real Flask/Vite boundaries in Google mode, fake only Google's outer token exchange and identity verification, sign in through the normal state/cookie/callback flow as a regular user and as an administrator, call the direct API as the regular user, and delete through the administrator detail UI.
- Consumer: regular authenticated users, administrators, Flask authorization, the rendered Library/detail surfaces, SQLite, and the Git mirror.
- Read-back: the regular user sees no bottom delete bar even after selecting a Library row, sees no detail delete control, and receives `403`; otherwise-authorized requests with missing/invalid CSRF or mismatched Origin receive `403`; the administrator sees the selected-skills bottom bar and detail control, confirms deletion from both surfaces, receives visible catalogue read-back, reloads, and gets `404`; a pending update proposal survives and cannot be approved after deletion; SQLite and generated Git retain the denied user's skill but not either administrator-deleted skill or its historical versions.
- Fake: Google's outer code exchange and ID-token claims only; browser sessions, CSRF, role derivation, API authorization, persistence, Git export, and UI are real.
- Catches: trusting frontend role state, granting the selected-skills bar to every signed-in user, omitting CSRF/origin enforcement, hiding only one UI entry point, or deleting from SQLite without updating affected consumers.

## Scenario: Recover a pending Git deletion

- Producer/activation: delete through the real open-mode Flask route while replacing only the local Git export edge with a deterministic failure, then exercise both the Registry service's full synchronization and application startup reconciliation against the same durable databases.
- Consumer: deletion API response, health, deletion journal, explicit full synchronization, startup reconciliation, and generated Git state.
- Read-back: the deletion remains absent from SQLite while the response and health report pending Git work; a full synchronization clears the journal and removes generated paths; a second failed deletion is repaired automatically on application restart; deleting a never-present slug returns `404` without creating a journal row.
- Fake: the local Git exporter raises only for the deliberately injected failed export; recovery uses the real exporter and local Git repository.
- Catches: swallowing export failure without durable recovery state, health undercounting, a journal that never clears, explicit sync ignoring deletions, or startup reconciliation treating deleted versions as already complete.

## Scope

Proves:

- Role-aware deletion through real browser and HTTP boundaries in both supported access modes.
- Confirmation, cancellation, durable state removal, reload behavior, and affected Git consumers.
- Regular-user server denial even if the UI is bypassed.

Does not prove:

- Live Google infrastructure, because only the Registry-side role and authorization behavior changes.
- Remote Git provider push, which retains its existing best-effort path after local export.

False-green risks:

- A mocked catalogue API could let UI state disappear without deleting durable data, so the browser uses the real Flask API and the runner independently reads SQLite and Git afterward.
- UI-only role checks could hide a button while leaving the route callable, so the regular user sends a direct authenticated, CSRF-bearing delete request.
- Checking only `registry.json` could miss retained immutable history, so the runner checks database versions and both generated latest and history paths.
- A happy-path export could hide a non-recoverable deletion, so the runner injects one local export failure and reads the journal and health before exercising both recovery paths.

Evidence method:

- deterministic

Known gaps:

- Live Google and remote Git provider effects are outside this local feature boundary.

## Environment

- One production Vite build is served twice with its normal API proxy: once against an open Flask runtime and once against a Google-mode Flask runtime.
- Each Flask runtime uses an isolated temporary SQLite database and real local Git repository; Playwright Chromium performs genuine clicks and navigation.
- Runner stdout identifies Python, Flask, Node, pnpm, frontend/backend URLs, database paths, Git paths, and Chromium.
