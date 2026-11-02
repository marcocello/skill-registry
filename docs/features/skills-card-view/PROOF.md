# Skills card view proof

## Evidence

The black-box browser scenario builds and serves the production Vite portal, replaces only the outer Registry HTTP boundary with deterministic responses, and drives Chromium through the rendered Library.

It proves that:

- the existing table is the initial active view;
- the labelled Cards control switches to a responsive ReUI Frame card collection;
- card content is derived from live catalogue summaries;
- the existing search filters the visible cards;
- switching back restores the table; and
- activating a card navigates to its existing detail route.

## Run

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/skills-card-view --timeout-seconds 120 --note "skills card view candidate"
```

Supporting checks are `pnpm run lint` and `pnpm run build` from `frontend/app`; they are not substitutes for the browser proof.
