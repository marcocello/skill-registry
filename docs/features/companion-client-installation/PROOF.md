# Proof

## Done

- The rendered Connect page exposes one real Codex `npx` command and one Claude plugin download.
- Each provider exposes exactly three separate step cards and omits the redundant inner provider, access, and feature-title chrome.
- The Codex path exposes the official CLI installation command and desktop download guidance plus copyable download, change, and create/upload examples that invoke the companion and preserve access-mode semantics.
- The Claude path exposes desktop installation, plugin installation guidance, and three equivalent namespaced examples as separate cards.
- The Codex connection step explicitly covers the new-task/restart recovery for a companion that was installed correctly but is not yet discoverable in an already-running client.
- The served Codex package configures the expected MCP URL and installs the companion skill idempotently.
- The downloaded Claude ZIP passes Claude's plugin validator and contains the exact rendered Registry endpoint and companion skill.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/companion-client-installation --timeout-seconds 180 --note "companion client installation"
```

## Scenario: Codex one-command installation

- Producer/activation: the real frontend build creates the npm tarball; the proof serves that build and executes the exact rendered command shape through `npx`.
- Consumer: npm's real package executor and the package's executable installer.
- Read-back: a temporary user home contains the exact companion `SKILL.md`; the fake outer `codex` executable records one `mcp add skills-registry --url <origin>/mcp` call; a second install makes no duplicate add. Separate runs seed a different-origin MCP entry, a different-origin source marker, and an unmanaged skill, then verify actionable failures and byte-for-byte preserved local ownership.
- Fake: only the outer `codex` executable, which records its argv and exposes its configured MCP JSON instead of changing the developer's real Codex configuration.
- Catches: a decorative or unpublished npx command, missing tarball, wrong MCP URL, wrong user skill path, partial companion download, or non-idempotent reinstallation.
- UI read-back: the built page exposes exactly three sibling install/connect/try cards, the official OpenAI CLI command and desktop destination, no redundant inner chrome, and three complete companion prompts whose text is inspected for download identity preservation and access-aware write reporting.

## Scenario: Claude plugin download

- Producer/activation: Playwright selects the Claude card and clicks the real download button in the built portal.
- Consumer: the browser download manager and the installed Claude plugin validator.
- Read-back: the page exposes exactly three Claude cards, official desktop guidance, and three namespaced example prompts; the saved ZIP is extracted; its manifest, HTTP MCP configuration, namespaced skill location, and instruction body are inspected; `claude plugin validate` passes.
- Fake: setup/session/catalogue HTTP responses only, because they are prerequisite portal state and not claimed installation behavior.
- Catches: missing download activation, invalid ZIP hierarchy, stale or hard-coded origin, omitted MCP transport, omitted companion skill, or invalid Claude manifest.

## Scope

Proves:
- The self-hosted build serves an executable one-command Codex installer without an npm publication.
- The installer configures MCP plus the user-scoped companion and is idempotent for the same Registry.
- The rendered Claude download produces a provider-valid plugin containing MCP plus the companion skill.

Does not prove:
- Live OAuth completion against Google.
- Claude's graphical approval dialogs or a live provider account.
- Windows-specific shell behavior; the command requires the cross-platform Node/npm and Codex executables.

False-green risks:
- Replacing the installer itself instead of only the outer Codex executable would bypass the claimed process boundary.
- Inspecting source templates instead of the browser-downloaded ZIP could miss a broken click or dynamic origin.

Evidence method:
- deterministic

Known gaps:
- provider approval UI is manual by design.

## Environment

- Real frontend production build, local preview server, Chromium, npx/npm, temporary home, and installed Claude plugin validator.
- Runner stdout prints the Node, npm, npx, Codex-fake, Claude validator, frontend origin, and downloaded artifact used without printing secrets.
