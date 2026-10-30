# Test Report

## CorelDRAW X7 targeted test (2026-10-30, this PC)

Installed: **CorelDRAW Technical Suite X7 17.4.0.887** (`C:\Program Files (x86)\Corel\CorelDRAW Technical Suite X7\`, 32-bit), ProgID `CorelDRAW.Application.17` registered; CorelDRAW 2026 (27.2) is installed alongside and was not touched. The running X7 window title reads **"CorelDRAW X7 (Evaluation Version)"**: it is an evaluation/trial build, **not an activated licence**, and the installer found in Downloads came from a software-piracy site. CardForge did not alter licensing; the test below is a technical compatibility check only. The client must use a properly licensed X7.

Command: `CARDFORGE_COREL_PROGID=CorelDRAW.Application.17 npx vitest run --config vitest.integration.config.ts tests/integration/x7smoke.int.test.ts` (4 synthetic-data steps + the real templates as private copies, 10 synthetic records, one sheet each).

| Check | Result on X7 17.4.0.887 |
|---|---|
| COM automation reachable (attach to the running X7, version read) | ✅ |
| Compatibility check, all 15 steps (inspect, name objects + save v17, reopen, fill + clear empty positions, undo, per-layer page copy, page-scoped fill, PNG export, save 2 pages, PDF export, light reopen + page count, font check) | ✅ 15/15 |
| `card layout final.cdr`: import, 20 unnamed text objects, 2 × 5 grid, prepare, map, 1 sheet of 10 records, CDR + PDF, reopen, preview | ✅ 20 text objects match the 10 records exactly; page 210 × 297 mm; no object outside its card; preview 827 × 1169 px at 100 dpi (as expected); 0 overflow warnings |
| `guide (2).cdr`: same | ✅ 40 text objects match exactly; same dimensions; 0 overflow warnings |
| Fonts | ⚠ both templates use **Gotham Medium / Gotham Black**, **not installed** on this PC: CorelDRAW X7 substitutes (Gotham Medium → Segoe Print); CardForge warns. With Gotham installed this is expected to resolve; not verified |
| Compatibility defects found | none: no code change was needed for X7 |

Not run on X7: the Electron end-to-end suites, large batches, physical print. X7 is slow over 32-bit COM (inspecting the sample took ≈30 s; each real-template sheet job ≈ 1 min), so e2e timeouts tuned on CorelDRAW 27 may need raising on X7. A dev e2e run started after X7 appeared on this PC showed template-inspection timeouts and was stopped (not investigated).

When both versions are installed CardForge prefers X7; set `CARDFORGE_COREL_PROGID=CorelDRAW.Application.27` to force 27.

---


## Client-workflow adaptation (card sheets), latest full run: 2026-10-30

Windows 11 · Node 26 · Electron 33.2.1 · **CorelDRAW 27.2** (not X7). All data and templates in committed tests are synthetic.

| Suite | Command | Result |
|---|---|---|
| Type-check | `npm run typecheck` | ✅ clean |
| Production build | `npm run build` | ✅ |
| Unit tests | `npm test` | ✅ **134 / 134** (12 files; adds sheet detection/composition/planning, batches, request validation, 40,897-row import, control-number checks) |
| Integration, real CorelDRAW | `npm run test:corel` | ✅ **19 / 19** (3 opt-in benchmarks skipped by default) |
| E2E, existing app, 100 % scaling | `npm run test:e2e` | ✅ **41 / 41** |
| E2E, existing app, 125 % and 150 % | `E2E_SCALE=1.25 / 1.5 npm run test:e2e` | ✅ **41 / 41** each |
| E2E, card-sheet workflow, 100 / 125 / 150 % | `npm run test:e2e:sheet` | ✅ **24 / 24** each |
| Private smoke test on the real client workbook | git-ignored, aggregates only | ✅ 40,897 records, header row 3 |
| **Anything on CorelDRAW X7** | – | ❌ **not run: X7 unavailable** |
| PDF export, installer | – | PDF only for sheet jobs, no installer work yet |

Card-sheet e2e covers: 40,897-record import (1.7 s) with paging and no truncation; identifier column flags; 10-up detection on an unnamed template with outlines on the page; preparing; mapping with prefix-mismatch block and confirmation; sheet preview (A4 aspect, 10 cards, sheet 1 of 4,090, card zoom, search by control number, go-to sheet, last sheet with 7 cards and 3 empty positions, keyboard, zoom); plan of 40,897 records → 4,090 sheets → 164 files; large-job confirmation; a real 47-record job (5 sheets, 3 files + PDF) verified on disk; resume dialog; layout probe on template, preview and generate at 800×480, 1024×768, 1280×720, 1366×768, 1920×1080 in light and dark.

Details and timings: `LARGE_BATCH_TEST_REPORT.md`. Output/print notes: `PRINT_PRODUCTION_VALIDATION.md`.

### Not tested
* CorelDRAW X7 (anything). Fonts Gotham / Segoe Print on a machine that lacks them.
* A full 4,090-sheet run (extrapolated ≈1 h 40 min from 30-sheet runs).
* Sheet engine under an injected CorelDRAW crash; renderer memory profile at 40,897 records beyond responsiveness in e2e.
* Printing, PDF/X, bleed and crop marks (not specified by the client).

---

## Earlier results (before the client-workflow adaptation)

Last run: 2026-10-29 · Windows 11 · Node 26.13 (tests) · Electron 33.2.1 (app) · **CorelDRAW v27.2.0.135**

> All CorelDRAW results below are from **v27.2**. **CorelDRAW X7 has not been tested.** These results do not
> establish production readiness; that requires the X7 procedure in CORELDRAW_INTEGRATION.md §8.

## Summary

| Suite | Command | Result |
|---|---|---|
| Type-check (strict, main + renderer) | `npm run typecheck` | ✅ pass |
| Unit tests (no CorelDRAW) | `npm test` | ✅ **95 / 95** |
| Integration tests (real CorelDRAW v27.2) | `npm run test:corel` | ✅ **9 / 9** |
| End-to-end, real app + real CorelDRAW (CDP-driven) | scripted, see below | ✅ 16 / 16 steps |
| Production build | `npm run build` | ✅ |
| PoC script on v27.2 | `scripts/corel-poc.ps1 -ProgIdVersion 27` | ✅ PASS |
| **Anything on CorelDRAW X7** | — | ❌ **not run: X7 not available** |
| Installer | `npm run dist` | not run (Phase 6) |

## Unit tests (95)

| File | Tests | Covers |
|---|---|---|
| `import.test.ts` | 26 | CSV, normalisation, header detection, validation (Phases 1–3) |
| `excelReader.test.ts` | 9 | xlsx/csv reading, invalid/corrupt/empty files |
| `main.test.ts` | 5 | file names, path safety, settings, LocalServer32 parsing |
| `mapping.test.ts` | 15 | **template mapping**: name keys, synonym auto-match, excluded columns, front/back duplicates, resolve by label, missing/stale/mixed/unmapped issues, values per record, keep vs blank, missing fields, exclusion of error rows, untrusted mapping parsing, reading-order sorting, file naming + batch de-duplication |
| `navigation.test.ts` | 8 | **preview navigation**: accent-insensitive search, stepping without wrap, clamping, grid paging, record title; zoom levels, fit, real-size CSS dimensions and aspect ratio, dpi buckets |
| `bridgeProcess.test.ts` | 8 | **error handling** in the bridge client (fake bridge process): Unicode round trip, console noise, error propagation, call serialisation, timeout → kill → restart (generation++), crash → reject → recover, never-ready/missing executable, graceful shutdown |
| `services.test.ts` | 25 | TemplateStore (original untouched, re-import dedupe, source changed/missing, mapping save/validation, invalid ids/paths, inspection failure cleanup, CorelDRAW unavailable, rename/remove); PreviewService (caching, single working copy, temp cleanup, overflow/notFound, request validation, renderer errors, recovery after restart); GenerationService (outputs, progress, report, history, overflow warnings, per-record failure, missing object, failed save, skip/suffix/overwrite, cancel, duplicate-job prevention, repeat jobs, crash recovery and stop after 3, CorelDRAW unavailable, invalid requests); CorelService version choice |

## Integration tests against real CorelDRAW v27.2 (9)

`tests/integration/*.int.test.ts`, using the CorelDRAW-built fixture `tests/fixtures/test-card-front-back.cdr`
(90×50 mm front + back, nested groups, paragraph frame, mixed-format object, static artwork).

| Test | Verifies |
|---|---|
| inspect | 2 pages 90×50 mm; 8 named objects; group paths `ContactGroup › PhoneGroup`; back-page object; paragraph flag; mixed-formatting flag; 1 unnamed static text; bounds |
| apply/export/save/reopen | Unicode (`José Peña-Ñuñez 王小明`), blank values, unknown object reported, paragraph-frame overflow, long-name card-edge overflow, exact page PNGs (531×295 at 150 dpi, both pages), X7-format save, reopened text/font match, untouched objects keep template text |
| no font drift | after a CJK record, the next Latin record is saved in Arial 14 pt and omitted fields return to template text (regression test for finding #6) |
| error recovery | missing file, unknown handle; bridge keeps working |
| pipeline: import | library import, thumbnails, original hash unchanged, no leftover working files |
| pipeline: preview | front/back renders at 200 dpi; overflow flagged; ~85–105 ms per page |
| pipeline: generate 12 | 12 CDRs, no temp files, overflow logged for the long name, 3 outputs reopened and verified (incl. one after the CJK record: Arial), template unchanged |
| pipeline: repeat/skip/fail | blocked output recorded as failed while others succeed; skip run skips all 3; suffix run adds 3 `(2)` files |
| pipeline: cancel | stops between records; outputs = succeeded count; no temp files |

Fixture hash is asserted unchanged after the suite.

## End-to-end (real Electron app + real CorelDRAW v27.2)

Driven over the Chrome DevTools Protocol with simulated OS file drops, isolated profile (`CARDFORGE_USER_DATA`):
drop spreadsheet → 8 records · drop CDR → inspected in ~4.7 s · auto-match (7 mapped, Tagline kept) → single
preview rendered by CorelDRAW (~1 s incl. first open) · navigate to record 5 → side panel shows the length warnings,
the blank telephone and the CorelDRAW-measured overflow · search “pena” → 1 record · grid → 8 CorelDRAW thumbnails
(~2.2 s) · generate → 7 CDRs (row 7 excluded for a missing name) in 4.3 s · second run → conflict prompt listing
existing files → "Keep both" → 7 more files with `(2)` · dashboard lists both jobs. **0 renderer errors or exceptions.**

Bugs found by E2E and fixed: card title used the address instead of the name; mapping table was in CorelDRAW
stacking order instead of reading order; a removed remembered template showed an error banner.

## Performance (dev PC, CorelDRAW v27.2; NOT X7)

| Operation | Time |
|---|---|
| Template inspection + thumbnails (2 pages) | ~3–5 s (CorelDRAW already running) |
| Preview, one page | 85–105 ms |
| Generation, steady state | ~0.4–0.5 s per card |
| Generation, cards needing font fallback (CJK) | ~1.8 s |
| 12 cards incl. opening the template | 8.6–8.8 s |

Linear extrapolation gives about 4 minutes for 500 cards, **on this PC with v27**. Not a promise for X7.

## Not tested

- **Everything on CorelDRAW X7** (API compatibility, Undo/command groups, `Text.Overflow`, export area, performance, licence/edition automation).
- PowerClip contents; master-page objects (not supported); text on a path.
- CorelDRAW modal dialogs during automation (missing-font dialog, crash recovery).
- Large real batches (500) and real client templates/spreadsheets.
- Installer and clean-machine install.
