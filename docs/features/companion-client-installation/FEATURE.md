# Companion client installation

## Outcome

A person who opens a configured Skill Registry can connect their own Codex or Claude installation without an administrator, marketplace, pre-registered provider app, or hand-built configuration. Codex gets one copyable `npx` command that installs both the Registry MCP connection and the user-scoped `skills-registry-guide`. Claude gets one downloadable plugin ZIP containing the exact Registry MCP endpoint and the same companion skill, followed by Claude's required local approval.

## Behavior

- The Connect page retains separate Codex and Claude provider cards with their real marks.
- Codex presents one Registry connection command in addition to the official CLI installation command. The connection command executes a dependency-free npm tarball served by this Registry instance and passes the current portal origin to it; it does not depend on a package published to npm or a company administrator.
- The Codex installer requires Node/npm and an installed `codex` command, downloads the companion from the same Registry origin, configures `skills-registry` at `<origin>/mcp`, and writes the skill to `$HOME/.agents/skills/skills-registry-guide/SKILL.md`.
- Re-running the Codex installer against the same origin is idempotent. It does not duplicate the MCP entry. If an existing `skills-registry` MCP entry or companion skill belongs to a different origin, it stops with an actionable conflict instead of silently replacing local configuration.
- Google-mode MCP login remains a separate `codex mcp login skills-registry` step because provider authorization requires the user's browser confirmation. Open mode does not show a login step.
- The selected provider renders three separate sibling cards, without repeating the provider name, access mode, or an inner "Add Skill Registry" title above them.
- Codex setup is presented as three compact cards: install the Codex CLI with OpenAI's official shell command and download the desktop app from official guidance, run the one Registry command, then try copyable companion prompts.
- After the command, the page tells users to start a new Codex task and restart Codex if the newly installed companion is not listed. This is the documented recovery when automatic skill discovery has not refreshed; the page does not imply that an already-open task can always autocomplete a newly added skill immediately.
- The Codex examples cover discovering and downloading a complete skill bundle, proposing an improvement to an existing skill, and creating and uploading a new skill. They invoke `$skills-registry-guide`, use placeholders instead of assuming Registry contents, defer to the write tool exposed for the current access mode, and require truthful published-versus-pending reporting.
- Claude presents a primary `Download Claude plugin` button. The browser generates `skills-registry-claude-plugin.zip` with `.claude-plugin/plugin.json`, `.mcp.json`, and `skills/guide/SKILL.md`; `.mcp.json` contains the exact current `<origin>/mcp` HTTP transport URL.
- Claude setup mirrors the same three-card structure: install Claude Desktop, download and approve the Skill Registry plugin, then try copyable discover/download, improvement, and create/upload prompts.
- The Claude connection card explains the required follow-up in Claude Desktop: open the plugin controls, upload the ZIP, and approve it. The installed companion is invoked as `/skills-registry:guide` because Claude namespaces plugin skills.
- A non-HTTPS Registry may still generate the plugin for local Claude Desktop or Claude Code use, but the page states that Claude cloud surfaces require a publicly reachable HTTPS Registry.
- Download or packaging failure leaves the page usable and displays an actionable error. Generated packages never contain Registry credentials, Google credentials, access tokens, or local machine paths.

## Architecture

- `frontend/app/companion/codex-installer` owns the dependency-free executable npm package source.
- The frontend production build packs that source into `dist/companion/skills-registry-connect.tgz`; Nginx serves it as a normal immutable static artifact.
- `frontend/app/src/registry/actions.ts` owns browser-side Claude plugin generation so the ZIP can embed the exact origin without server state or a provider account.
- `frontend/app/src/registry/connect-page.tsx` owns only presentation and activation of those installation paths.
- The existing static companion `SKILL.md` remains the single instruction source consumed by both packages.

## Non-goals

- Silently launching or modifying third-party desktop applications from the browser.
- Installing a plugin into Claude without Claude's required approval.
- Publishing a public npm package or provider marketplace entry.
- Configuring Claude web, Cowork, or mobile from a local HTTP-only Registry.
