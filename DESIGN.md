# Lattice Notes — Editorial instrument

## Intent and voice
A personal writing desk, not a dashboard. A place to write, connect and return to ideas. Product name remains **Lattice Notes**. Brand promise: **Your thoughts. In good company.** Supporting copy explains local browser storage honestly; never imply cloud sync or filesystem access.

## Visual identity
- Warm paper writing surfaces, ink-dark navigation, copper interaction accents. Original interlaced-line mark, also used in favicon/onboarding. No gradients, glass, stock photography, decorative charts or marketing hero inside the workspace.
- Editorial serif for reading/document titles; native sans for compact controls; native mono for Markdown. No remote font dependency. The memorable moment is a generous paper-like document beside a precise dark index.
- Flat surfaces and fine rules; one 4px control radius; 4/8/12/16/24/32/48 spacing. Use existing typography sizes with increased document hierarchy rather than inventing a new number per component.

## Token contract
Primitive tokens define paper #f6f3ec, white #fffdf8, ink #242924, muted #62665e, copper #99512e and dark #202923. Semantic tokens map existing --color-* names onto light surfaces; dark index/header locally override those semantic tokens with high-contrast equivalents. Component rules consume semantic tokens, never repeat raw colors. Accent is for selection/action, not large decorative fills.

## Surfaces
Onboarding is an intentional two-part welcome plus labelled setup form, with local-first reassurance. Workspace has compact branded chrome, a dark note index, spacious paper document, quiet context rail, clear tabs/mode controls and status. Search, note actions, empty/trash/error states share that vocabulary. Native palette/switcher/vault/calendar dialogs use paper, ink, copper, shared headers/rules/inputs/results. Fullscreen graph adopts matching warm geometry/background, restrained controls and readable list. Metadata, favicon and installed-app colors match.

## Non-negotiables
Preserve current five-file uncommitted refinement, every handler/accessible name, keyboard/focus/IME, mounted editor selection/scroll, responsive panels, graph controls and storage safety. No persistence/domain changes, runtime dependencies, remote fonts, data deletion or publishing. Prior dark design clauses are superseded only for visual identity, not behavior. All current features stay discoverable at 320px. Mobile controls >=44px; visible keyboard focus; WCAG AA text contrast; reduced motion. Motion only short opacity/transform, never continuous decoration.

## Acceptance
All product surfaces coherently restyled, not merely root colors. Existing tests and production build pass; actual 1440x900, 390x844 and 320x844 screenshots inspected. Fresh-context onboarding/workspace/mode/palette/switcher/manager/calendar/graph scans and keyboard interactions, no overflow or console errors. Independent diff review, fix blocking findings. Preserve evidence and local preview.

## Skill synthesis
Brand/design/stitch define this source of truth; design-system supplies primitive→semantic→component tokens; minimalist-ui supplies flat calm composition; ui-styling uses existing native React/CSS, not new libraries. ui-ux-pro-max lookup supports warm minimalist direction, but its marketing layout and Poppins pairing are rejected for this editor. gpt-taste motion/layout principles apply only where useful: no GSAP, AIDA, random page sections or oversized heroes in a writing tool. design-taste-frontend's marketing patterns do not override dense-product usability. Ponytail preserves native controls and working behavior.
