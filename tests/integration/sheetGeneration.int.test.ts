import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JobHistory } from '../../src/main/services/generation/JobHistory'
import { SheetGenerationService } from '../../src/main/services/generation/SheetGenerationService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { PreviewService } from '../../src/main/services/preview/PreviewService'
import { TemplateStore } from '../../src/main/services/templates/TemplateStore'
import { suggestSheetMapping } from '../../src/shared/sheet/compose'
import type { SheetGenerationRequest } from '../../src/shared/sheet/types'
import type { ColumnConfig, ImportRecord } from '../../src/shared/types'
import type { JobProgress, JobSummary } from '../../src/shared/template/types'
import { TMP, corelProgId, createAdapter } from './corelEnv'

const progId = await corelProgId()
const FIXTURE = resolve(__dirname, '../fixtures/sheet-10up-layout.cdr')

const cols: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number): ImportRecord => ({ rowNumber: i + 4, values: { c0: `XX ${String(i + 1).padStart(6, '0')}`, c1: `SURNAME${i + 1},GIVEN${i + 1}`, c3: `BRGY ${i + 1},TOWN,PROV` } })

describe.skipIf(!progId || !existsSync(FIXTURE))(`Bulk sheet generation (${progId ?? 'CorelDRAW not installed'})`, () => {
  const root = join(TMP, `sheetgen-${randomUUID().slice(0, 8)}`)
  const source = join(root, 'client-layout.cdr')
  let adapter: PowerShellCorelAdapter
  let store: TemplateStore
  let templateId: string
  const progress: JobProgress[] = []
  let service: SheetGenerationService

  const request = (n: number, over: Partial<SheetGenerationRequest> = {}): SheetGenerationRequest => ({
    templateId,
    outputDirectory: join(root, 'out'),
    mode: 'unique',
    cardsPerSheet: 10,
    sheetsPerFile: 2,
    exportPdf: true,
    clearEmpty: true,
    overwrite: 'resume',
    columns: cols.map((c) => ({ key: c.key, label: c.label })),
    records: Array.from({ length: n }, (_, i) => rec(i)),
    excludedRows: [],
    ...over
  })
  const runJob = async (req: SheetGenerationRequest): Promise<JobSummary> => {
    await service.start(req)
    return (await service.waitForIdle())!
  }

  beforeAll(async () => {
    mkdirSync(root, { recursive: true })
    copyFileSync(FIXTURE, source)
    adapter = createAdapter(progId!)
    store = new TemplateStore(join(root, 'library'), join(root, 'work'), async () => adapter)
    templateId = (await store.import(source)).id
    const prepared = await store.prepareSheet(templateId, {})
    const samples = new Map(cols.map((c) => [c.key, [rec(0).values[c.key]!, rec(1).values[c.key]!]]))
    await store.saveSheetMapping(templateId, suggestSheetMapping(prepared.sheet!, cols, samples))
    service = new SheetGenerationService({
      store,
      getAdapter: async () => adapter,
      history: new JobHistory(join(root, 'jobs.json')),
      safeMarginMm: () => 3,
      onProgress: (p) => progress.push(p)
    })
  }, 240_000)
  afterAll(async () => {
    await adapter?.dispose()
  })

  it('plans 25 records as 3 sheets (10, 10, 5) in 2 files and proves full coverage', async () => {
    const plan = await service.plan(request(25))
    expect(plan.sheets).toBe(3)
    expect(plan.batches.map((b) => [b.firstSheet, b.lastSheet, b.records])).toEqual([[1, 2, 20], [3, 3, 5]])
    expect(plan.problems).toEqual([])
    expect(plan.batches[0]!.fileName).toBe('client-layout sheets 00001-00002.cdr')
  })

  it('generates multi-sheet CDR + PDF files with one unique record per card and a partly filled final sheet', async () => {
    // The preview keeps its own working copy of the same template open while the job runs (as in the real app).
    const preview = new PreviewService(store, async () => adapter, join(root, 'preview'), () => 3)
    await preview.render({ templateId, values: { C01_f1: 'PREVIEW SESSION' }, dpi: 72, pages: [1] })
    const t0 = Date.now()
    const summary = await runJob(request(25))
    expect(summary.sheetJob!.verification[0]).toMatch(/^OK/)
    // No batch may need a retry: a retried batch means CorelDRAW misbehaved on the first attempt.
    expect(JSON.parse(readFileSync(summary.reportPath!, 'utf8')).entries.every((e: { message: string | null }) => !e.message)).toBe(true)
    await preview.close(adapter)
    console.log(`25 records / 3 sheets / 2 files (+PDF): ${Date.now() - t0} ms`)
    expect(summary.status).toBe('completed')
    expect([summary.succeeded, summary.failed, summary.skipped]).toEqual([25, 0, 0])
    expect(summary.sheetJob!.verification[0]).toMatch(/^OK/)
    const out = join(root, 'out')
    const files = readdirSync(out)
    expect(files.filter((f) => f.endsWith('.cdr')).sort()).toEqual(['client-layout sheets 00001-00002.cdr', 'client-layout sheets 00003-00003.cdr'])
    expect(files.filter((f) => f.endsWith('.pdf'))).toHaveLength(2)
    expect(files.some((f) => f.startsWith('~'))).toBe(false)
    expect(files.some((f) => f.endsWith('.manifest.json'))).toBe(true)
    expect(readdirSync(join(root, 'work'))).toEqual([])
    // Reports contain counts and row numbers only.
    const report = readFileSync(summary.reportPath!, 'utf8')
    expect(report).not.toMatch(/SURNAME|GIVEN|BRGY/)

    // Read the real output back: every card on every page holds exactly the record it should.
    const handle = await adapter.openDocument(join(out, 'client-layout sheets 00001-00002.cdr'))
    const inspected = await adapter.inspect(handle)
    await adapter.closeDocument(handle)
    expect(inspected.pages).toHaveLength(2)
    const text = (page: number, name: string) => inspected.objects.find((o) => o.pageIndex === page && o.name === name)?.text
    for (let cell = 1; cell <= 10; cell++) {
      const c = String(cell).padStart(2, '0')
      expect(text(1, `C${c}_f1`)?.trim()).toBe(`SURNAME${cell},GIVEN${cell}`)
      expect(text(2, `C${c}_f1`)?.trim()).toBe(`SURNAME${cell + 10},GIVEN${cell + 10}`)
      expect(text(2, `C${c}_f2`)).toContain(`XX ${String(cell + 10).padStart(6, '0')}`)
      // The copied page keeps every object exactly where the template has it.
      const b1 = inspected.objects.find((o) => o.pageIndex === 1 && o.name === `C${c}_f1`)!.bounds
      const b2 = inspected.objects.find((o) => o.pageIndex === 2 && o.name === `C${c}_f1`)!.bounds
      expect(Math.abs(b1.left - b2.left)).toBeLessThan(0.05)
      expect(Math.abs(b1.top - b2.top)).toBeLessThan(0.05)
    }
    const last = await adapter.openDocument(join(out, 'client-layout sheets 00003-00003.cdr'))
    const lastInspected = await adapter.inspect(last)
    await adapter.closeDocument(last)
    expect(lastInspected.pages).toHaveLength(1)
    const lastText = (name: string) => lastInspected.objects.find((o) => o.name === name)?.text?.trim()
    expect(lastText('C01_f1')).toBe('SURNAME21,GIVEN21')
    expect(lastText('C05_f1')).toBe('SURNAME25,GIVEN25')
    expect(lastText('C06_f1') ?? '').toBe('') // unused position: blank, not the template's sample text
    expect(lastText('C10_f2') ?? '').toBe('')
    expect(progress.at(-1)!.sheet).toMatchObject({ sheetsDone: 3, sheetsTotal: 3, batchesDone: 2, batchesTotal: 2 })
  }, 240_000)

  it('resumes: an identical run skips verified files and regenerates only a missing one', async () => {
    const out = join(root, 'out')
    const second = await runJob(request(25))
    expect([second.succeeded, second.skipped]).toEqual([0, 25])
    rmSync(join(out, 'client-layout sheets 00003-00003.cdr'))
    const plan = await service.plan(request(25))
    expect(plan.resumable).toBe(true)
    expect(plan.batches.map((b) => b.completed)).toEqual([true, false])
    const third = await runJob(request(25))
    expect([third.succeeded, third.skipped]).toEqual([5, 20])
    expect(third.sheetJob!.verification[0]).toMatch(/^OK/)
  }, 240_000)

  it('cancels safely between batches, leaves no temporary files, and can be resumed to completion', async () => {
    const out = join(root, 'out-cancel')
    const req = request(60, { outputDirectory: out, sheetsPerFile: 1 })
    const started = await service.start(req)
    // Wait for the first file, then cancel.
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && !(existsSync(out) && readdirSync(out).some((f) => f.endsWith('.cdr') && !f.startsWith('~')))) await new Promise((r) => setTimeout(r, 200))
    expect(service.cancel(started.jobId)).toBe(true)
    const cancelled = (await service.waitForIdle())!
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.succeeded).toBeGreaterThanOrEqual(10)
    expect(cancelled.succeeded).toBeLessThan(60)
    expect(readdirSync(out).some((f) => f.startsWith('~'))).toBe(false)
    const resumed = await runJob(req)
    expect(resumed.status).toBe('completed')
    expect(resumed.succeeded + resumed.skipped).toBe(60)
    expect(readdirSync(out).filter((f) => f.endsWith('.cdr'))).toHaveLength(6)
  }, 360_000)

  it('refuses an unsafe request: unknown column in the mapping blocks the job', async () => {
    const bad = request(10, { columns: [{ key: 'c0', label: 'CONTROL NO.' }], records: Array.from({ length: 10 }, (_, i) => ({ rowNumber: i + 4, values: { c0: rec(i).values['c0']! } })) })
    await expect(service.plan(bad)).rejects.toThrow(/not in the current spreadsheet/)
    await expect(service.start(request(10, { cardsPerSheet: 11 }))).rejects.toThrow()
  })
})
