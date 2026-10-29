# Development Plan

## Phase 1 — Technical feasibility ✅ (X7 run pending, client-side)
PoC script passes on CorelDRAW v27.2. Integration risks documented.

## Phase 2 — Application foundation ✅

## Phase 3 — Excel processing ✅

## Phase 4 — Template setup and preview ✅ (verified on v27; X7 pending)
- [x] Probe of the real CorelDRAW object model: type-library constants and members (CORELDRAW_INTEGRATION.md §3)
- [x] Persistent PowerShell COM bridge + `BridgeProcess` client (timeouts, crash restart, generations)
- [x] Template library: import by picker/drop, copy + hash, CorelDRAW inspection, thumbnails, re-inspect, remove, changed-original detection
- [x] Mapping editor with auto-match, keep/blank, object outlines on the page image, autosave, issues
- [x] CorelDRAW-rendered preview: single + grid, front/back, zoom/fit/actual size, search, navigation, missing/overflow panel
- [x] Front/back test fixture built by CorelDRAW (`scripts/make-test-template.ps1`)
- [x] Unit tests (mapping, navigation, bridge client, services) and integration tests on real CorelDRAW

## Phase 5 — CorelDRAW generation ✅ on v27 (X7-specific behaviour pending validation)
- [x] Job runner: plan, conflicts (ask/skip/suffix/overwrite), one job at a time, cancel, per-record errors, crash recovery
- [x] Undo-based reset between records (fixes font drift after CJK text)
- [x] Deferred rename (CorelDRAW locks the last-saved file)
- [x] Report JSON, job history, dashboard, open folder / open file
- [ ] Benchmark 100 / 500 records **on the client PC with X7**

## Phase 6 — Testing and packaging (next)
1. **Client:** X7 validation procedure (CORELDRAW_INTEGRATION.md §8). This gates everything below.
2. Fix any X7 differences found; re-run `npm run test:corel` on X7.
3. Build the NSIS installer; install/uninstall test on a clean Windows VM (PowerShell execution, bridge outside asar).
4. User guide with screenshots; operator checklist (close CorelDRAW dialogs, fonts installed).
5. Optional: PDF export, imposition (needs print specs), template rename UI.

## Next three actions
1. Client runs the X7 validation and sends the real template + spreadsheet.
2. Address X7 findings.
3. Installer build and clean-machine test.
