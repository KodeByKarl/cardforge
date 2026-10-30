import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  classifySpoolerStatus,
  estimateTotalPages,
  isActiveJob,
  jobStatus,
  parsePageRange,
  parsePrintSettings,
  printerBlocker,
  settingsKey,
  wasSent
} from '../../../shared/print/logic'
import type {
  PrintJobRecord,
  PrintPlan,
  PrintPlanFile,
  PrintPlanRequest,
  PrintPreview,
  PrintSettings,
  PrintSheetRecord,
  PrintSource,
  PrintStartRequest,
  PrinterInfo
} from '../../../shared/print/types'
import type { JobSummary } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import type { CorelAdapter } from '../corel/CorelAdapter'
import { fileToDataUrl, pathExists, readJson, writeJsonAtomic } from '../fsutil'
import type { PrinterApi } from './PrinterService'

const KEEP_JOBS = 100
const DUPLICATE_WINDOW_MS = 30 * 60_000
const PLAN_TTL_MS = 15 * 60_000
const PREVIEW_DPI = 60
const PREVIEW_MAX_PAGES = 12

export interface PrintServiceOptions {
  /** JSON file for the job history. */
  historyFile: string
  /** Scratch folder for preview images. */
  previewDir: string
  getAdapter: () => Promise<CorelAdapter>
  printers: PrinterApi
  /** Generation jobs a print job may use as its source. */
  sources: { get(id: string): Promise<JobSummary | undefined> }
  corelVersion: () => string | null
  onChange: (job: PrintJobRecord) => void
  /** Spooler polling, overridable for tests. */
  tracking?: { intervalMs: number; maxMs: number; noJobMs: number }
}

interface StoredPlan {
  plan: PrintPlan
  files: { fileIndex: number; path: string; pages: number }[]
  expires: number
}

const now = () => new Date().toISOString()
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Prints the CDR files of a finished generation job through CorelDRAW, one file at a time.
 *
 * Outcome honesty: a file is `failed` only when the printer was certainly never contacted (a document could not be opened or
 * configured). Once PrintOut has been called, any error leaves it `uncertain`; uncertain files are never retried
 * automatically. `completed` is only claimed after the Windows queue showed the job printing and then finishing.
 */
export class PrintService {
  private jobs: PrintJobRecord[] = []
  private loaded: Promise<void> | null = null
  private readonly plans = new Map<string, StoredPlan>()
  private readonly cancelRequested = new Set<string>()
  private readonly running = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly tracking: { intervalMs: number; maxMs: number; noJobMs: number }
  private readonly trackers = new Set<Promise<void>>()

  constructor(private readonly o: PrintServiceOptions) {
    this.tracking = o.tracking ?? { intervalMs: 2_000, maxMs: 10 * 60_000, noJobMs: 45_000 }
  }

  // ---- history ----

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed = await readJson<unknown>(this.o.historyFile)
        this.jobs = Array.isArray(parsed) ? (parsed as PrintJobRecord[]) : []
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('print.history_load_failed', { error: err })
        this.jobs = []
      }
      await this.recoverAfterRestart()
    })()
    return this.loaded
  }

  /**
   * Called once at startup. Files that never left the queue are cancelled. A file that was being submitted when the app
   * stopped may or may not have reached the printer: it becomes `uncertain`, and is never reprinted automatically.
   * Files already seen in the Windows queue are tracked again by their spooler job id.
   */
  private async recoverAfterRestart(): Promise<void> {
    let changed = false
    for (const job of this.jobs) {
      for (const s of job.sheets) {
        if (s.state === 'queued') {
          Object.assign(s, { state: 'cancelled', note: 'Not sent: the app was closed before this file was printed.', updatedAt: now() })
          changed = true
        } else if (s.state === 'submitting') {
          Object.assign(s, { state: 'uncertain', note: 'The app was closed while this file was being sent. It may or may not have printed: check the printer before printing it again.', updatedAt: now() })
          changed = true
        }
      }
      const next = jobStatus(job.sheets, false)
      if (next !== job.status) {
        job.status = next
        job.finishedAt ??= now()
        changed = true
      }
    }
    if (changed) await this.persist()
    for (const job of this.jobs) for (const s of job.sheets) if ((s.state === 'spooled' || s.state === 'printing') && s.spoolerJobId !== null) this.startTracking(job, s, null)
  }

  private async persist(): Promise<void> {
    this.jobs = this.jobs.slice(0, KEEP_JOBS)
    await writeJsonAtomic(this.o.historyFile, this.jobs)
  }

  async history(): Promise<PrintJobRecord[]> {
    await this.load()
    return structuredClone(this.jobs)
  }

  get activeJobId(): string | null {
    return this.jobs.find((j) => isActiveJob(j.sheets))?.id ?? null
  }

  // ---- sources ----

  private async sourceJob(sourceJobId: string): Promise<JobSummary> {
    const job = await this.o.sources.get(sourceJobId)
    if (!job) throw new AppError('JOB_NOT_FOUND', 'That generation job was not found in the history.')
    return job
  }

  private cdrFiles(job: JobSummary): { fileIndex: number; path: string }[] {
    return job.files.flatMap((path, fileIndex) => (extname(path).toLowerCase() === '.cdr' ? [{ fileIndex, path }] : []))
  }

  async source(sourceJobId: string): Promise<PrintSource> {
    const job = await this.sourceJob(sourceJobId)
    const files = []
    for (const f of this.cdrFiles(job)) files.push({ fileIndex: f.fileIndex, fileName: basename(f.path), exists: await pathExists(f.path) })
    return { jobId: job.id, templateName: job.templateName, finishedAt: job.finishedAt, files, warnings: job.sheetJob?.verification.filter((v) => /warn|overflow|font|clip|missing|differ|fail/i.test(v)) ?? [] }
  }

  // ---- planning ----

  /** Everything the operator must confirm, computed from the real files. Nothing is sent. */
  async plan(untrusted: unknown): Promise<PrintPlan> {
    await this.load()
    const request = parsePlanRequest(untrusted)
    const settings = request.settings
    const job = await this.sourceJob(request.sourceJobId)
    const cdrs = this.cdrFiles(job)
    const wanted = request.fileIndexes ? cdrs.filter((f) => request.fileIndexes!.includes(f.fileIndex)) : cdrs
    if (wanted.length === 0) throw new AppError('NO_FILES', 'There are no CorelDRAW files to print in that job.')
    if (request.fileIndexes && wanted.length !== new Set(request.fileIndexes).size) throw new AppError('INVALID_ARGS', 'Some selected files are not CorelDRAW files of that job.')

    const blockers: string[] = []
    const warnings: string[] = []

    const printers = await this.o.printers.list()
    const printer = printers.find((p) => p.name === settings.printer)
    if (!printer) blockers.push(`Printer “${settings.printer}” is not installed or not available. Nothing will be sent to a different printer.`)
    else {
      const blocked = printerBlocker(printer.name, printer.status, printer.statusDetail)
      if (blocked) blockers.push(blocked)
      else if (printer.status === 'paused') warnings.push(`Printer “${printer.name}” is paused. Jobs will wait in its queue until it is resumed.`)
      if (printer.paperSizes.length > 0 && !printer.paperSizes.includes(settings.paper)) warnings.push(`The printer driver does not list ${settings.paper}. Check the paper size.`)
      if (settings.color !== 'color' && printer.supportsColor === false) warnings.push('The printer is black-and-white; color output will be converted by the driver.')
    }
    const busy = this.activeJobId
    if (busy) blockers.push('Another print job is still sending. Wait for it to finish or cancel it.')

    const files: PrintPlanFile[] = []
    const stored: StoredPlan['files'] = []
    let adapter: CorelAdapter | null = null
    for (const f of wanted) {
      const name = basename(f.path)
      if (!(await pathExists(f.path))) {
        blockers.push(`${name} is missing from disk. Generate the sheets again.`)
        continue
      }
      adapter ??= await this.o.getAdapter()
      const handle = await adapter.openDocument(f.path, { light: true })
      try {
        const { pages } = await adapter.docInfo(handle)
        const range = parsePageRange(settings.pageRange, pages)
        if (!range.ok) {
          blockers.push(`${name}: ${range.error}`)
          continue
        }
        files.push({ fileIndex: f.fileIndex, fileName: name, pages, pagesToPrint: range.pages.length })
        stored.push({ fileIndex: f.fileIndex, path: f.path, pages })
      } finally {
        await adapter.closeDocument(handle).catch((err) => log.warn('print.close_failed', { error: err }))
      }
    }

    const duplicates: PrintPlan['duplicates'] = []
    const cutoff = Date.now() - DUPLICATE_WINDOW_MS
    for (const f of stored) {
      for (const j of this.jobs) {
        if (j.sourceJobId !== request.sourceJobId || j.settings.printer.toLowerCase() !== settings.printer.toLowerCase()) continue
        const s = j.sheets.find((x) => x.fileIndex === f.fileIndex && wasSent(x) && new Date(x.updatedAt).getTime() >= cutoff)
        if (s) {
          duplicates.push({ fileIndex: f.fileIndex, fileName: s.fileName, state: s.state, at: s.updatedAt })
          break
        }
      }
    }

    const plan: PrintPlan = {
      planId: randomUUID(),
      sourceJobId: job.id,
      templateName: job.templateName,
      settings,
      printerStatus: printer?.status ?? 'unknown',
      files,
      sheetCount: files.length,
      estimatedPages: estimateTotalPages(files.map((f) => f.pagesToPrint), settings.copies),
      blockers,
      warnings,
      duplicates
    }
    for (const [id, p] of this.plans) if (p.expires < Date.now()) this.plans.delete(id)
    this.plans.set(plan.planId, { plan, files: stored, expires: Date.now() + PLAN_TTL_MS })
    return plan
  }

  // ---- printing ----

  /** Starts the job the operator confirmed. Returns at once; progress arrives through onChange. */
  async start(untrusted: unknown): Promise<PrintJobRecord> {
    await this.load()
    const req = parseStartRequest(untrusted)
    const stored = this.plans.get(req.planId)
    if (!stored || stored.expires < Date.now()) throw new AppError('PLAN_EXPIRED', 'This print plan has expired. Review the print settings and confirm again.')
    if (!req.confirmed) throw new AppError('NOT_CONFIRMED', 'Printing must be confirmed explicitly.')
    const { plan } = stored
    if (plan.blockers.length > 0) throw new AppError('PLAN_BLOCKED', plan.blockers[0]!)
    if (plan.duplicates.length > 0 && !req.allowDuplicates) throw new AppError('DUPLICATE_PRINT', 'Some of these files were already sent to this printer recently. Confirm re-printing explicitly.')
    if (this.activeJobId) throw new AppError('PRINT_BUSY', 'Another print job is still sending.')
    this.plans.delete(req.planId) // one confirmation = one job: a double click cannot submit twice

    const job: PrintJobRecord = {
      id: randomUUID(),
      sourceJobId: plan.sourceJobId,
      templateName: plan.templateName,
      corelVersion: this.o.corelVersion() ?? 'unknown',
      createdAt: now(),
      finishedAt: null,
      settings: plan.settings,
      estimatedPages: plan.estimatedPages,
      status: 'queued',
      sheets: stored.files.map((f) => ({ fileIndex: f.fileIndex, file: f.path, fileName: basename(f.path), pages: f.pages, state: 'queued', attempts: 0, spoolerJobId: null, note: null, error: null, updatedAt: now() }))
    }
    this.jobs.unshift(job)
    await this.persist()
    this.run(job.id, job.sheets.map((s) => s.fileIndex))
    return structuredClone(job)
  }

  /** Re-sends files that certainly failed before reaching the printer. Uncertain and sent files are never included. */
  async retryFailed(jobId: unknown): Promise<PrintJobRecord> {
    await this.load()
    const job = this.find(jobId)
    if (this.activeJobId) throw new AppError('PRINT_BUSY', 'Another print job is still sending.')
    const failed = job.sheets.filter((s) => s.state === 'failed').map((s) => s.fileIndex)
    if (failed.length === 0) throw new AppError('NOTHING_TO_RETRY', 'No file in this job failed before printing. Files with an unknown outcome are not retried automatically.')
    const printer = (await this.o.printers.list()).find((p) => p.name === job.settings.printer)
    if (!printer) throw new AppError('PRINTER_UNAVAILABLE', `Printer “${job.settings.printer}” is not available. Nothing will be sent to a different printer.`)
    const blocked = printerBlocker(printer.name, printer.status, printer.statusDetail)
    if (blocked) throw new AppError('PRINTER_UNAVAILABLE', blocked)
    for (const s of job.sheets) if (failed.includes(s.fileIndex)) Object.assign(s, { state: 'queued', error: null, note: 'Retrying.', updatedAt: now() })
    job.finishedAt = null
    job.status = 'queued'
    await this.persist()
    this.run(job.id, failed)
    return structuredClone(job)
  }

  /** Cancels files that have not been sent yet. A file already being sent cannot be recalled. */
  async cancel(jobId: unknown): Promise<PrintJobRecord> {
    await this.load()
    const job = this.find(jobId)
    this.cancelRequested.add(job.id)
    let changed = false
    for (const s of job.sheets) {
      if (s.state === 'queued') {
        Object.assign(s, { state: 'cancelled', note: 'Cancelled before it was sent.', updatedAt: now() })
        changed = true
      }
    }
    if (changed) await this.finishIfIdle(job)
    return structuredClone(job)
  }

  private find(jobId: unknown): PrintJobRecord {
    const job = typeof jobId === 'string' ? this.jobs.find((j) => j.id === jobId) : undefined
    if (!job) throw new AppError('JOB_NOT_FOUND', 'That print job was not found.')
    return job
  }

  private run(jobId: string, fileIndexes: number[]): void {
    this.running.add(jobId)
    const task = this.queue.then(() => this.process(jobId, fileIndexes))
    this.queue = task.catch(() => undefined)
    void task.catch((err) => log.error('print.job_crashed', { error: err })).finally(() => this.running.delete(jobId))
  }

  private async update(job: PrintJobRecord, sheet: PrintSheetRecord, patch: Partial<PrintSheetRecord>): Promise<void> {
    Object.assign(sheet, patch, { updatedAt: now() })
    job.status = jobStatus(job.sheets, this.cancelRequested.has(job.id))
    await this.persist()
    this.o.onChange(structuredClone(job))
  }

  private async finishIfIdle(job: PrintJobRecord): Promise<void> {
    job.status = jobStatus(job.sheets, this.cancelRequested.has(job.id))
    if (!isActiveJob(job.sheets)) {
      job.finishedAt ??= now()
      this.cancelRequested.delete(job.id)
    }
    await this.persist()
    this.o.onChange(structuredClone(job))
  }

  private async process(jobId: string, fileIndexes: number[]): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) return
    for (const fileIndex of fileIndexes) {
      const sheet = job.sheets.find((s) => s.fileIndex === fileIndex)
      if (!sheet || sheet.state !== 'queued') continue // cancelled meanwhile
      await this.printSheet(job, sheet)
    }
    for (const s of job.sheets) if (s.state === 'queued') Object.assign(s, { state: 'cancelled', note: 'Cancelled before it was sent.', updatedAt: now() })
    await this.finishIfIdle(job)
  }

  private async printSheet(job: PrintJobRecord, sheet: PrintSheetRecord): Promise<void> {
    await this.update(job, sheet, { state: 'submitting', attempts: sheet.attempts + 1, error: null, note: null })
    let adapter: CorelAdapter
    let handle: string | null = null
    try {
      // The printer is re-checked right before each file: it may have gone offline during a long batch.
      const printer = await this.checkPrinter(job.settings)
      adapter = await this.o.getAdapter()
      if (!(await pathExists(sheet.file))) throw new AppError('FILE_NOT_FOUND', `${sheet.fileName} is no longer on disk.`)
      handle = await adapter.openDocument(sheet.file, { light: true })
      await adapter.configurePrint(handle, job.settings)
      const baseline = await this.safeSpooler(printer.name)
      try {
        await adapter.printOut(handle)
      } catch (err) {
        // PrintOut may have handed the job to the spooler before failing or timing out.
        const seen = await this.findNewJob(printer.name, baseline)
        if (seen) {
          await this.update(job, sheet, { state: 'spooled', spoolerJobId: seen.id, note: 'CorelDRAW reported an error, but the job is in the Windows queue.', error: messageOf(err) })
          this.startTracking(job, sheet, null)
        } else {
          await this.update(job, sheet, { state: 'uncertain', error: messageOf(err), note: 'CorelDRAW reported an error while sending. The file may or may not have reached the printer: check the queue before printing it again.' })
        }
        return
      }
      await this.update(job, sheet, { state: 'submitted', note: 'Accepted by CorelDRAW. Waiting for the Windows print queue.' })
      this.startTracking(job, sheet, baseline)
    } catch (err) {
      // Nothing was sent: opening, configuring or the printer check failed before PrintOut.
      log.warn('print.sheet_failed', { file: sheet.fileName, code: err instanceof AppError ? err.code : 'ERROR', error: messageOf(err) })
      await this.update(job, sheet, { state: 'failed', error: messageOf(err), note: 'Not sent to the printer. Safe to retry.' })
    } finally {
      if (handle) await this.closeQuietly(handle)
    }
  }

  private async closeQuietly(handle: string): Promise<void> {
    try {
      const adapter = await this.o.getAdapter()
      await adapter.closeDocument(handle)
    } catch (err) {
      log.warn('print.close_failed', { error: err })
    }
  }

  private async checkPrinter(settings: PrintSettings): Promise<PrinterInfo> {
    const printer = (await this.o.printers.list()).find((p) => p.name === settings.printer)
    if (!printer) throw new AppError('PRINTER_UNAVAILABLE', `Printer “${settings.printer}” is not available. Nothing was sent to a different printer.`)
    const blocked = printerBlocker(printer.name, printer.status, printer.statusDetail)
    if (blocked) throw new AppError('PRINTER_UNAVAILABLE', blocked)
    return printer
  }

  // ---- Windows queue tracking ----

  private async safeSpooler(printer: string): Promise<Set<number> | null> {
    try {
      return new Set((await this.o.printers.spoolerJobs(printer)).map((j) => j.id))
    } catch (err) {
      log.warn('print.spooler_unreadable', { error: err })
      return null
    }
  }

  private async findNewJob(printer: string, baseline: Set<number> | null): Promise<{ id: number } | null> {
    if (!baseline) return null
    try {
      const fresh = (await this.o.printers.spoolerJobs(printer)).filter((j) => !baseline.has(j.id))
      return fresh.length === 1 ? { id: fresh[0]!.id } : null // several new jobs: cannot tell which one is ours
    } catch {
      return null
    }
  }

  /**
   * Follows a submitted file in the Windows queue. spooled -> printing -> completed only on what the queue reports.
   * A job that never appears stays `submitted`; one that vanishes without having been seen printing becomes `uncertain`.
   */
  private startTracking(job: PrintJobRecord, sheet: PrintSheetRecord, baseline: Set<number> | null): void {
    const t = this.trackSheet(job, sheet, baseline).catch((err) => log.warn('print.tracking_failed', { error: err }))
    this.trackers.add(t)
    void t.finally(() => this.trackers.delete(t))
  }

  private async trackSheet(job: PrintJobRecord, sheet: PrintSheetRecord, baseline: Set<number> | null): Promise<void> {
    const printer = job.settings.printer
    const started = Date.now()
    let lastStatus = ''
    let seen = sheet.spoolerJobId !== null
    for (;;) {
      await wait(this.tracking.intervalMs)
      const elapsed = Date.now() - started
      let jobs
      try {
        jobs = await this.o.printers.spoolerJobs(printer)
      } catch {
        if (elapsed > this.tracking.maxMs) return
        continue
      }
      if (sheet.spoolerJobId === null && baseline) {
        const fresh = jobs.filter((j) => !baseline.has(j.id))
        if (fresh.length === 1) {
          seen = true
          lastStatus = fresh[0]!.status
          await this.update(job, sheet, { spoolerJobId: fresh[0]!.id, state: 'spooled', note: `In the Windows print queue (job ${fresh[0]!.id}).` })
        } else if (fresh.length > 1) {
          await this.update(job, sheet, { note: 'Several new jobs appeared in the Windows queue, so this file cannot be matched to one. Check the printer queue.' })
          return
        }
      }
      if (sheet.spoolerJobId !== null) {
        const mine = jobs.find((j) => j.id === sheet.spoolerJobId)
        if (mine) {
          seen = true
          lastStatus = mine.status
          const kind = classifySpoolerStatus(mine.status)
          if (kind === 'printing' && sheet.state !== 'printing') await this.update(job, sheet, { state: 'printing', note: `Printing (${mine.status}).` })
          else if (kind === 'spooled' && sheet.state !== 'spooled') await this.update(job, sheet, { state: 'spooled', note: `In the Windows print queue (${mine.status || 'queued'}).` })
          else if (kind === 'problem') await this.update(job, sheet, { note: `Printer problem: ${mine.status}. Check the printer.` })
        } else if (seen) {
          if (classifySpoolerStatus(lastStatus) === 'printing' || sheet.state === 'printing') await this.update(job, sheet, { state: 'completed', note: 'Left the Windows queue after printing.' })
          else await this.update(job, sheet, { state: 'uncertain', note: 'The job left the Windows queue without being seen printing. It may have been deleted: check the printer.' })
          await this.finishIfIdle(job)
          return
        }
      } else if (elapsed > this.tracking.noJobMs) {
        await this.update(job, sheet, { note: 'No job appeared in the Windows queue (it may have finished instantly, or the printer bypasses the spooler). Printing is not confirmed.' })
        return
      }
      if (elapsed > this.tracking.maxMs) {
        await this.update(job, sheet, { note: 'Stopped watching the Windows queue; the job is still there. Check the printer.' })
        return
      }
    }
  }

  async waitForIdle(): Promise<void> {
    await this.queue
    await Promise.allSettled([...this.trackers])
  }

  // ---- preview ----

  /** Renders the pages of one generated CDR to images for review. Uses CorelDRAW; the renderer never opens CDR files itself. */
  async preview(sourceJobId: unknown, fileIndex: unknown): Promise<PrintPreview> {
    if (typeof sourceJobId !== 'string' || typeof fileIndex !== 'number' || !Number.isInteger(fileIndex)) throw new AppError('INVALID_ARGS', 'Invalid preview request.')
    const job = await this.sourceJob(sourceJobId)
    const file = this.cdrFiles(job).find((f) => f.fileIndex === fileIndex)
    if (!file) throw new AppError('INVALID_ARGS', 'That file is not a CorelDRAW file of this job.')
    if (!(await pathExists(file.path))) throw new AppError('FILE_NOT_FOUND', `${basename(file.path)} is missing from disk.`)
    const adapter = await this.o.getAdapter()
    const handle = await adapter.openDocument(file.path, { light: true })
    await mkdir(this.o.previewDir, { recursive: true })
    try {
      const { pages: pageCount } = await adapter.docInfo(handle)
      const wanted = Array.from({ length: Math.min(pageCount, PREVIEW_MAX_PAGES) }, (_, i) => i + 1)
      const prefix = randomUUID()
      const exported = await adapter.exportPages(handle, { dir: this.o.previewDir, prefix, dpi: PREVIEW_DPI, pages: wanted })
      const pages = []
      for (const e of exported) {
        pages.push({ pageIndex: e.pageIndex, dataUrl: await fileToDataUrl(e.path), widthMm: Math.round((e.widthPx / PREVIEW_DPI) * 25.4 * 10) / 10, heightMm: Math.round((e.heightPx / PREVIEW_DPI) * 25.4 * 10) / 10 })
        await rm(e.path, { force: true })
      }
      return { fileIndex, fileName: basename(file.path), pageCount, pages, warnings: (await this.source(sourceJobId)).warnings }
    } finally {
      await adapter.closeDocument(handle).catch((err) => log.warn('print.close_failed', { error: err }))
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---- untrusted payload parsing ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asArgs<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    throw new AppError('INVALID_ARGS', messageOf(err))
  }
}

export function parsePlanRequest(input: unknown): PrintPlanRequest {
  return asArgs(() => {
    if (!isRecord(input)) throw new Error('Invalid print request.')
    const id = input['sourceJobId']
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid job id.')
    let fileIndexes: number[] | undefined
    if (input['fileIndexes'] !== undefined) {
      const raw = input['fileIndexes']
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 5000 || !raw.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) throw new Error('Invalid file selection.')
      fileIndexes = raw as number[]
    }
    return { sourceJobId: id, ...(fileIndexes ? { fileIndexes } : {}), settings: parsePrintSettings(input['settings']) }
  })
}

export function parseStartRequest(input: unknown): PrintStartRequest {
  return asArgs(() => {
    if (!isRecord(input)) throw new Error('Invalid print request.')
    const planId = input['planId']
    if (typeof planId !== 'string' || !/^[0-9a-f-]{36}$/.test(planId)) throw new Error('Invalid plan id.')
    return { planId, confirmed: input['confirmed'] === true, allowDuplicates: input['allowDuplicates'] === true }
  })
}
