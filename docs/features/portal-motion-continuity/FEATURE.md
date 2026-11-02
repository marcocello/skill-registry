# Portal motion continuity

## Outcome

Skill Registry feels like one continuous workspace: the shell stays fixed, each destination replaces the previous page cleanly, controls acknowledge presses immediately, and scrolling has one predictable owner.

## Accepted behavior

- Route changes replace the outgoing page before a short destination-only CSS reveal begins; an outgoing route snapshot never overlaps the destination.
- Forward and backward destinations reveal from opposite directions so hierarchy and history remain legible.
- Routine route motion completes within 300 ms and never blocks interaction.
- Buttons and button-like controls respond while pressed with a small translation, scale, and inset-depth change; disabled controls do not animate.
- The shell main viewport owns scrolling for ordinary pages, resets synchronously to the top when the route changes, and never performs an animated scroll correction.
- The installed ReUI DataGrid remains the sole exception: its bounded table viewport owns Library row scrolling and continues to drive the same shell feedback.
- Scrolling the shell main viewport or ReUI DataGrid viewport changes the shell header surface and advances a thin progress indicator.
- The header exposes distinct resting, scrolled, and actively-scrolling visual states without changing page geometry.
- Scroll feedback is scheduled through animation frames and settles shortly after input stops.
- `prefers-reduced-motion: reduce` disables route, button, and scroll animation while preserving navigation, scrolling, focus, and state feedback.

## Motion thesis

- Focal moment: the destination enters laterally inside the stable shell, with direction communicating forward or backward travel.
- Continuity: the shell stays fixed and only one route surface is ever visible; the outgoing page is removed before destination motion starts.
- Feedback: controls compress immediately and the shell reports scroll position without parallax or looping effects.
- Budget: transform, opacity, clip-path, and one small progress bar only; no new animation runtime or continuously running work.

## Boundaries

- Existing routes, authorization, data loading, ReUI DataGrid behavior, sorting, and filtering remain unchanged.
- Motion is presentation state only and is not persisted or sent to Flask.
- No route snapshot crossfade, parallax, scroll hijacking, elastic/bounce easing, auto-playing loop, or staged page-load choreography.
- The shell owns ordinary page scroll position; ReUI remains the owner of the Library data surface and its bounded row viewport. Generic buttons continue to use the existing shadcn primitive as required by ReUI guidance.

## Consumption target

The existing local portal at `http://127.0.0.1:5175` and the production Vite bundle built from `frontend/app`.
