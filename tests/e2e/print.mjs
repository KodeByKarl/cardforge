// End-to-end check of the Print screen (real Electron, real CorelDRAW). Nothing reaches a printer: the app is forced onto the
// CorelDRAW version given by E2E_PRINT_PROGID (default X7 = .17). On a PC where that version cannot configure printing
// (see PRINTING.md) the job ends as "Failed (not sent)", which this test also verifies.
// Run: npm run build && node tests/e2e/print.mjs      (E2E_SHOTS=<dir> saves screenshots)
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURES, launch, sleep } from './driver.mjs'

process.env.CARDFORGE_COREL_PROGID = process.env.E2E_PRINT_PROGID ?? 'CorelDRAW.Application.17'
const shots = process.env.E2E_SHOTS
if (shots) mkdirSync(shots, { recursive: true })

// Seed a finished generation job so the Print screen has something to print.
const userData = mkdtempSync(join(tmpdir(), 'cardforge-print-e2e-'))
const out = join(userData, 'out')
mkdirSync(out)
const files = ['sheet 00001-00002.cdr', 'sheet 00003-00004.cdr'].map((n) => {
  const f = join(out, n)
  copyFileSync(join(FIXTURES, 'test-card-front-back.cdr'), f)
  return f
})
const id = '11111111-2222-4333-8444-555555555555'
writeFileSync(
  join(userData, 'jobs.json'),
  JSON.stringify([{ id, templateId: id, templateName: 'Synthetic card', corelVersion: '17', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), status: 'completed', total: 4, succeeded: 4, failed: 0, skipped: 0, outputDirectory: out, reportPath: null, files, error: null }])
)

const app = await launch({ width: 1366, height: 768, userData })
const results = []
const assert = (c, m) => {
  if (!c) throw new Error(m)
}
async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok   ${name}`)
  } catch (err) {
    results.push({ name, ok: false })
    console.log(`  FAIL ${name}\n       ${err.message}`)
    if (shots) await app.screenshot(join(shots, `print-FAIL-${name.replace(/\W+/g, '_')}.png`)).catch(() => {})
  }
}
const text = () => app.eval('document.body.innerText')
const snap = (n) => shots && app.screenshot(join(shots, `print-${n}.png`))

try {
  await test('Print screen lists the generated files and the default printer', async () => {
    await app.click('[data-testid=nav-print]')
    await app.waitFor("document.querySelectorAll('[data-testid=print-files] li').length === 2", 20000, 'two files listed')
    await app.waitFor("document.querySelector('[data-testid=print-printer]')?.value !== ''", 20000, 'printer selected')
    await snap('screen')
    const t = await text()
    assert(/sheets to print/i.test(t) && /2 of 2 selected/.test(t), 'selection summary missing')
  })

  await test('Preview renders real pages from CorelDRAW', async () => {
    await app.click('[data-testid=print-load-preview]')
    await app.waitFor("!!document.querySelector('img[alt*=\"page 1\"]')", 90000, 'preview image')
    await snap('preview')
    assert(/Page size \d+(\.\d+)? × \d+(\.\d+)? mm/.test(await text()), 'page size missing')
  })

  await test('Review dialog shows the numbers and demands explicit confirmation', async () => {
    await app.eval("(() => { const i = document.querySelector('[data-testid=print-copies]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '3'); i.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await app.click('[data-testid=print-review]')
    await app.waitFor("!!document.querySelector('[data-testid=print-total]')", 90000, 'confirm dialog')
    await snap('confirm')
    const total = await app.eval("document.querySelector('[data-testid=print-total]').textContent")
    assert(Number(total) === 2 * 2 * 3, `expected 12 total pages, got ${total}`) // 2 files x 2 pages x 3 copies
    const disabled = await app.eval("document.querySelector('[data-testid=print-confirm]').disabled")
    assert(disabled === true, 'Print must stay disabled until the acknowledgement is ticked')
  })

  await test('Confirmed job is tracked and never reports success it cannot prove', async () => {
    await app.click('[data-testid=print-ack]')
    await app.click('[data-testid=print-confirm]')
    await app.waitFor("document.querySelector('[data-testid=print-jobs]')?.innerText.match(/Failed \\(not sent\\)|Submitted|In Windows queue|Check printer/)", 120000, 'job result')
    await sleep(500)
    await snap('jobs')
    const t = await text()
    assert(!/Completed/.test(t.split('Print jobs')[1] ?? ''), 'must not claim Completed right after submitting')
    console.log('       outcome:', (t.match(/Failed \(not sent\)|Submitted|In Windows queue|Check printer/) ?? ['?'])[0])
  })
} finally {
  await app.close()
}
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
