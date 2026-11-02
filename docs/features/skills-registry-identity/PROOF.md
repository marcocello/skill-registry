# Proof

## Done

- A production Compose candidate renders Skill Registry, advertises the `skills-registry` MCP identity, serves a valid companion skill, and presents the current Codex installer and Claude plugin paths with explicit prompt invocation text.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/skills-registry-identity --timeout-seconds 180 --note "reason"
```

## Scenario: rendered identity and installable companion

- Producer/activation: start the real production Compose topology from an isolated candidate, complete open-mode setup through the public API, initialize `/mcp`, fetch the companion skill, and navigate the portal through Chromium.
- Consumer: a teammate reading the Connect page and a Codex or Claude client connecting to the server and installing the companion.
- Read-back: browser title and shell name; exact same-origin Codex installer command, Claude plugin action, and invocation syntax; companion frontmatter and operating instructions; MCP `serverInfo.name`, instructions, and exposed open-mode write tools.
- Fake: none.
- Catches: a partial visual rollback, stale MCP alias, a command that installs only MCP, a companion in the wrong client directory, an invalid skill file, or accidental loss of the real portal write surface.

## Scope

Proves:

- The production frontend and backend agree on the Skill Registry identity.
- The same deployed origin serves the Codex installer and companion referenced by the connection flow.
- Codex and Claude users are shown the correct explicit invocation syntax.
- Open-mode MCP still exposes direct create/update tools.

Does not prove:

- Google provider login or reviewed submission behavior, already owned by the Google OIDC feature proof.
- Installation through a public Codex plugin marketplace or Claude organization policy.

False-green risks:

- Static source replacement could pass while an old container is served; the proof builds and browses an isolated production candidate.
- A renamed page could pass while MCP retains the old identity; the proof initializes the real MCP endpoint separately.
- The UI could describe a companion that is not deployable; the proof fetches and validates the exact same-origin `SKILL.md` referenced by the setup paths.

Evidence method:

- deterministic

Known gaps:

- Package execution, idempotency, conflict handling, and Claude ZIP internals are covered by `docs/features/companion-client-installation/PROOF.md` rather than repeated here.

## Environment

- Isolated Docker Compose frontend/Nginx/backend with a temporary SQLite and Git workspace; host Chromium from the repository-pinned Playwright dependency.
- Runner stdout: Docker Engine and Compose versions, isolated origin, setup result, MCP identity/tools, companion validation, and Chromium command/invocation assertions.
