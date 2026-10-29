# Test Report

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
