// Minimal targeted smoke test of the essential workflow on the installed CorelDRAW (intended for X7: set nothing, X7 is preferred
// when registered; or CARDFORGE_COREL_PROGID=CorelDRAW.Application.17). Uses the client's real templates as PRIVATE COPIES and
// 10 synthetic records. Prints structure only (counts, sizes, font names), never text from the client files.
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCompatibilityCheck } from '../../src/main/services/corel/CompatibilityCheck'
import { JobHistory } from '../../src/main/services/generation/JobHistory'
import { SheetGenerationService } from '../../src/main/services/generation/SheetGenerationService'
import { PreviewService } from '../../src/main/services/preview/PreviewService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { TemplateStore } from '../../src/main/services/templates/TemplateStore'
import { buildSheetValues, suggestSheetMapping } from '../../src/shared/sheet/compose'
import type { ColumnConfig, ImportRecord } from '../../src/shared/types'
import { TMP, corelProgId, createAdapter } from './corelEnv'

const progId = await corelProgId()
const CLIENTS = resolve(__dirname, '../../clients')
const SAMPLE = resolve(__dirname, '../../resources/samples/compat-sheet.cdr')
const TEMPLATES = [
  { key: 'layout', file: 'card layout final.cdr' },
  { key: 'guide', file: 'guide (2).cdr' }
]
const cols: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c2', label: 'BIRTHDATE', index: 2, kind: 'text', include: true, required: false, duplicateKey: false },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number): ImportRecord => {
  const n = String(i + 1).padStart(6, '0')
  return { rowNumber: i + 4, values: { c0: `PL ${n}`, c1: `SURNAME${n},GIVEN${n} MIDDLE`, c2: '', c3: `BARANGAY ${(i % 40) + 1}, SAMPLE CITY, PROVINCE` } }
}
const samples = new Map(cols.map((c) => [c.key, Array.from({ length: 10 }, (_, i) => rec(i).values[c.key]!)]))
const norm = (s: string | undefined) => (s ?? '').replace(/\r/g, '\n').replace(/\s+$/g, '')

describe.skipIf(!progId)(`Essential workflow smoke test on ${progId ?? 'CorelDRAW (not installed)'}`, () => {
  let adapter: PowerShellCorelAdapter
  beforeAll(() => {
    adapter = createAdapter(progId!)
  })
  afterAll(async () => {
    await adapter?.dispose()
  })

  it('compatibility check: every CorelDRAW feature the engine uses (synthetic sample)', async () => {
    const report = await runCompatibilityCheck(adapter, SAMPLE, join(TMP, 'x7-compat-work'), join(TMP, 'x7-compat-reports'))
    console.log(`[x7] compat: ${report.version} isX7=${report.isX7} passed=${report.passed}`)
    for (const s of report.steps) console.log(`[x7]   ${s.ok ? 'PASS' : 'FAIL'} ${s.name} (${s.ms} ms) ${s.ok ? '' : s.detail}`)
    expect(report.steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`)).toEqual([])
  }, 600_000)

  describe.skipIf(!existsSync(CLIENTS))('client templates (private copies)', () => {
    describe.each(TEMPLATES)('$key', ({ key, file }) => {
      const root = join(TMP, `x7-${key}-${randomUUID().slice(0, 6)}`)
      let store: TemplateStore
      let id: string
      it('opens the template, detects text objects and fonts, prepares it, maps fields', async () => {
        mkdirSync(root, { recursive: true })
        copyFileSync(join(CLIENTS, file), join(root, 'client.cdr'))
        store = new TemplateStore(join(root, 'library'), join(root, 'work'), async () => adapter)
        const record = await store.import(join(root, 'client.cdr'))
        id = record.id
        expect(record.pages[0]).toMatchObject({ widthMm: 210, heightMm: 297 })
        const fonts = [...new Set((record.inspection.unnamed ?? []).map((o) => o.font))]
        console.log(`[x7:${key}] CorelDRAW ${record.corelVersion}; unnamed text=${record.inspection.unnamedTextCount}; fonts in template: ${fonts.join(', ')}`)
        const a = await store.analyzeSheet(id, {})
        expect([a.config.columns, a.config.rows]).toEqual([2, 5])
        const prepared = await store.prepareSheet(id, {})
        const mapping = { ...suggestSheetMapping(prepared.sheet!, cols, samples), acknowledged: ['prefix'] }
        await store.saveSheetMapping(id, mapping)
        console.log(`[x7:${key}] grid 2x5, roles/card=${a.config.roles.length}, fonts not installed: ${(await store.missingFonts(id)).join(', ') || 'none'}`)
      }, 600_000)

      it('generates ONE A4 sheet with 10 personalised cards, saves editable X7 CDR + PDF, reopens it, renders a preview', async () => {
        const service = new SheetGenerationService({ store, getAdapter: async () => adapter, history: new JobHistory(join(root, 'j.json')), safeMarginMm: () => 3, onProgress: () => undefined })
        const records = Array.from({ length: 10 }, (_, i) => rec(i))
        await service.start({ templateId: id, outputDirectory: join(root, 'out'), mode: 'unique', cardsPerSheet: 10, sheetsPerFile: 1, exportPdf: true, clearEmpty: true, overwrite: 'overwrite', columns: cols.map((c) => ({ key: c.key, label: c.label })), records, excludedRows: [] })
        const summary = (await service.waitForIdle())!
        console.log(`[x7:${key}] job ${summary.status}: ok=${summary.succeeded} failed=${summary.failed}; verification: ${summary.sheetJob!.verification.join(' | ').slice(0, 200)}`)
        if (summary.failed) console.log(`[x7:${key}] failure: ${JSON.parse(readFileSync(summary.reportPath!, 'utf8')).entries.map((e: { message: string }) => e.message).join(' | ').slice(0, 300)}`)
        expect(summary.status).toBe('completed')
        expect(summary.failed).toBe(0)
        const out = join(root, 'out')
        const cdr = readdirSync(out).find((f) => f.endsWith('.cdr'))!
        const pdf = readdirSync(out).find((f) => f.endsWith('.pdf'))!
        expect(readFileSync(join(out, pdf)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

        // Reopen in the same CorelDRAW and verify the content, dimensions and positions.
        const h = await adapter.openDocument(join(out, cdr))
        const inspected = await adapter.inspect(h)
        await adapter.closeDocument(h)
        expect(inspected.pages).toHaveLength(1)
        expect(inspected.pages[0]).toMatchObject({ widthMm: 210, heightMm: 297 })
        const sheet = (await store.get(id)).sheet!
        const expected = buildSheetValues(sheet, (await store.get(id)).sheetMapping!, records, cols).values
        let checked = 0
        let outside = 0
        const subst = new Set<string>()
        const original = new Map((await store.get(id)).inspection.objects.map((o) => [o.name, o]))
        for (const [name, want] of Object.entries(expected)) {
          const o = inspected.objects.find((x) => x.name === name)
          expect(o, `object ${name}`).toBeTruthy()
          expect(norm(o!.text), `text of ${name}`).toBe(norm(want))
          const ref = original.get(name)!
          if (o!.font !== ref.font) subst.add(`${ref.font} -> ${o!.font}`)
          const cell = sheet.cells.find((c) => c.objects[Object.keys(sheet.cells[0]!.objects).find((r) => sheet.cells.some((cc) => cc.objects[r] === name))!] === name)!
          if (o!.bounds.left < cell.region.left - 0.5 || o!.bounds.right > cell.region.right + 0.5 || o!.bounds.top > cell.region.top + 0.5 || o!.bounds.bottom < cell.region.bottom - 0.5) outside++
          checked++
        }
        console.log(`[x7:${key}] reopened: pages=1 size=210x297 mm; ${checked} text objects match the 10 records exactly; objects outside their card=${outside}; font changes vs template: ${subst.size ? [...subst].join('; ') : 'none'}`)
        expect(outside).toBe(0)

        const preview = new PreviewService(store, async () => adapter, join(root, 'preview'), () => 3)
        const sv = buildSheetValues(sheet, (await store.get(id)).sheetMapping!, records, cols)
        const r = await preview.render({ templateId: id, values: sv.values, dpi: 100, pages: [1] })
        console.log(`[x7:${key}] preview: ${r.pages[0]!.widthPx}x${r.pages[0]!.heightPx} px at 100 dpi (expected ${Math.round((210 / 25.4) * 100)}x${Math.round((297 / 25.4) * 100)}); overflow warnings=${r.objects.filter((o) => o.overflow).length}`)
        expect(r.pages[0]!.widthPx).toBe(Math.round((210 / 25.4) * 100))
        expect(r.pages[0]!.heightPx).toBe(Math.round((297 / 25.4) * 100))
        await preview.close(adapter)
      }, 900_000)
    })
  })
})
