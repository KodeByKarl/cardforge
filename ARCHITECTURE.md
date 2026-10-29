# Architecture

## Overview

```
┌──────────────────────────────── Electron app ──────────────────────────────────┐
│ Renderer (React, sandboxed, no Node)                                            │
│   screens/  Import · Template setup · Card preview · Generate · Dashboard · …   │
│   state/    job (import) · templates (library + mapping) · generation (progress)│
│   shared/   import pipeline · mapping · navigation · file naming (pure TS)       │
│         │ window.cardforge (typed API, src/shared/ipc.ts)                       │
│ Preload (contextBridge; invoke-only + one filtered progress event)              │
│         │ IPC — every channel validates sender and arguments                    │
│ Main process                                                                    │
│   ipc.ts · validation.ts · settings.ts · logger.ts                              │
│   services/excel      ExcelJS + CSV reader                                      │
│   services/templates  TemplateStore (library, mappings, page thumbnails)        │
│   services/preview    PreviewService (CorelDRAW renders, LRU cache)             │
│   services/generation GenerationService (job runner) · JobHistory               │
│   services/corel      CorelService → CorelAdapter ─┬─ PowerShellCorelAdapter    │
│                                                    └─ MockCorelAdapter (tests)  │
└────────────────────────────────────────────────────┬───────────────────────────┘
                              BridgeProcess: Base64 JSON lines over stdio
                                    powershell.exe resources/corel/corel-bridge.ps1
                                                     │ COM (out-of-process)
                                              CorelDRW.exe /Automation
```

The CorelDRAW boundary is the `CorelAdapter` interface: connect, open/close document, inspect, apply text, export
pages, save. Services only use these primitives, so the real adapter and the test mock are interchangeable.
The mock is imported only by tests. See [CORELDRAW_INTEGRATION.md](CORELDRAW_INTEGRATION.md).

## Security model

- `contextIsolation`, `sandbox`, `webSecurity` on; `nodeIntegration` off; strict CSP; navigation and new windows blocked.
- The renderer can only call the named operations in `CardForgeApi`. The progress listener receives only the
  payload, never the IPC event object.
- IPC handlers reject frames that aren't our bundle or dev server, and validate every argument
  (`src/main/validation.ts`, `parseSavedMapping`, settings sanitiser): ids are UUIDs, paths absolute with allowed
  extensions, values bounded in size, dpi bounded, batch size ≤ 5000.
- `excel:readSheet` only reads files opened in this session. "Open folder/file" only opens paths recorded in the
  job history, never arbitrary paths from the renderer.
- External processes are started with argument arrays only (`reg.exe`, `powershell.exe`); never through a shell.
- Template library paths are derived from validated UUIDs and checked to stay inside the library root.

## Data flow

1. **Import:** spreadsheet → string grid (main) → header detection, column setup, normalisation, validation (renderer).
2. **Template:** `.cdr` → copied into the library and hashed → CorelDRAW inspects a throwaway copy (pages, named
   text objects incl. groups, bounds, fonts, paragraph/mixed flags) and exports page thumbnails.
3. **Mapping:** object name → `column` (by header label, so it is reusable with future sheets) | `keep` | `blank`.
   Auto-match by normalised name plus synonyms. Saved per template in `meta.json`.
4. **Preview:** record → values → `preview:render` → one working copy per template held open → apply (undo
   previous record first) → export pages at zoom-dependent dpi → data URLs + overflow metrics.
5. **Generate:** plan (file names, conflicts) → operator resolves conflicts → job: open a working copy once, per
   record apply → save temp → deferred move into place → progress events → report JSON + history.

## Storage

| What | Where |
|---|---|
| Settings | `%APPDATA%\CardForge\settings.json` (atomic writes) |
| Template library | `%APPDATA%\CardForge\templates\<uuid>\{template.cdr, meta.json, pages\page-pN.png}` |
| Job history | `%APPDATA%\CardForge\jobs.json` (last 50) |
| Logs | `%APPDATA%\CardForge\logs\app-YYYY-MM-DD.log` (JSON lines) |
| Working copies, preview temp | `%TEMP%\CardForge\{work,preview}` (deleted after use) |
| Generated cards + report | operator-chosen output folder |

`CARDFORGE_USER_DATA` overrides the data folder (used by automated end-to-end runs).

## Directory structure

```
src/shared/      types, IPC contract; import/, template/ (types, mapping), preview/ (navigation), generation/ (naming)
src/main/        index (wiring, shutdown), ipc, validation, settings, logger, paths, errors
  services/      excel/, corel/, templates/, preview/, generation/, fsutil
src/preload/     contextBridge API
src/renderer/    React UI: screens/, components/, state/
resources/corel/ corel-bridge.ps1 (shipped outside app.asar)
scripts/         corel-poc.ps1, make-test-template.ps1, make-sample-workbook.mjs
tests/           unit tests (Vitest) · tests/integration (real CorelDRAW) · fixtures
```

## Key decisions

| Decision | Reason |
|---|---|
| PowerShell COM bridge | No native add-ons; crash isolation; ships with Windows |
| Previews rendered by CorelDRAW | Only way to show the real design and real text metrics; no HTML imitation |
| Undo-based record reset | Replacement keeps current formatting and CorelDRAW auto-substitutes fonts; undo restores the exact template state |
| Library copy of templates | Originals are never opened by CorelDRAW; detects when the original changes |
| Mapping by header label | Reusable across future spreadsheets with the same headers |
| One CDR per record, X7 format | Editable output X7 can open; imposition waits for print specs |
| Deferred rename | CorelDRAW locks the last-saved file; still never leaves partial files under final names |
