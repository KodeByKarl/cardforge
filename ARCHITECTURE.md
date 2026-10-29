# Architecture

## Overview

```
┌──────────────────────────── Electron app ─────────────────────────────┐
│ Renderer (React, sandboxed, no Node)                                  │
│   screens/ → state/job.tsx → shared/import/* (pure parsing/validation)│
│         │ window.cardforge (typed API, src/shared/ipc.ts)             │
│ Preload (contextBridge, ipcRenderer.invoke only)                      │
│         │ IPC — every channel validates sender + arguments            │
│ Main process (Node)                                                   │
│   ipc.ts · settings.ts · logger.ts · paths.ts                         │
│   services/excel/excelReader.ts  (ExcelJS, CSV)                       │
│   services/corel/detect.ts       (registry → server exe)              │
│   services/corel/CorelAdapter.ts (interface) ── MockCorelAdapter      │
│                                             └─ PowerShell bridge (P5) │
└───────────────────────────────────────────┬───────────────────────────┘
                                            │ JSON lines over stdio (Phase 5)
                              powershell.exe corel-bridge.ps1
                                            │ COM (out-of-process)
                                     CorelDRW.exe /Automation
```

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Strict CSP in `src/renderer/index.html` (no remote origins, no inline scripts).
- Navigation and new windows are blocked; only `https://` links go to the system browser.
- The renderer can only call the named operations in `CardForgeApi`. No generic fs, shell, or IPC passthrough.
- IPC handlers reject calls from frames that aren't our bundle or dev server.
- File paths are validated in main: absolute, no device/UNC-`\\?\` paths, no NUL, allowed extensions, size limit.
- `excel:readSheet` only accepts files previously opened through `excel:open` in the same session.
- Settings are validated field by field on load and on update, and written atomically (temp file + rename).
- External processes are started with `execFile`/argument arrays only, never through a shell.

## Error handling

- Main converts `AppError` into `{ ok: false, error: { code, message } }` with an operator-facing message.
  Unexpected errors return a generic message and are logged with stack traces.
- Structured JSON-lines logs: `%APPDATA%\CardForge\logs\app-YYYY-MM-DD.log`.
- React error boundaries per screen; a crash in one screen doesn't take down the app.
- Failed records are never silently dropped: validation issues carry the spreadsheet row number.

## Data flow (import)

1. Drop/pick file → preload resolves its path (`webUtils.getPathForFile`) → `excel:open` validates and lists visible sheets.
2. `excel:readSheet` returns a string grid (max 20,000 rows × 200 columns; truncation is reported).
   Cell conversion handles rich text, hyperlinks, formulas (cached result), dates (ISO), zero-padded number formats, and merged cells.
   CSV: RFC 4180 parser, delimiter detection (`,` `;` tab), UTF-8 with Windows-1252 fallback.
3. Renderer: `detectHeaderRow` → `buildColumns` (user can override header row, include/exclude, type, required, duplicate key)
   → `buildDataset` (normalisation) → `validateDataset` (required, email, phone, length heuristics, duplicates).

## Preview strategy (Phase 4)

An HTML imitation of the card is not acceptable. Planned approach:
1. Through the bridge, inspect the template: page size, named text objects with bounds, fonts, sizes.
2. Export the template **with the mapped text objects emptied** as a high-resolution PNG (working copy only).
   That gives a pixel-accurate background of everything static.
3. Overlay record text at the inspected positions, using the template's fonts when installed. This is an approximation of CorelDRAW's text engine.
4. **Verification:** "Render in CorelDRAW" exports the true result for selected records; the app shows both side by side.
   Overflow warnings come from CorelDRAW-side measurement, not from the browser.

## Directory structure

```
src/
  shared/            types, IPC contract, pure import pipeline (no Node/DOM)
    import/          csv, normalize, headers, dataset, validate
  main/              Electron main process
    services/excel/  ExcelJS + CSV reader
    services/corel/  detection, adapter interface, mock adapter (bridge in Phase 5)
  preload/           contextBridge API
  renderer/          React UI (index.html, src/screens, src/components, src/state)
resources/corel/     bridge scripts bundled into the installer (Phase 5)
scripts/             corel-poc.ps1 (feasibility PoC), sample workbook generator
tests/               Vitest suites + fixtures
```

## Key decisions

| Decision | Reason |
|---|---|
| electron-vite | One build for main/preload/renderer with HMR. |
| ExcelJS in main | Needs Node fs; keeps the parser away from the sandboxed renderer. |
| Own CSV parser | Explicit control over BOM, encoding fallback, delimiter detection; tiny and fully tested. |
| Validation in shared pure TS | Instant re-validation as the user changes column settings; testable without Electron. |
| PowerShell COM bridge | No native addons; crash isolation; ships with Windows. See CORELDRAW_INTEGRATION.md. |
| One CDR per record (initial) | Simplest, robust, matches "editable output". Multi-up imposition waits for print specs. |
