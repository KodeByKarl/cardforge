# Large batch test report

All measurements: Windows 11 dev PC, CorelDRAW **27.2** (not X7), Electron 33. **X7 performance is unmeasured.**
All data is synthetic. The "client layout" timings below were taken on a private copy of the client's real 10-up layout; only
timings and file sizes were recorded, nothing from the file's content.

## 1. Spreadsheet import (40,897 synthetic records, header on row 3)

| Step | Time |
|---|---|
| Read worksheet (main process, chunked, progress events) | ≈1.0–1.8 s (unit test); whole drop → table in the app: **1.7 s** |
| Build dataset in the renderer | ≈0.16–0.20 s |
| Validate (required fields, duplicates, control numbers) | ≈0.07–0.21 s |
| Records table | paged, 100 rows in the DOM (not 40,897) |

Checks (automated, `tests/largeImport.test.ts`, `tests/e2e/sheet.mjs`): no truncation (limit is now Excel's own 1,048,576 rows),
header detected on row 3, original Excel row numbers kept (blank separator rows leave gaps), control numbers kept as typed
(`PL 000001`), every record present exactly once, duplicate control numbers flagged once per repeat naming the first row,
missing required name is an error, blank optional values (birthdate/address) produce no issue.
Real client workbook (aggregates only, private test): 40,897 records, header row 3, 0 errors, 0 repeated control numbers.

## 2. Sheet imposition and batch plan (pure logic, `tests/sheet.test.ts`, `tests/batches.test.ts`)

| Job | Sheets | Last sheet | Files at 25 sheets/file |
|---|---|---|---|
| 40,897 records, 10 per sheet | 4,090 | 7 cards | 164 (last has 15 sheets) |
| 40,900 records, 8 per sheet | 5,113 | 4 cards | – |

`verifyPlan` / `verifyBatches` prove each record is on exactly one sheet and each sheet in exactly one file, in order, for 54 combinations of sizes; tampered plans (gap, overlap, wrong numbering) are detected. Generation refuses to start if the proof fails.

## 3. CorelDRAW timings (30 sheets = 300 cards per configuration, verification included)

| Sheets per file | Synthetic template | Client's real layout | Output size (30 sheets, real layout) |
|---|---|---|---|
| 1 | 2.18 s/sheet | 2.50 s/sheet | 4.7 MB in 30 files |
| 5 | 1.42 | 1.62 | 1.3 MB in 6 files |
| 10 | 1.37 | 1.51 | 0.9 MB in 3 files |
| 30 | 1.32 | 1.44 | 0.6 MB in 1 file |
| 10 + PDF per file | 1.45 | 1.58 | 2.7 MB (CDR + PDF) |

Preview render of one A4 sheet (on demand, cold CorelDRAW page): ≈0.8–0.9 s at 72, 96 and 150 dpi (first render after opening ≈2.2 s). The main-process cache is bounded by count (300) and size (160 MB); 18 renders of this size occupy ≈2–3 MB.

### Decision: default 25 sheets per file

Per-file fixed cost (open template ≈1.1 s, save ≈0.4–1.4 s, verification) dominates below ~10 sheets per file; beyond ~10 the gain is under 5 %. 25 keeps files small enough to resume cheaply (one file ≈ 40 s of work) and gives 164 files instead of 4,090.
Projected for the client job at the measured real-layout speed (≈1.45 s/sheet): **4,090 sheets ≈ 1 h 40 min**, ≈100 MB of CDR (≈250 MB with PDF). This is an extrapolation of a 30-sheet run, not a full 4,090-sheet run, and it is for CorelDRAW 27.

### Defects found by benchmarking (all fixed)

1. Per-object COM reads dominated the apply step → index built once per page, bounds read once, page boxes cached, `Optimization` mode on (apply 0.85–1.4 s → ≈0.55 s/page).
2. Removing artwork of empty card positions took 6.2 s → one `ShapeRange.Delete`, no re-index (≈1.0 s).
3. Output verification reopened files and ran a full `inspect` (thousands of COM calls; minutes per file) → light open + page count only (milliseconds).
4. Copying a sheet page with `Duplicate`+`MoveToLayer` cost 2.2 s per page on the real layout and silently copied only guidelines → per-layer `CopyToLayer` (0.3 s), guides layer skipped, positions verified equal across pages.
5. A first-attempt `'Story' cannot be found` on a copied page appeared only inside the real app (not in isolated tests) → lookups are now verified (type, name) and fall back to a full index; failed batches are retried once and the retry is written to the report. After the fix no retry occurred in the last runs.

## 4. Bulk generation behaviour (real CorelDRAW, `tests/integration/sheetGeneration.int.test.ts`, `tests/e2e/sheet.mjs`)

* 25 synthetic records → 3 sheets (10, 10, 5) → 2 files + PDFs. Output reopened: every card on every page holds exactly its record; position of each object equal on all pages; the 5 unused positions of the last sheet are blank and their artwork removed.
* Reports and manifests contain row numbers and counts only (asserted: no sample text).
* Resume: an identical run skips verified files; deleting one file regenerates only that file.
* Cancel between batches: status `cancelled`, no `~cardforge-*` temporary files, resume completes the remaining batches.
* Unsafe requests refused: unknown column in the mapping, more cards than positions, relative output path, bad ids.
* Temporary working copies are deleted (`work` folder empty after each job).

## 5. Not measured / limitations

* No full 4,090-sheet run was executed (≈1 h 40 min estimated); a 30-sheet configuration sweep and a 3-file end-to-end job were.
* No memory profile of the renderer with 40,897 records beyond: import and navigation stayed responsive in the e2e run.
* Crash recovery (CorelDRAW killed mid-batch) is covered for the single-card engine and by the bridge-loss retry path, but not by an injected-crash test of the sheet engine.
* Everything above is CorelDRAW 27. X7 speed, fonts and file compatibility are unverified.
