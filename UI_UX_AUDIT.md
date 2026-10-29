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

## Verification

- `npm run typecheck`: clean.
- `npx vitest run`: 8 files, 101 tests pass (adds `tests/workflow.test.ts`).
- `npm run test:e2e` (`tests/e2e/run.mjs`, real Electron + real CorelDRAW 27): navigation and shortcuts, empty/error states, import workflow, tab keyboard support, template inspect, mapping, dialog focus trap, preview zoom/navigation/grid/inspector, theme, settings, real batch generation, cancel dialog, overwrite dialog, then a layout probe (document overflow, controls outside the window, clipped button labels, overlapping toolbar controls) on all six screens at 800×480, 910×512, 1024×768, 1093×614, 1280×720, 1366×768, 1440×900, 1920×1080, 2560×1440 in light and dark.
  - Last complete run: 35/41, the 6 failures being two test-script bugs and the Settings overflow (#10/#11), all fixed afterwards.
  - After those fixes the non-CorelDRAW subset (layout at all sizes/themes, navigation, import, keyboard, theme, settings) passed 29/30; the one failure is the dialog test, which needs a template and therefore CorelDRAW.
- `tests/e2e/real-resize.mjs` resizes the real window with Win32 and confirms the layout follows (4 sizes, all matched). The e2e suite itself emulates viewport sizes (Electron does not support `Browser.setWindowBounds`), so it must not be left running when judging resizing by hand.

## Not verified / limitations

- A full e2e re-run **after** the last two fixes could not complete: a stale CorelDRAW process left by an interrupted run blocked template inspection. The CorelDRAW-dependent tests (template, mapping, dialog, preview, generation) need a re-run once CorelDRAW is closed: `npm run build && npm run test:e2e`.
- The two-pane Template layout from 1024 px was added after the last screenshots of that screen; it has not been re-inspected visually.
- Windows scaling 125 %/150 %: the suite supports `E2E_SCALE=1.25` (Chromium `--force-device-scale-factor`) but it was not run; equivalent CSS-pixel sizes (1093×614, 910×512) were. Real Windows display settings were not changed.
- CorelDRAW integration tests (`npm run test:corel`) and the production build were not re-run for this change set beyond `npm run build`.
- Everything was tested on CorelDRAW 27, not X7.
