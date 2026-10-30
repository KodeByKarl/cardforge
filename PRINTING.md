# Direct printing

Staff can print generated CDR sheets from the app (the **Print** screen, `Ctrl+5`, or the **Print…** button after generating) without opening CorelDRAW. Printing goes through CorelDRAW COM; the existing import, layout and CDR export are unchanged.

## Flow

1. Choose the generation job and the files (default: all CDR files of the latest job).
2. Optional **Show preview**: CorelDRAW renders the real pages (the renderer cannot display CDR itself). Generation warnings (fonts, overflow) for that job are shown under the preview.
3. Choose printer and settings: copies, paper (A4, A3, A5, Letter, Legal), orientation, page range (`1-3,5`), scaling (100 % or fit to paper), color. Presets save a whole configuration; the last used settings are remembered.
4. **Review & print…** counts the pages of every file and shows printer, sheets, copies, paper, settings and the **total pages**. Printing needs the acknowledgement tick. Printing is blocked when the printer is offline, in error, not installed, a file is missing or the page range is invalid.
5. The job runs in the main process, one file at a time. Each file moves through: *Waiting → Sending → Submitted → In Windows queue → Printing → Completed*.

## What the states mean (read this)

| State | Meaning |
|---|---|
| Submitted | CorelDRAW accepted `PrintOut`. **Not** proof of paper. |
| In Windows queue / Printing | Seen in the Windows spooler (`Get-PrintJob`), with its spooler job id. |
| Completed | Seen *printing*, then it left the queue. Closest signal Windows gives; still check the paper. |
| Failed (not sent) | Failed while opening/configuring, before `PrintOut`. Certain nothing was sent. **Retry failed** re-sends only these. |
| Check printer (uncertain) | Outcome unknown (error/timeout during `PrintOut`, vanished from the queue unseen, app closed mid-send). It may already be on paper, so it is **never retried automatically**. Check the printer queue, then print again deliberately. |
| Cancelled | Never sent. A file already being sent cannot be recalled. |

If no job ever appears in the Windows queue, the file stays *Submitted* with a note; it is never upgraded to Completed.

## Safety rules implemented

- The selected printer is never replaced. CorelDRAW must report that exact printer selected (read back), otherwise the file fails.
- One confirmation = one job (the plan is single-use); a second job cannot start while one is sending.
- Files already sent to the same printer in the last 30 minutes are listed and need an extra explicit tick to print again.
- History (`print-jobs.json` in the app data folder) survives restarts: unsent files become *Cancelled*, files that were mid-send become *uncertain*, files already in the Windows queue are followed again.
- IPC payloads are validated in the main process; the renderer sends only job ids and file indexes (never paths) and cannot run commands. The printer name reaches PowerShell Base64-encoded as a single argument.

## Technical notes

- COM: `Document.PrintSettings` (`SelectPrinter`, `Copies`, `Collate`, `SetPaperSize`, `PageRange`/`PrintRange`, `Layout.Placement`, `Options.ColorMode`) then `Document.PrintOut()`, in `resources/corel/corel-bridge.ps1` (`configurePrint`, `printOut`). Enum values were read from the X7 type library (`CorelDRAW.tlb`).
- Windows printers/spooler: `resources/corel/printers.ps1` (read-only).
- Code: `src/main/services/print/` (PrintService, PrinterService, PresetStore), `src/shared/print/`, `src/renderer/src/screens/PrintScreen.tsx`.

## Verification status

Verified here (2026-10-30, Windows 11, one printer: *Microsoft Print to PDF*):

- Unit tests with a mock CorelDRAW and fake spooler (`tests/print.test.ts`): single and multiple sheets, copies, offline and uninstalled printer, partial batch failure, retry of failed only, uncertain never retried, cancellation, duplicate prevention, double submission, app restart (cancel/uncertain/resume tracking), CorelDRAW not installed, COM failure, invalid payloads, presets.
- CorelDRAW **v27.2**: `configurePrint` selects the printer, applies the settings and reads them back; a non-existent printer is refused; `printOut` without configuration is refused (`tests/integration/print.int.test.ts`).
- CorelDRAW **X7 17.4** on this PC: preview and the confirm dialog work (`npm run test:e2e:print`), but **`PrintSettings.SelectPrinter` fails with `STG_E_FILENOTFOUND` (0x80030002)** for *Microsoft Print to PDF*. The app reports this as *Failed (not sent)* with the real message and prints nothing. Cause not determined (X7's print module on this PC / this virtual printer).

**Not verified (needs the production workstation with X7 and its real printer):** actual `PrintOut` to paper on X7, X7 honouring paper size/orientation/range/scaling/color, the Windows spooler job appearing for X7 jobs, printer-offline behaviour on real hardware, a real restart during a print.

### Production checklist (run on the X7 workstation)

1. `npm run build`, start the app, open **Print** and confirm the real printer is listed with the right status.
2. Generate one small sheet job. Preview it. Print **1 file, 1 copy** to the real printer. Expect: *Submitted → In Windows queue → Printing → Completed* and one physical sheet. Note what you actually saw.
3. If the job ends *Failed (not sent)* with `0x80030002` or similar, run `CARDFORGE_COREL_PROGID=CorelDRAW.Application.17 npx vitest run --config vitest.integration.config.ts tests/integration/print.int.test.ts` and send the output. Opening CorelDRAW X7 once and printing a page manually (to create its default print settings) is the first thing to try.
4. Print 2–3 files with 2 copies; check the paper count equals the confirm dialog's total.
5. Turn the printer off (or pause the queue) and try again: offline must block; a paused queue must warn.
6. Print a multi-file job and close the app while it sends; reopen and confirm the unfinished files show *Cancelled* / *Check printer*, and nothing reprints by itself.
7. Optional real-print integration test: `CARDFORGE_PRINT_REAL=1 CARDFORGE_PRINTER="<exact printer name>" npx vitest run --config vitest.integration.config.ts tests/integration/print.int.test.ts`.
