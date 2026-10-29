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
| F16 | Optional PDF export | ⏳ not started; never substitutes for CDR |
| F17 | Printing | Out of scope: the operator prints from CorelDRAW; no automatic print jobs |
| F18 | Multi-up imposition / bleed / crop marks | ❓ needs print specs |

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
