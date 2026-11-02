# Proof

## Done

- The exact Docker command and arguments owned by the VS Code `compose:up` task start an isolated candidate with Compose Watch enabled.
- Registry state and its Git mirror are created through the public API before a watched backend recreation and remain readable afterward.
- A backend source edit is rebuilt automatically and its new health payload is read through the running Nginx `/api/health` gateway.
- A frontend source edit is rebuilt automatically and its new document title is read from the same published port.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/docker-compose-deployment --timeout-seconds 420 --note "compose watch backend and frontend source propagation"
```

## Scenario: VS Code Compose task watches both application services

- Producer/activation: parse `.vscode/tasks.json`, select `compose:up`, and execute its real Docker command and arguments in an isolated copy of the candidate repository.
- Consumer: a developer saving backend or frontend source while the task remains active.
- Read-back: HTTP requests through the published Nginx port observe preserved Registry state, a changed backend health value, and then a changed frontend document title without restarting the task; the mounted Git mirror remains present.
- Fake: none.
- Catches: a missing `--watch` task argument, absent or incorrect Compose watch paths/actions, a rebuild that does not recreate the affected service, a broken Nginx-to-backend boundary, or stale frontend assets.

## Scope

Proves:

- The repository's `compose:up` task activates real Docker Compose Watch.
- Backend and frontend source changes propagate automatically through real image rebuilds and the real Compose/Nginx/Gunicorn topology.
- Both updates are visible on the same running host port without manual Compose lifecycle commands.
- SQLite-owned Registry state and the workspace Git mirror survive the watched backend recreation.

Does not prove:

- Browser HMR or sub-second update latency.
- Watch behavior on Docker Compose versions older than the runtime used by this proof.
- Production deployment behavior outside the local Docker daemon.

False-green risks:

- Merely detecting a container restart without reading changed behavior could pass while stale code is still served; the proof reads unique changed values through HTTP instead.
- Executing a hand-written command could pass while the VS Code task remains wrong; the proof executes the task's parsed command and arguments.

Evidence method:

- deterministic

Known gaps:

- Timing varies with local Docker build cache and machine performance; the proof uses bounded polling rather than assuming a fixed rebuild duration.

## Environment

- Isolated temporary candidate copy, Compose project name, workspace, and loopback host port.
- Real local Docker Engine, Docker Compose, backend image, frontend image, Gunicorn, Nginx, SQLite, and Git executable.
- Runner stdout: Docker/Compose versions, parsed task command, selected port, initial readiness, and the changed backend/frontend values observed through HTTP.
