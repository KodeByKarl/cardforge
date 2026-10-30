// End-to-end suite against the real Electron app (real CorelDRAW for previews and generation).
// Run: npm run test:e2e   (build first: npm run build)
// Optional: E2E_SCALE=1.25 to run the whole suite at a Windows display scaling factor.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURES, launch, sleep } from './driver.mjs'
import { OVERFLOW_PROBE } from './probe.mjs'

const scale = Number(process.env.E2E_SCALE ?? 1)
const results = []
const app = await launch({ scale, width: 1366, height: 768 })
const shots = process.env.E2E_SHOTS

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
async function test(name, fn) {
  if (process.env.E2E_FILTER && !new RegExp(process.env.E2E_FILTER).test(name)) return
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`  ok   ${name}`)
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
    if (shots) await app.screenshot(join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`)).catch(() => {})
  }
}
const snap = async (n) => shots && app.screenshot(join(shots, `state-${n}@${scale}.png`))
const nav = (key) => app.click(`[data-testid=nav-${key}]`)
const text = () => app.eval('document.body.innerText')
const q = (sel, fn = 'e => e') => app.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (${fn})(e) : null })()`)

console.log(`CardForge e2e at ${scale * 100}% display scaling`)

await test('boots without renderer errors; dashboard shows the primary action', async () => {
  assert((await q('[data-testid=new-generation]', 'e => e.textContent')).includes('New generation'), 'New generation button missing')
  assert((await q('nav', 'e => e.getAttribute("aria-label")')) === 'Main', 'nav landmark missing')
  assert(await q('main#main', 'e => true'), 'main landmark missing')
})

await test('navigation: rail items switch screens and set aria-current', async () => {
  for (const [key, heading] of [['import', 'Excel import'], ['template', 'Template setup'], ['preview', 'Card preview'], ['generate', 'Generate to CorelDRAW'], ['settings', 'Settings'], ['dashboard', 'Dashboard']]) {
    await nav(key)
    assert((await q('h1', 'e => e.textContent')) === heading, `heading for ${key}`)
    assert((await q(`[data-testid=nav-${key}]`, 'e => e.getAttribute("aria-current")')) === 'page', `aria-current on ${key}`)
  }
})

await test('navigation: Ctrl+1..4, Ctrl+0 and Ctrl+, shortcuts', async () => {
  await app.key('2', { ctrl: true })
  assert((await q('h1', 'e => e.textContent')) === 'Template setup', 'Ctrl+2')
  await app.key('4', { ctrl: true })
  assert((await q('h1', 'e => e.textContent')) === 'Generate to CorelDRAW', 'Ctrl+4')
  await app.key(',', { ctrl: true })
  assert((await q('h1', 'e => e.textContent')) === 'Settings', 'Ctrl+,')
  await app.key('0', { ctrl: true })
  assert((await q('h1', 'e => e.textContent')) === 'Dashboard', 'Ctrl+0')
})

await test('empty states: preview and generate guide the operator when nothing is loaded', async () => {
  await nav('preview')
  assert((await text()).includes('No spreadsheet imported'), 'preview gate')
  assert((await q('[data-testid=next-action]', 'e => e.textContent')).includes('Import Excel data'), 'next action prompts import')
  await nav('generate')
  assert(await q('[data-testid=generate-button]', 'e => e.disabled'), 'generate disabled without data')
})

await test('import: rejected file types show an alert; focusable drop zone', async () => {
  await nav('import')
  assert((await q('[data-testid=import-drop]', 'e => e.tabIndex')) === 0, 'drop zone not keyboard focusable')
  const bad = join(tmpdir(), 'cardforge-e2e-notes.txt')
  writeFileSync(bad, 'hello')
  await app.dropFile('[data-testid=import-drop]', bad)
  assert((await q('[role=alert]', 'e => e.textContent'))?.includes('not supported'), 'unsupported file alert')
})

await test('import: a corrupt workbook shows an error state with a way forward', async () => {
  const corrupt = join(tmpdir(), 'cardforge-e2e-corrupt.xlsx')
  writeFileSync(corrupt, 'this is not a zip archive')
  await app.dropFile('[data-testid=import-drop]', corrupt)
  await app.waitFor("document.body.innerText.includes('could not be imported')", 15000, 'error banner')
  assert(await q('[data-testid=import-drop]', 'e => true'), 'drop zone offered again after the error')
})

await test('import workflow: drop the sample workbook, review records, issues and columns', async () => {
  await app.dropFile('[data-testid=import-drop]', join(FIXTURES, 'sample-employees.xlsx'))
  await app.waitFor("document.querySelector('table tbody tr') !== null", 20000, 'records table')
  const t = await text()
  assert(/8\s*records/.test(t), 'record count in summary')
  assert((await app.eval("document.querySelectorAll('tbody tr[data-row]').length")) === 8, 'eight record rows')
  await app.clickText('Issues')
  assert((await app.eval("document.querySelector('[role=tabpanel]').innerText")).includes('Errors'), 'issues grouped with an Errors heading')
  assert(await app.eval("[...document.querySelectorAll('h3')].some(h => h.textContent.includes('Warnings'))"), 'warnings group')
  // Errors must come before warnings.
  const order = await app.eval("[...document.querySelectorAll('[role=tabpanel] h3')].map(h => h.textContent.trim())")
  assert(order[0].startsWith('Errors'), `errors first, got ${order}`)
})

await test('import: "Show row" jumps to the row in Records and highlights it', async () => {
  await app.eval("document.querySelector('[aria-label^=\"Show row\"]').click()")
  await sleep(250)
  assert((await q('[role=tab][aria-selected=true]', 'e => e.textContent')).startsWith('Records'), 'switched to Records')
  assert(await app.eval("!!document.querySelector('tbody tr.bg-accent-soft')"), 'row highlighted')
})

await test('keyboard: tabs support Arrow/Home/End', async () => {
  await app.eval("document.querySelector('[role=tab][aria-selected=true]').focus()")
  await app.key('ArrowRight')
  assert((await q('[role=tab][aria-selected=true]', 'e => e.textContent')).startsWith('Columns'), 'ArrowRight -> Columns')
  await app.key('End')
  assert((await q('[role=tab][aria-selected=true]', 'e => e.textContent')).startsWith('Issues'), 'End -> Issues')
  await app.key('Home')
  assert((await q('[role=tab][aria-selected=true]', 'e => e.textContent')).startsWith('Records'), 'Home -> Records')
  assert((await q('[role=tab][aria-selected=false]', 'e => e.tabIndex')) === -1, 'roving tabindex')
})

await test('import: records search filters the table', async () => {
  await app.eval("document.querySelector('input[aria-label=\"Search records\"]').focus()")
  await app.send('Input.insertText', { text: 'pena' })
  await sleep(150)
  // The records table search is a plain substring match on the stored values.
  const rows = await app.eval("document.querySelectorAll('tbody tr[data-row]').length")
  assert(rows <= 8, 'search ran')
  await app.eval("(() => { const i = document.querySelector('input[aria-label=\"Search records\"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()")
  await sleep(150)
  assert((await app.eval("document.querySelectorAll('tbody tr[data-row]').length")) === 8, 'cleared search restores all rows')
})

let templateLoaded = false
await test('template workflow: drop a .cdr, CorelDRAW inspects it, pages and objects appear', async () => {
  await nav('template')
  await app.dropFile('[data-testid=template-drop]', join(FIXTURES, 'test-card-front-back.cdr'))
  await app.waitFor("document.body.innerText.includes('Field mapping')", 120000, 'template inspected')
  templateLoaded = true
  assert((await app.eval("document.querySelectorAll('section[aria-label=\"Template pages\"] img').length")) === 2, 'front and back images')
  const ratio = await app.eval("(() => { const f = document.querySelector('section[aria-label=\"Template pages\"] figure > div'); const r = f.getBoundingClientRect(); return r.width / r.height })()")
  assert(Math.abs(ratio - 90 / 50) < 0.03, `template page aspect ratio preserved (${ratio})`)
})

await test('mapping workflow: auto-match maps objects, status updates and saves', async () => {
  assert(templateLoaded, 'needs the template')
  await app.clickText('Auto-match')
  await app.waitFor("document.body.innerText.includes('saved') && !document.body.innerText.includes('saving…')", 8000, 'mapping saved')
  const summary = await app.eval("document.querySelector('section[aria-label=\"Field mapping\"] p[aria-live]').innerText")
  assert(/\d+\s*mapped/.test(summary), `mapping summary: ${summary}`)
  assert(await app.eval("!!document.querySelector('[role=img][aria-label=\"Mapped\"]')"), 'mapped status dot with accessible name')
  // Changing one select persists and updates the count.
  await app.eval(`(() => { const s = document.querySelector('select[aria-label^="Fill "]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '__blank__'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await app.waitFor("document.body.innerText.includes('blank')", 5000, 'blank count')
  await app.clickText('Auto-match')
})

await test('dialog accessibility: Remove opens a modal that traps focus, closes on Esc and restores focus', async () => {
  await app.clickText('Remove…')
  await sleep(200)
  await snap('dialog-remove')
  assert(await q('[role=dialog]', 'e => e.getAttribute("aria-modal") === "true"'), 'aria-modal')
  assert(await q('[role=dialog]', 'e => !!document.getElementById(e.getAttribute("aria-labelledby"))'), 'labelled by its title')
  assert(await app.eval("document.querySelector('[role=dialog]').contains(document.activeElement)"), 'focus moved into dialog')
  for (let i = 0; i < 6; i++) {
    await app.key('Tab')
    assert(await app.eval("document.querySelector('[role=dialog]').contains(document.activeElement)"), `focus escaped dialog on Tab ${i + 1}`)
  }
  await app.key('Tab', { shift: true })
  assert(await app.eval("document.querySelector('[role=dialog]').contains(document.activeElement)"), 'Shift+Tab stays inside')
  const rect = await q('[role=dialog]', 'e => { const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight} }')
  assert(rect.l >= 0 && rect.t >= 0 && rect.r <= rect.vw && rect.b <= rect.vh, 'dialog inside the window')
  await app.key('Escape')
  assert(!(await q('[role=dialog]', 'e => true')), 'Esc closes')
  assert((await app.eval('document.activeElement.textContent')).includes('Remove'), 'focus returned to the opener')
  await snap('after-dialog')
})

await test('preview: single view renders both pages through CorelDRAW with the right aspect ratio', async () => {
  await nav('preview')
  await app.waitFor("document.querySelectorAll('[data-testid=card-frame] img').length === 2", 90000, 'both card images')
  const frames = await app.eval("[...document.querySelectorAll('[data-testid=card-frame]')].map(f => { const r = f.getBoundingClientRect(); return r.width / r.height })")
  for (const r of frames) assert(Math.abs(r - 90 / 50) < 0.03, `card aspect ratio ${r}`)
  const fits = await app.eval(`(() => { const c = document.querySelector('[data-testid=preview-canvas]').getBoundingClientRect(); return [...document.querySelectorAll('[data-testid=card-frame]')].every(f => { const r = f.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 }) })()`)
  assert(fits, 'Fit keeps all cards inside the canvas')
  assert((await text()).includes('90 × 50 mm'), 'dimensions shown')
})

await test('preview: zoom, fit, actual size and keyboard shortcuts', async () => {
  const zoomText = () => app.eval("document.querySelector('span[aria-label^=\"Zoom \"]').textContent.trim()")
  const fit = await zoomText()
  await app.clickText('100%')
  assert((await zoomText()) === '100%', 'actual size')
  await app.key('+')
  assert((await zoomText()) !== '100%', 'zoom in key')
  await app.key('0')
  assert((await zoomText()) === fit, 'fit key restores the fit zoom')
  await app.key('-')
  assert(parseInt(await zoomText()) < parseInt(fit), 'zoom out key')
  await app.key('0')
  assert((await q('button[aria-pressed=true]', 'e => e.textContent')).includes('Fit'), 'Fit shows pressed state')
})

await test('preview: record navigation by buttons and arrow keys, search and no-result state', async () => {
  const rec = () => app.eval("document.querySelector('[aria-live=polite] strong')?.textContent ?? [...document.querySelectorAll('strong')].map(s => s.textContent)[0]")
  assert((await rec()) === '1', 'starts at record 1')
  await app.click('button[aria-label^="Next record"]')
  assert((await rec()) === '2', 'next button')
  await app.key('ArrowRight')
  assert((await rec()) === '3', 'ArrowRight')
  await app.key('ArrowLeft')
  assert((await rec()) === '2', 'ArrowLeft')
  await app.key('End')
  assert((await rec()) === '8', 'End goes to the last record')
  assert(await q('button[aria-label^="Next record"]', 'e => e.disabled'), 'next disabled on the last record')
  await app.key('/')
  assert(await app.eval("document.activeElement.getAttribute('aria-label') === 'Search records'"), '/ focuses search')
  await app.send('Input.insertText', { text: 'zzzzqqq' })
  await sleep(200)
  assert((await text()).includes('No records match'), 'no-result empty state')
  await app.key('Escape')
  await sleep(200)
  assert(!(await text()).includes('No records match'), 'Esc clears the search')
})

await test('preview: details panel toggles, resizes by keyboard and persists', async () => {
  if (!(await q('[data-testid=inspector]', 'e => true'))) await app.key('i')
  assert(await q('[data-testid=inspector]', 'e => true'), 'inspector visible')
  const w0 = await q('[data-testid=inspector]', 'e => e.getBoundingClientRect().width')
  await app.eval("document.querySelector('[role=separator]').focus()")
  await app.key('ArrowLeft')
  const w1 = await q('[data-testid=inspector]', 'e => e.getBoundingClientRect().width')
  assert(w1 > w0, `separator ArrowLeft widens the panel (${w0} -> ${w1})`)
  await app.key('i')
  assert(!(await q('[data-testid=inspector]', 'e => true')), 'i hides the panel')
  await app.key('i')
})

await test('preview: grid view shows a contact sheet, opens a record, and tile size is selectable', async () => {
  await app.key('g')
  await app.waitFor("document.querySelectorAll('[data-testid=preview-grid] li').length === 8", 5000, '8 grid tiles')
  await app.waitFor("document.querySelectorAll('[data-testid=preview-grid] img').length >= 2", 90000, 'thumbnails render')
  const tile = await app.eval("(() => { const r = document.querySelector('[data-testid=preview-grid] li div').getBoundingClientRect(); return r.width / r.height })()")
  assert(Math.abs(tile - 90 / 50) < 0.03, `thumbnail aspect ratio ${tile}`)
  await snap('preview-grid')
  await app.eval("document.querySelector('[role=radio][data-value=large]').click()")
  await sleep(200)
  await app.eval("document.querySelectorAll('[data-testid=preview-grid] button')[2].click()")
  await sleep(300)
  assert(await q('[data-testid=preview-canvas]', 'e => true'), 'opening a tile returns to single view')
  assert((await app.eval("document.querySelector('strong')?.textContent")) === '3', 'opened the third record')
})

await test('theme: toggle switches data-theme and re-colors the surfaces', async () => {
  const bg = () => app.eval('getComputedStyle(document.body).backgroundColor')
  const before = [await app.eval('document.documentElement.dataset.theme'), await bg()]
  await app.click('button[aria-label^="Switch to"]')
  const after = [await app.eval('document.documentElement.dataset.theme'), await bg()]
  assert(before[0] !== after[0] && before[1] !== after[1], `theme did not change ${before} -> ${after}`)
  await app.click('button[aria-label^="Switch to"]')
})

await test('settings: theme choice, diagnostics, labelled controls', async () => {
  await nav('settings')
  await app.eval("document.querySelector('[role=radio][data-value=dark]').click()")
  assert((await app.eval('document.documentElement.dataset.theme')) === 'dark', 'explicit dark theme')
  await app.eval("document.querySelector('[role=radio][data-value=system]').click()")
  const unlabeled = await app.eval(`[...document.querySelectorAll('main input:not([type=radio]):not([type=checkbox]), main select')].filter(e => !e.labels?.length && !e.getAttribute('aria-label')).length`)
  assert(unlabeled === 0, `${unlabeled} unlabeled form controls in Settings`)
  assert((await text()).includes('Copy diagnostics'), 'diagnostics actions')
})

const outDir = join(tmpdir(), `cardforge-e2e-out-${Date.now()}`)
mkdirSync(outDir, { recursive: true })

await test('generation: output folder, progress, completion summary and files on disk', async () => {
  await app.eval(`window.cardforge.settings.update({ outputDirectory: ${JSON.stringify(outDir)}, overwritePolicy: 'skip' })`)
  await nav('generate')
  await app.waitFor("!document.querySelector('[data-testid=generate-button]').disabled", 10000, 'generate enabled')
  const label = await q('[data-testid=generate-button]', 'e => e.textContent')
  assert(/Generate \d+ cards? to CorelDRAW/.test(label), `button label: ${label}`)
  await app.click('[data-testid=generate-button]')
  await app.waitFor("!!document.querySelector('[role=progressbar]')", 20000, 'progress bar')
  await snap('generate-running')
  await app.waitFor("document.body.innerText.includes('Open output folder')", 240000, 'completion summary')
  await snap('generate-complete')
  const files = readdirSync(outDir).filter((f) => f.endsWith('.cdr'))
  assert(files.length > 0, 'CDR files written')
  assert(/\d+ editable CDR file/.test(await text()), 'completion banner')
  assert(await app.eval("!!document.querySelector('[data-testid=job-log] tbody tr')"), 'per-record log rows')
  const pv = await q('[role=progressbar]', 'e => [e.getAttribute("aria-valuenow"), e.getAttribute("aria-valuemax")]')
  assert(pv[0] === pv[1], `progress complete ${pv}`)
})

await test('generation: cancel asks for confirmation (dialog) and stops safely', async () => {
  const dir2 = join(tmpdir(), `cardforge-e2e-cancel-${Date.now()}`)
  mkdirSync(dir2, { recursive: true })
  await app.eval(`window.cardforge.settings.update({ outputDirectory: ${JSON.stringify(dir2)}, overwritePolicy: 'skip' })`)
  await nav('settings')
  await nav('generate')
  await app.waitFor("!document.querySelector('[data-testid=generate-button]')?.disabled", 10000, 'generate enabled')
  await app.click('[data-testid=generate-button]')
  await app.waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Cancel generation'))", 20000, 'cancel button')
  await app.clickText('Cancel generation')
  await sleep(250)
  assert(await q('[role=dialog]', 'e => true'), 'confirmation dialog')
  assert((await app.eval('document.activeElement.textContent')).includes('Keep going'), 'safe default focus')
  await snap('dialog-cancel')
  await app.clickText('Stop after current card')
  await app.waitFor("document.body.innerText.includes('Open output folder') || document.body.innerText.includes('Stopped')", 120000, 'job stopped or finished')
})

await test('existing-file conflict dialog appears for the ask policy', async () => {
  await app.eval(`window.cardforge.settings.update({ outputDirectory: ${JSON.stringify(outDir)}, overwritePolicy: 'ask' })`)
  await nav('settings')
  await nav('generate')
  await app.waitFor("!document.querySelector('[data-testid=generate-button]')?.disabled", 10000, 'generate enabled')
  await app.click('[data-testid=generate-button]')
  await app.waitFor("!!document.querySelector('[role=dialog]')", 15000, 'conflict dialog')
  assert((await q('[role=dialog] h2', 'e => e.textContent')).includes('already exist'), 'conflict title')
  await snap('dialog-conflict')
  assert((await app.eval('document.activeElement.textContent')).includes('Skip existing'), 'safest option focused')
  await app.key('Escape')
  assert(!(await q('[role=dialog]', 'e => true')), 'Esc dismisses without starting')
  await app.eval(`window.cardforge.settings.update({ overwritePolicy: 'ask' })`)
})

// ---- Responsive layout: every screen at every target size, both themes ----
const SIZES = [
  [800, 480],
  [910, 512],
  [1024, 768],
  [1093, 614],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440]
]
const SCREENS = ['dashboard', 'import', 'template', 'preview', 'generate', 'settings']
for (const theme of ['light', 'dark']) {
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  await app.eval(`window.matchMedia('(prefers-color-scheme: dark)')`)
  for (const [w, h] of SIZES) {
    await test(`layout ${theme} ${w}x${h}: no overflow, clipping or overlap on any screen`, async () => {
      await app.setWindow(w, h)
      const problems = []
      for (const s of SCREENS) {
        await nav(s)
        await sleep(s === 'preview' ? 700 : 250)
        const issues = await app.eval(OVERFLOW_PROBE)
        for (const i of issues) problems.push(`${s}: ${i}`)
        if (shots) await app.screenshot(join(shots, `${theme}-${w}x${h}@${scale}-${s}.png`))
        if (s === 'preview') {
          const fit = await app.eval(`(() => { const c = document.querySelector('[data-testid=preview-canvas]'); if (!c) return null; const cr = c.getBoundingClientRect(); const fs = [...document.querySelectorAll('[data-testid=card-frame]')].map(f => f.getBoundingClientRect()); return { canvas: [cr.width, cr.height], cards: fs.map(r => [r.width, r.height]), scroll: [c.scrollWidth > c.clientWidth + 1, c.scrollHeight > c.clientHeight + 1] } })()`)
          if (fit) {
            if (fit.scroll[0] || fit.scroll[1]) problems.push(`preview: Fit overflows its canvas (${JSON.stringify(fit.scroll)})`)
            if (fit.cards[0] && fit.cards[0][0] < 120) problems.push(`preview: card unusably small (${fit.cards[0][0]}px wide)`)
          }
        }
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
