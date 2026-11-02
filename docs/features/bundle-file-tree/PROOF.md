# Bundle file tree proof

## Done

- A skill bundle with root and nested files is presented as an always-expanded, accessible folder tree whose folder labels have no disclosure controls.
- Opening a skill selects and renders its root `SKILL.md` before any file interaction, even when another path arrives first.
- Folder labels are visually muted, nested files use compact indentation, and the active file has ReUI's quiet accent selected treatment without elevation.
- Selecting a nested file transfers that selected treatment and shows its content while preserving the complete path in the viewer header.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/bundle-file-tree --timeout-seconds 120 --note "bundle file tree candidate"
```

## Scenario: Browse a nested skill bundle

- Producer/activation: build and serve the production Vite portal, return a configured open-access Registry session plus a deterministic skill bundle through the normal Registry HTTP routes, navigate to its detail route, and use genuine Chromium clicks on tree rows.
- Consumer: the rendered Files tab and file content viewer.
- Read-back: the labelled tree exposes root files, nested folders, local item names, levels, and selection; folder rows are non-button structural labels without `aria-expanded` state or disclosure chevrons and use muted foreground text; level-two and level-three items use 20-pixel and 32-pixel left padding; every descendant remains visible before and after clicking a folder label; before any file click, root `SKILL.md` has the ReUI accent-background, accent-foreground, medium-weight treatment without shadow and its path and content are rendered despite a nested file arriving first; selecting `openai.yaml` transfers that treatment and renders the expected content under the full `agents/openai.yaml` viewer path.
- Fake: deterministic responses replace only the outer Registry HTTP server because this is presentation-only behavior.
- Catches: retaining a flat slash-delimited list, leaving folder disclosure controls or chevrons in place, dominant black folder labels, overly wide indentation, an overly dominant primary selected row, selection elevation, incorrect nesting, choosing the first sorted/API file instead of root `SKILL.md`, hiding descendants after a folder-label click, or losing the full file path/content when a leaf is selected.

## Scope

Proves:

- Folder hierarchy, deterministic initial `SKILL.md` selection, arbitrary always-expanded rendering, non-interactive muted folder labels, compact indentation, understated ReUI selection, content read-back, and accessible tree state in a production frontend build.

Does not prove:

- Registry persistence or download correctness, which are unchanged.
- Desktop-style arrow-key tree navigation, which is outside this feature.

False-green risks:

- A fixture that happens to return `SKILL.md` first could preserve the old positional default. The proof returns a nested file first, opens the production UI in Chromium, and reads the selected tree state, viewer path, and content before any file click.

Evidence method:

- deterministic

Known gaps:

- Browser-specific assistive-technology announcements are represented by DOM roles and ARIA state rather than a screen-reader integration.

## Environment

- Isolated production Vite preview with deterministic outer Registry HTTP responses for the complete proof.
- The unchanged passing candidate is rebuilt into the existing local Compose frontend and rechecked at `http://127.0.0.1:5175` as the named active runtime.
- Runner stdout identifies the Node, pnpm, Vite preview, and Chromium target used.
