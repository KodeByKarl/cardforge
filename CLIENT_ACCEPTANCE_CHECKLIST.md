# Client acceptance checklist (production PC with CorelDRAW X7)

**CardForge is not production-ready until sections A–D below pass on the client's PC with CorelDRAW X7 and a physical print sample is approved (section E).**
Everything verified so far was done on CorelDRAW 27 with synthetic data; X7 has never been run.

Final references (confirmed by the client): the supplied Excel workbook, `card layout final.cdr` and `guide (2).cdr`. Their artwork, A4 2 × 5 arrangement, fonts and captions are the source of truth; CardForge never redesigns them.

Bring: the installer `CardForge-Setup-0.1.0.exe` (unsigned: Windows SmartScreen will ask to confirm "Run anyway"), the three client files, a test USB stick, and the printer the job will use.

**Pre-check already done on the dev PC (evaluation build of X7 17.4):** the compatibility check (15/15) and the one-sheet workflow on both templates passed. What remains for the client's PC: a licensed X7, the Gotham fonts, the physical print, and the checks below.

## A. Install and CorelDRAW X7 compatibility (≈15 min)

| # | Step | Expected | Pass |
|---|---|---|---|
| A1 | Run the installer, choose a folder, finish; start CardForge | Window opens, no error; status bar shows CorelDRAW | ☐ |
| A2 | Settings → CorelDRAW | "X7 registered" | ☐ |
| A3 | Settings → **Run compatibility check** | Every step PASS and the banner says "CorelDRAW X7 detected". Save the report file it names | ☐ |
| A4 | Fonts: Gotham (Black, Medium) and Segoe Print installed | Generate screen row "Fonts" is green for each template. The development PC lacks Gotham: **install it on the production PC** | ☐ |
| A5 | Close CorelDRAW completely, start CardForge, open Template setup | CardForge starts CorelDRAW itself (first start can take a minute) | ☐ |

If any step in A3 fails, stop and send the report file. Do not run production jobs.

## B. Template acceptance (both templates, one at a time)

For `card layout final.cdr` and then `guide (2).cdr`:

| # | Step | Expected | Pass |
|---|---|---|---|
| B1 | Import the Excel file | 40,897 records (or the real count), header row 3, no errors, control numbers shown exactly as in Excel (PL prefix) | ☐ |
| B2 | Template setup → drop the template | "Detected 2 columns × 5 rows = 10 cards per sheet"; numbered outlines sit on the 10 cards | ☐ |
| B3 | Prepare as 10-card sheet; Auto-match | Name, address and control number are mapped; **precinct stays "Leave blank"** (no precinct data); Birthdate is not mapped | ☐ |
| B4 | Control-number prefix warning (layout template) | A red notice says the template sample prefix differs from the spreadsheet. The client decides which is right; ticking the confirmation records that the spreadsheet value is printed as is. **Nothing is converted** | ☐ |
| B5 | Open the original `.cdr` files in CorelDRAW | Unchanged (date/time not modified, still open normally) | ☐ |

## C. Production modes (explicit choice every time)

| # | Step | Expected | Pass |
|---|---|---|---|
| C1 | Open Card preview or Generate without choosing a mode | Both ask you to choose; nothing is pre-selected | ☐ |
| C2 | **10 different records per sheet** → preview | Sheet 1 shows records 1–10 in reading order (top-left, across, then down); every card different; last sheet shows 7 filled + 3 empty | ☐ |
| C3 | **10 copies of the same record per sheet** → preview | All 10 cards on a sheet identical; next sheet is the next record | ☐ |
| C4 | Compare the preview with the original artwork | Same layout, fonts, sizes, line spacing, alignment, colours, shapes | ☐ |
| C5 | Search a known control number | Jumps to the right sheet and card | ☐ |

## D. Generate a small real job in CorelDRAW X7

Use 23 records (or any small set) first, **10 per sheet**, 2 sheets per file, PDF on; then repeat with 3 records in copies mode.

| # | Check | Expected | Pass |
|---|---|---|---|
| D1 | Progress, then "Output verified" banner | Files count as planned; no temporary `~cardforge` files | ☐ |
| D2 | Open the first CDR in X7 | Opens without warnings; pages = sheets; artwork complete (no missing graphics) | ☐ |
| D3 | Cards | Each card shows the right person/number; no clipped or overlapping text; spacing as in the original | ☐ |
| D4 | Last sheet | Unused positions are empty (no leftover sample text or captions) | ☐ |
| D5 | Open the PDF | Same pages and appearance as the CDR | ☐ |
| D6 | Read the **print summary** and report in the output folder | Counts match; excluded rows (if any) listed by row number | ☐ |
| D7 | Cancel and Resume | Cancel stops cleanly; running again offers Resume and keeps finished files | ☐ |

## E. Physical print sample (required for sign-off)

1. Print one A4 sheet from the CDR in each production mode on the production printer and paper.
2. Hold it against the client's original sample: card positions (2 × 5), margins, text size and alignment, captions.
3. Check cutting guides align (cards are cut by the client's process).
4. Client signs: ☐ Layout approved ☐ Data fields approved ☐ Control-number prefix approved ☐ Paper/print quality approved.

## F. Large job rehearsal (recommended before the full run)

Run 1,000 records (100 sheets) and note the time per sheet; the full job of ≈4,090 sheets was estimated at about 1 h 40 min on the development PC with CorelDRAW 27, and 40,897 sheets in copies mode would take about 17 hours. Cancel/resume is safe if the PC must be used meanwhile.

## Open decisions for the client

1. Is the control-number prefix in the spreadsheet (PL) final? (The layout template shows a different sample prefix.)
2. Should the `guide` template's Precinct No. be filled? If so, provide the data column; otherwise it prints blank.
3. Which production mode is used for which job?
4. Is bleed or crop-mark output needed? (None is added now.)

Sign-off: Name ______________________ Date ____________ Signature ______________
