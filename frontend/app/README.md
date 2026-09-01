# Skill Registry

The React portal for discovering, inspecting, downloading, and reviewing team skills. It provides User and Admin previews, a virtual infinite catalogue, skill bundle downloads, proposal moderation, and Codex and Claude connection guides.

## Technology

- React and TypeScript
- Vite
- Tailwind CSS
- shadcn/ui and ReUI
- TanStack Router, Table, and Virtual
- Playwright browser proof

## Run locally

From `frontend/app`:

```bash
pnpm install
pnpm run dev
```

The development server prints its local URL. Product configuration, including the remote MCP endpoint, is documented in the root feature contracts.

## Validate

```bash
pnpm run build
pnpm run test:e2e
```

The production-preview acceptance runner is `docs/features/skills-registry-frontend/proof/run.sh` from the repository root.

## Project boundaries

- Browser ZIP downloads are real effects.
- User/Admin identity, moderation, and MCP actions use the typed demo adapter until backend capabilities are available.
- SQLite and the Git export remain backend-owned authority.
