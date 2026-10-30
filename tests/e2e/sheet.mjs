// End-to-end suite for the card-sheet workflow (real Electron + real CorelDRAW). SYNTHETIC data only: nothing from the client is used.
// Run: npm run test:e2e:sheet   (build first: npm run build)
// Scenario: 40,897 synthetic records (header on row 3) -> prepare a 10-up template -> map -> preview -> generate.
import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURES, launch, sleep } from './driver.mjs'
import { OVERFLOW_PROBE } from './probe.mjs'

const scale = Number(process.env.E2E_SCALE ?? 1)
const shots = process.env.E2E_SHOTS
const BIG = 40_897
const results = []
const app = await launch({ scale, width: 1366, height: 768 })

const assert = (c, m) => {
  if (!c) throw new Error(m)
}
async function test(name, fn) {
  if (process.env.E2E_FILTER && !new RegExp(process.env.E2E_FILTER).test(name)) return
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (err) {
    results.push({ name, ok: false, err: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
    if (shots) await app.screenshot(join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`)).catch(() => {})
  }
}
const snap = async (n) => shots && app.screenshot(join(shots, `sheet-${n}@${scale}.png`))
const nav = (key) => app.click(`[data-testid=nav-${key}]`)
const text = () => app.eval('document.body.innerText')
const q = (sel, fn = 'e => e') => app.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (${fn})(e) : null })()`)
const setInput = (sel, value) =>
  app.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); const proto = i.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(i, ${JSON.stringify(String(value))}); i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })()`)

async function writeWorkbook(file, records) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('sample list')
  ws.getCell(1, 1).value = 'SYNTHETIC SAMPLE LIST'
  ws.getRow(3).values = ['CONTROL NO.', 'FULL NAME', 'BIRTHDATE', 'ADDRESS']
  for (let i = 0; i < records; i++) {
    const n = String(i + 1).padStart(6, '0')
    ws.getRow(4 + i).values = [`PL ${n}`, `SURNAME${n},GIVEN${n} MIDDLE`, '', `BARANGAY ${(i % 40) + 1}, SAMPLE CITY, PROVINCE`]
  }
  await wb.xlsx.writeFile(file)
}

const outDir = join(tmpdir(), `cardforge-sheet-out-${Date.now()}`)
mkdirSync(outDir, { recursive: true })
const dir = join(tmpdir(), `cardforge-sheet-e2e-${Date.now()}`)
mkdirSync(dir, { recursive: true })
const bigFile = join(dir, 'synthetic-big.xlsx')
const smallFile = join(dir, 'synthetic-small.xlsx')
await writeWorkbook(bigFile, BIG)
await writeWorkbook(smallFile, 47)
console.log(`CardForge sheet e2e at ${scale * 100}% scaling`)

await test('large import: 40,897 records, header on row 3, progress shown, no truncation', async () => {
  await nav('import')
  const t0 = Date.now()
  await app.dropFile('[data-testid=import-drop]', bigFile)
  await app.waitFor("document.querySelector('tbody tr[data-row]') !== null", 120000, 'records table')
  const secs = (Date.now() - t0) / 1000
  console.log(`       imported in ${secs.toFixed(1)}s`)
  const t = await text()
  assert(t.includes(BIG.toLocaleString('en-US')), `record count ${BIG.toLocaleString('en-US')} shown`)
  assert(!t.includes('cut off'), 'no truncation banner')
  assert((await app.eval("document.querySelectorAll('tbody tr[data-row]').length")) === 100, 'table is paged (100 rows), not 40,897 DOM rows')
  assert((await app.eval("document.querySelector('tbody tr[data-row]').dataset.row")) === '4', 'first record is spreadsheet row 4')
  assert(secs < 90, `import took ${secs}s`)
  await snap('import-large')
})

await test('large import: control number is required + unique, name required, no false duplicate issues', async () => {
  await app.clickText('Columns')
  const flags = await app.eval(`[...document.querySelectorAll('[role=tabpanel] tbody tr')].map(r => ({ h: r.children[2].textContent.trim(), req: r.querySelector('input[aria-label$="required"]')?.checked, uid: r.querySelector('input[aria-label$="unique identifier"]')?.checked }))`)
  const ctrl = flags.find((f) => f.h === 'CONTROL NO.')
  assert(ctrl.req && ctrl.uid, 'CONTROL NO. required + unique ' + JSON.stringify(ctrl))
  assert(flags.find((f) => f.h === 'FULL NAME').req, 'FULL NAME required')
  await app.clickText('Issues')
  assert((await app.eval("document.querySelector('[role=tabpanel]').innerText")).includes('No issues'), 'no issues for clean data')
  await app.clickText('Records')
})

let prepared = false
await test('template: unnamed 10-up sheet is detected as 2 x 5 = 10 cards and shown on the page', async () => {
  await nav('template')
  await app.dropFile('[data-testid=template-drop]', join(FIXTURES, 'sheet-10up-layout.cdr'))
  await app.waitFor("!!document.querySelector('[data-testid=sheet-detected]')", 150000, 'sheet detection')
  assert((await q('[data-testid=sheet-cell-count]', 'e => e.textContent')) === '10', '10 cards')
  assert((await q('[data-testid=sheet-detected]', 'e => e.textContent')).includes('2 columns × 5 rows'), '2 x 5')
  assert((await app.eval("document.querySelectorAll('section[aria-label=\"Template pages\"] .border-dashed').length")) >= 10, 'numbered outlines drawn on the page')
  await snap('template-detected')
})

await test('template: preparing names the objects in the private copy and switches to card-field mapping', async () => {
  await app.click('[data-testid=prepare-sheet]')
  await app.waitFor("!!document.querySelector('[data-testid=sheet-mapping]')", 240000, 'prepared')
  prepared = true
  assert((await text()).includes('Card sheet · 10 cards'), 'sheet badge')
  assert((await app.eval("document.querySelectorAll('[data-testid=sheet-mapping] select').length")) >= 3, 'selects for name + address + control lines')
})

await test('mapping: auto-match, prefix discrepancy blocks until the client confirmation is ticked', async () => {
  assert(prepared, 'needs prepared template')
  await app.clickText('Auto-match')
  await app.waitFor("document.querySelector('[data-testid=sheet-mapping]').innerText.includes('saved')", 8000, 'saved')
  const sel = await app.eval("[...document.querySelectorAll('[data-testid=sheet-mapping] select')].map(s => s.selectedOptions[0].textContent)")
  assert(sel.includes('FULL NAME') && sel.includes('ADDRESS') && sel.includes('CONTROL NO.'), 'suggested mapping ' + sel)
  assert((await q('[data-testid=sheet-issues] [role=alert]', 'e => e.textContent'))?.includes('does not convert prefixes'), 'prefix discrepancy flagged')
  await nav('preview')
  assert((await text()).includes('field mapping has errors'), 'preview is blocked until confirmed')
  await nav('template')
  await app.click('[data-testid=ack-prefix]')
  await app.waitFor("document.querySelector('[data-testid=sheet-mapping]').innerText.includes('saved')", 8000, 'ack saved')
  assert(!(await q('[data-testid=sheet-issues] [role=alert]', 'e => e.textContent')), 'blocking alert cleared after confirmation')
  await snap('template-mapped')
})

await test('sheet preview: A4 page rendered by CorelDRAW, 10 cards, correct aspect ratio, sheet 1 of 4,090', async () => {
  await nav('preview')
  await app.waitFor("!!document.querySelector('[data-testid=sheet-frame] img')", 120000, 'sheet image')
  const t = await q('[data-testid=sheet-position]', 'e => e.textContent')
  assert(t.replace(/\s+/g, ' ').includes('Sheet 1 of 4,090'), 'position: ' + t)
  const ratio = await q('[data-testid=sheet-frame]', 'e => { const r = e.getBoundingClientRect(); return r.width / r.height }')
  assert(Math.abs(ratio - 210 / 297) < 0.01, 'A4 aspect ratio ' + ratio)
  assert((await app.eval("document.querySelectorAll('[data-testid^=cell-]').length")) === 10, '10 clickable card positions')
  const fits = await app.eval(`(() => { const c = document.querySelector('[data-testid=sheet-canvas]'); return c.scrollHeight <= c.clientHeight + 1 && c.scrollWidth <= c.clientWidth + 1 })()`)
  assert(fits, 'Fit shows the whole sheet without scrolling')
  await snap('preview-sheet1')
})

await test('sheet preview: clicking a card shows its record (unique per card) and a magnified crop', async () => {
  await app.click('[data-testid=cell-3]')
  await app.waitFor("!!document.querySelector('[data-testid=card-detail]')", 20000, 'card detail')
  const d = await q('[data-testid=card-detail]', 'e => e.innerText')
  assert(d.includes('Card 3') && d.includes('row 6'), 'third card = spreadsheet row 6: ' + d.slice(0, 80))
  assert(d.includes('SURNAME000003'), 'shows the record printed on card 3')
  await snap('preview-card')
  await app.key('Escape')
})

await test('sheet preview: search by control number jumps to the right sheet and card; Enter cycles matches', async () => {
  await app.key('/')
  await app.send('Input.insertText', { text: 'PL 000015' })
  await app.waitFor("document.querySelector('[data-testid=sheet-position]').textContent.includes('Sheet 2 ')", 8000, 'jumped to sheet 2')
  assert((await q('[data-testid=cell-5]', 'e => e.getAttribute("aria-pressed")')) === 'true', 'record 15 is card 5 of sheet 2 and is selected')
  assert((await q('[data-testid=match-status]', 'e => e.textContent')).includes('Match 1 of 1'), 'one match')
  await setInput('input[aria-label="Search by control number or name"]', '')
})

await test('sheet preview: go to sheet, keyboard navigation and the partly filled final sheet', async () => {
  await setInput('input[aria-label="Go to sheet number"]', '4090')
  await app.eval("document.querySelector('input[aria-label=\"Go to sheet number\"]').form.requestSubmit()")
  await app.waitFor("document.querySelector('[data-testid=sheet-position]').textContent.includes('4,090 of 4,090')", 8000, 'final sheet')
  await app.waitFor("!!document.querySelector('[data-testid=sheet-frame] img')", 60000, 'final sheet image')
  const empties = await app.eval("[...document.querySelectorAll('[data-testid^=cell-]')].filter(c => c.getAttribute('aria-label').includes('empty position')).length")
  assert(empties === 3, `last sheet has 7 cards and 3 empty positions, got ${empties} empty`)
  assert((await text()).includes('7 of 10 positions filled'), 'status line')
  await snap('preview-last-sheet')
  await app.eval('document.activeElement && document.activeElement.blur()')
  await app.key('Home')
  assert((await q('[data-testid=sheet-position]', 'e => e.textContent')).includes('Sheet 1 '), 'Home -> first sheet')
  await app.key('ArrowRight')
  assert((await q('[data-testid=sheet-position]', 'e => e.textContent')).includes('Sheet 2 '), 'ArrowRight -> next sheet')
  await app.key('End')
  assert((await q('[data-testid=sheet-position]', 'e => e.textContent')).includes('4,090 of 4,090'), 'End -> last sheet')
})

await test('sheet preview: zoom controls keep the page aspect ratio and Fit restores the fit', async () => {
  await app.key('1')
  const r = await q('[data-testid=sheet-frame]', 'e => { const b = e.getBoundingClientRect(); return b.width / b.height }')
  assert(Math.abs(r - 210 / 297) < 0.01, 'aspect ratio at 100%')
  await app.key('0')
  const fits = await app.eval(`(() => { const c = document.querySelector('[data-testid=sheet-canvas]'); return c.scrollHeight <= c.clientHeight + 1 })()`)
  assert(fits, 'fit restored')
})

await test('generate: plan shows records, sheets and files; settings are validated', async () => {
  await nav('generate')
  const plan = await q('[data-testid=gen-plan]', 'e => e.innerText')
  assert(plan.replace(/\s+/g, ' ').includes('40,897 records → 4,090 sheets → 164 files'), 'plan: ' + plan)
  assert(plan.includes('the last sheet holds 7'), 'last sheet note')
  await setInput('[data-testid=gen-sheets-per-file]', '50')
  assert((await q('[data-testid=gen-plan]', 'e => e.innerText')).replace(/\s+/g, ' ').includes('82 files'), '50 sheets per file -> 82 files')
  await setInput('[data-testid=gen-sheets-per-file]', '25')
  assert(await q('[data-testid=generate-button]', 'e => e.disabled'), 'disabled until an output folder exists')
  await snap('generate-plan')
})

await test('generate: a large job asks for confirmation before it starts (plan of 40,897 records crosses IPC quickly)', async () => {
  await app.eval(`window.cardforge.settings.update({ outputDirectory: ${JSON.stringify(outDir)} })`)
  await nav('settings')
  await nav('generate')
  await app.waitFor("!document.querySelector('[data-testid=generate-button]').disabled", 20000, 'enabled')
  const t0 = Date.now()
  await app.click('[data-testid=generate-button]')
  await app.waitFor("!!document.querySelector('[role=dialog]')", 60000, 'large-job dialog')
  console.log(`       plan + dialog in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  assert((await q('[role=dialog] h2', 'e => e.textContent')).includes('large job'), 'large job title')
  assert((await q('[role=dialog]', 'e => e.innerText')).includes('4,090 sheets'), 'dialog states the size')
  assert((await app.eval('document.activeElement.textContent')).includes('Not yet'), 'safe default focus')
  await app.key('Escape')
  assert(!(await q('[role=dialog]', 'e => true')), 'nothing started')
  assert(readdirSync(outDir).length === 0, 'no output written')
})

await test('generate: a small job end to end (47 records -> 5 sheets -> 3 files + PDF), verified output', async () => {
  // Start over with the small workbook; the saved mapping applies because the headers are the same.
  await nav('dashboard')
  await app.click('[data-testid=new-generation]')
  await app.dropFile('[data-testid=import-drop]', smallFile)
  await app.waitFor("document.querySelector('tbody tr[data-row]') !== null", 60000, 'small workbook')
  await nav('generate')
  await app.waitFor("!!document.querySelector('[data-testid=gen-plan]')", 20000, 'plan')
  await setInput('[data-testid=gen-sheets-per-file]', '2')
  await app.click('[data-testid=gen-pdf]')
  assert((await q('[data-testid=gen-plan]', 'e => e.innerText')).replace(/\s+/g, ' ').includes('47 records → 5 sheets → 3 files'), 'small plan')
  await app.waitFor("!document.querySelector('[data-testid=generate-button]').disabled", 20000, 'enabled')
  await app.click('[data-testid=generate-button]')
  await app.waitFor("!!document.querySelector('[data-testid=sheet-progress]')", 60000, 'sheet progress line')
  await snap('generate-running')
  await app.waitFor("!!document.querySelector('[data-testid=verification]')", 360000, 'completion with verification')
  await snap('generate-complete')
  const v = await q('[data-testid=verification]', 'e => e.innerText')
  assert(v.includes('Output verified'), 'verification banner: ' + v.slice(0, 120))
  const files = readdirSync(outDir)
  assert(files.filter((f) => f.endsWith('.cdr')).length === 3, 'three CDR files: ' + files.join(', '))
  assert(files.filter((f) => f.endsWith('.pdf')).length === 3, 'three PDFs')
  assert(files.some((f) => f.startsWith('cardforge-print-summary')) && files.some((f) => f.startsWith('cardforge-sheets-report')), 'summary and report written')
  const report = readFileSync(join(outDir, files.find((f) => f.startsWith('cardforge-sheets-report'))), 'utf8')
  assert(!/SURNAME|GIVEN|BARANGAY/.test(report), 'report holds no spreadsheet contents')
  assert(!files.some((f) => f.startsWith('~')), 'no temporary files left')
})

await test('generate: running again offers Resume and keeps the finished files', async () => {
  await app.click('[data-testid=generate-button]')
  await app.waitFor("!!document.querySelector('[role=dialog]')", 30000, 'resume dialog')
  assert((await q('[role=dialog] h2', 'e => e.textContent')).includes('Resume'), 'resume offered')
  assert((await app.eval('document.activeElement.textContent')).includes('Resume'), 'safest option focused')
  await snap('generate-resume-dialog')
  await app.key('Escape')
  assert(!(await q('[role=dialog]', 'e => true')), 'Esc cancels without starting')
})

// ---- Responsive layout of the sheet screens ----
const SIZES = [[800, 480], [1024, 768], [1280, 720], [1366, 768], [1920, 1080]]
const SCREENS = ['template', 'preview', 'generate']
for (const theme of ['light', 'dark']) {
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  for (const [w, h] of SIZES) {
    await test(`layout ${theme} ${w}x${h}: sheet screens have no overflow, clipping or overlap`, async () => {
      await app.setWindow(w, h)
      const problems = []
      for (const s of SCREENS) {
        await nav(s)
        await sleep(s === 'preview' ? 2500 : 400)
        for (const i of await app.eval(OVERFLOW_PROBE)) problems.push(`${s}: ${i}`)
        if (s === 'preview') {
          const fit = await app.eval(`(() => { const c = document.querySelector('[data-testid=sheet-canvas]'); const f = document.querySelector('[data-testid=sheet-frame]'); if (!c || !f) return null; const r = f.getBoundingClientRect(); return { scroll: c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1, w: r.width, ratio: r.width / r.height } })()`)
          if (!fit) problems.push('preview: no sheet workspace shown')
          else {
            if (fit.scroll) problems.push('preview: Fit overflows its canvas')
            if (Math.abs(fit.ratio - 210 / 297) > 0.01) problems.push('preview: aspect ratio distorted')
            if (fit.w < 120) problems.push('preview: sheet unusably small')
          }
        }
        if (shots) await app.screenshot(join(shots, `sheet-layout-${theme}-${w}x${h}@${scale}-${s}.png`))
      }
      assert(problems.length === 0, problems.join('; '))
    })
  }
}
await app.setWindow(1366, 768)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
const renderErrors = app.consoleErrors.filter((e) => !/Autofill|DevTools/.test(e))
if (renderErrors.length) console.log(`Renderer console errors (${renderErrors.length}):\n${renderErrors.slice(0, 8).join('\n')}`)
await app.close()
process.exit(failed.length || renderErrors.length ? 1 : 0)
