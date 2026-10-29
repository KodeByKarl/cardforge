# CorelDRAW Integration — Feasibility and Design

Status: **Feasible in principle, verified on CorelDRAW v27.2. NOT yet verified on CorelDRAW X7 (v17), the client's production version.**

## 1. Summary

| Question | Answer | Evidence |
|---|---|---|
| Does CorelDRAW expose COM automation? | Yes. Out-of-process COM server `CorelDRW.exe /Automation`, ProgID `CorelDRAW.Application.<ver>`. X7 = `CorelDRAW.Application.17`. | Registry inspection on the dev machine; PoC run (v27). |
| Is VBA required? | No. External COM automation drives the same object model VBA uses; the VBA *editor/runtime* component is not needed. **Risk:** some low-end editions (Home & Student, Essentials) historically restrict automation. Must be confirmed on the client's licence. | Design reasoning; to verify on X7. |
| Open existing CDR? | `Application.OpenDocument(path)` | PoC step 1 — passed on v27. |
| Identify text objects? | By Object Manager name: `Shape.Name`, searched across `Document.Pages[].Shapes` and recursively into groups (`Shape.Type = 7`, `Shape.Shapes`). Text objects have `Shape.Type = 6`. | PoC step 2 (found inside a group) — passed on v27. |
| Replace text without losing formatting? | `Shape.Text.Story.Text = "..."` keeps the font and size of the replaced story. | PoC step 3 — font Arial / 14 pt preserved on v27. Mixed-formatting stories (e.g. bold first name + regular surname in one object) not yet tested. |
| Preserve position? | Insertion point should hold; the **bounding box** changes with glyph shapes (an accented capital raises the top). Left/centre/right alignment anchors must be checked on the real template. | PoC measured bbox top-left (8.35, 33.48) → (8.09, 34.24) mm on v27. |
| Save editable CDR? | `Document.SaveAs(path, StructSaveAsOptions)` with `Options.Version = 17` for X7 format. | PoC step 4 — passed on v27, saving in v17 format. |
| Reopen and verify? | Yes. | PoC step 5 — passed on v27; Unicode (`José Peña-Ñuñez`) round-tripped. |
| Original template protected? | Yes: the app only opens a temp copy; SHA-256 is compared before and after. | PoC final step — passed. |
| Preview export from CorelDRAW? | Planned via `Document.ExportBitmap(...)`. **Not yet tested.** | — |

## 2. What is verified and what is not

**Verified (dev machine, CorelDRAW Graphics Suite v27.2.0.135, Windows 11, Windows PowerShell 5.1), 2026-10-29:**
connect via COM, create document, set page size, create artistic text, name shapes, set font/size,
build a shape range and group it, open a CDR, recursive named-shape lookup, text replacement with
font/size preserved, SaveAs in v17 file format, reopen and read back, template untouched.

**Not verified:**
- Anything on **CorelDRAW X7 itself**. The object model calls used are long-standing (present since well before X7), but that is an expectation, not proof.
- Whether X7 opens the v17-format file produced by v27 correctly (likely, untested).
- Paragraph (frame) text, text on a path, text inside PowerClips, mixed formatting in one object.
- Overflow detection for paragraph text.
- Bitmap export for previews.
- Batch performance on the client's PC.
- Behaviour when CorelDRAW is already open with unsaved work, or shows a modal dialog (licence, recovery, update prompts).

## 3. Integration approach

**PowerShell COM bridge**, not a native Node addon.

- Windows PowerShell 5.1 ships with every Windows 10/11 machine and does late-bound COM via `New-Object -ComObject`.
- Avoids native modules (e.g. `winax`) that must be rebuilt for each Electron version and CPU architecture. Those are the most common source of installer breakage.
- Isolation: if CorelDRAW hangs or crashes, only the child process dies. The app detects it, logs it, and marks the current record failed.
- Out-of-process COM works regardless of 32/64-bit mismatch between PowerShell and CorelDRAW (X7 shipped both builds).

Phase 5 design: a long-lived `powershell.exe -NoProfile -ExecutionPolicy Bypass -File corel-bridge.ps1`
process, spoken to via **JSON lines on stdin/stdout, each line Base64-encoded UTF-8** (avoids console
code-page corruption of names like *Ñuñez*). Commands: `connect`, `inspectTemplate`, `beginBatch`
(copy template to temp, open once), `generateOne` (set texts, SaveAs), `endBatch`, `exportPreview`.
Node owns the loop, so progress, cancellation between records, and per-record timeouts live in TypeScript.
The adapter interface is already defined in `src/main/services/corel/CorelAdapter.ts`, with a mock in `MockCorelAdapter.ts`
(it writes `.mock.json` files, never `.cdr`, so mock output can't be mistaken for real output).

## 4. Pitfalls found during the PoC (keep these in the bridge)

1. **Windows PowerShell 5.1 reads BOM-less `.ps1` files as ANSI.** Any non-ASCII literal breaks parsing. Bridge scripts must be ASCII-only; data arrives encoded.
2. **`Application.CreateShapeRangeFromArray` (ParamArray) cannot be called from PowerShell.** Use `CreateShapeRange()` + `.Add()`.
3. **`Document.SaveAs(path)` with one argument fails from PowerShell** ("Cannot convert … string to type string"): the binder treats it as a parameterized property. Always pass a `StructSaveAsOptions`.
4. Calling a method on the wrong object (`Layer.CreateShapeRangeFromArray`) fails at runtime only; there is no type checking with late binding. Every call needs to run against a real CorelDRAW.
5. `Shape.PositionX/Y` is the bounding box, not the text anchor. Overflow and alignment checks must use the right properties.

## 5. Template convention (proposal for the client)

Each variable text object in the CDR template gets a **name** in Object Manager, e.g.
`FullName`, `JobTitle`, `Mobile`, `Telephone`, `Email`, `Address`. Static design elements stay unnamed.
The app lists named text objects and the user maps spreadsheet columns to them. No `{{tokens}}` are
needed in the artwork, so the designer keeps the file looking like a real card.

## 6. Running the PoC on the client's machine (required before Phase 5)

1. Copy `scripts\corel-poc.ps1` to the client PC.
2. In the client's real template, name the name text object `FullName` (Object Manager → double-click name).
3. Run:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File corel-poc.ps1 -Template "C:\path\template.cdr" -ShapeName FullName
   ```
   Add `-CreateTestTemplate` (and omit `-Template`) to test without a real template first.
4. Send back the `poc-report-*.json` and the generated `poc-output-*.cdr` from `%TEMP%\cardforge-poc`.
5. Open the output in X7 and confirm the layout visually.

Exit code 0 / `RESULT: PASS` means all five steps passed on that machine.

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Client's X7 edition/licence blocks automation | Blocks Phase 5 | PoC on client PC first; fallback is a VBA macro (GMS) run inside CorelDRAW that reads a JSON/CSV file the app writes. |
| Modal dialogs (licence, crash recovery) block COM calls | Batch hangs | Per-call timeout; kill and restart the bridge; document "close CorelDRAW before generating". |
| Mixed-format text objects lose formatting on replace | Wrong output | Test on the real template; if needed, replace per text range instead of whole story. |
| Text overflow in fixed frames | Cut-off text on print | Detect with CorelDRAW-side measurement after replacement; flag in preview. |
| Fonts missing on the production PC | Substituted fonts | Template inspection reports fonts used; warn when a font is not installed. |
| Performance | Long batches | Open the template once per batch, replace + SaveAs per record. v27 dev timings: ~0.1 s replace, ~0.3 s save. Benchmark on client PC. |
