# Library search toolbar

## Outcome

Library users can search the skill catalogue from a compact toolbar above one consistent table presentation, without redundant facet controls.

## Accepted behavior

- Search appears in a toolbar above and outside the bordered results container.
- The results container begins with the table header and the table is the only Library presentation.
- No Table/Cards view chooser, Cards control, or cards surface is present.
- The toolbar does not show the transient `n of n loaded` badge.
- No Contents or Git export filter trigger, dropdown, or checkbox option is present.
- Search continues to match skill display names, names, slugs, descriptions, owners, and file paths.
- The toolbar wraps in source order on narrow screens without causing page-level horizontal overflow.

## Boundaries

- Contents and Git export remain visible, sortable table data; only their toolbar filtering controls and local facet state are removed.
- Existing search, demo-only Purpose/Status filters, incremental loading, sorting, empty states, and catalogue fetching remain unchanged.
- The bottom-of-results `All n matching skills loaded` message remains; only the toolbar badge is removed.

## Consumption target

The existing local portal at `http://127.0.0.1:5175` and the production Vite bundle built from `frontend/app`.
