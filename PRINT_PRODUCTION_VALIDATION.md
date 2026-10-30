# Print production validation

Status: **verified on CorelDRAW 27.2 with synthetic data and synthetic templates; not validated on CorelDRAW X7 or on the client's printer/PC.**
CardForge never prints. The operator opens the generated CDR/PDF in CorelDRAW, reviews it and prints.

## What the output is

| Property | Behaviour | Verified |
|---|---|---|
| Page | the template's own page (client layouts: A4 portrait 210 × 297 mm); size and artwork are copied, never regenerated | page size and copied-object positions compared across pages (≤ 0.05 mm) |
| Cards | N records per sheet in reading order (top-left, across, then down); only the last sheet may be partly filled | unit + real-CorelDRAW tests |
| Positions | taken from the template; text is replaced in place, so fonts, sizes, colours and layout stay as designed | read back from saved files |
| Unused positions (last sheet) | text blank; static artwork inside the position removed (option, default on) | real CorelDRAW test |
| Editable CDR | saved in CorelDRAW X7 (v17) format, several sheets (pages) per file | saved with v27; ZIP container signature checked; reopened, page count checked |
| PDF (optional) | one PDF per CDR with every page, CorelDRAW's default PDF settings | `%PDF` signature and 10-page PDF seen in tests; not checked against a RIP or press requirements |
| Names | `<template> sheets 00001-00025.cdr` (+ `.pdf`) zero-padded so files sort in sheet order | unit test |
| Reports | JSON report, manifest, and a plain-text print summary (file → sheets → spreadsheet rows → cards) | e2e; asserted to contain no spreadsheet contents |

## Operator checks before printing (recommended)

1. Read the **print summary** and confirm the record count, sheet count and any excluded rows (rows with errors are listed by number).
2. Open the first and last file of the job in CorelDRAW; check text, fonts (Gotham / Segoe Print must be installed), and the partly filled last sheet.
3. Confirm the control-number prefix with the client (the template sample and the spreadsheet differ; CardForge blocks until acknowledged and never converts it).
4. Print a test page on the production printer before a long run.

## Preview indicators

* Full A4 sheet rendered by CorelDRAW; numbered card outlines; click a card for a magnified crop and the printed values.
* Overflow warnings are measured by CorelDRAW (text outside its paragraph frame or outside the safety margin / page); blank mapped fields are flagged per card.
* **Print margin**: a dashed line at the *Safety margin* from Settings (default 3 mm). It is a warning aid, not the printer's real non-printable area.
* **Bleed / crop marks**: none are specified in the client's files, so none are drawn or added. If the client wants bleed, the template must be changed.

## Known limits

* Two-sided (front/back) sheet pairs are not built: the client's templates have one page.
* PDF is not validated for PDF/X or colour management.
* Text overlapping artwork is not detected; overflow detection covers frames and page/margin edges.
* If a fixed caption (e.g. "ADDRESS:") is converted to curves it cannot change per record, which is the intended behaviour here.
* Everything: CorelDRAW 27 only. X7 compatibility is unverified.
