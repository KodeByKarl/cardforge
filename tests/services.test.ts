import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../src/main/errors'
import { CorelService, chooseProgId } from '../src/main/services/corel/CorelService'
import { MOCK_CDR_CONTENT, MockCorelAdapter } from '../src/main/services/corel/MockCorelAdapter'
import { GenerationService } from '../src/main/services/generation/GenerationService'
import { JobHistory } from '../src/main/services/generation/JobHistory'
import { PreviewService } from '../src/main/services/preview/PreviewService'
import { TemplateStore } from '../src/main/services/templates/TemplateStore'
import type { GenerationRequest, JobProgress } from '../src/shared/template/types'
import { FRONT_BACK } from './fixtures/inspection'

const ROOT = resolve(__dirname, '.tmp', 'services')
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

function setup() {
  const dir = join(ROOT, randomUUID())
  mkdirSync(dir, { recursive: true })
  const source = join(dir, 'client template.cdr')
  writeFileSync(source, 'pretend CDR bytes')
  const adapter = new MockCorelAdapter(FRONT_BACK)
  const store = new TemplateStore(join(dir, 'library'), join(dir, 'work'), async () => adapter)
  return { dir, source, adapter, store }
}

describe('TemplateStore', () => {
  it('imports a copy, inspects only a working copy, and never touches the original', async () => {
    const { source, adapter, store, dir } = setup()
    const before = sha(source)
    const record = await store.import(source)
    expect(sha(source)).toBe(before)
    expect(record).toMatchObject({ name: 'client template', sourceHash: before, objectCount: 8, mapping: null })
    expect(record.pages.map((p) => p.index)).toEqual([1, 2])
    // CorelDRAW (mock) only ever opened a throwaway copy, which was cleaned up.
    const opened = adapter.calls.filter((c) => c === 'openDocument')
    expect(opened).toHaveLength(1)
    expect(adapter.open.size).toBe(0)
    expect(readdirSync(join(dir, 'work'))).toEqual([])
    expect((await store.pageImages(record.id)).map((p) => p.pageIndex)).toEqual([1, 2])
  })

  it('returns the existing record when the same unchanged file is imported again', async () => {
    const { source, store } = setup()
    const a = await store.import(source)
    const b = await store.import(source)
    expect(b.id).toBe(a.id)
    expect(await store.list()).toHaveLength(1)
  })

  it('detects when the original template changes or disappears', async () => {
    const { source, store } = setup()
    const record = await store.import(source)
    expect(await store.sourceStatus(record.id)).toEqual({ exists: true, changed: false })
    writeFileSync(source, 'edited in CorelDRAW!')
    expect(await store.sourceStatus(record.id)).toEqual({ exists: true, changed: true })
    rmSync(source)
    expect(await store.sourceStatus(record.id)).toEqual({ exists: false, changed: false })
  })

  it('saves, reloads and validates reusable mappings', async () => {
    const { source, store } = setup()
    const { id } = await store.import(source)
    const mapping = { version: 1 as const, entries: { FullName: { kind: 'column' as const, columnLabel: 'Full Name' } } }
    await store.saveMapping(id, mapping)
    expect((await store.get(id)).mapping).toEqual(mapping)
    expect((await store.list())[0]!.hasMapping).toBe(true)
    await expect(store.saveMapping(id, { version: 1, entries: { X: { kind: 'bogus' } } })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })

  it('rejects invalid files and ids, and cleans up after a failed inspection', async () => {
    const { dir, adapter, store } = setup()
    await expect(store.import(join(dir, 'missing.cdr'))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(store.import(join(dir, 'x.cdt'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' })
    await expect(store.get('../../etc')).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(store.get(randomUUID())).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' })

    const other = join(dir, 'broken.cdr')
    writeFileSync(other, 'x')
    adapter.failOn = (op) => (op === 'inspect' ? new AppError('COREL_ERROR', 'boom') : null)
    await expect(store.import(other)).rejects.toMatchObject({ code: 'COREL_ERROR' })
    expect(await store.list()).toEqual([])
    expect(adapter.open.size).toBe(0)
  })

  it('reports CorelDRAW being unavailable', async () => {
    const dir = join(ROOT, randomUUID())
    mkdirSync(dir, { recursive: true })
    const source = join(dir, 't.cdr')
    writeFileSync(source, 'x')
    const store = new TemplateStore(join(dir, 'lib'), join(dir, 'work'), async () => {
      throw new AppError('COREL_NOT_INSTALLED', 'CorelDRAW was not found on this computer.')
    })
    await expect(store.import(source)).rejects.toMatchObject({ code: 'COREL_NOT_INSTALLED' })
  })

  it('renames and removes templates', async () => {
    const { source, store } = setup()
    const { id } = await store.import(source)
    expect((await store.rename(id, '  Sales team  ')).name).toBe('Sales team')
    await expect(store.rename(id, '')).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await store.remove(id)
    expect(await store.list()).toEqual([])
  })
})

describe('PreviewService', () => {
  it('renders through the adapter, reuses one working copy, and caches identical requests', async () => {
    const { source, adapter, store, dir } = setup()
    const { id } = await store.import(source)
    const preview = new PreviewService(store, async () => adapter, join(dir, 'preview'), () => 3)
    const req = { templateId: id, values: { FullName: 'Ana Cruz' }, dpi: 150, pages: [1, 2] }

    const first = await preview.render(req)
    expect(first.pages.map((p) => [p.pageIndex, p.widthPx, p.heightPx, p.widthMm])).toEqual([
      [1, 531, 295, 90],
      [2, 531, 295, 90]
    ])
    expect(first.pages[0]!.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const exportsBefore = adapter.calls.filter((c) => c === 'exportPages').length
    await preview.render({ ...req })
    expect(adapter.calls.filter((c) => c === 'exportPages').length).toBe(exportsBefore) // cache hit

    await preview.render({ ...req, values: { FullName: 'Ben Santos' } })
    expect(adapter.calls.filter((c) => c === 'openDocument')).toHaveLength(2) // import + one preview session
    expect(readdirSync(join(dir, 'preview'))).toEqual([]) // exported PNGs are not left behind
  })

  it('reports overflow and unknown objects from the renderer', async () => {
    const { source, adapter, store, dir } = setup()
    const { id } = await store.import(source)
    const preview = new PreviewService(store, async () => adapter, join(dir, 'preview'), () => 3)
    const result = await preview.render({ templateId: id, values: { FullName: 'x'.repeat(40), Nope: 'y' }, dpi: 96, pages: [1] })
    expect(result.objects).toEqual([expect.objectContaining({ name: 'FullName', overflow: true })])
    expect(result.notFound).toEqual(['Nope'])
  })

  it('validates requests and surfaces renderer errors', async () => {
    const { source, adapter, store, dir } = setup()
    const { id } = await store.import(source)
    const preview = new PreviewService(store, async () => adapter, join(dir, 'preview'), () => 3)
    await expect(preview.render({ templateId: id, values: {}, dpi: 5000, pages: [1] })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(preview.render({ templateId: id, values: {}, dpi: 96, pages: [3] })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(preview.render({ templateId: 'nope', values: {}, dpi: 96, pages: [1] })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(preview.render({ templateId: id, values: { A: 42 }, dpi: 96, pages: [1] })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    adapter.failOn = (op) => (op === 'exportPages' ? new AppError('COREL_ERROR', 'Export failed') : null)
    await expect(preview.render({ templateId: id, values: { FullName: 'Z' }, dpi: 96, pages: [1] })).rejects.toMatchObject({ code: 'COREL_ERROR' })
  })

  it('reopens the working copy once after CorelDRAW restarts', async () => {
    const { source, adapter, store, dir } = setup()
    const { id } = await store.import(source)
    const preview = new PreviewService(store, async () => adapter, join(dir, 'preview'), () => 3)
    await preview.render({ templateId: id, values: { FullName: 'A' }, dpi: 96, pages: [1] })
    let failures = 1
    adapter.failOn = (op) => (op === 'applyText' && failures-- > 0 ? new AppError('COREL_RESTARTED', 'restarted') : null)
    const result = await preview.render({ templateId: id, values: { FullName: 'B' }, dpi: 96, pages: [1] })
    expect(result.pages).toHaveLength(1)
    expect(adapter.calls.filter((c) => c === 'openDocument')).toHaveLength(3)
  })
})

describe('GenerationService', () => {
  let progress: JobProgress[]
  beforeEach(() => {
    progress = []
  })

  async function setupGeneration() {
    const ctx = setup()
    const { id } = await ctx.store.import(ctx.source)
    const history = new JobHistory(join(ctx.dir, 'jobs.json'))
    const service = new GenerationService({ store: ctx.store, getAdapter: async () => ctx.adapter, history, safeMarginMm: () => 3, onProgress: (p) => progress.push(p) })
    const out = join(ctx.dir, 'out')
    const request = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
      templateId: id,
      outputDirectory: out,
      fileNamePattern: '{row} - {col:Full Name}',
      overwrite: 'suffix',
      records: [
        { rowNumber: 2, values: { FullName: 'Ana Cruz' }, fields: { 'Full Name': 'Ana Cruz' } },
        { rowNumber: 3, values: { FullName: 'José Peña' }, fields: { 'Full Name': 'José Peña' } },
        { rowNumber: 4, values: { FullName: 'Ben: Santos?' }, fields: { 'Full Name': 'Ben: Santos?' } }
      ],
      ...overrides
    })
    return { ...ctx, id, history, service, out, request }
  }

  it('generates one file per record from a working copy, with progress, report and history', async () => {
    const { service, request, out, history, adapter, source } = await setupGeneration()
    const before = sha(source)
    await service.start(request())
    const summary = (await service.waitForIdle())!
    expect(summary).toMatchObject({ status: 'completed', total: 3, succeeded: 3, failed: 0, skipped: 0 })
    expect(readdirSync(out).sort()).toEqual(['2 - Ana Cruz.cdr', '3 - José Peña.cdr', '4 - Ben_ Santos_.cdr', expect.stringMatching(/^cardforge-report-.*\.json$/)].sort())
    expect(readFileSync(join(out, '3 - José Peña.cdr'), 'utf8')).toContain(MOCK_CDR_CONTENT)
    expect(sha(source)).toBe(before)
    expect(adapter.open.size).toBe(0) // working document closed
    expect(progress.at(-1)).toMatchObject({ status: 'completed', done: 3 })
    expect(progress.filter((p) => p.entry?.status === 'ok')).toHaveLength(3)
    const report = JSON.parse(readFileSync(summary.reportPath!, 'utf8'))
    expect(report.entries).toHaveLength(3)
    expect(report.note).toContain('pending validation')
    expect((await history.list())[0]!.id).toBe(summary.id)
  })

  it('records overflow warnings without failing the record', async () => {
    const { service, request } = await setupGeneration()
    await service.start(request({ records: [{ rowNumber: 2, values: { FullName: 'x'.repeat(50) }, fields: {} }] }))
    const summary = (await service.waitForIdle())!
    expect(summary.succeeded).toBe(1)
    expect(progress.find((p) => p.entry)!.entry!.overflow).toEqual(['FullName: Mock overflow'])
  })

  it('keeps going when one record fails, and leaves no temp files', async () => {
    const { service, request, adapter, out } = await setupGeneration()
    adapter.failOn = (op, detail) => (op === 'applyText' && detail.includes('José') ? new AppError('COREL_ERROR', 'Simulated failure') : null)
    await service.start(request())
    const summary = (await service.waitForIdle())!
    expect(summary).toMatchObject({ status: 'completed', succeeded: 2, failed: 1 })
    expect(readdirSync(out).some((f) => f.includes('.tmp'))).toBe(false)
    expect(progress.find((p) => p.entry?.status === 'failed')!.entry).toMatchObject({ rowNumber: 3, message: 'Simulated failure' })
  })

  it('fails a record whose mapped object is missing from the template', async () => {
    const { service, request } = await setupGeneration()
    await service.start(request({ records: [{ rowNumber: 2, values: { Ghost: 'x' }, fields: {} }] }))
    const summary = (await service.waitForIdle())!
    expect(summary.failed).toBe(1)
    expect(progress.find((p) => p.entry)!.entry!.message).toContain('Ghost')
  })

  it('fails a record when saving fails (e.g. a locked output) and continues', async () => {
    const { service, request, out } = await setupGeneration()
    mkdirSync(join(out, '2 - Ana Cruz.cdr'), { recursive: true }) // a folder where the file should go: rename fails
    await service.start(request({ overwrite: 'overwrite' }))
    const summary = (await service.waitForIdle())!
    expect(summary).toMatchObject({ succeeded: 2, failed: 1 })
  })

  it('applies the overwrite policy: plan reports conflicts, skip skips, suffix renames', async () => {
    const { service, request, out } = await setupGeneration()
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, '2 - Ana Cruz.cdr'), 'existing')
    const plan = await service.plan(request({ overwrite: 'skip' }))
    expect(plan.conflicts).toBe(1)
    expect(plan.items[0]).toMatchObject({ fileName: '2 - Ana Cruz.cdr', exists: true })

    await service.start(request({ overwrite: 'skip' }))
    expect((await service.waitForIdle())!).toMatchObject({ succeeded: 2, skipped: 1 })
    expect(readFileSync(join(out, '2 - Ana Cruz.cdr'), 'utf8')).toBe('existing')

    const suffixPlan = await service.plan(request({ overwrite: 'suffix' }))
    expect(suffixPlan.items.map((i) => i.fileName)).toEqual(['2 - Ana Cruz (2).cdr', '3 - José Peña (2).cdr', '4 - Ben_ Santos_ (2).cdr'])
  })

  it('overwrites only when explicitly told to', async () => {
    const { service, request, out } = await setupGeneration()
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, '2 - Ana Cruz.cdr'), 'existing')
    await service.start(request({ overwrite: 'overwrite' }))
    await service.waitForIdle()
    expect(readFileSync(join(out, '2 - Ana Cruz.cdr'), 'utf8')).toContain(MOCK_CDR_CONTENT)
  })

  it('cancels between records', async () => {
    const { service, request, adapter, out } = await setupGeneration()
    let jobId = ''
    adapter.failOn = (op) => {
      if (op === 'saveAs' && adapter.calls.filter((c) => c === 'saveAs').length === 1) service.cancel(jobId)
      return null
    }
    jobId = (await service.start(request())).jobId
    const summary = (await service.waitForIdle())!
    expect(summary.status).toBe('cancelled')
    expect(summary.succeeded).toBe(1)
    expect(readdirSync(out).filter((f) => f.endsWith('.cdr'))).toHaveLength(1)
    expect(adapter.open.size).toBe(0)
  })

  it('prevents a second job while one is running, and allows a repeat afterwards', async () => {
    const { service, request } = await setupGeneration()
    await service.start(request())
    await expect(service.start(request())).rejects.toMatchObject({ code: 'JOB_RUNNING' })
    await service.waitForIdle()
    await service.start(request())
    expect((await service.waitForIdle())!.status).toBe('completed')
  })

  it('reopens CorelDRAW after a bridge crash and stops after repeated crashes', async () => {
    const { service, request, adapter } = await setupGeneration()
    let crashes = 1
    adapter.failOn = (op) => (op === 'applyText' && crashes-- > 0 ? new AppError('BRIDGE_EXITED', 'gone') : null)
    await service.start(request())
    expect((await service.waitForIdle())!).toMatchObject({ status: 'completed', succeeded: 2, failed: 1 })

    adapter.failOn = (op) => (op === 'applyText' ? new AppError('BRIDGE_TIMEOUT', 'hung') : null)
    await service.start(request({ records: [...request().records, ...request().records] }))
    const summary = (await service.waitForIdle())!
    expect(summary.status).toBe('failed')
    expect(summary.failed).toBe(3)
    expect(summary.error).toContain('3 times')
  })

  it('fails the job cleanly when CorelDRAW is unavailable', async () => {
    const { store, id, history, dir } = await setupGeneration()
    const service = new GenerationService({
      store,
      history,
      safeMarginMm: () => 3,
      onProgress: (p) => progress.push(p),
      getAdapter: async () => {
        throw new AppError('COREL_NOT_INSTALLED', 'CorelDRAW was not found on this computer.')
      }
    })
    await service.start({ templateId: id, outputDirectory: join(dir, 'o2'), fileNamePattern: '{row}', overwrite: 'skip', records: [{ rowNumber: 2, values: {}, fields: {} }] })
    const summary = (await service.waitForIdle())!
    expect(summary).toMatchObject({ status: 'failed', error: 'CorelDRAW was not found on this computer.' })
    expect(progress.at(-1)!.status).toBe('failed')
  })

  it('rejects invalid requests', async () => {
    const { service, request } = await setupGeneration()
    await expect(service.start({ ...request(), outputDirectory: 'relative' })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(service.start({ ...request(), records: [] })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(service.start({ ...request(), overwrite: 'ask' })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    expect(existsSync(request().outputDirectory)).toBe(false)
  })
})

describe('CorelService', () => {
  it('prefers X7, otherwise the newest version', () => {
    expect(chooseProgId(['CorelDRAW.Application.27', 'CorelDRAW.Application.17'])).toBe('CorelDRAW.Application.17')
    expect(chooseProgId(['CorelDRAW.Application.9', 'CorelDRAW.Application.27', 'CorelDRAW.Application.20'])).toBe('CorelDRAW.Application.27')
    expect(chooseProgId([])).toBeNull()
  })

  it('creates one adapter lazily and disposes it', async () => {
    let created = 0
    const adapter = new MockCorelAdapter(FRONT_BACK)
    const service = new CorelService('bridge.ps1', () => {
      created++
      return adapter
    })
    const detection = await service.status()
    if (!detection.available) return // no CorelDRAW registered on this machine: nothing to create
    await Promise.all([service.getAdapter(), service.getAdapter()])
    expect(created).toBe(1)
    await service.dispose()
  })
})
