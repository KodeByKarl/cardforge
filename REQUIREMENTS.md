# Requirements

Status: ✅ done and verified (on CorelDRAW v27 where CorelDRAW is involved) · 🟡 partial · ⏳ planned · ❓ needs client input.
**Every CorelDRAW-dependent ✅ means verified on v27.2; X7 validation is pending for all of them.**

## Functional

| # | Requirement | Status |
|---|---|---|
| F1 | Drag-and-drop `.xlsx` / `.csv` import, file-picker fallback | ✅ |
| F2 | Worksheet selection, header detection, column setup | ✅ |
| F3 | Normalisation and validation (missing, email, phone, long values, duplicates) with row numbers | ✅ |
| F4 | Searchable records table, issues list, import summary | ✅ |
| F5 | CDR template selection and management (local library, add by picker or drop, rename, remove, re-inspect, detect changed/missing original) | ✅ (rename is API-only, no UI yet) |
| F6 | Map Excel columns to named CorelDRAW text objects; keep / leave blank options; auto-match; issues | ✅ |
| F7 | Grouped and nested text objects | ✅ nested groups; PowerClip contents implemented, untested; master-page objects not supported |
| F8 | Realistic preview based on the actual template | ✅ rendered by CorelDRAW itself |
| F9 | Single and grid preview | ✅ |
| F10 | Front and back | ✅ (page 1 = front, page 2 = back; any number of pages) |
| F11 | Zoom, search, record navigation | ✅ fit, 25–400 %, actual size; accent-insensitive search; prev/next + arrow keys |
| F12 | Missing fields and overflow detection | ✅ missing from data; overflow measured by CorelDRAW (frame overflow, card edge / safety margin). Collisions with artwork are not detected |
| F13 | Real card dimensions and aspect ratio | ✅ from CorelDRAW page size; 100 % = real size at Windows' nominal 96 dpi |
| F14 | Reusable template mappings saved locally | ✅ per template, by column header |
| F15 | Batch generation of editable CDR (X7 format), progress, current record, counts, logs, cancel, no duplicate jobs, overwrite confirmation, output folder, safe names, report, open folder / open file | ✅ |
| F16 | Optional PDF export | 🟡 per job for card sheets (one PDF per CDR, CorelDRAW default settings); not available for single-card jobs; not validated against press specs |
| F17 | Printing | Out of scope: the operator prints from CorelDRAW; no automatic print jobs |
| F18 | Multi-up imposition | ✅ see F19–F27. Bleed / crop marks: none specified by the client, none drawn |
| F19 | Large spreadsheets: no 20,000-row limit, 40,897 rows tested, no silent truncation, progress, paged table | ✅ |
| F20 | Identifier columns (control number): required + unique by default, duplicates flagged per repeat | ✅ |
| F21 | Unnamed CDR templates: detect repeated cards from object positions, name objects in a private copy, never modify the original | ✅ (v27, synthetic templates; real layouts analysed) |
| F22 | Visual mapping: card grid outlines on the page, one reference card mapped line by line to columns, auto-match, replicated to every position | ✅ |
| F23 | N-up A4 production mode (default = detected grid, e.g. 10; any 1..N), unique records per card, partly filled last sheet | ✅ |
| F24 | Sheet preview: CorelDRAW-rendered A4, sheet navigation, jump, search by control number/name, card zoom, overflow + blank-field warnings, print-margin guide | ✅ |
| F25 | Bulk generation: several sheets per CDR (default 25), optional PDF, manifest, resume, safe cancel, verification, report, print summary | ✅ |
| F26 | Control-number prefix mismatch is flagged and blocks generation until confirmed; never converted | ✅ |
| F27 | Unmapped data fields print blank, never the template's sample text | ✅ |
| F28 | Client data protection: client files git-ignored and purged from local history; no contents in logs, reports, fixtures or docs | ✅ |
| F29 | Two explicit production modes: N different records per sheet, or N copies of one record per sheet (each record on its own sheet). Chosen by the operator before preview/generation; never assumed; recorded in the print summary | ✅ |
| F30 | Missing-font warning (CorelDRAW substitutes silently) on the mapping screen, Generate screen and report; text beyond its card position is flagged | ✅ (warning only; the real Gotham fonts are not installed on the dev PC) |
| F31 | In-app CorelDRAW compatibility check (Settings) that exercises every CorelDRAW feature the sheet engine uses and writes a report, for validating X7 on the client's PC | ✅ on v27; **X7 not run** |
| F32 | Windows installer (NSIS, unsigned) and packaged-app test | 🟡 built and tested on v27; not tested on a clean PC or X7 |

## Non-functional

| Requirement | Status |
|---|---|
| Runs offline on Windows 10/11 x64, no cloud | ✅ by design |
| Original templates never modified | ✅ hash-verified in unit, integration and E2E tests |
| 100–500 records per batch | Dev PC on v27: about 0.4 s/card. **Not benchmarked on X7 / client PC** |
| Recovery from CorelDRAW hangs/crashes | ✅ timeouts, bridge restart, job continues; stops after 3 consecutive failures |
| Installer | 🟡 electron-builder config present; not built/tested yet (Phase 6) |

## Missing client assets and decisions ❓

1. **The real CDR template(s)**, saved from X7, with variable objects named (see CORELDRAW_INTEGRATION.md §7).
2. **Run of the X7 validation procedure** (CORELDRAW_INTEGRATION.md §8) on the production PC.
3. **CorelDRAW version and edition**: Help → About, 32/64-bit, and whether VBA/automation components are installed.
4. A real (or anonymised) **employee spreadsheet**.
5. **Fields on the card** and which are mandatory.
6. **Fonts** used, installed on the production PC.
7. **Output layout**: one CDR per person (current), or N-up sheets?
8. **Print specs**: card size, bleed, crop marks, colour mode, printer/RIP.
9. **Naming convention** and output folder.
10. **Long-name rule**: shrink, wrap, or flag for manual edit (currently flagged).
11. Production **PC specs**, for performance expectations.
