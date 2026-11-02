# Library transfer actions proof

## Done

- Library users can discover Codex, Claude, and ZIP beneath compact Download and Upload menus.
- Assistant choices provide the correct connection guide and client-specific copyable prompt.
- Assistant download prompts include active Library selections by display name and slug while preserving the general zero-selection prompt.
- ZIP download contains a bounded, consistent snapshot of complete current bundles and transport identifiers.
- ZIP and MCP upload preserve text and binary assets in complete bundles larger than the former request and file-count limits, then reach the publication or proposal boundary with truthful read-back and stale-write protection.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/library-transfer-actions --timeout-seconds 180 --note "library transfer actions candidate"
```

## Scenario: Move bundles through the Library

- Producer/activation: launch the production portal and Registry boundaries, open the Library in Chromium, and use genuine menu, dialog, clipboard, download, file chooser, and upload interactions. Send a complete MCP create call through the production Nginx `/mcp` route with more than 100 files, more than 3.3 MB of payload, UTF-8 HTML, and base64 PNG content.
- Consumer: the rendered Library transfer controls, downloaded archive, production Nginx and Flask mutation routes, MCP schema and tool handler, SQLite Registry read-back, and Git snapshot.
- Read-back: both menus expose the three requested paths; the Claude modal links to `/connect?client=claude` and copies a slash-command prompt while Codex copies a `$skills-registry-guide` prompt; the catalogue ZIP contains non-empty text files, byte-exact PNG and arbitrary binary assets, UTF-8 HTML/SVG, and exact `.skill_id` values; uploading a new ZIP reports publication in open mode and the created skill is visible through `/skills/<slug>` and the generated Git snapshot; the large MCP create returns success rather than 413 and its JSON, ZIP, and Git read-backs preserve a representative bundle with three PNGs, HTML/SVG, an arbitrary binary file, more than 100 files, and more than 3.3 MB of request payload; one identified update creates exactly one version; stale, malformed, malicious, and rapidly double-submitted archives do not create extra versions.
- Fake: none inside the application boundary. The archive fixture is deterministic user input. Browser clipboard permission is granted by the proof harness.
- Catches: old MCP-labelled buttons, missing dropdown options, a generic or wrong-client prompt, same-tab guide navigation, inconsistent or unbounded catalogue archives, decorative upload controls, text-only MCP schemas, corrupted binary round trips, the obsolete 1.2 MB Nginx or Flask request cap, an unbounded production transport, legacy normalized file-count or byte caps, publishing `.skill_id`, lost updates, ZIP traversal/bomb/symlink tricks, duplicate submission, and a success message without durable Registry read-back.

## Scenario: Submit a ZIP through authenticated access

- Producer/activation: launch the existing production Google-mode proof boundary with its deterministic outer Google provider, sign in as a normal user in Chromium, upload a create ZIP through the Library, and double-click the final action.
- Consumer: the rendered upload state, authenticated Flask browser mutation and CSRF checks, SQLite proposals, unchanged published skills, and unchanged Git snapshot.
- Read-back: the UI reports `Submitted for review`; exactly one create proposal contains the complete bundle without `.skill_id`; uploading an identified current bundle creates exactly one update proposal; uploading an identified stale bundle is rejected; the skill catalogue and Git snapshot remain unchanged. A request without valid CSRF is rejected without a proposal, and an unauthenticated download receives 401. A Google-mode multipart request that adds forged `mode`, `role`, and `publication_path` fields is rejected as an undeclared schema or still produces proposal-only handling; it never creates a published version or Git change.
- Fake: only the existing outer Google authorization/token/JWKS edge. Registry, browser session, CSRF, SQLite, and Git are real.
- Catches: treating an authenticated user as open access, bypassing CSRF, claiming publication, duplicate proposal creation, or exporting an unapproved bundle.

## Scenario: Reject hostile or unbounded archives

- Producer/activation: inspect the declared schemas for MCP create, update, submit, and proposal edit, then execute each write path with binary content. Verify rejection without mutation for malformed base64, extra binary-object fields, unsupported encodings, binary `SKILL.md`, overlong paths, file/ancestor collisions, and the application-owned file/content ceilings through deterministic test-narrowed limits. Verify the built Nginx and Flask runtimes both own the 128 MB transport ceiling. Send deterministic ZIP fixtures to the real open-mode archive endpoint for CRC or declared-size corruption; raw traversal (`../escape`), backslash, Unix-absolute, Windows-drive-absolute, Windows-drive-relative, and original NUL-containing paths; encrypted flag; Unix symlink, socket, device, block device, and FIFO modes; duplicate normalized file and directory paths; same-path and ancestor file/directory collisions; multiple top-level roots including a foreign empty directory root; a test-narrowed raw-entry ceiling; binary `SKILL.md` and `.skill_id`; missing delimiter, malformed/over-limit or malformed-quoted scalar, `name` block scalar, duplicate metadata key, UTF-8-byte frontmatter above 16 KB, and `name`/`description` tags, anchors, aliases, sequences, or mappings; malformed and unknown `.skill_id`; `.skill_id`/name conflict; existing slug without `.skill_id`; and stale `.skill_id`. Send valid root-level and common-root archives containing ignored `__MACOSX` and `.DS_Store` entries, more than 100 published files, multi-megabyte content, UTF-8 HTML/SVG, three PNGs, and an arbitrary binary asset to prove accepted normalization and byte-exact round trip. Exercise both catalogue rejection branches against multiple real repository records with deterministic test-narrowed limits, including generated `.skill_id` bytes, and approve a Google-authored proposal before downloading the resulting catalogue.
- Consumer: Flask request limits, archive parser, metadata parser, repository version check, SQLite skills/versions, and Git snapshot.
- Read-back: each hostile upload returns a specific 4xx response and leaves skill/version/proposal counts and Git unchanged; valid root/common-root controls publish exactly one normalized bundle without ignored metadata; both over-cap catalogue branches return bounded 4xx responses with no partial download; the approved Google-authored bundle downloads with its exact `.skill_id` and retained author identity.
- Fake: deterministic archive bytes and seeded Registry rows are test input, not a replaced application boundary.
- Catches: path normalization after extraction, ignored metadata bypassing raw caps, special-file extraction, parser alias/tag surprises, stale overwrites, corrupted asset encoding, or silently truncated catalogue downloads.

## Scope

Proves:

- Production frontend interaction, bounded ZIP generation and hardened parsing, complete multi-megabyte bundle ingestion with explicit binary encoding, open-mode create/update with stale-version rejection, Google-mode create/update proposal submission and CSRF, unauthenticated Google download rejection, SQLite read-back, catalogue-cap rejection, and Git behavior for the named active behavior.

Does not prove:

- Codex or Claude installation, which remains covered by companion installation acceptance.

False-green risks:

- Source inspection or mocked component callbacks could pass without browser downloads, file selection, server validation, or persistence. The proof crosses the rendered production UI and reads the result from Flask and Git.

Evidence method:

- deterministic

Known gaps:

- Native screen-reader announcements are represented by semantic menus, dialog focus management, labelled status, and live-region text rather than a screen-reader integration.

## Environment

- Isolated production Compose/Nginx/Flask/SQLite/Git runtime with a deterministic starter catalogue.
- Chromium from the repository Playwright dependency.
- The unchanged passing candidate is rebuilt into the existing local Compose frontend and rechecked at `http://127.0.0.1:5175` as the named active runtime.
