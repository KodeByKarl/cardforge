// Screenshot sweep: every screen x window size x theme. Usage: node tests/e2e/audit-shots.mjs <outDir> [scale]
// Loads the sample workbook and test template first so data-bearing screens are exercised.
import { join } from 'node:path'
import { FIXTURES, launch, sleep } from './driver.mjs'

const out = process.argv[2] ?? 'audit-shots'
const scale = Number(process.argv[3] ?? 1)
const ALL_SIZES = [
  [800, 480],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440]
]
const SIZES = process.argv[4] ? process.argv[4].split(',').map((x) => x.split('x').map(Number)) : ALL_SIZES
const THEMES = (process.argv[5] ?? 'light,dark').split(',')
const SCREENS = ['Dashboard', 'Excel import', 'Template setup', 'Card preview', 'Generate', 'Settings']

const app = await launch({ scale })
try {
  await app.clickText('Excel import', 'nav button')
  await app.dropFile('[data-testid=import-drop]', join(FIXTURES, 'sample-employees.xlsx')).catch(() => app.dropFile('.border-dashed', join(FIXTURES, 'sample-employees.xlsx')))
  await app.waitFor("document.body.innerText.includes('Records')", 20000)
  await app.clickText('Template setup', 'nav button')
  await sleep(500)
  await app.dropFile('[data-testid=template-drop]', join(FIXTURES, 'test-card-front-back.cdr')).catch(() => app.dropFile('.border-dashed', join(FIXTURES, 'test-card-front-back.cdr')))
  await app.waitFor("document.body.innerText.includes('Field mapping') || document.body.innerText.includes('Fill from')", 120000, 'template inspected')
  await sleep(800)
  await app.clickText('Auto-match')
  await sleep(1200)
  for (const theme of THEMES) {
    await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
    for (const [w, h] of SIZES) {
      await app.setWindow(w, h)
      for (const s of SCREENS) {
        await app.clickText(s, 'nav button')
        await sleep(s === 'Card preview' ? 6000 : 500)
        await app.screenshot(join(out, `${theme}-${w}x${h}@${scale}-${s.replace(/\s+/g, '_')}.png`))
      }
    }
  }
} finally {
  await app.close()
}
console.log('done', out)
