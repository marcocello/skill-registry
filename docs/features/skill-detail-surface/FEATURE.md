# Skill detail surface

## Outcome

People inspecting a skill can transfer that exact skill with the same assistant actions used by the Library and can read its bundle in the same light visual system as the rest of the portal.

## Accepted behavior

- The skill detail page exposes the same `Download` and `Upload` assistant menus as the Library. `Download` keeps the Library's outline treatment and `Upload` keeps its primary treatment.
- Each detail menu offers Codex and Claude only. ZIP download and upload choices remain available in the Library but are not shown inside a skill.
- Activating an assistant choice opens the shared transfer dialog and copy flow.
- Detail download and upload prompts identify the current skill by its human display name and include its Registry slug as the exact machine identity.
- Codex prompts invoke the installed `$skills-registry-guide` companion and Claude prompts invoke `/skills-registry:guide` instead of telling people to address the MCP server directly.
- The selected file header, copy control, line numbers, code content, and binary fallback render on semantic light-theme surfaces with readable contrast.
- Bundle folders start expanded and their full rows are keyboard-accessible controls. Activating a folder toggles only that folder's descendants, exposes the expanded state to assistive technology, and leaves file selection and independently nested folders working.
- The content-sized file viewer keeps its existing path header, copy behavior, file selection, and responsive split/stacked layout while rendering every line without a separate expansion step or nested vertical scrollbar; the route provides the single scroll surface, a sticky bottom edge keeps the long bundle frame visually closed inside the viewport, and the real bundle border closes after the final line.
- The portal header remains pinned while the route content scrolls independently.
- A binary file fallback directs people toward the available connected-tool actions rather than a ZIP download.

## Boundaries

- Registry APIs, bundle persistence, collapse-state persistence, history, proposal workflows, and the underlying ZIP utility do not change.
- The shared assistant-transfer prompt generator receives the selected skill identity; propose, create, and administrator-edit prompt semantics remain unchanged.
- Demo-only proposal and administrator actions remain unchanged when their modes apply.
- This feature does not add syntax highlighting, a theme switcher, or a new download format.

## Consumption target

The production Vite portal built from `frontend/app`, served by an isolated local preview, and viewed in Chromium.
