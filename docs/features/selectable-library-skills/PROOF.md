# Selectable Library skills proof

## Done

- A user can select individual skills or all visible skills without accidentally navigating away.
- Selection remains attached to stable skill IDs while sorting and filtering, and the toolbar exposes the count and Clear action.
- Codex and Claude download prompts name the active selection while the zero-selection prompt remains general.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/selectable-library-skills --timeout-seconds 120 --note "selectable Library skills candidate"
```

## Scenario: select skills in the Library grid

- Producer/activation: a Chromium user opens the built Library, clicks the blank area around a row checkbox, then clicks ReUI row and header checkboxes and an ordinary row cell.
- Consumer: the visible ReUI/TanStack Library table and its toolbar selection status.
- Read-back: the proof reads the unchanged Library URL and unselected row after a click in the blank selection-cell area, then reads checkbox state, selected row state, selection count, filtered visibility, selected-skill text in both assistant prompts, zero-selection fallback text, and subsequent detail navigation from an ordinary cell.
- Fake: only the outer Registry HTTP responses are deterministic fixtures; the built React application, ReUI grid, controlled selection state, sorting, filtering, and browser interaction are real.
- Catches: blank selection-cell or checkbox clicks bubbling into row navigation, blank selection-cell clicks changing selection, unstable index-based selection, selection loss during sort/filter, prompts ignoring or ambiguously naming the selection, broken select-all/indeterminate behavior, an ineffective Clear action, or ordinary-cell navigation being disabled by selection support.

## Scope

Proves:
- Individual selection, visible select-all, selected-row styling, count, and Clear work through genuine browser clicks.
- Selection survives sorting and a hide/show filter cycle because it is keyed by skill slug.
- Checkbox and surrounding selection-cell interaction leave the Library URL unchanged while ordinary-cell interaction still opens detail.
- Claude and Codex prompts include selected display names and slugs, and clearing selection restores the general discovery prompt.

Does not prove:
- persisted selection across reloads, selection of rows that have not loaded, or ZIP/upload actions consuming the selection.

False-green risks:
- asserting only rendered checkbox presence or component configuration without clicking both the control and its surrounding cell, or without reading state after reorder/filter operations.

Evidence method:
- deterministic

Known gaps:
- none

## Environment

- Production Vite build served by `vite preview` on a temporary local port and driven by Playwright Chromium.
- Runner stdout identifies the frontend path, Node version, and preview URL.
