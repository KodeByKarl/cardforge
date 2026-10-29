# CardForge

Windows desktop app that turns an employee spreadsheet into personalised, editable CorelDRAW calling cards,
using the client's existing CorelDRAW X7 templates.

> **Status: Phases 1–3 of 6.** Excel import, validation, settings and CorelDRAW detection work.
> Template mapping, preview and CDR generation are **not built yet**. CorelDRAW automation has been proven on
> CorelDRAW v27 but **not on X7**. See [CORELDRAW_INTEGRATION.md](CORELDRAW_INTEGRATION.md) and [TEST_REPORT.md](TEST_REPORT.md).

## Requirements

- Windows 10/11 x64
- Node.js 20 or 22 LTS for development (Node 26 works with the workaround below)
- CorelDRAW X7 (version 17) on the production PC, for generation (Phase 5)

## Setup

```powershell
npm install
npm install-scripts approve electron esbuild   # npm 11+ blocks install scripts by default
npm rebuild electron esbuild
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Strict TypeScript check of main + renderer |
| `npm run build` | Production bundle into `out/` |
| `npm run dist` | Typecheck, test, build, then the NSIS installer into `release/` |
| `node scripts/make-sample-workbook.mjs` | Regenerate `tests/fixtures/sample-employees.xlsx` |

### Development environment notes

- **Node 26: Electron's binary download stops partway through extraction** (`node_modules/electron/dist` contains only `locales`).
  Fix: extract the cached zip yourself:
  ```powershell
  $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter 'electron-v33.2.1-win32-x64.zip' | Select-Object -First 1
  Expand-Archive $zip.FullName node_modules\electron\dist -Force
  Set-Content node_modules\electron\path.txt 'electron.exe' -NoNewline
  ```
  Using Node 22 LTS avoids this.
- **Launched from a VS Code terminal, Electron may start as plain Node** (`Cannot read properties of undefined (reading 'requestSingleInstanceLock')`)
  because `ELECTRON_RUN_AS_NODE=1` is inherited. Clear it first: `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## Using it (current build)

1. **Excel import**: drop an `.xlsx`/`.csv` file (or Browse). Pick the worksheet; check the detected header row.
2. **Columns** tab: include/exclude columns, set each column's type, mark required columns and the duplicate key.
3. **Records** / **Issues** tabs: search, filter to problem rows, fix the spreadsheet, then re-import.
4. **Settings**: check CorelDRAW detection, choose the output folder and overwrite policy.

## CorelDRAW proof of concept

`scripts/corel-poc.ps1` proves CorelDRAW automation on any PC: it opens a template copy, replaces a named
text object, saves an editable CDR in X7 format, reopens it to verify, and confirms the template is unchanged.
Instructions: [CORELDRAW_INTEGRATION.md §6](CORELDRAW_INTEGRATION.md#6-running-the-poc-on-the-clients-machine-required-before-phase-5).

## Known limitations

- Only `.xlsx` and `.csv`. Legacy `.xls` must be re-saved as `.xlsx`.
- Limits: 50 MB file, 20,000 rows, 200 columns per sheet (truncation is reported).
- Long-value warnings are character-count heuristics. Real overflow is checked against the template in Phase 4.
- Changing the header row resets column settings.
- Column settings are not yet saved between sessions.
- No template, preview, generation, or PDF yet. Printing is always done by the operator from CorelDRAW.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [REQUIREMENTS.md](REQUIREMENTS.md) · [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) ·
[CORELDRAW_INTEGRATION.md](CORELDRAW_INTEGRATION.md) · [TEST_REPORT.md](TEST_REPORT.md) · [PROGRESS.md](PROGRESS.md)
