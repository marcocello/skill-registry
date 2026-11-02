# Library transfer actions

## Outcome

People can move skill bundles between Skill Registry and their local tools from two compact Library actions, using Codex, Claude, or ZIP without first deciphering MCP terminology.

## Accepted behavior

- The Library header exposes `Download` and `Upload` buttons. Each button opens a keyboard-accessible menu with Codex, Claude, and ZIP choices.
- Choosing Codex or Claude opens a client-specific modal. The modal tells the user to connect Skill Registry first, links to that client's connection guide in a new browser tab, and presents a client-specific prompt that can be copied immediately.
- When Library skills are selected, a Codex or Claude download prompt names every selected skill by display name and Registry slug. With no selection, the general skill-discovery prompt remains unchanged.
- The connection guide opens with the selected client already active.
- Downloading as ZIP asks Flask for one transactionally selected snapshot of every current bundle, adds its transport-only `.skill_id`, and saves one `skills-registry.zip` archive. The server rejects a catalogue above 1,000 skills or 100 MB uncompressed instead of building an unbounded archive or returning a partial snapshot.
- Uploading as ZIP opens a focused uploader for one skill bundle. It accepts files at the archive root or beneath one common top-level folder, ignores macOS archive metadata, preserves UTF-8 files as text and every other regular file as base64-encoded binary content, and requires a text `SKILL.md` with valid skill frontmatter.
- A downloaded `.skill_id` uses the exact grammar `registry:<slug>:v<positive-integer>`. It identifies the Registry slug and base version but is not published as part of the bundle. Missing IDs are create-only; malformed IDs, unknown IDs, name/slug conflicts, and stale versions are rejected without mutation. An existing slug without an ID is rejected with recovery guidance.
- Flask owns archive validation before extraction: the old 1.2 MB request, 100-file, and 1 MB content caps are replaced. Nginx and Flask accept request bodies up to 128 MB, and a bundle may contain up to 1,000 normalized files, 20 MB of decoded content, and 1,024-byte UTF-8 paths, while the raw central directory remains capped at 1,024 entries including directories and ignored platform metadata. This admits complete asset-heavy skills such as the reported 3.3 MB, 152-file bundle without making request parsing, decompression, or persistence unbounded. It rejects encrypted entries, symlinks and non-regular entries, unsafe or overlong paths, duplicate normalized paths, file/directory and file/ancestor collisions, invalid CRC or declared sizes, binary `SKILL.md` or `.skill_id`, and unsupported multi-root bundles. Browser checks improve feedback but are not authoritative.
- Flask parses only a deliberately restricted `SKILL.md` metadata envelope; it never invokes a general or executable YAML parser. The file must begin with an exact `---` line and contain an exact top-level closing `---` within 16 KB. `name` is required exactly once as a plain, single-quoted, or JSON-compatible double-quoted single-line scalar of at most 100 characters. `description` is optional exactly once as the same scalar form or a `>`/`|` indented block, limited to 1,000 characters after decoding. Duplicate `name`/`description`, tags, anchors, aliases, malformed quoting, unsupported scalar forms, and invalid UTF-8 are rejected. Other frontmatter keys are retained as file content but not interpreted. The decoded `name` must be a valid Registry slug matching `.skill_id` when present; decoded `description` supplies Registry metadata.
- In open mode, a new ZIP publishes through the same service as `POST /skills`; an identified existing ZIP publishes only through an atomic expected-version update. In Google mode, the same upload creates a durable create or update proposal under the authenticated browser session and CSRF boundary; it never publishes or changes Git before approval.
- MCP create, update, submit, and proposal-edit tools accept each file as either a UTF-8 string or an object with exact `encoding: "base64"` and `data` fields. Binary values are strictly decoded before publication, remain explicit in Registry JSON, and are written as their original bytes in generated Git and ZIP downloads. Unknown object fields, unsupported encodings, malformed base64, binary `SKILL.md`, overlong paths, and file/ancestor collisions are rejected without mutation. The production Nginx and Flask transport boundaries replace the former 1.2 MB cap with a 128 MB request limit; the application-owned 1,000-file and 20 MB decoded-content ceilings apply consistently to JSON, MCP, and ZIP ingestion.
- Archive download uses the existing protected-browser authority. Archive upload requires the existing same-origin browser-mutation authority and CSRF token in Google mode. Flask dispatches publish versus proposal exclusively from the sealed installation policy and authenticated principal; no request field may select access mode, role, or publication path.
- Upload progress prevents duplicate submission. Success identifies whether the bundle was published or submitted for review; validation and network failures remain in the uploader with a specific recovery message.
- Empty catalogues disable ZIP download while leaving the assistant-guided paths available.

## Boundaries

- One upload contains one skill bundle; bulk ZIP import is not part of this feature.
- The feature does not bypass existing browser session, CSRF, open-mode, proposal, validation, immutable-version, Git-export, or review authority.
- Codex and Claude installation mechanics remain owned by the existing Connect page.
- Skill-detail actions are unchanged.

## Architecture

The Library transfer component owns the two menus, assistant guidance dialog, ZIP uploader state, and visible outcomes. A small frontend client calls bounded multipart upload and binary download endpoints. A backend archive service owns ZIP parsing, creation, metadata derivation, and transport limits, then delegates publication or proposal creation to the existing authoritative services. Repository updates accept an expected version inside the same SQLite write transaction. The Connect page reads an optional client query parameter only to choose its initial client card.

## Consumption target

The production Vite portal and Flask Registry served by the existing local Compose runtime at `http://127.0.0.1:5175` and viewed in Chromium.
