# CardForge

Windows desktop app that turns an employee spreadsheet into personalised, editable CorelDRAW calling cards
using the client's existing CorelDRAW templates: **import → map → preview → generate → print from CorelDRAW**.

> **Status: Phases 1–5 built and verified on CorelDRAW v27.2. Not production-ready.**
> The client uses CorelDRAW **X7**, and nothing has been verified on X7 yet. Production readiness requires the
> X7 validation in [CORELDRAW_INTEGRATION.md §8](CORELDRAW_INTEGRATION.md#8-x7-validation-procedure-required-before-production)
> to pass on the client's computer. Installer and user guide are Phase 6.

## Workflow

1. **Excel import**: drop an `.xlsx`/`.csv`, pick the worksheet, check the header row and columns, review issues.
2. **Template setup**: add a `.cdr` (picker or drop). CardForge keeps its own copy and asks CorelDRAW to list the
   named text objects (Object Manager names, including inside groups). Map each object to a column, or keep its
   template text, or leave it blank. "Auto-match" fills obvious matches. Mappings are saved per template.
3. **Card preview**: cards rendered **by CorelDRAW** from the real template. Single view (front/back, zoom,
   actual size, search, ← → navigation, missing-field and overflow warnings) or grid view.
4. **Generate**: one editable CDR per valid record (X7 file format) into the chosen folder. You are asked before
   any existing file is overwritten. Progress, cancel, per-record log, and a JSON report.
5. Open the output in CorelDRAW, review, and print. CardForge never prints.

## Requirements

- Windows 10/11 x64, Windows PowerShell 5.1 (preinstalled)
- CorelDRAW with COM automation: **X7 (v17) is the target**; newer versions are used for development
- Node.js 20/22 LTS for development

## Setup (development)

```powershell
npm install
npm install-scripts approve electron esbuild   # npm 11+ blocks install scripts by default
npm rebuild electron esbuild
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm test` | Unit tests (no CorelDRAW needed) |
| `npm run test:corel` | Integration tests against the CorelDRAW installed on this PC (skipped if none) |
| `npm run typecheck` | Strict TypeScript, main + renderer |
| `npm run build` | Production bundle into `out/` |
| `npm run dist` | Typecheck, test, build, NSIS installer into `release/` (not yet validated) |
| `node scripts/make-sample-workbook.mjs` | Regenerate the sample spreadsheet fixture |
| `powershell -File scripts/make-test-template.ps1 -ProgIdVersion 27` | Regenerate the front/back CDR fixture with CorelDRAW |
| `powershell -File scripts/corel-poc.ps1 -CreateTestTemplate` | Standalone CorelDRAW automation check (X7 by default) |

### Environment notes

- **Node 26:** Electron 33's binary download stops partway through extraction. Extract the cached zip manually:
  ```powershell
  $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter 'electron-v33.2.1-win32-x64.zip' | Select-Object -First 1
  Expand-Archive $zip.FullName node_modules\electron\dist -Force
  Set-Content node_modules\electron\path.txt 'electron.exe' -NoNewline
  ```
- **VS Code terminals** may set `ELECTRON_RUN_AS_NODE=1`; clear it before `npm run dev`.
- `CARDFORGE_USER_DATA=<folder>` runs the app with a separate data folder (used for automated end-to-end runs).

## Preparing a template (designer)

Name every variable text object in CorelDRAW's Object Manager (`FullName`, `JobTitle`, `Email`, …). Page 1 is the
front, page 2 the back. Keep each variable object in one formatting: replacing text applies a single
formatting to the whole object. See [CORELDRAW_INTEGRATION.md §7](CORELDRAW_INTEGRATION.md#7-template-convention-for-the-clients-designer).

## Known limitations

- **X7 not verified** (all CorelDRAW features verified on v27.2 only).
- Overflow detection covers paragraph frames and the card edge/safety margin, not collisions with other artwork.
- Mixed formatting inside one variable object is flattened on replacement (flagged in Template setup).
- Master-page objects are not searched; PowerClip contents are searched but untested.
- Only `.xlsx`/`.csv` (re-save `.xls`). Limits: 50 MB, 20,000 rows, 200 columns per sheet.
- No PDF export, imposition, or bleed/crop marks yet (need print specs).
- Modal dialogs in CorelDRAW (missing fonts, recovery) can block automation until dismissed; calls time out and recover.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [REQUIREMENTS.md](REQUIREMENTS.md) · [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) ·
[CORELDRAW_INTEGRATION.md](CORELDRAW_INTEGRATION.md) · [TEST_REPORT.md](TEST_REPORT.md) · [PROGRESS.md](PROGRESS.md)
