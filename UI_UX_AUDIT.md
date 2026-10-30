# UI/UX audit and redesign

## Baseline findings (before)

Screenshots of every screen at 1024×768 – 2560×1440, light and dark, were taken from the real Electron app.

| # | Finding | Fix |
|---|---|---|
| 1 | Card preview: fit zoom used a stale/default canvas size, cards were small and a horizontal scrollbar appeared at 1024×768. | Canvas size is measured with a ResizeObserver; Fit is recomputed on every resize. Front/back pick side-by-side or stacked, whichever makes the cards larger (`chooseLayout`). |
| 2 | Preview chrome (header, X7 banner, two toolbars, 72 px sidebar) left ~40 % of the height for the canvas. | One toolbar row; X7 notice moved to the status bar and details panel; details panel is collapsible and resizable (drag or ←/→). |
| 3 | Template setup: artwork and mapping stacked, so mapping needed a long scroll. | Two panes from 1024 px (artwork left, mapping right), each scrolling on its own; one column below that. |
| 4 | Colors were raw Tailwind `stone/teal` plus `dark:` variants in every file. | Single token layer (CSS variables) for both themes; no raw colors in components. |
| 5 | Inconsistent radii (lg/xl), 13.5 px body, ad-hoc `text-[11px]`. | Type scale 11/12/13/14/16/20, radii 2/3/4/6, fixed control height 28 px. |
| 6 | Confirmations were inline button swaps (remove template, cancel generation, overwrite). | Accessible modal `Dialog` (focus trap, Esc, focus return, never taller than the window). |
| 7 | Errors from "open folder" appeared as stray inline text. | Toasts (`role=status`/`alert`). |
| 8 | Min window 1024×680 is larger than a 1366×768 screen at 150 % scaling (910×512 DIP). | Min window 800×480, capped to the work area; layouts verified at that size. |
| 9 | No persistent project context; next step was not obvious. | Header shows `file → template`; a single contextual primary button (`nextAction`) tells the operator what to do next; rail shows per-step summary and completion. |
| 10 | Shell grid had an implicit auto row, so tall pages (Settings) pushed the document past the window height. | `grid-rows-[minmax(0,1fr)]`. |
| 11 | `sr-only` elements were positioned against the document and inflated its scroll height. | `main` is the containing block. |

## Design system

Defined in `src/renderer/src/index.css` (tokens) and `tailwind.config.js` (names, type scale, radii, dimensions, breakpoints).

- Surfaces: canvas < bg < rail < surface-2 < surface. Lines: `line`, `line-strong`. Text: `fg`, `fg-muted`, `fg-subtle`.
- One accent (viridian), status colors ok / warn / err each with a soft fill. Light and dark values are defined side by side; Settings → Appearance and the header toggle switch between System / Light / Dark.
- Dimensions: control 28 px, header 44 px, status bar 24 px, rail 208 px (48 px icon rail below 1100 px).
- Breakpoints on the CSS viewport: `compact` (<1100), `lg` (≥1024), `wide` (≥1280), `short` (<680 high).
- Identity: crop marks around every card on the pasteboard, numbered workflow rail, flat hairline-ruled sections instead of cards.

Components (`components/ui.tsx`): Button (loading), IconButton, Tooltip, Badge, Banner, Tabs (arrow/Home/End), Segmented (radiogroup), Dialog, Toast, Progress, EmptyState, Spinner, Kbd, `useElementSize`.

## Screens

Dashboard, Excel import (grouped issues with "Show row", sticky row column, one-line validation summary), Template setup (mapped/unmapped/missing status, Required/Optional per field, auto-match), Card preview (zoom, fit, 100 %, record navigation, search, grid with tile sizes, details panel, shortcuts `← → Home End + − 0 1 / G I`, Ctrl+wheel zoom), Generate (readiness checks, output, progress, counters, log, cancel and overwrite dialogs), Settings (theme, CorelDRAW, output, diagnostics with copy).

## Final verification (2026-10-29)

Environment: Windows 11, Electron 33.2.1 (Chromium 130), CorelDRAW 27.2 (not X7). A stale test-launched CorelDRAW instance (PID 19072, `/Automation -Embedding`, started by an interrupted run; the operator confirmed no unsaved work) was terminated; only that PID. A new empty automation instance (PID 1796) was activated by COM afterwards and was left alone.

### Exact results

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | success |
| `npx vitest run` | 8 files, **101/101** passed |
| `npm run test:corel` (real CorelDRAW integration) | 2 files, **9/9** passed |
| `npm run test:e2e` at 100 % scaling | **41/41** passed |
| `E2E_SCALE=1.25 npm run test:e2e` | **41/41** passed |
| `E2E_SCALE=1.5 npm run test:e2e` | **41/41** passed |
| `tests/e2e/real-resize.mjs` (real window, Win32 resize, 4 sizes) | all matched |
| Renderer console errors during e2e | none |

The e2e suite covers: navigation and shortcuts, empty/error/loading states, import (reject, corrupt file, records, grouped issues, Show row, tab keyboard, search), template inspection, mapping and persistence, dialog focus trap/Esc/focus return, preview (render, aspect ratio, zoom/fit/100 %, record keys, search, details panel resize, grid, tile size), theme, settings labelling, real batch generation (files verified on disk), cancel dialog, overwrite dialog, and the layout probe below. Nothing was skipped or disabled.

Layout probe (document overflow, controls outside the window, clipped button labels, overlapping toolbar controls, Fit overflowing its canvas, unusably small cards) runs on all six screens, light and dark, at 800×480, 910×512, 1024×768, 1093×614, 1280×720, 1366×768, 1440×900, 1920×1080 and 2560×1440, at each of the three scaling factors (the 100/125/150 % runs were all green).

### Screenshots inspected (by eye)

Template setup 1024×768 light and 800×480 light; Card preview 1366×768 dark and 2560×1440 dark (scale 100 %); preview grid; Excel import 1366×768 light and 1024×768 dark; Dashboard 1366×768 light; Generate 1366×768 dark, generate-complete state, overwrite dialog; Settings 1280×720 light, 1920×1080 dark at 150 %; Generate 800×480 dark at 125 %. Other combinations were covered by the automated probe, not inspected individually.

### Issues found in this round and fixed

1. Stale CorelDRAW process made template inspection time out (environment, resolved by terminating the confirmed test-only PID).
2. Settings left the right half of the window empty at 1280 px and wider (constrained `max-w-3xl`): now two columns on wide windows, labels above controls.
3. 1 px light line at the right edge of rendered cards (frame size rounded versus image aspect): images now `object-fill` in single and grid views.
4. Earlier in the redesign: implicit grid row and `sr-only` elements inflating document height (see table above), Template two-pane below 1280 px.

### Remaining limitations (unverified)

- **CorelDRAW X7 compatibility is unverified.** Everything was run on CorelDRAW 27 only.
- Windows scaling was applied through Chromium's device scale factor (`--force-device-scale-factor`), not by changing Windows display settings. Viewport sizes are emulated in the suite; the real-resize script covers true window resizing at four sizes.
- Tab order and screen-reader output were checked through automated roles, labels and focus assertions, not with a screen reader or full manual Tab-through.
- Contrast was judged visually in both themes; no automated contrast audit was run.
- Very large datasets (20,000 rows) were not re-tested visually; the table and issue lists are paged/capped (100 records per page, 200 issues per group).
- Unit tests cover only the pure workflow/layout logic; React components are covered by e2e, not component tests.
- Not started, by instruction: PDF export (the setting is still labelled "not built yet") and the Windows installer.

## Production readiness

The UI is stable and verified for the tested configuration (Windows 11, CorelDRAW 27) with no known open UI defects. It is **not** declared production-ready for the client until X7 compatibility is validated on the client's computer and PDF export and the installer are built and tested.

## Addendum: card-sheet screens (2026-10-30)

New screens (sheet template setup, sheet preview, sheet generation) follow the same design system. Verified by `npm run test:e2e:sheet` (24/24 at 100 %, 125 %, 150 %): no overflow, clipped or overlapping controls at 800×480, 1024×768, 1280×720, 1366×768 and 1920×1080 in light and dark; A4 aspect ratio preserved. Defects found and fixed: Fit was clamped at 25 % so an A4 sheet overflowed at 800×480 (Fit now goes down to 10 %); large counts lacked thousands separators; the portrait template artwork was tiny in the Template screen. Screenshots were taken with synthetic data only. 2560×1440 was not re-run for the new screens. CorelDRAW X7 remains unverified.
