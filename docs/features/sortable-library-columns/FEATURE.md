# Sortable Library columns

## Outcome

Library users can quickly reorder the table by any visible column without leaving the catalogue.

## Accepted behavior

- Every Library table header is an interactive sort control.
- The first activation sorts the visible rows ascending by that column and the second activation sorts descending.
- Activating another header replaces the previous column sort.
- The active header exposes its direction with both a visible arrow and the table-header `aria-sort` state.
- Skill and Description sort as case-insensitive text using the displayed values.
- Owner sorts by its displayed value, including `Not recorded` when no owner exists.
- Files sorts numerically, Git export sorts by its displayed status, and Updated sorts chronologically.
- Search and filters continue to determine the available row set; sorting only reorders the filtered rows currently loaded into the table.

## Boundaries

- Sorting is local presentation state and is not persisted or sent to Flask.
- Sorting does not change card-view order, catalogue fetching, filtering semantics, incremental loading, or skill identity.
- Multi-column sorting is not included.

## Consumption target

The existing local production-style Vite portal at `http://127.0.0.1:5175` and the production bundle built from `frontend/app`.
