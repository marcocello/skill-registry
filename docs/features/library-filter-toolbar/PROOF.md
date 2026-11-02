# Library search toolbar proof

## Done

- The toolbar is outside the bordered results container and contains no loaded-count badge.
- Contents and Git export filter controls and options are absent.
- Search still filters the visible skill rows and clearing it restores the catalogue.
- The Library exposes only the table presentation and remains usable without page overflow on a narrow viewport.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/library-filter-toolbar --timeout-seconds 120 --note "Library filter toolbar candidate"
```

## Scenario: use the distilled Library search toolbar

- Producer/activation: a Chromium user opens the built Library, searches for a skill, and clears the search.
- Consumer: the visible Library toolbar and table rows.
- Read-back: the proof checks toolbar/results geometry and containment, absence of both facet triggers and their checkbox options, search-driven visible table identities, absence of the loaded badge and view chooser, absence of a cards surface, and document overflow at a narrow viewport.
- Fake: only the outer Registry HTTP responses are deterministic fixtures; the built React application, search control, filtering, layout, table, and browser interaction are real.
- Catches: either removed dropdown remains, hidden but reachable facet options remain, search regresses, controls are embedded in the table frame, a loaded badge or Cards mode returns, or the narrow layout overflows.

## Scope

Proves:
- Contents and Git export facet controls are completely absent from the Library toolbar.
- Search remains outside the results frame, filters the rendered table, and the loaded-count badge is absent.
- The Library has no view chooser or cards surface and remains usable at a narrow viewport.

Does not prove:
- server-side search or demo-only Purpose/Status filtering.

False-green risks:
- checking only control absence without exercising the remaining search path and reading the rendered result set.

Evidence method:
- deterministic

Known gaps:
- none

## Environment

- Production Vite build served by `vite preview` on a temporary local port and driven by Playwright Chromium.
- Runner stdout identifies the frontend path, Node version, and preview URL.
