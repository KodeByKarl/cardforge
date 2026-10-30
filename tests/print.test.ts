import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AppError } from '../src/main/errors'
import { MockCorelAdapter } from '../src/main/services/corel/MockCorelAdapter'
import { PresetStore } from '../src/main/services/print/PresetStore'
import { PrintService, parsePlanRequest, parseStartRequest } from '../src/main/services/print/PrintService'
import { parsePrinters, parseSpoolerJobs, type PrinterApi } from '../src/main/services/print/PrinterService'
import { classifySpoolerStatus, defaultPrintSettings, estimateTotalPages, jobStatus, parsePageRange, parsePrintSettings, printerBlocker } from '../src/shared/print/logic'
import type { PrintJobRecord, PrintPlan, PrintSettings, PrinterInfo, SpoolerJob } from '../src/shared/print/types'
import type { JobSummary } from '../src/shared/template/types'
import { FRONT_BACK } from './fixtures/inspection'

const ROOT = resolve(__dirname, '.tmp', 'print')
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const PRINTER: PrinterInfo = { name: 'Office Laser', isDefault: true, status: 'ready', statusDetail: '', port: 'IP_1', supportsColor: true, paperSizes: ['A4', 'A3'] }

class FakePrinters implements PrinterApi {
  printers: PrinterInfo[] = [{ ...PRINTER }]
  /** Spooler snapshots returned by successive calls; the last one repeats. */
  script: SpoolerJob[][] = [[]]
  private n = 0
  async list() {
    return this.printers.map((p) => ({ ...p }))
  }
  async spoolerJobs() {
    const snap = this.script[Math.min(this.n, this.script.length - 1)]!
    this.n++
    return snap.map((j) => ({ ...j }))
  }
}

const settings = (patch: Partial<PrintSettings> = {}): PrintSettings => ({ ...defaultPrintSettings('Office Laser'), ...patch })

function setup(fileCount = 3) {
  const dir = join(ROOT, randomUUID())
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (let i = 1; i <= fileCount; i++) {
    const f = join(dir, `sheet ${i}.cdr`)
    writeFileSync(f, 'cdr')
    files.push(f)
  }
  const pdf = join(dir, 'sheet 1.pdf')
  writeFileSync(pdf, 'pdf')
  const sourceId = randomUUID()
  const source = { id: sourceId, templateName: 'Member card', files: [...files, pdf], finishedAt: new Date().toISOString(), sheetJob: { verification: ['Warning: font Foo is missing'] } } as unknown as JobSummary
  const adapter = new MockCorelAdapter(FRONT_BACK)
  const printers = new FakePrinters()
  const changes: PrintJobRecord[] = []
  const service = (historyFile = join(dir, 'print-jobs.json'), getAdapter: () => Promise<MockCorelAdapter> = async () => adapter) =>
    new PrintService({
      historyFile,
      previewDir: join(dir, 'preview'),
      getAdapter,
      printers,
      sources: { get: async (id) => (id === sourceId ? source : undefined) },
      corelVersion: () => 'Mock 0.0',
      onChange: (j) => changes.push(j),
      tracking: { intervalMs: 5, maxMs: 2000, noJobMs: 80 }
    })
  const svc = service()
  const plan = (s = settings(), fileIndexes?: number[]) => svc.plan({ sourceJobId: sourceId, settings: s, ...(fileIndexes ? { fileIndexes } : {}) })
  const confirm = (p: PrintPlan, extra: { allowDuplicates?: boolean } = {}) => svc.start({ planId: p.planId, confirmed: true, allowDuplicates: extra.allowDuplicates ?? false })
  const states = (jobId: string) => svc.history().then((h) => h.find((j) => j.id === jobId)!.sheets.map((s) => s.state))
  return { dir, files, sourceId, adapter, printers, svc, service, plan, confirm, states, changes }
}

describe('print logic', () => {
  it('parses page ranges against the page count', () => {
    expect(parsePageRange('', 3)).toEqual({ ok: true, pages: [1, 2, 3] })
    expect(parsePageRange('1-2, 3', 5)).toEqual({ ok: true, pages: [1, 2, 3] })
    expect(parsePageRange('2,2,1', 5)).toEqual({ ok: true, pages: [1, 2] })
    expect(parsePageRange('4', 3)).toMatchObject({ ok: false })
    expect(parsePageRange('3-1', 5)).toMatchObject({ ok: false })
    expect(parsePageRange('a', 5)).toMatchObject({ ok: false })
  })

  it('validates untrusted settings', () => {
    expect(parsePrintSettings(settings({ copies: 3, pageRange: ' 1-2 ' }))).toMatchObject({ copies: 3, pageRange: '1-2' })
    for (const bad of [{ copies: 0 }, { copies: 100 }, { copies: 1.5 }, { printer: '' }, { printer: 'a\u0000b' }, { paper: 'A0' }, { orientation: 'sideways' }, { pageRange: '1;calc' }, { color: 'rainbow' }, { scaling: 'zoom' }]) {
      expect(() => parsePrintSettings({ ...settings(), ...bad })).toThrow()
    }
    expect(() => parsePrintSettings(null)).toThrow()
  })

  it('estimates total printed pages and judges printer states', () => {
    expect(estimateTotalPages([2, 2, 1], 3)).toBe(15)
    expect(printerBlocker('P', 'offline', '')).toMatch(/offline/)
    expect(printerBlocker('P', 'error', 'Paper jam')).toMatch(/Paper jam/)
    expect(printerBlocker('P', 'paused', '')).toBeNull()
    expect(printerBlocker('P', 'ready', '')).toBeNull()
  })

  it('classifies Windows spooler status text', () => {
    expect(classifySpoolerStatus('Printing')).toBe('printing')
    expect(classifySpoolerStatus('Spooling')).toBe('spooled')
    expect(classifySpoolerStatus('Error, Offline')).toBe('problem')
    expect(classifySpoolerStatus('Printing, Retained')).toBe('printing')
  })

  it('derives job status from sheets', () => {
    const sheet = (state: PrintJobRecord['sheets'][number]['state']) => ({ state }) as PrintJobRecord['sheets'][number]
    expect(jobStatus([sheet('completed'), sheet('submitted')], false)).toBe('done')
    expect(jobStatus([sheet('completed'), sheet('failed')], false)).toBe('failed')
    expect(jobStatus([sheet('completed'), sheet('uncertain'), sheet('failed')], false)).toBe('attention')
    expect(jobStatus([sheet('cancelled'), sheet('cancelled')], false)).toBe('cancelled')
    expect(jobStatus([sheet('queued'), sheet('queued')], false)).toBe('queued')
    expect(jobStatus([sheet('submitted'), sheet('submitting')], false)).toBe('running')
  })

  it('parses Windows printer and queue payloads defensively', () => {
    const printers = parsePrinters({ printers: [{ name: 'B', status: 'weird', paperSizes: ['A4', 'Banner', 5] }, { name: 'A', isDefault: true, status: 'offline', supportsColor: false }, { nothing: true }] })
    expect(printers.map((p) => p.name)).toEqual(['A', 'B']) // default first
    expect(printers[1]).toMatchObject({ status: 'unknown', paperSizes: ['A4'], supportsColor: null })
    expect(() => parsePrinters({})).toThrow(AppError)
    expect(parseSpoolerJobs({ jobs: [{ id: 4, documentName: 'x', status: 'Printing' }, { id: 'no' }] })).toEqual([{ id: 4, documentName: 'x', status: 'Printing' }])
  })
})

describe('print requests', () => {
  it('rejects malformed payloads before touching anything', () => {
    const id = randomUUID()
    expect(() => parsePlanRequest(null)).toThrow(AppError)
    expect(() => parsePlanRequest({ sourceJobId: '../etc', settings: settings() })).toThrow(AppError)
    expect(() => parsePlanRequest({ sourceJobId: id, settings: settings(), fileIndexes: [-1] })).toThrow(AppError)
    expect(() => parsePlanRequest({ sourceJobId: id, settings: { ...settings(), copies: 500 } })).toThrow(/Copies/)
    expect(() => parseStartRequest({ planId: 'x' })).toThrow(AppError)
    expect(parseStartRequest({ planId: id, confirmed: 'yes' })).toMatchObject({ confirmed: false }) // only literal true confirms
  })
})

describe('PrintService', () => {
  it('prints a single sheet and follows it through the Windows queue to completed', async () => {
    const t = setup(1)
    t.printers.script = [[], [{ id: 11, documentName: 'sheet 1.cdr', status: 'Spooling' }], [{ id: 11, documentName: 'sheet 1.cdr', status: 'Printing' }], []]
    const plan = await t.plan(settings({ copies: 2, paper: 'A3', orientation: 'landscape', scaling: 'fitToPage', color: 'grayscale', pageRange: '1' }))
    expect(plan).toMatchObject({ sheetCount: 1, estimatedPages: 2, blockers: [] })
    expect(plan.files[0]).toMatchObject({ fileName: 'sheet 1.cdr', pages: 2, pagesToPrint: 1 })
    const job = await t.confirm(plan)
    await t.svc.waitForIdle()
    const final = (await t.svc.history())[0]!
    expect(final.id).toBe(job.id)
    expect(final.sheets[0]).toMatchObject({ state: 'completed', spoolerJobId: 11, attempts: 1 })
    expect(t.adapter.printed).toHaveLength(1)
    expect(t.adapter.printed[0]!.settings).toMatchObject({ printer: 'Office Laser', copies: 2, paper: 'A3', orientation: 'landscape', scaling: 'fitToPage', color: 'grayscale', pageRange: '1' })
    const seen = new Set(t.changes.flatMap((j) => j.sheets.map((s) => s.state)))
    expect([...seen]).toEqual(expect.arrayContaining(['submitting', 'submitted', 'spooled', 'printing', 'completed']))
    expect(t.adapter.open.size).toBe(0) // every document was closed again
  })

  it('prints several sheets in order with copies, ignoring non-CDR files', async () => {
    const t = setup(3)
    const plan = await t.plan(settings({ copies: 3 }))
    expect(plan.files.map((f) => f.fileName)).toEqual(['sheet 1.cdr', 'sheet 2.cdr', 'sheet 3.cdr'])
    expect(plan.estimatedPages).toBe(3 * 2 * 3) // 3 files x 2 pages x 3 copies
    await t.confirm(plan)
    await t.svc.waitForIdle()
    expect(t.adapter.printed.map((p) => p.path)).toEqual(t.files)
    expect(t.adapter.printed.every((p) => p.settings.copies === 3)).toBe(true)
  })

  it('never reports completed from the COM call alone', async () => {
    const t = setup(1)
    const job = await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    const sheet = (await t.svc.history()).find((j) => j.id === job.id)!.sheets[0]!
    expect(sheet.state).toBe('submitted')
    expect(sheet.note).toMatch(/not confirmed/i)
  })

  it('marks a job that vanished from the queue unseen as uncertain, not completed', async () => {
    const t = setup(1)
    t.printers.script = [[], [{ id: 5, documentName: 'x', status: 'Spooling' }], []]
    const job = await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    expect(await t.states(job.id)).toEqual(['uncertain'])
  })

  it('reports a printer problem seen in the queue without changing the outcome', async () => {
    const t = setup(1)
    t.printers.script = [[], [{ id: 8, documentName: 'x', status: 'Error, Offline' }]]
    const job = await t.confirm(await t.plan())
    await new Promise((r) => setTimeout(r, 60))
    const sheet = (await t.svc.history()).find((j) => j.id === job.id)!.sheets[0]!
    expect(sheet.state).toBe('spooled')
    expect(sheet.note).toMatch(/Printer problem/)
  })

  it('blocks an offline printer and an uninstalled printer, and never substitutes another', async () => {
    const t = setup(1)
    t.printers.printers = [{ ...PRINTER, status: 'offline', statusDetail: 'Offline' }, { ...PRINTER, name: 'Other', isDefault: false }]
    const offline = await t.plan()
    expect(offline.blockers[0]).toMatch(/offline/)
    await expect(t.confirm(offline)).rejects.toMatchObject({ code: 'PLAN_BLOCKED' })

    const missing = await t.plan(settings({ printer: 'Gone Printer' }))
    expect(missing.blockers[0]).toMatch(/not installed|not available/)
    await expect(t.confirm(missing)).rejects.toMatchObject({ code: 'PLAN_BLOCKED' })
    expect(t.adapter.printed).toHaveLength(0)
  })

  it('warns about a paused printer but still allows the job', async () => {
    const t = setup(1)
    t.printers.printers = [{ ...PRINTER, status: 'paused' }]
    const plan = await t.plan()
    expect(plan.blockers).toEqual([])
    expect(plan.warnings.join(' ')).toMatch(/paused/)
  })

  it('stops if the printer goes offline during the batch and leaves later files unsent and retryable', async () => {
    const t = setup(2)
    const plan = await t.plan()
    const original = t.adapter.configurePrint.bind(t.adapter)
    let first = true
    t.adapter.configurePrint = async (h, s) => {
      await original(h, s)
      if (first) {
        first = false
        t.printers.printers = [{ ...PRINTER, status: 'offline' }] // goes offline after file 1 is configured
      }
    }
    const job = await t.confirm(plan)
    await t.svc.waitForIdle()
    expect(await t.states(job.id)).toEqual(['submitted', 'failed'])
    expect(t.adapter.printed).toHaveLength(1)
  })

  it('treats a failure before PrintOut as failed (safe to retry) and retries only that file', async () => {
    const t = setup(3)
    let broken = true
    t.adapter.failOn = (op, detail) => (op === 'configurePrint' && broken && detail === 'Office Laser' && t.adapter.calls.filter((c) => c === 'configurePrint').length === 2 ? new AppError('PRINT_SETUP_FAILED', 'boom') : null)
    const job = await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    expect(await t.states(job.id)).toEqual(['submitted', 'failed', 'submitted'])
    expect(t.adapter.printed).toHaveLength(2)

    broken = false
    await t.svc.retryFailed(job.id)
    await t.svc.waitForIdle()
    expect(await t.states(job.id)).toEqual(['submitted', 'submitted', 'submitted'])
    expect(t.adapter.printed.map((p) => p.path)).toEqual([t.files[0], t.files[2], t.files[1]]) // file 2 only once more; 1 and 3 untouched
    const sheet = (await t.svc.history())[0]!.sheets[1]!
    expect(sheet.attempts).toBe(2)
  })

  it('treats a failure during PrintOut as uncertain and never retries it', async () => {
    const t = setup(2)
    let printOuts = 0
    t.adapter.failOn = (op) => (op === 'printOut' && ++printOuts === 1 ? new AppError('BRIDGE_TIMEOUT', 'CorelDRAW did not respond') : null)
    const job = await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    expect(await t.states(job.id)).toEqual(['uncertain', 'submitted'])
    await expect(t.svc.retryFailed(job.id)).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY' })
    expect(t.adapter.printed).toHaveLength(1)
  })

  it('adopts a spooler job that appeared despite a PrintOut error', async () => {
    const t = setup(1)
    t.printers.script = [[], [{ id: 21, documentName: 'x', status: 'Spooling' }]]
    t.adapter.failOn = (op) => (op === 'printOut' ? new AppError('BRIDGE_TIMEOUT', 'timed out') : null)
    const job = await t.confirm(await t.plan())
    await new Promise((r) => setTimeout(r, 40))
    const sheet = (await t.svc.history()).find((j) => j.id === job.id)!.sheets[0]!
    expect(sheet).toMatchObject({ spoolerJobId: 21 })
    expect(['spooled', 'printing']).toContain(sheet.state)
  })

  it('cancels files that are still queued but cannot recall the one being sent', async () => {
    const t = setup(3)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const original = t.adapter.printOut.bind(t.adapter)
    t.adapter.printOut = async (h) => {
      await gate
      await original(h)
    }
    const job = await t.confirm(await t.plan())
    await new Promise((r) => setTimeout(r, 20))
    const cancelled = await t.svc.cancel(job.id)
    expect(cancelled.sheets.map((s) => s.state)).toEqual(['submitting', 'cancelled', 'cancelled'])
    release()
    await t.svc.waitForIdle()
    expect(await t.states(job.id)).toEqual(['submitted', 'cancelled', 'cancelled'])
    expect(t.adapter.printed).toHaveLength(1)
    expect((await t.svc.history())[0]!.status).toBe('attention') // partly printed: the operator must look
  })

  it('requires explicit confirmation and uses each plan once', async () => {
    const t = setup(1)
    const plan = await t.plan()
    await expect(t.svc.start({ planId: plan.planId, confirmed: false, allowDuplicates: false })).rejects.toMatchObject({ code: 'NOT_CONFIRMED' })
    await t.confirm(plan)
    await expect(t.confirm(plan)).rejects.toMatchObject({ code: 'PLAN_EXPIRED' }) // double click / replay
    await t.svc.waitForIdle()
    expect(t.adapter.printed).toHaveLength(1)
    await expect(t.svc.start({ planId: randomUUID(), confirmed: true, allowDuplicates: false })).rejects.toMatchObject({ code: 'PLAN_EXPIRED' })
  })

  it('blocks a second job while one is sending', async () => {
    const t = setup(1)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const original = t.adapter.printOut.bind(t.adapter)
    t.adapter.printOut = async (h) => {
      await gate
      await original(h)
    }
    const second = await t.plan()
    await t.confirm(await t.plan())
    await new Promise((r) => setTimeout(r, 20))
    await expect(t.confirm(second)).rejects.toMatchObject({ code: 'PRINT_BUSY' })
    expect((await t.plan()).blockers.join(' ')).toMatch(/still sending/)
    release()
    await t.svc.waitForIdle()
    expect(t.adapter.printed).toHaveLength(1)
  })

  it('flags files already sent to the same printer and needs explicit approval to reprint', async () => {
    const t = setup(2)
    await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    const again = await t.plan()
    expect(again.duplicates.map((d) => d.fileName)).toEqual(['sheet 1.cdr', 'sheet 2.cdr'])
    await expect(t.confirm(again)).rejects.toMatchObject({ code: 'DUPLICATE_PRINT' })
    expect(t.adapter.printed).toHaveLength(2)
    await t.confirm(again, { allowDuplicates: true })
    await t.svc.waitForIdle()
    expect(t.adapter.printed).toHaveLength(4)
    // A different printer is not a duplicate.
    t.printers.printers = [{ ...PRINTER }, { ...PRINTER, name: 'Second', isDefault: false }]
    expect((await t.plan(settings({ printer: 'Second' }))).duplicates).toEqual([])
  })

  it('does not count a failed or cancelled file as a duplicate', async () => {
    const t = setup(1)
    t.adapter.failOn = (op) => (op === 'configurePrint' ? new AppError('PRINT_SETUP_FAILED', 'x') : null)
    await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    t.adapter.failOn = null
    expect((await t.plan()).duplicates).toEqual([])
  })

  it('surfaces CorelDRAW not installed and refuses unknown or missing files', async () => {
    const t = setup(1)
    const gone = t.service(join(t.dir, 'x.json'), async () => Promise.reject(new AppError('COREL_NOT_INSTALLED', 'CorelDRAW was not found')))
    await expect(gone.plan({ sourceJobId: t.sourceId, settings: settings() })).rejects.toMatchObject({ code: 'COREL_NOT_INSTALLED' })
    await expect(t.svc.plan({ sourceJobId: randomUUID(), settings: settings() })).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' })
    await expect(t.plan(settings(), [5])).rejects.toMatchObject({ code: 'NO_FILES' })
    rmSync(t.files[0]!)
    const plan = await t.plan()
    expect(plan.blockers[0]).toMatch(/missing from disk/)
  })

  it('reports an invalid page range as a blocker', async () => {
    const t = setup(1)
    const plan = await t.plan(settings({ pageRange: '1-9' }))
    expect(plan.blockers[0]).toMatch(/beyond the last page/)
  })

  it('reports CorelDRAW print-module failures as failed with the real message', async () => {
    const t = setup(1)
    t.adapter.failOn = (op) => (op === 'configurePrint' ? new AppError('PRINT_SETUP_FAILED', 'CorelDRAW could not set up printing (HRESULT 0x80030002)') : null)
    const job = await t.confirm(await t.plan())
    await t.svc.waitForIdle()
    const sheet = (await t.svc.history()).find((j) => j.id === job.id)!.sheets[0]!
    expect(sheet).toMatchObject({ state: 'failed' })
    expect(sheet.error).toMatch(/0x80030002/)
    expect(t.adapter.printed).toHaveLength(0)
  })

  it('survives an application restart: unsent files are cancelled, in-flight files become uncertain and are not reprinted', async () => {
    const t = setup(3)
    const file = join(t.dir, 'restart-jobs.json')
    const now = new Date().toISOString()
    const sheet = (i: number, state: string) => ({ fileIndex: i, file: t.files[i]!, fileName: `sheet ${i + 1}.cdr`, pages: 2, state, attempts: 1, spoolerJobId: null, note: null, error: null, updatedAt: now })
    const job = { id: randomUUID(), sourceJobId: t.sourceId, templateName: 'x', corelVersion: 'v', createdAt: now, finishedAt: null, settings: settings(), estimatedPages: 6, status: 'running', sheets: [sheet(0, 'submitted'), sheet(1, 'submitting'), sheet(2, 'queued')] }
    writeFileSync(file, JSON.stringify([job]))
    const restarted = t.service(file)
    const [loaded] = await restarted.history()
    expect(loaded!.sheets.map((s) => s.state)).toEqual(['submitted', 'uncertain', 'cancelled'])
    expect(loaded!.status).toBe('attention')
    expect(loaded!.finishedAt).not.toBeNull()
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].sheets[1].state).toBe('uncertain') // persisted
    await expect(restarted.retryFailed(loaded!.id)).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY' })
    expect(t.adapter.printed).toHaveLength(0)
  })

  it('resumes queue tracking after a restart for files already in the Windows queue', async () => {
    const t = setup(1)
    const file = join(t.dir, 'resume-jobs.json')
    const now = new Date().toISOString()
    const job = { id: randomUUID(), sourceJobId: t.sourceId, templateName: 'x', corelVersion: 'v', createdAt: now, finishedAt: now, settings: settings(), estimatedPages: 2, status: 'done', sheets: [{ fileIndex: 0, file: t.files[0]!, fileName: 'sheet 1.cdr', pages: 2, state: 'spooled', attempts: 1, spoolerJobId: 31, note: null, error: null, updatedAt: now }] }
    writeFileSync(file, JSON.stringify([job]))
    t.printers.script = [[{ id: 31, documentName: 'x', status: 'Printing' }], []]
    const restarted = t.service(file)
    await restarted.history()
    await restarted.waitForIdle()
    expect((await restarted.history())[0]!.sheets[0]!.state).toBe('completed')
  })

  it('renders preview pages and surfaces the generation warnings', async () => {
    const t = setup(2)
    const preview = await t.svc.preview(t.sourceId, 1)
    expect(preview).toMatchObject({ fileIndex: 1, fileName: 'sheet 2.cdr', pageCount: 2 })
    expect(preview.pages).toHaveLength(2)
    expect(preview.pages[0]!.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(preview.pages[0]!.widthMm).toBeGreaterThan(0)
    expect(preview.warnings).toEqual(['Warning: font Foo is missing'])
    await expect(t.svc.preview(t.sourceId, 3)).rejects.toMatchObject({ code: 'INVALID_ARGS' }) // the PDF is not previewable
    expect(t.adapter.open.size).toBe(0)
  })

  it('lists printable files of a source job', async () => {
    const t = setup(2)
    const source = await t.svc.source(t.sourceId)
    expect(source.files).toEqual([{ fileIndex: 0, fileName: 'sheet 1.cdr', exists: true }, { fileIndex: 1, fileName: 'sheet 2.cdr', exists: true }])
  })
})

describe('PresetStore', () => {
  it('saves, replaces, removes and remembers settings across instances', async () => {
    const file = join(ROOT, randomUUID(), 'presets.json')
    mkdirSync(join(file, '..'), { recursive: true })
    const store = new PresetStore(file)
    const a = await store.saveAs('A4 colour', settings())
    const b = await store.saveAs('a4 COLOUR', settings({ copies: 5 }))
    expect(b.id).toBe(a.id) // same name replaces
    await store.saveAs('Draft', settings({ color: 'black' }))
    await store.remember(settings({ copies: 7 }))
    const reloaded = await new PresetStore(file).list()
    expect(reloaded.presets.map((p) => p.name)).toEqual(['a4 COLOUR', 'Draft'])
    expect(reloaded.presets[0]!.settings.copies).toBe(5)
    expect(reloaded.last?.copies).toBe(7)
    await store.remove(a.id)
    expect((await store.list()).presets.map((p) => p.name)).toEqual(['Draft'])
    await expect(store.saveAs('', settings())).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    await expect(store.saveAs('Bad', { ...settings(), copies: 0 })).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })
})
