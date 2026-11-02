# Selectable Library skills

## Outcome

Library users can select one or more skills without leaving the catalogue, creating a clear foundation for future bulk actions.

## Accepted behavior

- Every rendered skill row has a ReUI Data Grid selection checkbox.
- The header checkbox selects or clears all currently loaded, filtered rows and shows an indeterminate state when only some are selected.
- Selection uses the skill slug as its stable identity and survives local sorting and filtering while the skill still exists in the catalogue.
- A selected row has the grid's visible selected state, and the toolbar reports the total number of selected skills with a Clear action.
- Clicking a selection checkbox or the blank area of its selection cell does not activate the row's detail navigation. Only the checkbox changes selection; clicking an ordinary row cell still opens the skill detail.
- Skills that no longer exist in a refreshed catalogue are excluded from the active selection and its count.
- Choosing Download with Codex or Claude includes every active selection in the assistant prompt by display name and Registry slug. With no selection, the existing general discovery prompt remains available.

## Boundaries

- Selection is local presentation state and is reset when the Library remounts or reloads.
- ZIP download, upload, archive, and other bulk actions do not consume selection in this feature.
- The header checkbox affects the currently loaded filtered rows, not catalogue rows that have not loaded yet.

## Consumption target

The existing local portal at `http://127.0.0.1:5175` and the production bundle built from `frontend/app`.
