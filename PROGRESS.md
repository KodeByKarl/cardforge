# Progress Log

## 2026-10-29 — Phases 1–3
- Environment: empty directory; Node 26.13, npm 11.20; CorelDRAW Graphics Suite v27.2 installed on the dev PC (no X7).
- Scaffolded Electron 33 + electron-vite + React 18 + TS strict + Tailwind 3 + ExcelJS + Vitest + electron-builder.
- Built the import module end to end (parse → header detection → column setup → normalise → validate → table/issues UI).
- Settings (validated, atomic), structured logging, CorelDRAW detection (registry → server exe, stale detection).
- CorelDRAW PoC script passes on v27.2. Found and documented three PowerShell/COM pitfalls.
- Adapter interface + mock adapter for development.
- 42 unit tests passing; the app was driven end to end over CDP with a fixture workbook.
- Dev-environment workarounds (see README): Electron zip extraction under Node 26; `ELECTRON_RUN_AS_NODE` inherited from VS Code.

**Blocked on client:** X7 PoC run, real template, real spreadsheet, print specs (REQUIREMENTS.md).
**Next:** Phase 4: PowerShell bridge (`inspectTemplate`), template setup + mapping screen.

## 2026-10-29: Phases 4 and 5 (verified on CorelDRAW v27.2; X7 pending)
- Probed the real CorelDRAW object model: enum constants read from the v27 type library; members listed via COM.
- Built `corel-bridge.ps1` (persistent COM worker) + `BridgeProcess` + `PowerShellCorelAdapter`, behind the existing adapter interface.
- Template library, mapping editor, CorelDRAW-rendered preview (single/grid, front/back, zoom, search, navigation), generation engine, job history, dashboard.
- Findings from real CorelDRAW that changed the design: page export crops to content (fixed with an export area); font drift after CJK text (fixed with undo per record); last-saved file locked (deferred rename); growing paragraph frames never overflow (card-edge check). See CORELDRAW_INTEGRATION.md §4.
- A probe that would have closed unsaved CorelDRAW documents was blocked by the permission system. The rule "only touch our own documents" is now in the bridge.
- Tests: 95 unit, 9 integration (real CorelDRAW), 16-step E2E in the real app. Typecheck and build pass.
- Dev-PC housekeeping: four orphaned, unsaved `Untitled-1..4` documents from failed early probe runs sat in a hidden CorelDRAW automation instance. They were left alone, pending the user's decision.

**Blocked on client:** X7 validation run, real template, real spreadsheet, print specs.
**Next:** Phase 6, after the X7 results.
