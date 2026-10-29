# CorelDRAW Integration

**Status (2026-10-29):** Implemented and verified against **CorelDRAW v27.2.0.135** on the development PC.
**Not yet verified on CorelDRAW X7 (v17)**, the client's production version. Nothing in this document is a
claim about X7 behaviour unless marked as verified on X7. Production readiness depends on the X7 validation
in §8 passing.

## 1. Architecture

```
Electron main ── BridgeProcess (Node) ──stdin/stdout── powershell.exe corel-bridge.ps1 ──COM── CorelDRW.exe
                 PowerShellCorelAdapter implements CorelAdapter (src/main/services/corel/CorelAdapter.ts)
```

- **Why PowerShell:** Windows PowerShell 5.1 ships with every Windows 10/11 install and does late-bound COM. No
  native Node add-on to rebuild per Electron version, and a CorelDRAW hang or crash only takes down the child process.
- **Protocol:** one request in flight at a time. Each line is Base64(UTF-8 JSON). Responses are prefixed `CFB1 `.
  Base64 keeps names like *Peña-Ñuñez* or *王小明* intact regardless of the console code page.
- **Timeouts and crashes:** each call has a timeout (60 s; 120 s to open or save; 180 s to start CorelDRAW). A
  timeout kills the bridge, and the next call starts a fresh one. Document handles carry a *generation* number,
  so a handle from before a restart is rejected with `COREL_RESTARTED` rather than silently pointing at nothing.
- **Version choice:** `CorelService` uses `CorelDRAW.Application.17` (X7) when registered, otherwise the newest
  registered version (development/testing only).

## 2. Safety rules (enforced in code)

1. **Original templates are never opened by CorelDRAW.** Import copies the user's CDR into the library
   (`%APPDATA%\CardForge\templates\<id>\template.cdr`) and verifies the copy by SHA-256. Every inspection,
   preview and generation opens a fresh throwaway copy of the library file in `%TEMP%\CardForge\work`.
   Tests assert the original's hash is unchanged.
2. **Only documents opened by the bridge are touched.** CorelDRAW is quit only if the bridge started it *and* no
   documents are open. A user's unsaved work in CorelDRAW is never closed.
   (During development a probe script broke this rule and was correctly blocked; the rule is now in the bridge.)
3. **Every document the bridge opens is closed in `finally`,** including on errors. Before this rule, failed probe
   runs left four invisible, unsaved `Untitled` documents in a hidden CorelDRAW instance on the dev PC.

## 3. CorelDRAW API members used

Constants were read from the v27 type library (`CorelDRAW.tlb`), not from memory: `cdrPNG=802`,
`cdrCurrentPage=1`, `cdrRGBColorImage=4`, `cdrNormalAntiAliasing=1`, `cdrTextShape=6`, `cdrGroupShape=7`,
`cdrMillimeter=3`, `cdrParagraphText=1`, `cdrVersion17=17`, `cdrCenterAlignment=3`.

| Purpose | Member | v27 | X7 |
|---|---|---|---|
| Connect | `GetActiveObject` / `New-Object -ComObject CorelDRAW.Application.N`, `Application.Version` | ✅ | pending |
| Open / close | `Application.OpenDocument`, `Document.Close`, `Document.Dirty` | ✅ | pending |
| Units | `Document.Unit = cdrMillimeter` | ✅ | pending |
| Pages | `Document.Pages`, `Page.SizeWidth/SizeHeight/LeftX/BottomY/Activate` | ✅ | pending |
| Find objects | `Page.Shapes`, `Shape.Name/Type/Shapes` (groups), `Shape.PowerClip.Shapes` | ✅ (groups, nested groups); PowerClip untested | pending |
| Read format | `Text.Story`, `TextRange.Characters`, `.Font/.Size/.Bold/.Italic/.Alignment`, `Text.Type` | ✅ | pending |
| Replace text | `Text.Story.Text = …` (`\r` for line breaks) | ✅ | pending |
| Revert between records | `Document.BeginCommandGroup/EndCommandGroup/Undo(1)` | ✅ | pending; fallback below |
| Bounds | `Shape.LeftX/RightX/TopY/BottomY` | ✅ | pending |
| Paragraph overflow | `Text.Overflow`; fallback `Text.Frame.Range.Characters.Count < Story.Characters.Count` | ✅ both | pending |
| Page image | `Document.Export(path, cdrPNG, cdrCurrentPage, StructExportOptions, StructPaletteOptions)` with `ExportArea = CreateRect(page)` | ✅ | pending |
| Save | `Document.SaveAs(path, StructSaveAsOptions{Version=17})` | ✅ (v17 format) | pending |

## 4. Findings from testing against real CorelDRAW (all fixed in code)

| # | Finding | Consequence if missed | Fix |
|---|---|---|---|
| 1 | PowerShell 5.1 reads BOM-less `.ps1` as ANSI | Script fails to parse on accented literals | Bridge and scripts are ASCII-only (checked); data travels Base64 |
| 2 | `CreateShapeRangeFromArray` (ParamArray) cannot be called from PowerShell | — | `CreateShapeRange()` + `Add` |
| 3 | `SaveAs` / `Export` with optional struct args omitted fail ("cannot convert string to string"); `$null`/`Missing` don't help | Saving/exporting fails | Always pass `StructSaveAsOptions` / `StructPaletteOptions` |
| 4 | "Current page" export crops to the drawing's content, stretched to the requested size | **Misleading, distorted previews** | `ExportArea = CreateRect(page bounds)` |
| 5 | Replacing `Story.Text` flattens mixed formatting (bold first word lost) | Silent design change | Detected at inspection; flagged in mapping as a warning |
| 6 | After CJK text CorelDRAW switches the object to SimSun, and **later records inherit SimSun** | **Every card after one Asian name in the wrong font** | Each record is a command group, undone before the next record; regression test |
| 7 | CorelDRAW keeps the last-saved file locked | Rename into place fails (`EBUSY`) | Deferred rename: file N is moved once record N+1 is saved or the document closes |
| 8 | Paragraph frames that grow with their text never report overflow | Text off the card unflagged | Card-edge/safety-margin check applies to paragraph text too |
| 9 | `AddPages` creates Letter-size pages | Wrong back page size in test fixture | `AddPagesEx(n, w, h)`; every page's size is read individually |
| 10 | Setting empty text keeps the object | (Good: blank fields are safe) | — |
| 11 | `StructOpenOptions` has no dialog suppression | Modal dialogs can block automation | Timeouts; documented risk |
| 12 | `GetActiveObject` can't see a hidden automation instance; `New-Object` reuses it | "started vs attached" label unreliable | Quit decision relies on "no documents open", not on that label |

## 5. Preview fidelity

Previews are **rendered by CorelDRAW itself**: the record's text is written into a working copy of the template
and the page is exported to PNG at a resolution matched to the zoom level (96 dpi for grid thumbnails, up to
450 dpi for the single view). There is no HTML re-creation of the design. What you see is CorelDRAW's
rendering with CorelDRAW's fonts. Overflow warnings come from CorelDRAW measurements:
- paragraph text: the frame overflows (`Text.Overflow`)
- any text: its bounds extend past the card edge or into the safety margin (Settings, default 3 mm)

Limits: an artistic text that stays inside the card but collides with other artwork is **not** detected. The
operator must look at the preview. Screen size at "Actual size" depends on Windows display scaling.

Measured on the dev PC (v27): about 85–105 ms per single-page preview.

## 6. Generation

- One editable CDR per record, saved in **X7 (v17) format**. The working copy is opened once per job.
- Per record: undo the previous record, apply values, save to `~cardforge-<job>-<n>.tmp.cdr`, then move to the
  final name (deferred, see finding 7). A crash never leaves a half-written card under its final name.
- One job at a time; cancel takes effect between records; per-record failures are logged and the job continues.
  After 3 consecutive bridge crashes or timeouts the job stops.
- Existing files: *ask* (default: plan first, the operator chooses skip / suffix / overwrite), *skip*, or *suffix*.
  Nothing is overwritten without an explicit choice.
- A JSON report (`cardforge-report-<timestamp>.json`) is written next to the outputs. It includes the CorelDRAW
  version and, when that isn't X7, a note that X7 validation is pending.

**Benchmark (dev PC, CorelDRAW v27, 2-page template, 12 records):** about 0.4 s per card in steady state; about
1.8 s for cards needing font fallback (CJK); 12 cards ≈ 8.6 s including opening the template.
**These are not X7 numbers.** Benchmark on the client's PC before promising throughput.

## 7. Template convention (for the client's designer)

- Name each variable text object in CorelDRAW's **Object Manager** (e.g. `FullName`, `JobTitle`, `Mobile`,
  `Telephone`, `Email`, `Address`, `Company`). Objects may sit inside groups (any depth).
- Page 1 is the front, page 2 the back (optional). Pages can differ in size.
- Avoid mixed formatting inside one variable object (e.g. bold first name + regular surname in one text). Use
  two objects instead, or accept that replacement applies one formatting to the whole object.
- Unnamed text is static artwork and is never touched.

## 8. X7 validation procedure (required before production)

On the client's PC with CorelDRAW X7:
1. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\corel-poc.ps1 -CreateTestTemplate -QuitWhenDone`
   → must print `RESULT: PASS`. Then repeat with `-Template <client template.cdr> -ShapeName <a named object>`.
2. With Node.js available: `npm run test:corel`. It picks X7 automatically when registered. All tests must pass.
3. In the app: import the client template, map, preview 5 records (incl. longest name and any non-Latin name),
   generate a batch of 20, open several outputs in X7 and compare against the preview.
4. Record the per-card time from the job report and the results in TEST_REPORT.md.

Specific X7 questions: does `Text.Overflow` exist (fallback is automatic)? Do `BeginCommandGroup`/`Undo`
work over COM (fallback: explicit restore of text, font, size, bold, italic; the bridge reports `revertMode`)?
Does `ExportArea` behave the same? Does X7's edition/licence allow COM automation at all?

## 9. Remaining risks

| Risk | Mitigation |
|---|---|
| X7 lacks or differs in a member above | Fallbacks for overflow and revert; others need code changes after the X7 run |
| Edition/licence blocks automation | PoC detects it in minutes; fallback would be an in-CorelDRAW VBA macro |
| Modal dialogs (missing fonts, recovery, updates) block COM | Timeouts + bridge restart; ask operators to close dialogs and keep CorelDRAW idle |
| Missing fonts on the production PC | Fonts are listed per object in Template setup; previews show CorelDRAW's actual substitution |
| PowerClip contents, text on path, master-page objects | Groups verified; PowerClip search implemented but untested; master-page objects are not searched |
