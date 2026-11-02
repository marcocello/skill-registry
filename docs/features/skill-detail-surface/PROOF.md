# Skill detail surface proof

## Done

- The skill detail page presents the same Download and Upload assistant menus as the Library without either ZIP choice.
- Codex download and Claude upload choices open the shared transfer dialog with prompts containing the skill display name, Registry slug, and correct companion invocation.
- The selected file viewer uses a light surface with high-contrast text.
- Bundle folder rows collapse and reopen their descendants, expose their expanded state, and keep nested folders independently controllable.
- Complete file contents render without an expansion action or nested scrollbar, a sticky bottom edge keeps long bundle frames visually closed during page scrolling, the real border closes after the final line, and the portal header remains pinned while the page content scrolls.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/skill-detail-surface --timeout-seconds 120 --note "skill detail surface candidate"
```

## Scenario: Inspect and acquire a skill

- Producer/activation: build and serve the production Vite portal, return a configured open-access Registry session plus a deterministic skill through the normal Registry HTTP routes, navigate to its detail route, click parent and nested folder rows to collapse and reopen them, open both assistant menus, activate Codex download and Claude upload, select a nested file, and inspect the result in Chromium.
- Consumer: the visible skill detail action area, shared assistant-transfer menus and dialog, and selected-file viewer.
- Read-back: the proof checks the exact Download and Upload labels and Library-matching variants; Codex/Claude-only menu contents with no ZIP choice; real download and upload dialog titles; prompts containing the distinct human display name, Registry slug, and selected companion invocation; absence of direct MCP-server wording; full-row folder controls and `aria-expanded` state; descendants disappearing and returning after parent clicks; a nested folder collapsing without hiding its sibling file; nested file selection after reopening; all lines of a long selected file without an expansion action or nested scroll range; a visible sticky bottom edge while the real bundle bottom remains below the viewport; the final line and real bundle border visible at the end of the route's single scroll surface; the header remaining pinned while route content scrolls; the selected full file path; computed light background and high-contrast foreground colors; and the narrow viewport layout.
- Fake: deterministic responses replace only the outer Registry HTTP server because the claimed behavior is presentation-only; the production React build, dialog, file tree, and styles are real.
- Catches: retaining the old `Get for your tool` action, implementing detail-only controls that drift from Library labels or variants, exposing either ZIP choice, using generic prompts or only the slug instead of the current display name and slug, bypassing the installed companion with direct MCP-server instructions, wiring the wrong assistant command, making only a small icon clickable, omitting accessible expanded state, collapsing the wrong subtree, coupling nested folder state, losing nested-file selection after reopening, truncating file content behind an expansion control, adding a nested vertical scrollbar, leaving a long bundle frame visually open inside the viewport, failing to expose the real closing border after the final line, losing the pinned portal header, a dark or unreadable viewer, or introducing page-level horizontal overflow.

## Scope

Proves:

- The production skill detail UI reuses the accepted Download and Upload assistant menus without ZIP choices and retains the light file viewer.
- Both transfer directions expose companion-led prompts with the current skill display name and exact Registry slug.
- Parent and nested bundle folders can be independently collapsed and reopened through accessible full-row controls.
- The selected nested file remains readable on desktop and narrow viewports after folder interaction.

Does not prove:

- Live MCP execution in Codex or Claude.
- Registry persistence or ZIP generation, which are unchanged internal capabilities.
- Demo-only proposal or administrator actions.

False-green risks:

- Inspecting Tailwind class names alone could miss inherited or overridden colors, so the proof reads computed browser colors and their contrast.
- Checking only button text could miss a copied-but-divergent menu, hidden ZIP choice, generic prompt, or wrong integration guidance, so the proof opens both menus, checks their items, activates different assistants and directions, and reads the rendered display name, slug, selected companion command, and forbidden direct-server wording.
- Inspecting tree markup alone could miss broken interaction or coupled subtree state, so the proof performs real pointer clicks and reads back visible descendants plus accessibility state at both folder levels.

Evidence method:

- deterministic

Known gaps:

- Syntax-token color contrast is not applicable because the viewer intentionally renders plain text without syntax highlighting.

## Environment

- Production Vite build served by `vite preview` on a temporary local port and driven by Playwright Chromium.
- Runner stdout identifies the frontend path, Node version, preview URL, and browser target.
