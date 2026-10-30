import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeFileName } from '../../../shared/generation/naming'
import { batchFileName, planBatches, verifyBatches, type BatchPlan, type BatchPlanItem } from '../../../shared/sheet/batches'
import { buildSheetValues, cellExtentIssues, hasBlockingSheetIssues, recordsForSheet, sheetMappingIssues } from '../../../shared/sheet/compose'
import type { SheetGenerationPlan, SheetGenerationRequest, SheetManifest, SheetManifestBatch, SheetPlanBatch } from '../../../shared/sheet/types'
import type { JobLogEntry, JobProgress, JobSummary, TemplateRecord } from '../../../shared/template/types'
import type { ColumnConfig, ImportRecord } from '../../../shared/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import { parseSheetGenerationRequest } from '../../validation'
import { X7_FILE_VERSION, type CorelAdapter } from '../corel/CorelAdapter'
import { pathExists, readJson, writeJsonAtomic } from '../fsutil'
import type { TemplateStore } from '../templates/TemplateStore'
import type { JobHistory } from './JobHistory'

const BRIDGE_LOSS = new Set(['COREL_RESTARTED', 'BRIDGE_EXITED', 'BRIDGE_TIMEOUT', 'COREL_GONE'])
const MAX_CONSECUTIVE_CRASHES = 3
const MAX_OVERFLOW_NOTES_PER_BATCH = 40
const DEEP_VERIFY_FILES = 3

export interface SheetGenerationDeps {
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

class CancelledError extends Error {}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** A CDR written for X7 is a ZIP container; a PDF starts with %PDF. Cheap proof that CorelDRAW really wrote the file. */
async function hasSignature(path: string, kind: 'cdr' | 'pdf'): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(5)
    await handle.read(buf, 0, 5, 0)
    return kind === 'pdf' ? buf.toString('latin1') === '%PDF-' : buf[0] === 0x50 && buf[1] === 0x4b
  } finally {
    await handle.close()
  }
}

/** What the plan/run need from a validated request, resolved once. */
interface Prepared {
  request: SheetGenerationRequest
  template: TemplateRecord
  columns: ColumnConfig[]
  records: ImportRecord[]
  plan: BatchPlan
  prefix: string
  fingerprint: string
}

/**
 * Bulk production of A4 card sheets. Each output document holds several sheets (one page per sheet, `sheetsPerFile`
 * pages); each sheet holds one record per card position. A manifest next to the output records every batch as it
 * completes, so an interrupted job can resume without redoing or duplicating work.
 */
export class SheetGenerationService {
  private active: ActiveJob | null = null

  constructor(private readonly deps: SheetGenerationDeps) {}

  get activeJobId(): string | null {
    return this.active?.id ?? null
  }

  private async prepare(untrusted: unknown): Promise<Prepared> {
    const request = parseSheetGenerationRequest(untrusted)
    const template = await this.deps.store.get(request.templateId)
    const sheet = template.sheet
    if (!sheet?.preparedAt) throw new AppError('SHEET_NOT_PREPARED', 'The template has not been prepared as a card sheet.')
    if (!template.sheetMapping) throw new AppError('NO_MAPPING', 'Map the template fields to spreadsheet columns first.')
    if (request.cardsPerSheet > sheet.cells.length) throw new AppError('INVALID_ARGS', `The template has only ${sheet.cells.length} card positions.`)
    const columns: ColumnConfig[] = request.columns.map((c, i) => ({ key: c.key, label: c.label, index: i, kind: 'text', include: true, required: false, duplicateKey: false }))
    const records: ImportRecord[] = request.records
    const samples = new Map(columns.map((c) => [c.key, records.slice(0, 500).map((r) => r.values[c.key] ?? '')]))
    const blocking = sheetMappingIssues(sheet, template.sheetMapping, columns, samples).filter((i) => i.severity === 'error')
    if (hasBlockingSheetIssues(blocking)) throw new AppError('MAPPING_BLOCKED', blocking[0]!.message)
    // Only the first `cardsPerSheet` positions receive records; planBatches uses that as the sheet size.
    const plan = planBatches(records.length, request.cardsPerSheet, request.sheetsPerFile, request.mode)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([template.id, template.updatedAt, request.mode, request.cardsPerSheet, request.sheetsPerFile, request.clearEmpty, request.records]))
      .digest('hex')
    return { request, template, columns, records, plan, prefix: sanitizeFileName(template.name) || 'Cards', fingerprint }
  }

  private manifestPath(p: Prepared): string {
    return join(p.request.outputDirectory, `.cardforge-${p.fingerprint.slice(0, 12)}.manifest.json`)
  }

  private async readManifest(p: Prepared): Promise<SheetManifest | null> {
    try {
      const m = await readJson<SheetManifest>(this.manifestPath(p))
      return m.fingerprint === p.fingerprint ? m : null
    } catch {
      return null
    }
  }

  private batchRows(p: Prepared, b: BatchPlanItem): { firstRow: number; lastRow: number } {
    return { firstRow: p.records[b.firstRecord]!.rowNumber, lastRow: p.records[b.firstRecord + b.recordCount - 1]!.rowNumber }
  }

  /** Names every output, checks what already exists, and proves the batches cover each record exactly once. Read-only. */
  async plan(untrusted: unknown): Promise<SheetGenerationPlan> {
    const p = await this.prepare(untrusted)
    const manifest = await this.readManifest(p)
    const batches: SheetPlanBatch[] = []
    for (const b of p.plan.batches) {
      const fileName = batchFileName(p.prefix, b, p.plan.sheetPlan.sheets.length)
      const path = join(p.request.outputDirectory, fileName)
      const exists = await pathExists(path)
      const m = manifest?.batches.find((x) => x.index === b.index)
      const completed = !!m && m.status === 'done' && exists && (await stat(path)).size === m.bytes
      const { firstRow, lastRow } = this.batchRows(p, b)
      batches.push({
        index: b.index,
        fileName,
        pdfName: p.request.exportPdf ? fileName.replace(/\.cdr$/, '.pdf') : null,
        firstSheet: b.firstSheet,
        lastSheet: b.lastSheet,
        firstRow,
        lastRow,
        records: b.recordCount,
        exists,
        completed
      })
    }
    const completedCount = batches.filter((b) => b.completed).length
    return {
      mode: p.request.mode,
      cardsPerSheet: p.request.cardsPerSheet,
      sheets: p.plan.sheetPlan.sheets.length,
      records: p.records.length,
      batches,
      conflicts: batches.filter((b) => b.exists && !b.completed).length,
      resumable: completedCount > 0,
      completed: completedCount,
      fingerprint: p.fingerprint,
      problems: verifyBatches(p.plan),
      warnings: await this.fontWarnings(p.template.id)
    }
  }

  private async fontWarnings(templateId: string): Promise<string[]> {
    try {
      const missing = await this.deps.store.missingFonts(templateId)
      return missing.length ? [`Font${missing.length > 1 ? 's' : ''} not installed on this PC: ${missing.join(', ')}. CorelDRAW will substitute ${missing.length > 1 ? 'them' : 'it'} and text widths will change.`] : []
    } catch {
      return []
    }
  }

  async start(untrusted: unknown): Promise<{ jobId: string }> {
    if (this.active) throw new AppError('JOB_RUNNING', 'A generation job is already running. Wait for it to finish or cancel it.')
    const p = await this.prepare(untrusted)
    const problems = verifyBatches(p.plan)
    if (problems.length > 0) throw new AppError('PLAN_INVALID', `The sheet plan is not safe: ${problems[0]}`)
    const id = randomUUID()
    const job: ActiveJob = { id, cancelRequested: false, done: Promise.resolve(null as unknown as JobSummary) }
    this.active = job
    job.done = this.run(job, p).finally(() => {
      this.active = null
    })
    return { jobId: id }
  }

  cancel(jobId: unknown): boolean {
    if (!this.active || this.active.id !== jobId) return false
    this.active.cancelRequested = true
    log.info('sheets.cancel_requested', { jobId })
    return true
  }

  async waitForIdle(): Promise<JobSummary | null> {
    return this.active ? this.active.done : null
  }

  private async run(job: ActiveJob, p: Prepared): Promise<JobSummary> {
    const { request, template, plan } = p
    const startedAt = new Date()
    const entries: JobLogEntry[] = []
    const summary: JobSummary = {
      id: job.id,
      templateId: template.id,
      templateName: template.name,
      corelVersion: '',
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      status: 'running',
      total: p.records.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      outputDirectory: request.outputDirectory,
      reportPath: null,
      files: [],
      error: null,
      sheetJob: { sheets: plan.sheetPlan.sheets.length, cardsPerSheet: request.cardsPerSheet, sheetsPerFile: request.sheetsPerFile, batches: plan.batches.length, manifestPath: null, summaryPath: null, verification: [] }
    }
    const totalSheets = plan.sheetPlan.sheets.length
    let sheetsDone = 0
    let batchesDone = 0
    let currentSheet: number | null = null
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
        error: summary.error,
        sheet: { sheetsDone, sheetsTotal: totalSheets, batchesDone, batchesTotal: plan.batches.length, currentSheet }
      })

    const manifest: SheetManifest = (await this.readManifest(p)) ?? {
      version: 1,
      fingerprint: p.fingerprint,
      templateId: template.id,
      templateName: template.name,
      createdAt: startedAt.toISOString(),
      cardsPerSheet: request.cardsPerSheet,
      sheetsPerFile: request.sheetsPerFile,
      totalRecords: p.records.length,
      totalSheets,
      batches: plan.batches.map((b): SheetManifestBatch => {
        const rows = this.batchRows(p, b)
        return { index: b.index, fileName: '', pdfName: null, firstSheet: b.firstSheet, lastSheet: b.lastSheet, ...rows, records: b.recordCount, status: 'pending', bytes: null, completedAt: null, message: null }
      })
    }
    const manifestPath = this.manifestPath(p)
    const saveManifest = () => writeJsonAtomic(manifestPath, manifest)

    log.info('sheets.start', { jobId: job.id, template: template.id, records: p.records.length, sheets: totalSheets, batches: plan.batches.length })
    emit(null, null)

    let crashes = 0
    try {
      await mkdir(request.outputDirectory, { recursive: true })
      const adapter = await this.deps.getAdapter()
      summary.corelVersion = (await adapter.connect()).version
      await saveManifest()

      for (const b of plan.batches) {
        if (job.cancelRequested) break
        const mb = manifest.batches.find((x) => x.index === b.index)!
        const rows = this.batchRows(p, b)
        let fileName = batchFileName(p.prefix, b, totalSheets)
        let finalPath = join(request.outputDirectory, fileName)
        const exists = await pathExists(finalPath)
        const verifiedDone = mb.status === 'done' && exists && (await stat(finalPath)).size === mb.bytes
        const cardsInBatch = b.recordCount

        if (request.overwrite === 'resume' && verifiedDone) {
          summary.skipped += cardsInBatch
          sheetsDone += b.sheetCount
          batchesDone++
          summary.files.push(finalPath)
          const entry: JobLogEntry = { rowNumber: rows.firstRow, fileName, status: 'skipped', message: 'Already generated by an earlier run (resumed).', overflow: [], durationMs: null }
          entries.push(entry)
          emit(null, entry)
          continue
        }
        if (exists && (request.overwrite === 'skip' || request.overwrite === 'resume')) {
          summary.skipped += cardsInBatch
          sheetsDone += b.sheetCount
          batchesDone++
          const entry: JobLogEntry = { rowNumber: rows.firstRow, fileName, status: 'skipped', message: 'A file with this name already exists.', overflow: [], durationMs: null }
          entries.push(entry)
          emit(null, entry)
          continue
        }
        if (exists && request.overwrite === 'suffix') {
          for (let n = 2; ; n++) {
            fileName = batchFileName(`${p.prefix} (${n})`, b, totalSheets)
            finalPath = join(request.outputDirectory, fileName)
            if (!(await pathExists(finalPath))) break
          }
        }

        const t0 = Date.now()
        const sheetsBefore = sheetsDone
        let outcome: { bytes: number; overflow: string[]; pdf: boolean } | null = null
        let failure: string | null = null
        let retryNote: string | null = null
        for (let attempt = 1; attempt <= 2 && !outcome && !failure; attempt++) {
          sheetsDone = sheetsBefore
          try {
            outcome = await this.runBatch(job, p, b, finalPath, adapter, (sheetNumber) => {
              currentSheet = sheetNumber
              sheetsDone++
              emit({ rowNumber: rows.firstRow, fileName }, null)
            })
            crashes = 0
          } catch (err) {
            if (err instanceof CancelledError) break
            const message = err instanceof AppError ? err.message : `Unexpected error: ${(err as Error).message}`
            log.warn('sheets.batch_failed', { jobId: job.id, batch: b.index, attempt, error: err })
            if (err instanceof AppError && BRIDGE_LOSS.has(err.code)) {
              crashes++
              if (crashes >= MAX_CONSECUTIVE_CRASHES) throw new AppError('COREL_UNSTABLE', `CorelDRAW stopped responding ${crashes} times in a row. The job was stopped.`)
              if (attempt === 1) {
                retryNote = message
                continue // CorelDRAW restarts on the next call: retry the whole batch once
              }
            } else if (attempt === 1 && err instanceof AppError && (err.code === 'COREL_ERROR' || err.code === 'APPLY_FAILED' || err.code === 'COREL_BUSY')) {
              retryNote = message
              continue // a transient CorelDRAW error: the batch is rebuilt from a fresh copy of the template
            }
            failure = message
          }
        }
        currentSheet = null
        if (job.cancelRequested && !outcome && !failure) {
          sheetsDone = sheetsBefore
          break
        }
        if (outcome) {
          summary.succeeded += cardsInBatch
          summary.files.push(finalPath)
          if (outcome.pdf) summary.files.push(finalPath.replace(/\.cdr$/, '.pdf'))
          mb.status = 'done'
          mb.fileName = fileName
          mb.pdfName = outcome.pdf ? fileName.replace(/\.cdr$/, '.pdf') : null
          mb.bytes = outcome.bytes
          mb.completedAt = new Date().toISOString()
          mb.message = null
          const notes = outcome.overflow.slice(0, MAX_OVERFLOW_NOTES_PER_BATCH)
          if (outcome.overflow.length > notes.length) notes.push(`…and ${outcome.overflow.length - notes.length} more warnings.`)
          const entry: JobLogEntry = { rowNumber: rows.firstRow, fileName, status: 'ok', message: retryNote ? `Completed on the second attempt after a CorelDRAW error: ${retryNote}` : null, overflow: notes, durationMs: Date.now() - t0 }
          entries.push(entry)
          batchesDone++
          await saveManifest()
          emit(null, entry)
        } else {
          sheetsDone = sheetsBefore + b.sheetCount // processed (failed) sheets still count towards the bar
          summary.failed += cardsInBatch
          mb.status = 'failed'
          mb.message = failure
          batchesDone++
          const entry: JobLogEntry = { rowNumber: rows.firstRow, fileName, status: 'failed', message: failure, overflow: [], durationMs: Date.now() - t0 }
          entries.push(entry)
          await saveManifest()
          emit(null, entry)
        }
      }
      summary.status = job.cancelRequested ? 'cancelled' : 'completed'
    } catch (err) {
      summary.status = 'failed'
      summary.error = err instanceof AppError ? err.message : `Unexpected error: ${(err as Error).message}`
      log.error('sheets.failed', { jobId: job.id, error: err })
    } finally {
      summary.finishedAt = new Date().toISOString()
      const verification: string[] = []
      try {
        verification.push(...(await this.verifyOutputs(p, manifest, request)))
      } catch (err) {
        verification.push(`Verification could not run: ${(err as Error).message}`)
      }
      verification.push(...(await this.fontWarnings(template.id)).map((w) => `Warning: ${w}`))
      summary.sheetJob!.verification = verification
      summary.sheetJob!.manifestPath = manifestPath
      try {
        const reportPath = join(request.outputDirectory, `cardforge-sheets-report-${stamp(startedAt)}.json`)
        const note = summary.corelVersion.includes('17.') ? 'Generated with CorelDRAW X7.' : 'Generated with a CorelDRAW version other than X7. X7 compatibility is pending validation.'
        await writeJsonAtomic(reportPath, {
          // Row numbers and counts only: no names, addresses or control numbers are written to reports or logs.
          ...summary,
          note,
          excludedRows: request.excludedRows,
          fingerprint: p.fingerprint,
          batches: manifest.batches,
          verification,
          entries
        })
        summary.reportPath = reportPath
        const summaryPath = join(request.outputDirectory, `cardforge-print-summary-${stamp(startedAt)}.txt`)
        await writeFile(summaryPath, this.printSummary(p, manifest, summary, request, note), 'utf8')
        summary.sheetJob!.summaryPath = summaryPath
      } catch (err) {
        log.error('sheets.report_failed', { error: err })
      }
      await this.deps.history.save(summary).catch((err) => log.error('sheets.history_failed', { error: err }))
      log.info('sheets.finished', { jobId: job.id, status: summary.status, ok: summary.succeeded, failed: summary.failed, skipped: summary.skipped })
      emit(null, null)
    }
    return summary
  }

  /** One output document: open a private copy, add the sheet pages, fill every page once, save, optionally export PDF. */
  private async runBatch(
    job: ActiveJob,
    p: Prepared,
    b: BatchPlanItem,
    finalPath: string,
    adapter: CorelAdapter,
    onSheet: (sheetNumber: number) => void
  ): Promise<{ bytes: number; overflow: string[]; pdf: boolean }> {
    const { request, template } = p
    const sheet = template.sheet!
    const mapping = template.sheetMapping!
    const tmp = join(request.outputDirectory, `~cardforge-${job.id.slice(0, 8)}-b${b.index}.tmp.cdr`)
    const tmpPdf = tmp.replace(/\.cdr$/, '.pdf')
    const finalPdf = finalPath.replace(/\.cdr$/, '.pdf')
    const work = await this.deps.store.makeWorkingCopy(template.id)
    const overflow: string[] = []
    let handle: string | null = null
    try {
      handle = await adapter.openDocument(work)
      const originalPages = template.pages.length
      if (b.sheetCount > 1) await adapter.addSheetPages(handle, b.sheetCount - 1, sheet.pageIndex)
      const sheets = p.plan.sheetPlan.sheets.slice(b.firstSheet - 1, b.lastSheet)
      for (const [k, s] of sheets.entries()) {
        if (job.cancelRequested) throw new CancelledError()
        const page = k === 0 ? sheet.pageIndex : originalPages + k
        const recs = recordsForSheet(request.mode, request.cardsPerSheet, p.records, s)
        const sv = buildSheetValues(sheet, mapping, recs, p.columns)
        const regions = request.clearEmpty ? sv.emptyRegions : []
        const applied = await adapter.applyText(handle, sv.values, this.deps.safeMarginMm(), { page, keep: true, clearRegions: regions, clearPage: page })
        if (applied.notFound.length > 0) throw new AppError('SHAPE_NOT_FOUND', `The prepared template has no object named ${applied.notFound.slice(0, 3).map((n) => `“${n}”`).join(', ')}. Prepare the template again.`)
        for (const x of cellExtentIssues(sheet, applied.objects)) overflow.push(`Sheet ${s.number}, card ${x.cell}, text ${Number(x.roleId.slice(1))}: ${x.message}`)
        for (const o of applied.objects) {
          if (!o.overflow) continue
          const m = /^C(\d+)_f(\d+)$/.exec(o.name)
          overflow.push(`Sheet ${s.number}${m ? `, card ${Number(m[1])}, text ${Number(m[2])}` : ''}: ${o.reason ?? 'text may not fit'}`)
        }
        onSheet(s.number)
      }
      await adapter.saveAs(handle, tmp, X7_FILE_VERSION)
      let pdf = false
      if (request.exportPdf) {
        await adapter.exportPdf(handle, tmpPdf)
        pdf = true
      }
      // CorelDRAW keeps the saved file locked until the document is closed.
      await adapter.closeDocument(handle).catch((err) => log.warn('sheets.close_failed', { error: err }))
      handle = null
      const info = await stat(tmp)
      if (info.size === 0 || !(await hasSignature(tmp, 'cdr'))) throw new AppError('OUTPUT_INVALID', 'CorelDRAW wrote an invalid or empty file.')
      if (pdf && !(await hasSignature(tmpPdf, 'pdf'))) throw new AppError('OUTPUT_INVALID', 'CorelDRAW wrote an invalid PDF.')
      await rename(tmp, finalPath)
      if (pdf) await rename(tmpPdf, finalPdf)
      return { bytes: info.size, overflow, pdf }
    } finally {
      if (handle) await adapter.closeDocument(handle).catch((err) => log.warn('sheets.close_failed', { error: err }))
      await rm(work, { force: true }).catch(() => undefined)
      await rm(tmp, { force: true }).catch(() => undefined)
      await rm(tmpPdf, { force: true }).catch(() => undefined)
    }
  }

  /** Re-checks the finished output against the plan: files present, sizes unchanged, coverage exact, a sample reopened. */
  private async verifyOutputs(p: Prepared, manifest: SheetManifest, request: SheetGenerationRequest): Promise<string[]> {
    const problems: string[] = [...verifyBatches(p.plan)]
    const done = manifest.batches.filter((b) => b.status === 'done')
    for (const b of done) {
      const path = join(request.outputDirectory, b.fileName)
      try {
        const info = await stat(path)
        if (info.size !== b.bytes) problems.push(`${b.fileName}: size changed since it was written.`)
      } catch {
        problems.push(`${b.fileName}: file is missing.`)
      }
    }
    const cards = done.reduce((n, b) => n + b.records, 0)
    const pending = manifest.batches.filter((b) => b.status !== 'done')
    if (pending.length === 0 && cards !== p.records.length) problems.push(`${cards} of ${p.records.length} records are in finished files.`)
    if (pending.length > 0) {
      const failed = pending.filter((b) => b.status === 'failed').map((b) => b.index)
      problems.push(`${pending.length} of ${manifest.batches.length} files are not finished${failed.length ? ` (failed: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? ', …' : ''})` : ''}; ${p.records.length - cards} records are not on a finished sheet.`)
    }
    // Reopen a few outputs and count pages: the first, the last (partly filled) and one in between.
    if (done.length > 0) {
      const picks = [...new Set([done[0]!, done[Math.floor(done.length / 2)]!, done.at(-1)!])].slice(0, DEEP_VERIFY_FILES)
      const adapter = await this.deps.getAdapter()
      for (const b of picks) {
        const path = join(request.outputDirectory, b.fileName)
        let handle: string | null = null
        try {
          handle = await adapter.openDocument(path, { light: true })
          const pages = (await adapter.docInfo(handle)).pages
          const expected = b.lastSheet - b.firstSheet + 1
          if (pages !== expected) problems.push(`${b.fileName}: has ${pages} pages, expected ${expected}.`)
        } catch (err) {
          problems.push(`${b.fileName}: could not be reopened (${(err as Error).message}).`)
        } finally {
          if (handle) await adapter.closeDocument(handle).catch(() => undefined)
        }
      }
    }
    return problems.length === 0 ? [`OK: ${done.length} of ${manifest.batches.length} files verified (presence, size, page count of ${Math.min(done.length, DEEP_VERIFY_FILES)} sampled files); ${cards} records on ${done.reduce((n, b) => n + (b.lastSheet - b.firstSheet + 1), 0)} sheets.`] : problems
  }

  private printSummary(p: Prepared, manifest: SheetManifest, summary: JobSummary, request: SheetGenerationRequest, note: string): string {
    const lines = [
      `CardForge print job summary`,
      `Template: ${summary.templateName}`,
      `Started: ${summary.startedAt}   Finished: ${summary.finishedAt}   Status: ${summary.status}`,
      `Production mode: ${request.mode === 'copies' ? `${request.cardsPerSheet} COPIES of each record on its own sheet` : `${request.cardsPerSheet} DIFFERENT records per sheet`}`,
      `Records: ${p.records.length}   Sheets: ${manifest.totalSheets} (${request.cardsPerSheet} cards per A4 sheet)   Files: ${manifest.batches.length} (${request.sheetsPerFile} sheets per file)`,
      `Excluded because of errors: ${request.excludedRows.length}${request.excludedRows.length ? ` (rows ${request.excludedRows.slice(0, 50).join(', ')}${request.excludedRows.length > 50 ? ', …' : ''})` : ''}`,
      note,
      'Printing is not started by CardForge. Check each file in CorelDRAW before printing.',
      '',
      'File | Sheets | Spreadsheet rows | Cards | Status'
    ]
    for (const b of manifest.batches) lines.push(`${b.fileName || `(batch ${b.index})`} | ${b.firstSheet}-${b.lastSheet} | ${b.firstRow}-${b.lastRow} | ${b.records} | ${b.status}${b.message ? ` (${b.message})` : ''}`)
    return lines.join('\r\n') + '\r\n'
  }
}

