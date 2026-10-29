# Requirements

Status legend: ✅ done and tested · 🟡 partial · ⏳ planned · ❓ needs client input

## Functional

| # | Requirement | Status |
|---|---|---|
| F1 | Drag-and-drop `.xlsx` / `.csv` import, file-picker fallback | ✅ |
| F2 | Worksheet selection (hidden sheets excluded) | ✅ |
| F3 | Automatic header detection, user override | ✅ |
| F4 | Column setup: include, type (text / multi-line / email / phone), required, duplicate key | ✅ |
| F5 | Normalisation (whitespace, invisible chars, NFC, email case); phone digits never reformatted | ✅ |
| F6 | Missing-field, invalid email/phone, long-value, duplicate detection with row numbers | ✅ |
| F7 | Import summary and searchable/filterable records table | ✅ |
| F8 | CDR template selection and inspection of named text objects | ⏳ Phase 4 |
| F9 | Map columns to template text objects | ⏳ Phase 4 |
| F10 | Card preview (single/grid, zoom, navigation, search, missing-data & overflow warnings, real dimensions) | ⏳ Phase 4 |
| F11 | Batch generation of editable CDR files with progress, cancel, logs, counts | ⏳ Phase 5 |
| F12 | Output folder, safe file naming, overwrite policy, output summary, open folder / open in CorelDRAW | 🟡 settings + filename sanitiser done; generation Phase 5 |
| F13 | Optional PDF export | ⏳ after CDR is verified; never substitutes for CDR |
| F14 | Printing | Out of MVP scope. Operator prints from CorelDRAW. No automatic print jobs. |
| F15 | CorelDRAW installation detection | ✅ (verifies server exe exists, flags stale registrations) |

## Non-functional

| Requirement | Status |
|---|---|
| Windows 10/11 x64, runs fully offline, no cloud services | ✅ by design |
| Secure Electron configuration (see ARCHITECTURE.md) | ✅ |
| Original templates never modified | ✅ in PoC (hash-verified); enforced in bridge design |
| 100–500 records per batch | Import: 500 rows validated in < 0.5 s (tested). Generation: not benchmarked. |
| Structured logs | ✅ |
| Windows installer | 🟡 electron-builder NSIS config present; not yet built/tested |

## Missing client assets and decisions ❓

These block Phases 4–5 or affect their design. Please provide:

1. **The real CDR calling card template(s)**, front and back if applicable, saved from X7.
2. **Exact CorelDRAW version and edition**: Help → About (e.g. "CorelDRAW Graphics Suite X7, 17.x.x.xxx, 64-bit"), and whether VBA was installed.
3. **Run of `scripts/corel-poc.ps1` on the production PC** (see CORELDRAW_INTEGRATION.md §6), with its JSON report.
4. **A real (or anonymised) employee spreadsheet** in the format HR actually sends.
5. **Which fields appear on the card** and which are mandatory (e.g. is Telephone optional? Address one or two lines?).
6. **Fonts used** in the template (font files or names), confirmed installed on the production PC.
7. **Output layout**: one CDR per employee, or N cards imposed per sheet (which sheet size, how many up)?
8. **Print specs**: card size (e.g. 3.5 × 2 in / 90 × 50 mm / 89 × 51 mm), bleed, crop marks, colour mode (CMYK?), printer/RIP.
9. **File naming convention** for outputs and the output folder location.
10. **Rules for long names/titles**: shrink font, allow two lines, or flag for manual edit?
11. **Phone formatting rules**, if any (the app currently keeps phone text exactly as typed).
12. **PC specs** of the production machine (Windows version, RAM), to set performance expectations.
