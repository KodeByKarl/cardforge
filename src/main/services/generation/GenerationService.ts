import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { planFileNames } from '../../../shared/generation/naming'
import type { GenerationPlan, GenerationRequest, JobLogEntry, JobProgress, JobSummary, PlannedItem } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import { parseGenerationRequest } from '../../validation'
import { X7_FILE_VERSION, type CorelAdapter, type DocHandle } from '../corel/CorelAdapter'
import { pathExists, writeJsonAtomic } from '../fsutil'
import type { TemplateStore } from '../templates/TemplateStore'
import type { JobHistory } from './JobHistory'

const BRIDGE_LOSS = new Set(['COREL_RESTARTED', 'BRIDGE_EXITED', 'BRIDGE_TIMEOUT', 'COREL_GONE'])
const MAX_CONSECUTIVE_CRASHES = 3

export interface GenerationDeps {
  store: TemplateStore
  getAdapter: () => Promise<CorelAdapter>
  history: JobHistory
  safeMarginMm: () => number
  onProgress: (progress: JobProgress) => void
}

interface ActiveJob {
  id: string
  cancelRequested: boolean
  done: Promise<JobSummary>
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

/**
 * Generates one editable CDR per record from a private working copy of the template.
 * One job at a time. Each file is saved under a temporary name and renamed into place only when complete,
 * so a crash never leaves a half-written card under its final name.
 */
export class GenerationService {
  private active: ActiveJob | null = null

  constructor(private readonly deps: GenerationDeps) {}

  get activeJobId(): string | null {
    return this.active?.id ?? null
  }

  /** Resolves file names and checks which already exist. Read-only. */
  async plan(untrusted: unknown): Promise<GenerationPlan> {
    return this.planRequest(parseGenerationRequest(untrusted))
  }

  private async planRequest(request: GenerationRequest): Promise<GenerationPlan> {
    await this.deps.store.get(request.templateId)
    const names = planFileNames(request.records, request.fileNamePattern)
    const taken = new Set<string>()
    const items: PlannedItem[] = []
    for (let i = 0; i < request.records.length; i++) {
      let fileName = names[i]!
      let outputPath = join(request.outputDirectory, fileName)
      let exists = await pathExists(outputPath)
      if (exists && request.overwrite === 'suffix') {
        const stem = fileName.slice(0, -'.cdr'.length)
        for (let n = 2; exists || taken.has(fileName.toLowerCase()); n++) {
          fileName = `${stem} (${n}).cdr`
          outputPath = join(request.outputDirectory, fileName)
          exists = await pathExists(outputPath)
        }
      }
      taken.add(fileName.toLowerCase())
      items.push({ rowNumber: request.records[i]!.rowNumber, fileName, outputPath, exists })
    }
    return { items, conflicts: items.filter((i) => i.exists).length }
  }

  async start(untrusted: unknown): Promise<{ jobId: string }> {
    if (this.active) throw new AppError('JOB_RUNNING', 'A generation job is already running. Wait for it to finish or cancel it.')
    const request = parseGenerationRequest(untrusted)
    const template = await this.deps.store.get(request.templateId)
    const plan = await this.planRequest(request)
    const id = randomUUID()
    const job: ActiveJob = { id, cancelRequested: false, done: Promise.resolve(null as unknown as JobSummary) }
    this.active = job
    job.done = this.run(job, request, plan, template.name).finally(() => {
      this.active = null
    })
    return { jobId: id }
  }

  cancel(jobId: unknown): boolean {
    if (!this.active || this.active.id !== jobId) return false
    this.active.cancelRequested = true
    log.info('generation.cancel_requested', { jobId })
    return true
  }

  /** For tests and app shutdown. */
  async waitForIdle(): Promise<JobSummary | null> {
    return this.active ? this.active.done : null
  }

  private async run(job: ActiveJob, request: GenerationRequest, plan: GenerationPlan, templateName: string): Promise<JobSummary> {
    const startedAt = new Date()
    const entries: JobLogEntry[] = []
    const summary: JobSummary = {
      id: job.id,
      templateId: request.templateId,
      templateName,
      corelVersion: '',
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      status: 'running',
      total: plan.items.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      outputDirectory: request.outputDirectory,
      reportPath: null,
      files: [],
      error: null
    }
    const emit = (current: JobProgress['current'], entry: JobLogEntry | null) =>
      this.deps.onProgress({
        jobId: job.id,
        status: summary.status,
        total: summary.total,
        done: summary.succeeded + summary.failed + summary.skipped,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
        current,
        entry,
        error: summary.error
      })
    const record = (entry: JobLogEntry) => {
      entries.push(entry)
      if (entry.status === 'ok') summary.succeeded++
      else if (entry.status === 'failed') summary.failed++
      else summary.skipped++
      emit(null, entry)
    }

    log.info('generation.start', { jobId: job.id, template: request.templateId, records: plan.items.length, out: request.outputDirectory })
    emit(null, null)

    // Held in an object: TypeScript doesn't track reassignment of locals inside the closures below.
    const doc: { adapter: CorelAdapter | null; handle: DocHandle | null; workPath: string | null } = { adapter: null, handle: null, workPath: null }
    const openWorking = async (): Promise<{ adapter: CorelAdapter; handle: DocHandle }> => {
      const adapter = await this.deps.getAdapter()
      doc.adapter = adapter
      doc.workPath = await this.deps.store.makeWorkingCopy(request.templateId)
      const handle = await adapter.openDocument(doc.workPath)
      doc.handle = handle
      return { adapter, handle }
    }
    const closeWorking = async () => {
      if (doc.adapter && doc.handle) await doc.adapter.closeDocument(doc.handle).catch((err) => log.warn('generation.close_failed', { error: err }))
      if (doc.workPath) await rm(doc.workPath, { force: true }).catch(() => undefined)
      doc.handle = null
      doc.workPath = null
    }

    // CorelDRAW keeps the file it last saved locked, so a saved temp file can only be moved to its final
    // name once the document has been saved elsewhere (next record) or closed. Saved-but-unmoved files wait here.
    const pending: { tmp: string; item: PlannedItem; overflow: string[]; durationMs: number }[] = []
    const flush = async (keepNewest: boolean) => {
      while (pending.length > (keepNewest ? 1 : 0)) {
        const p = pending.shift()!
        try {
          await rename(p.tmp, p.item.outputPath)
          summary.files.push(p.item.outputPath)
          record({ rowNumber: p.item.rowNumber, fileName: p.item.fileName, status: 'ok', message: null, overflow: p.overflow, durationMs: p.durationMs })
        } catch (err) {
          await rm(p.tmp, { force: true }).catch(() => undefined)
          log.warn('generation.move_failed', { jobId: job.id, row: p.item.rowNumber, error: err })
          record({
            rowNumber: p.item.rowNumber,
            fileName: p.item.fileName,
            status: 'failed',
            message: `The card was generated but could not be saved as “${p.item.fileName}”: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`,
            overflow: [],
            durationMs: p.durationMs
          })
        }
      }
    }

    try {
      await mkdir(request.outputDirectory, { recursive: true })
      const first = await openWorking()
      summary.corelVersion = (await first.adapter.connect()).version
      let crashes = 0

      for (let i = 0; i < plan.items.length; i++) {
        if (job.cancelRequested) break
        const item = plan.items[i]!
        const input = request.records[i]!
        emit({ rowNumber: item.rowNumber, fileName: item.fileName }, null)

        if (item.exists && request.overwrite === 'skip') {
          record({ rowNumber: item.rowNumber, fileName: item.fileName, status: 'skipped', message: 'A file with this name already exists.', overflow: [], durationMs: null })
          continue
        }
        const tmp = join(request.outputDirectory, `~cardforge-${job.id.slice(0, 8)}-${i}.tmp.cdr`)
        const itemStart = Date.now()
        try {
          const { adapter, handle } = doc.adapter && doc.handle ? { adapter: doc.adapter, handle: doc.handle } : await openWorking()
          const applied = await adapter.applyText(handle, input.values, this.deps.safeMarginMm())
          if (applied.notFound.length > 0) {
            throw new AppError('SHAPE_NOT_FOUND', `The template has no text object named ${applied.notFound.map((n) => `“${n}”`).join(', ')}.`)
          }
          await adapter.saveAs(handle, tmp, X7_FILE_VERSION)
          crashes = 0
          pending.push({
            tmp,
            item,
            overflow: applied.objects.filter((o) => o.overflow).map((o) => `${o.name}: ${o.reason ?? 'overflow'}`),
            durationMs: Date.now() - itemStart
          })
          await flush(true)
        } catch (err) {
          await rm(tmp, { force: true }).catch(() => undefined)
          const message = err instanceof AppError ? err.message : `Unexpected error: ${(err as Error).message}`
          log.warn('generation.record_failed', { jobId: job.id, row: item.rowNumber, error: err })
          record({ rowNumber: item.rowNumber, fileName: item.fileName, status: 'failed', message, overflow: [], durationMs: Date.now() - itemStart })
          if (err instanceof AppError && BRIDGE_LOSS.has(err.code)) {
            crashes++
            // The old document died with the bridge; drop its working copy and reopen on the next record.
            if (doc.workPath) await rm(doc.workPath, { force: true }).catch(() => undefined)
            doc.handle = null
            doc.workPath = null
            await flush(false) // completed saves are no longer locked by the lost document
            if (crashes >= MAX_CONSECUTIVE_CRASHES) {
              throw new AppError('COREL_UNSTABLE', `CorelDRAW stopped responding ${crashes} times in a row. The job was stopped.`)
            }
          }
        }
      }
      summary.status = job.cancelRequested ? 'cancelled' : 'completed'
    } catch (err) {
      summary.status = 'failed'
      summary.error = err instanceof AppError ? err.message : `Unexpected error: ${(err as Error).message}`
      log.error('generation.failed', { jobId: job.id, error: err })
    } finally {
      await closeWorking()
      await flush(false) // the newest file is released once the document is closed
      summary.finishedAt = new Date().toISOString()
      try {
        await mkdir(request.outputDirectory, { recursive: true })
        const reportPath = join(request.outputDirectory, `cardforge-report-${stamp(startedAt)}.json`)
        await writeJsonAtomic(reportPath, {
          ...summary,
          note: summary.corelVersion.includes('17.')
            ? 'Generated with CorelDRAW X7.'
            : 'Generated with a CorelDRAW version other than X7. X7 compatibility is pending validation.',
          entries
        })
        summary.reportPath = reportPath
      } catch (err) {
        log.error('generation.report_failed', { error: err })
      }
      await this.deps.history.save(summary).catch((err) => log.error('generation.history_failed', { error: err }))
      log.info('generation.finished', { jobId: job.id, status: summary.status, ok: summary.succeeded, failed: summary.failed, skipped: summary.skipped })
      emit(null, null)
    }
    return summary
  }
}
