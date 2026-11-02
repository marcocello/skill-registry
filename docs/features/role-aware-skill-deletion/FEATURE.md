# Role-aware skill deletion

## Outcome

An operator who is allowed to mutate the catalogue can deliberately remove an obsolete skill from either the Library or its detail page, while authenticated non-administrators cannot see or invoke deletion.

## Accepted behavior

- Open-access instances expose skill deletion to their anonymous visitors because open mode intentionally has no user or administrator distinction.
- Google-authenticated instances expose skill deletion only to configured administrators. Authenticated non-administrators do not see delete controls and receive `403 Forbidden` from the deletion API.
- The Library shows no per-row delete buttons. Selecting one or more skills reveals one floating bottom action bar with the selection count and a delete action; clearing the selection or completing deletion hides the bar.
- The selected-skills action deletes every currently selected skill through the existing role-protected deletion boundary. Successful deletions disappear from the catalogue; if a later request fails, already completed deletions remain honest and the surviving selection is refreshed from the catalogue.
- The skill detail action area retains its single-skill delete capability.
- Both the selected-skills bar and detail action show a confirmation dialog naming the skill or selected count and explaining that all versions will be permanently removed. Cancelling makes no request, preserves the current selection, and leaves the catalogue unchanged.
- Confirming deletion removes the skill and all of its immutable versions from SQLite, removes it from the visible catalogue, and returns detail navigation to the Library.
- The one-way Git mirror is rebuilt from the remaining SQLite-owned catalogue. Successful deletion removes the skill's latest and historical generated paths and updates `registry.json`.
- If Git export fails after the SQLite deletion, the API reports the deletion as durable with a pending Git sync. The pending deletion participates in health, startup reconciliation, and later full synchronization until the complete SQLite snapshot is exported.
- Deleting a missing skill returns `404 Not Found` and does not create a pending Git operation.

## Boundaries

- Flask remains the authorization and mutation authority. Frontend role state controls presentation only.
- Deletion uses the Registry service mutation lock and the repository's foreign-key cascade for immutable versions.
- Existing proposal rows are not deleted or rewritten. A pending update proposal for a deleted skill can no longer be approved as an update unless the skill is recreated through a valid create flow.
- Remote Git push retains its existing best-effort behavior after a successful local export.
- Selected Library deletion reuses the existing single-skill API serially; it does not add a separate atomic bulk endpoint. This feature does not add undo, recycle-bin retention, owner-based deletion, MCP deletion, or proposal-based deletion.

## Consumption target

The production React/Vite portal in `frontend/app` consuming the Flask HTTP API with temporary real SQLite and local Git repositories, viewed in Playwright Chromium.
