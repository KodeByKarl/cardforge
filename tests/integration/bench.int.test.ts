// Benchmark (opt-in): CARDFORGE_BENCH=1 npx vitest run --config vitest.integration.config.ts tests/integration/bench.int.test.ts
// Optional: CARDFORGE_BENCH_TEMPLATE=<path to a prepared-able 10-up .cdr> to benchmark a real layout. Only timings and sizes are printed.
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { JobHistory } from '../../src/main/services/generation/JobHistory'
import { SheetGenerationService } from '../../src/main/services/generation/SheetGenerationService'
import { PreviewService } from '../../src/main/services/preview/PreviewService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { TemplateStore } from '../../src/main/services/templates/TemplateStore'
import { buildSheetValues, suggestSheetMapping } from '../../src/shared/sheet/compose'
import type { ColumnConfig, ImportRecord } from '../../src/shared/types'
import { TMP, corelProgId, createAdapter } from './corelEnv'

const progId = await corelProgId()
const enabled = process.env['CARDFORGE_BENCH'] === '1'
const FIXTURE = process.env['CARDFORGE_BENCH_TEMPLATE'] ?? resolve(__dirname, '../fixtures/sheet-10up-layout.cdr')

const cols: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number): ImportRecord => ({ rowNumber: i + 4, values: { c0: `PL ${String(i + 1).padStart(6, '0')}`, c1: `SURNAME${i + 1},GIVEN${i + 1} MIDDLE${i + 1}`, c3: `BARANGAY ${i + 1}, SAMPLE CITY, PROVINCE` } })

describe.skipIf(!progId || !enabled || !existsSync(FIXTURE))('CorelDRAW sheet benchmark', () => {
  const root = join(TMP, `bench-${randomUUID().slice(0, 8)}`)
  let adapter: PowerShellCorelAdapter
  let store: TemplateStore
  let service: SheetGenerationService
  let templateId: string
  let prepared: Awaited<ReturnType<TemplateStore['prepareSheet']>>

  beforeAll(async () => {
    mkdirSync(root, { recursive: true })
    const source = join(root, 'bench-template.cdr')
    copyFileSync(FIXTURE, source)
    adapter = createAdapter(progId!)
    store = new TemplateStore(join(root, 'library'), join(root, 'work'), async () => adapter)
    const imported = await store.import(source)
    templateId = imported.id
    prepared = await store.prepareSheet(templateId, {})
    const samples = new Map(cols.map((c) => [c.key, [rec(0).values[c.key]!, rec(1).values[c.key]!]]))
    // The benchmark acknowledges a prefix mismatch with a real layout; no data is converted.
    const mapping = suggestSheetMapping(prepared.sheet!, cols, samples)
    await store.saveSheetMapping(templateId, { ...mapping, acknowledged: ['prefix'] })
    service = new SheetGenerationService({ store, getAdapter: async () => adapter, history: new JobHistory(join(root, 'jobs.json')), safeMarginMm: () => 3, onProgress: () => undefined })
  }, 300_000)
  afterAll(async () => {
    await adapter?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('profiles one 10-sheet batch step by step', async () => {
    const mapping = (await store.get(templateId)).sheetMapping!
    const sheet = prepared.sheet!
    const marks: string[] = []
    const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = Date.now()
      const r = await fn()
      marks.push(`${label}=${Date.now() - t0}`)
      return r
    }
    const work = await store.makeWorkingCopy(templateId)
    const handle = await time('open', () => adapter.openDocument(work))
    await time('addPages(9)', () => adapter.addSheetPages(handle, 9, 1))
    for (let k = 0; k < 3; k++) {
      const sv = buildSheetValues(sheet, mapping, Array.from({ length: 10 }, (_, i) => rec(k * 10 + i)), cols)
      await time(`apply p${k + 1}`, () => adapter.applyText(handle, sv.values, 3, { page: k === 0 ? 1 : 1 + k, keep: true }))
    }
    const sv = buildSheetValues(sheet, mapping, [rec(0), rec(1), rec(2)], cols)
    await time('apply with clearRegions (7 empty)', () => adapter.applyText(handle, sv.values, 3, { page: 4, keep: true, clearRegions: sv.emptyRegions, clearPage: 4 }))
    const out = join(root, 'profile.cdr')
    await time('saveAs 10 pages', () => adapter.saveAs(handle, out, 17))
    await time('close', () => adapter.closeDocument(handle))
    rmSync(work, { force: true })
    console.log(`[bench-steps] ms: ${marks.join(', ')}`)
  }, 300_000)

  it('measures generation time per sheet for different sheets-per-file settings', async () => {
    const lines: string[] = []
    const N = 300 // 30 sheets of 10
    for (const [sheetsPerFile, pdf] of [[1, false], [5, false], [10, false], [30, false], [10, true]] as const) {
      const out = join(root, `out-${sheetsPerFile}-${pdf}`)
      const t0 = Date.now()
      await service.start({
        templateId,
        outputDirectory: out,
        cardsPerSheet: 10,
        sheetsPerFile,
        exportPdf: pdf,
        clearEmpty: true,
        overwrite: 'overwrite',
        columns: cols.map((c) => ({ key: c.key, label: c.label })),
        records: Array.from({ length: N }, (_, i) => rec(i)),
        excludedRows: []
      })
      const summary = (await service.waitForIdle())!
      const ms = Date.now() - t0
      const files = readdirSync(out).filter((f) => /\.(cdr|pdf)$/.test(f))
      const bytes = files.reduce((n, f) => n + statSync(join(out, f)).size, 0)
      lines.push(`sheetsPerFile=${sheetsPerFile} pdf=${pdf}: ${summary.status} total=${ms}ms (${(ms / 30).toFixed(0)} ms/sheet incl. verification) files=${files.length} size=${(bytes / 1024 / 1024).toFixed(1)}MB`)
    }
    console.log(['[bench] generation, 30 sheets (300 cards):', ...lines].join('\n'))
  }, 900_000)

  it('measures on-demand sheet preview render time', async () => {
    const preview = new PreviewService(store, async () => adapter, join(root, 'preview'), () => 3)
    const mapping = (await store.get(templateId)).sheetMapping!
    const times: Record<number, number[]> = { 72: [], 96: [], 150: [] }
    for (const dpi of [72, 96, 150]) {
      for (let s = 0; s < 6; s++) {
        const sv = buildSheetValues(prepared.sheet!, mapping, Array.from({ length: 10 }, (_, i) => rec(s * 10 + i)), cols)
        const t0 = Date.now()
        await preview.render({ templateId, values: sv.values, dpi, pages: [1] })
        times[dpi]!.push(Date.now() - t0)
      }
    }
    const stats = preview.cacheStats()
    console.log(`[bench] preview render per sheet (ms, first is cold): ${Object.entries(times).map(([d, t]) => `${d}dpi=[${t.join(', ')}]`).join(' ')}; cache ${stats.entries} entries, ${(stats.bytes / 1024 / 1024).toFixed(1)}MB`)
    await preview.close(adapter)
  }, 300_000)
})
