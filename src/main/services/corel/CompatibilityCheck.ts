import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectSheetGrid } from '../../../shared/sheet/detect'
import type { CompatReport, CompatStep } from '../../../shared/template/types'
import { X7_FILE_VERSION, type CorelAdapter, type DocHandle } from './CorelAdapter'

/**
 * Exercises, on the installed CorelDRAW, every CorelDRAW feature the card-sheet engine depends on, using a small
 * synthetic sample (no client data). Meant to be run on the client's PC to validate X7 before production use.
 */
export async function runCompatibilityCheck(adapter: CorelAdapter, samplePath: string, workDir: string, reportDir: string): Promise<CompatReport> {
  const steps: CompatStep[] = []
  const run = async <T>(name: string, fn: () => Promise<{ value: T; detail: string } | { value: T }>, ok?: (v: T) => boolean): Promise<T | null> => {
    const t0 = Date.now()
    try {
      const r = await fn()
      const pass = ok ? ok(r.value) : true
      steps.push({ name, ok: pass, ms: Date.now() - t0, detail: 'detail' in r ? r.detail : '' })
      return pass ? r.value : null
    } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: (err as Error).message.slice(0, 300) })
      return null
    }
  }

  await mkdir(workDir, { recursive: true })
  const id = randomUUID().slice(0, 8)
  const work = join(workDir, `compat-${id}.cdr`)
  const prepared = join(workDir, `compat-${id}-prepared.cdr`)
  const multi = join(workDir, `compat-${id}-multi.cdr`)
  const pdf = join(workDir, `compat-${id}.pdf`)
  const handles: DocHandle[] = []
  let version = ''
  let progId = ''

  try {
    const conn = await run('Start / attach CorelDRAW', async () => {
      const c = await adapter.connect()
      version = c.version
      progId = c.progId
      return { value: c, detail: `${c.progId}, version ${c.version}` }
    })
    if (!conn) return finish()

    await copyFile(samplePath, work)
    const doc = await run('Open the sample template', async () => {
      const h = await adapter.openDocument(work)
      handles.push(h)
      return { value: h }
    })
    if (!doc) return finish()

    const inspection = await run('Inspect pages, text objects and positions', async () => {
      const i = await adapter.inspect(doc)
      return { value: i, detail: `${i.pages.length} page, ${i.unnamed?.length ?? 0} unnamed text objects` }
    }, (i) => (i.unnamed?.length ?? 0) >= 20 && i.pages[0]?.widthMm === 210)
    if (!inspection) return finish()

    const grid = await run('Detect the 2 × 5 card grid', async () => {
      const g = detectSheetGrid(inspection.unnamed ?? [], { pageWidthMm: 210, pageHeightMm: 297 })
      if ('error' in g) throw new Error(g.error)
      return { value: g, detail: `${g.config.columns} × ${g.config.rows}` }
    }, (g) => g.config.cells.length === 10)
    if (!grid) return finish()

    await run('Name text objects and save the private copy (X7 format)', async () => {
      const n = await adapter.nameShapes(doc, grid.assignments)
      await adapter.saveAs(doc, prepared, X7_FILE_VERSION)
      return { value: n, detail: `${n} objects named` }
    }, (n) => n === grid.assignments.length)
    await adapter.closeDocument(doc).catch(() => undefined)
    handles.length = 0

    const pdoc = await run('Reopen the prepared copy; named objects are found', async () => {
      const h = await adapter.openDocument(prepared)
      handles.push(h)
      const i = await adapter.inspect(h)
      return { value: { h, count: i.objects.length }, detail: `${i.objects.length} named objects` }
    }, (v) => v.count === grid.assignments.length)
    if (!pdoc) return finish()

    await run('Fill text and remove artwork of empty card positions', async () => {
      const values: Record<string, string> = { C01_f1: 'COMPAT SAMPLE', C02_f1: 'COMPAT SAMPLE 2' }
      const regions = [grid.config.cells[9]!.region]
      const r = await adapter.applyText(pdoc.h, values, 3, { clearRegions: regions, clearPage: 1 })
      return { value: r, detail: `${r.objects.length} objects filled, ${r.cleared ?? 0} shapes removed` }
    }, (r) => r.notFound.length === 0 && (r.cleared ?? 0) > 0)
    await run('Undo restores the template after filling', async () => {
      const r = await adapter.applyText(pdoc.h, { C01_f1: 'AGAIN' }, 3)
      return { value: r }
    }, (r) => r.notFound.length === 0)

    await run('Copy the sheet page (layers, no clipboard)', async () => {
      const pages = await adapter.addSheetPages(pdoc.h, 1, 1)
      return { value: pages, detail: `${pages} pages` }
    }, (p) => p === 2)
    await run('Fill the copied page only', async () => {
      const r = await adapter.applyText(pdoc.h, { C01_f1: 'PAGE TWO' }, 3, { page: 2, keep: true })
      return { value: r }
    }, (r) => r.notFound.length === 0 && r.objects.every((o) => o.pageIndex === 2))

    await run('Export a page image', async () => {
      await mkdir(workDir, { recursive: true })
      const files = await adapter.exportPages(pdoc.h, { dir: workDir, prefix: `compat-${id}`, dpi: 72, pages: [1, 2] })
      const sizes = await Promise.all(files.map(async (f) => (await stat(f.path)).size))
      await Promise.all(files.map((f) => rm(f.path, { force: true })))
      return { value: sizes, detail: `${files.length} images` }
    }, (sizes) => sizes.length === 2 && sizes.every((s) => s > 1000))

    await run('Save the two-page document (X7 format)', async () => {
      await adapter.saveAs(pdoc.h, multi, X7_FILE_VERSION)
      return { value: (await stat(multi)).size, detail: 'saved' }
    }, (s) => s > 1000)
    await run('Export a PDF', async () => {
      await adapter.exportPdf(pdoc.h, pdf)
      return { value: (await stat(pdf)).size }
    }, (s) => s > 1000)
    await adapter.closeDocument(pdoc.h).catch(() => undefined)
    handles.length = 0

    await run('Reopen the saved file and count its pages', async () => {
      const h = await adapter.openDocument(multi, { light: true })
      handles.push(h)
      const info = await adapter.docInfo(h)
      await adapter.closeDocument(h)
      handles.length = 0
      return { value: info.pages, detail: `${info.pages} pages` }
    }, (p) => p === 2)

    await run('Detect missing fonts', async () => {
      const missing = await adapter.checkFonts(['Arial', 'Font That Does Not Exist 123'])
      return { value: missing, detail: `missing: ${missing.join(', ') || 'none'}` }
    }, (m) => m.includes('Font That Does Not Exist 123') && !m.includes('Arial'))
  } finally {
    for (const h of handles) await adapter.closeDocument(h).catch(() => undefined)
    for (const f of [work, prepared, multi, pdf]) await rm(f, { force: true }).catch(() => undefined)
  }
  return finish()

  async function finish(): Promise<CompatReport> {
    const passed = steps.every((s) => s.ok) && steps.length >= 12
    const report: CompatReport = { when: new Date().toISOString(), version, progId, isX7: /^CorelDRAW\.Application\.17$/.test(progId), passed, steps, reportPath: null }
    try {
      await mkdir(reportDir, { recursive: true })
      const path = join(reportDir, `cardforge-compatibility-${report.when.replace(/[-:]/g, '').slice(0, 15)}.txt`)
      const lines = [
        'CardForge CorelDRAW compatibility check',
        `Date: ${report.when}`,
        `CorelDRAW: ${progId || 'not available'} ${version}${report.isX7 ? ' (X7)' : ''}`,
        `Result: ${passed ? 'ALL STEPS PASSED' : 'FAILED'}`,
        report.isX7 ? '' : 'Note: this is not CorelDRAW X7. A pass here does not establish X7 compatibility.',
        '',
        ...steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.name}  (${s.ms} ms)${s.detail ? `  ${s.detail}` : ''}`)
      ]
      await writeFile(path, lines.join('\r\n') + '\r\n', 'utf8')
      report.reportPath = path
    } catch {
      // The on-screen result is still returned.
    }
    return report
  }
}
