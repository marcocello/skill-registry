# Skills card view

## Outcome

Library users can switch between the existing ReUI data-grid view and a responsive ReUI Frame card view without changing the active search, filters, or loaded skill set.

## Accepted behavior

- The Library opens in the existing table view.
- A labelled table/cards control exposes both views and reports the active choice to assistive technology.
- The cards view renders the same filtered and incrementally loaded skills as the table view.
- Each card shows the skill name, slug, description, version, file count, update date, and the catalogue-specific owner or purpose/status information already available for that skill.
- Activating a card opens the existing skill detail route.
- Loading, error, empty, and filtered-empty states remain truthful in both views.
- The cards reflow from one column on narrow screens to multiple columns on wider screens and own their vertical scrolling within the existing Library viewport.

## Boundaries

- The existing ReUI data grid remains the default and is not redesigned.
- View choice is local presentation state; it is not persisted or sent to Flask.
- Catalogue fetching, filtering semantics, page size, and skill identity remain unchanged.
- No premium ReUI block or license is required. The card composition uses the free ReUI Frame primitive and the existing shadcn controls.

## Consumption target

The production Vite portal built from `frontend/app` and served in a Chromium browser.
