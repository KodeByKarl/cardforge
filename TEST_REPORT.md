# Test Report

Last run: 2026-10-29 · Windows 11 · Node 26.13 (tests) · Electron 33.2.1 (app)

## Automated — `npm test` (Vitest): 42 passed, 0 failed

| Suite | Tests | Covers |
|---|---|---|
| `tests/import.test.ts` | 26 | CSV (quotes, escaped quotes, embedded newlines, CRLF, BOM, `;`/tab delimiters, trailing empties); normalisation (whitespace, invisible chars, NFC, email, phone); header detection below title/blank rows; blank/duplicate header naming; field-kind guessing; **valid import; empty sheet; header-only sheet; missing required values; absent columns; duplicates (case-insensitive); long names; special characters (accents, quotes, `&`, `<>`, CJK)**; blank-row reporting; invalid email/phone; all columns excluded; 500-record validation < 0.5 s |
| `tests/excelReader.test.ts` | 9 | Visible-sheet listing; rich text, hyperlinks, formulas, dates, zero-padded numbers; merged cells; empty worksheet; unknown sheet; UTF-8 and Windows-1252 CSV; **invalid formats (.xls, .txt), missing file, relative path, non-string path, empty file, corrupt .xlsx**; grid trimming |
| `tests/main.test.ts` | 7 | File-name sanitising (reserved names, illegal chars, length, Unicode); path safety; settings validation and atomic persistence; CorelDRAW LocalServer32 parsing; mock adapter (never writes .cdr, no overwrite, unknown objects, simulated failures, batch state) |

`npm run typecheck`: clean (strict, `noUncheckedIndexedAccess`). `npm run build`: succeeds.

## App-level verification (real Electron app, driven over Chrome DevTools Protocol)

Built app launched; `tests/fixtures/sample-employees.xlsx` dropped onto the drop zone via a simulated OS file drop.

| Check | Result |
|---|---|
| Preload API present, `require` not exposed to renderer | ✅ |
| Header row auto-detected as row 3 (title + blank row above) | ✅ |
| 8 records · 4 ready · 3 warnings · 1 error · 1 duplicate group · 1 blank row skipped | ✅ matches the fixture's planted problems |
| Issues list: missing name (row 7), long name/title (row 8), bad phone + email (row 10), duplicate of row 4 (row 11) | ✅ |
| Settings: CorelDRAW detection reports "v27 installed, not X7" | ✅ |
| Light and dark themes render | ✅ |
| Renderer console errors / exceptions | none |

## CorelDRAW PoC — `scripts/corel-poc.ps1`

| Environment | Result |
|---|---|
| CorelDRAW **v27.2.0.135**, Windows PowerShell 5.1, save format v17 | **PASS**, all 5 steps + template-hash check (see CORELDRAW_INTEGRATION.md) |
| CorelDRAW **X7** | **NOT RUN — no X7 available.** Required on the client PC. |

## Not yet tested

- Anything on CorelDRAW X7. CorelDRAW automation failures, crashes, modal dialogs.
- Template inspection, preview, generation, batch cancellation, repeated jobs, failed output saving (Phases 4–5 not built).
- Installer build and install on a clean machine.
- Very large workbooks near the 50 MB / 20,000-row limits (truncation logic is unit-tested on CSV only).

**This build is not production-ready.** Phases 4–6 remain, and real X7 integration is unverified.
