# Development Plan

## Phase 1 — Technical feasibility ✅ (except client-side X7 verification)
- [x] Inspect environment (Node 26, npm 11, Windows 11; CorelDRAW v27 present, X7 absent)
- [x] Architecture defined (ARCHITECTURE.md)
- [x] Excel parsing proof of concept → became the production import module
- [x] CorelDRAW text-replacement PoC (`scripts/corel-poc.ps1`): **PASS on v27.2**
- [x] Integration risks documented (CORELDRAW_INTEGRATION.md)
- [ ] **Run PoC on client's X7 machine** ← gate for Phase 5

## Phase 2 — Application foundation ✅
- [x] Electron + React + TypeScript (strict) + Vite + Tailwind
- [x] Secure IPC with typed contract, sender + argument validation
- [x] App shell, navigation, Dashboard, Settings (CorelDRAW detection, output folder, overwrite policy, naming pattern)
- [x] Structured logging, error boundaries
- [x] Vitest infrastructure

## Phase 3 — Excel processing ✅
- [x] Drag-and-drop + picker, worksheet selection, header detection
- [x] Column setup, normalisation, validation, duplicates, searchable table, issues list

## Phase 4 — Template and preview (next, prioritised)
1. `corel-bridge.ps1` persistent worker + `PowerShellCorelAdapter` (inspect + export commands only first)
2. Template selection screen; list named text objects; map columns → objects; save mapping per template
3. Background export (mapped text emptied) + overlay preview; single + grid view, zoom, navigation, search
4. "Render in CorelDRAW" verification for chosen records; overflow measurement via CorelDRAW
5. Tests: bridge protocol (with a fake bridge process), mapping logic, preview geometry

## Phase 5 — CorelDRAW generation
1. `beginBatch / generateOne / endBatch` in the bridge; template copied to temp, opened once per batch
2. Job runner in main: queue, single active job lock, per-record timeout, cancel between records, crash restart
3. Output naming from pattern, overwrite policy, output summary, open folder / open in CorelDRAW
4. Job history on the Dashboard
5. Benchmark 100 / 500 records **on client PC**

## Phase 6 — Testing and packaging
- Integration tests against real CorelDRAW (gated, run on a machine with CorelDRAW)
- End-to-end UI tests (CDP-driven like the Phase 3 verification)
- X7 compatibility test pass on the client PC
- NSIS installer build, install/uninstall test on a clean Windows VM
- User guide with screenshots

## Order of the next three actions
1. Client: run `corel-poc.ps1` on X7 and send template + spreadsheet (REQUIREMENTS.md, "Missing client assets").
2. Dev: build the bridge's `inspectTemplate` against the client's real template.
3. Dev: Template setup screen + mapping.
