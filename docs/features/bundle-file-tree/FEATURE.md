# Bundle file tree

## Outcome

People inspecting a skill can browse its bundle as a familiar folder tree instead of reading repeated slash-delimited paths in one flat list.

## Accepted behavior

- The Files tab renders bundle paths as a hierarchical tree with folders and files at their actual depth.
- Folder and file labels show only their local name. Selecting a file continues to show its complete bundle path in the content viewer header.
- Opening a skill initially selects the root `SKILL.md` file when present, regardless of API or display ordering. Bundles without a root `SKILL.md` fall back to their first available file.
- Folders are always expanded so every bundled file remains visible at a glance. Folder rows are non-interactive structural labels with no disclosure chevron or collapse state.
- The tree supports arbitrary nested folder depth, keeps root files at the root, and sorts folders before files alphabetically at each level.
- Folder labels use muted foreground text so they organize the tree without competing with file selection.
- Each nested level adds a compact 12-pixel indent, keeping child files visibly grouped without pushing their names unnecessarily far right.
- The selected file follows ReUI's quiet tree treatment: a semantic accent background, accent foreground, and medium label with no elevation. Selection remains identifiable without becoming the tree's dominant visual element. It opens the same text or binary preview as before.
- File selection is local presentation state and resets when a different skill detail page is mounted.
- The tree exposes its structure, item levels, and selected file to assistive technology. File rows remain normal keyboard-focusable controls; folder rows identify the permanently visible groups without presenting an unavailable action.
- The existing desktop split layout and narrow-screen stacked layout remain intact.

## Boundaries

- Bundle storage, validation, API payloads, downloads, search, history, and proposal editing do not change.
- This feature does not add file creation, rename, deletion, drag-and-drop, filesystem access, or persisted expansion state.
- It does not add desktop-style arrow-key tree navigation; standard browser focus and activation behavior remains available for file rows.

## Architecture

The skill detail frontend derives a presentation-only tree from the existing `SkillFile[]` paths. The tree component owns recursive rendering of permanently expanded folders; `FilesTab` remains the owner of selected file content and the viewer.

The selection treatment reuses the ReUI Tree label pattern. The full ReUI Tree primitive is not adopted because its disclosure interaction conflicts with this feature's always-open, no-chevron folder contract.

## Consumption target

The production Vite portal built from `frontend/app`, served by the existing local Compose frontend at `http://127.0.0.1:5175`, and viewed in Chromium.
