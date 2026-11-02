# Docker Compose Deployment

## Outcome

A developer can run the VS Code `compose:up` task once and keep it running while editing backend or frontend source. Docker Compose automatically rebuilds and recreates the affected service, and the updated behavior becomes visible through the existing frontend port without a manual `docker compose down` or a second `docker compose up`.

## Behavior

- The `compose:up` task launches the repository's Compose project with its initial image build and Compose Watch enabled.
- A change under `backend/` rebuilds the backend image and recreates the backend service.
- A change to `pyproject.toml` rebuilds the backend so dependency metadata is not left stale.
- A change under `frontend/app/`, including its package manifest or lockfile, rebuilds the frontend image and recreates the frontend service.
- Rebuilt backend behavior remains observable through Nginx's same-origin `/api/*` gateway.
- Rebuilt frontend assets remain observable through the same host bind address and port.
- Watch ignores generated dependency, build, cache, and retained proof-run directories.
- Persistent Registry data and the Git mirror remain owned by the existing `./workspace:/workspace` mount and survive service recreation.

## Architecture

Compose Watch owns development-time source observation. Image builds continue to own application code and dependencies. The runtime remains the production-like topology documented in `docs/ARCHITECTURE.md`: one Gunicorn backend worker, one Nginx frontend/gateway, and the backend-owned workspace mount.

This deliberately uses rebuild actions instead of bind-mounted Vite or Gunicorn reload servers. Rebuilds are slower than HMR, but they preserve parity with the supported Compose deployment and its acceptance boundary.

## Compatibility

- Direct `docker compose -f deployment/prod/compose.yaml up --build` remains valid and retains its previous non-watching behavior.
- The VS Code task requires a Docker Compose release that supports `up --watch` and the Compose `develop.watch` specification.
- The published frontend address remains `${FRONTEND_BIND_ADDRESS:-127.0.0.1}:${FRONTEND_PORT:-5175}`.

## Non-goals

- Instant browser HMR.
- Rebuilding for documentation-only changes outside the watched application paths.
- Replacing the Nginx/Gunicorn deployment topology with framework development servers.
- Automatically installing host-side dependencies.
