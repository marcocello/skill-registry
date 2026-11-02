# Sortable Library columns proof

## Done

- Every Library table column sorts ascending and descending through genuine header clicks.
- The sorted header reports the matching accessible direction.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/sortable-library-columns --timeout-seconds 120 --note "sortable Library columns candidate"
```

## Scenario: sort every Library column

- Producer/activation: a Chromium user opens the built Library and clicks each rendered column-header button twice.
- Consumer: the visible ReUI/TanStack Library table.
- Read-back: the proof reads row slug order after each click and the active header's `aria-sort` value.
- Fake: only the outer Registry HTTP responses are deterministic fixtures; the built React application, grid, sorting state, controls, and browser interaction are real.
- Catches: missing header controls, wrong direction transitions, lexical numeric/date ordering, a column that does not sort, stale direction indicators, or sorting that does not affect rendered rows.

## Scope

Proves:
- Skill, Description, Owner, Files, Git export, and Updated each sort ascending and descending in the rendered Library.
- A newly selected column replaces the prior sort and exposes the correct accessible direction.

Does not prove:
- persisted sort preferences, multi-column sorting, server-side sorting, or ordering of catalogue rows that have not yet loaded.

False-green risks:
- asserting only the icon or source configuration without reading the rendered row order.

Evidence method:
- deterministic

Known gaps:
- none

## Environment

- Production Vite build served by `vite preview` on a temporary local port and driven by Playwright Chromium.
- Runner stdout identifies the frontend path, Node version, and preview URL.
