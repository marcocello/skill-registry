# Skill Registry identity and companion skill

## Outcome

A teammate connects Codex or Claude to Skill Registry through the self-hosted setup path for that client and can invoke a small companion skill from the prompt input to use the Registry correctly.

## Behavior

- The rendered portal, OAuth consent surface, metadata, connection guide, current documentation, and MCP instructions use **Skill Registry** as the product name.
- MCP `initialize` identifies the server as `skills-registry`. Codex and Claude packages use the same client-side MCP server name.
- The portal serves a valid, self-contained companion skill named `skills-registry-guide` at `/companion/skills-registry-guide/SKILL.md`. It guides discovery, read-back, complete-bundle writes, access-mode-aware publication, and truthful result reporting through the connected Registry MCP tools.
- The primary Codex `npx` command runs the same-origin installer, which registers MCP and installs or updates the companion at `$HOME/.agents/skills/skills-registry-guide/SKILL.md`. The guide tells users to invoke it as `$skills-registry-guide`.
- The primary Claude action downloads a generated plugin containing the exact MCP endpoint and companion. The guide is invoked as `/skills-registry:guide` after the user uploads and approves the plugin.
- The browser does not silently configure either client. Codex setup runs only after the user copies and executes the command; Claude setup runs only after the user downloads, uploads, and approves the plugin.
- Open instances continue to publish through `skills.create` and `skills.update`; Google instances continue to submit through `skills.submit`. This feature does not alter authorization, review, persistence, or version semantics.

## Compatibility and non-goals

- Existing database contents, setup state, workspace paths, Git repositories, export history, and OAuth credentials remain compatible.
- Stable machine identifiers remain `skills-registry`; the product-name change does not rename MCP aliases, companion paths, package names, Compose projects, Git branches, or stored configuration.
- The default Git export branch remains `skills-registry`.
- Publishing a Codex plugin marketplace or a Claude organization-managed skill is outside this self-hosted implementation.
