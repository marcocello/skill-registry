# Portal motion continuity proof

## Done

- Portal navigation produces destination-only directional continuity inside the stable shell without retaining an outgoing route snapshot.
- Buttons visibly respond during pointer press.
- Ordinary pages scroll through the shell viewport, return to the top before the next route paints, and never visibly correct their position after navigation.
- Scrolling either the shell viewport or ReUI DataGrid viewport changes the header and progress indicator, then settles.
- Reduced-motion preference removes nonessential animation without breaking navigation.

## Command

```bash
"${CODEX_HOME:-$HOME/.codex}/scripts/proof_run_capture" --feature-dir docs/features/portal-motion-continuity --timeout-seconds 120 --note "Portal motion continuity candidate"
```

## Scenario: move through and scroll the portal

- Producer/activation: a Chromium user presses portal navigation, moves forward and backward between Library and Connect, opens a long skill detail page, scrolls it, returns to Library, and scrolls a long Library catalogue.
- Consumer: the shared button primitive, route surface, shell main scroll viewport, persistent header, progress indicator, and installed ReUI DataGrid scroll viewport.
- Read-back: the proof reads the pressed control transform, directional destination animation, browser route-snapshot invocation count, destination content, the completed route surface's released clip, hit-tested visibility of the final line after a real scroll to the bottom, shell and nested scroll positions across navigation frames, ReUI viewport scroll position, header state before leaving and after returning to a route, computed progress transform, settled scroll state, and a reduced-motion browser path.
- Fake: only deterministic outer Registry HTTP responses; the production React bundle, navigation, CSS, ReUI DataGrid, real pointer input, scrolling, and browser animation engine are real.
- Catches: source-only animation classes, an outgoing route snapshot crossfading over the destination, directionless page replacement, a route animation that permanently clips long content after it finishes, a press effect that starts only after click, nested page and shell scroll owners competing, a post-navigation scroll correction, stale header/progress state resurrected when revisiting a reset route, scroll feedback wired to the wrong container, a permanently active scrolling state, or motion that ignores the user preference.

## Scope

Proves:

- Destination-only route, press, shell-scroll, and ReUI-scroll motion activate through real browser interactions in the production bundle.
- Forward/back direction and reduced-motion behavior are observable.
- A long detail page scrolls through the shell viewport, leaves no competing page-level scroll owner, and the next destination is at the top from its first observed frame.
- Scroll feedback does not change the page width on desktop or mobile.

Does not prove:

- Frame-rate performance on low-end hardware or motion in browsers without the View Transitions API beyond the CSS fallback contract.

False-green risks:

- Bounding rectangles and scroll dimensions can remain correct while an ancestor `clip-path` prevents long route content from being painted. The proof waits for the reveal to finish, requires the route clip to be released, scrolls to the final line with real wheel input, and verifies that line through browser hit-testing.

Evidence method:

- deterministic

Known gaps:

- manual performance feel on low-end hardware

## Environment

- Production Vite build served by `vite preview` on a temporary local port and driven by Playwright Chromium.
- Runner stdout identifies the frontend path, Node version, and preview URL.
