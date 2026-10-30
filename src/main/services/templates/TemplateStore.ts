import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { parseSheetMapping } from '../../../shared/sheet/compose'
import { detectSheetGrid } from '../../../shared/sheet/detect'
import type { DetectionOptions, DetectionResult } from '../../../shared/sheet/types'
import { parseSavedMapping } from '../../../shared/template/mapping'
import type { TemplateInspection, TemplateRecord, TemplateSourceStatus, TemplateSummary } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import { assertReadableFile, assertSafePath } from '../../paths'
import { parseId } from '../../validation'
import { X7_FILE_VERSION, type CorelAdapter } from '../corel/CorelAdapter'
import { fileToDataUrl, pathExists, readJson, sha256File, writeJsonAtomic } from '../fsutil'

export const TEMPLATE_EXTENSIONS = ['.cdr'] as const
export const MAX_TEMPLATE_BYTES = 300 * 1024 * 1024
const THUMBNAIL_DPI = 150
const TEMPLATE_FILE = 'template.cdr'
const META_FILE = 'meta.json'
/** Untouched library copy kept when a template is prepared as a sheet, so preparation can be redone or undone. */
const ORIGINAL_FILE = 'template.original.cdr'

function summarize(r: TemplateRecord): TemplateSummary {
  return {
    id: r.id,
    name: r.name,
    sourcePath: r.sourcePath,
    importedAt: r.importedAt,
    updatedAt: r.updatedAt,
    pages: r.inspection.pages,
    objectCount: r.inspection.objects.length,
    corelVersion: r.inspection.corelVersion,
    hasMapping: r.mapping !== null || !!r.sheetMapping,
    sheetMode: !!r.sheet?.preparedAt
  }
}

/**
 * Local template library at <userData>/templates/<id>/.
 * Importing copies the user's CDR into the library; CorelDRAW only ever opens throwaway copies of that
 * library file, so neither the original nor the library copy is ever written by CorelDRAW.
 */
export class TemplateStore {
  constructor(
    private readonly root: string,
    private readonly workRoot: string,
    private readonly getAdapter: () => Promise<CorelAdapter>
  ) {}

  private dir(id: string): string {
    const dir = resolve(this.root, parseId(id, 'template id'))
    if (!dir.startsWith(resolve(this.root) + sep)) throw new AppError('INVALID_ARGS', 'Invalid template id.')
    return dir
  }

  async list(): Promise<TemplateSummary[]> {
    await mkdir(this.root, { recursive: true })
    const out: TemplateSummary[] = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        out.push(summarize(await readJson<TemplateRecord>(join(this.root, entry.name, META_FILE))))
      } catch (err) {
        log.warn('templates.unreadable_meta', { id: entry.name, error: err })
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string): Promise<TemplateRecord> {
    try {
      return await readJson<TemplateRecord>(join(this.dir(id), META_FILE))
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('TEMPLATE_NOT_FOUND', 'The template is no longer in the library.', err)
    }
  }

  /** A fresh private copy of the library template for CorelDRAW to open. Callers delete it when done. */
  async makeWorkingCopy(id: string): Promise<string> {
    await mkdir(this.workRoot, { recursive: true })
    const path = join(this.workRoot, `${id.slice(0, 8)}-${randomUUID()}.cdr`)
    await copyFile(join(this.dir(id), TEMPLATE_FILE), path, constants.COPYFILE_EXCL)
    return path
  }

  async import(untrustedPath: unknown): Promise<TemplateRecord> {
    const source = assertSafePath(untrustedPath, TEMPLATE_EXTENSIONS)
    const sizeBytes = await assertReadableFile(source, MAX_TEMPLATE_BYTES)
    const sourceHash = await sha256File(source)

    const existing = (await this.list()).find((t) => t.sourcePath.toLowerCase() === source.toLowerCase())
    if (existing) {
      const record = await this.get(existing.id)
      if (record.sourceHash === sourceHash) return record
    }

    const id = randomUUID()
    const dir = this.dir(id)
    await mkdir(join(dir, 'pages'), { recursive: true })
    try {
      const copy = join(dir, TEMPLATE_FILE)
      await copyFile(source, copy, constants.COPYFILE_EXCL)
      if ((await sha256File(copy)) !== sourceHash) throw new AppError('COPY_MISMATCH', 'The template copy does not match the original file.')
      const inspection = await this.inspectLibraryCopy(id)
      const now = new Date().toISOString()
      const record: TemplateRecord = {
        id,
        name: basename(source, extname(source)),
        sourcePath: source,
        sourceHash,
        sizeBytes,
        importedAt: now,
        updatedAt: now,
        pages: inspection.pages,
        objectCount: inspection.objects.length,
        corelVersion: inspection.corelVersion,
        hasMapping: false,
        inspection,
        mapping: null
      }
      // The original must be untouched by import (it is only ever read).
      if ((await sha256File(source)) !== sourceHash) log.warn('templates.source_changed_during_import', { source })
      await writeJsonAtomic(join(dir, META_FILE), record)
      log.info('templates.imported', { id, source, pages: inspection.pages.length, objects: inspection.objects.length })
      return record
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  }

  private async inspectLibraryCopy(id: string): Promise<TemplateInspection> {
    const adapter = await this.getAdapter()
    const work = await this.makeWorkingCopy(id)
    const handle = await adapter.openDocument(work)
    try {
      const inspection = await adapter.inspect(handle)
      await rm(join(this.dir(id), 'pages'), { recursive: true, force: true })
      await mkdir(join(this.dir(id), 'pages'), { recursive: true })
      await adapter.exportPages(handle, {
        dir: join(this.dir(id), 'pages'),
        prefix: 'page',
        dpi: THUMBNAIL_DPI,
        pages: inspection.pages.map((p) => p.index)
      })
      return inspection
    } finally {
      await adapter.closeDocument(handle).catch((err) => log.warn('templates.close_failed', { error: err }))
      await rm(work, { force: true })
    }
  }

  /** Re-reads objects and thumbnails from the library copy (e.g. after a CorelDRAW upgrade). Keeps the mapping. */
  async reinspect(id: string): Promise<TemplateRecord> {
    const record = await this.get(id)
    const inspection = await this.inspectLibraryCopy(id)
    return this.write({ ...record, inspection, pages: inspection.pages, objectCount: inspection.objects.length, corelVersion: inspection.corelVersion })
  }

  async saveMapping(id: string, mapping: unknown): Promise<TemplateRecord> {
    let parsed
    try {
      parsed = parseSavedMapping(mapping)
    } catch (err) {
      throw new AppError('INVALID_ARGS', (err as Error).message)
    }
    const record = await this.get(id)
    return this.write({ ...record, mapping: parsed, hasMapping: true })
  }

  // ---- Multi-card sheet templates ----

  private detectFor(record: TemplateRecord, options: DetectionOptions): DetectionResult {
    const unnamed = record.inspection.unnamed ?? []
    const page = record.inspection.pages.find((p) => p.index === (options.pageIndex ?? 1)) ?? record.inspection.pages[0]
    const result = detectSheetGrid(unnamed, { ...options, pageWidthMm: page?.widthMm, pageHeightMm: page?.heightMm })
    if ('error' in result) throw new AppError('SHEET_NOT_DETECTED', result.error)
    return result
  }

  /** The record as the client made it: for a prepared sheet that is the inspection taken before preparation. */
  private async sourceRecord(id: string): Promise<TemplateRecord> {
    const record = await this.get(id)
    if (!record.sheet?.preparedAt) return record
    if (!record.sheetOriginalInspection || !(await pathExists(join(this.dir(id), ORIGINAL_FILE)))) {
      throw new AppError('SHEET_ORIGINAL_MISSING', 'The unprepared copy of this template is missing. Re-import the template to change its layout.')
    }
    return { ...record, inspection: record.sheetOriginalInspection }
  }

  /** Proposes the card grid for a template without changing anything (pure, no CorelDRAW needed). */
  async analyzeSheet(id: string, options: unknown): Promise<DetectionResult> {
    return this.detectFor(await this.sourceRecord(id), parseDetectionOptions(options))
  }

  /**
   * Gives the repeated text objects of a card sheet stable names in the PRIVATE library copy, so every other part of
   * the app (preview, generation) can address them like any named object. The client's original file is never touched.
   */
  async prepareSheet(id: string, options: unknown): Promise<TemplateRecord> {
    const opts = parseDetectionOptions(options)
    let record = await this.get(id)
    if (record.sheet?.preparedAt) record = await this.revertSheet(id)
    const { config, assignments } = this.detectFor(record, opts)
    const dir = this.dir(id)
    const library = join(dir, TEMPLATE_FILE)
    const original = join(dir, ORIGINAL_FILE)
    if (!(await pathExists(original))) await copyFile(library, original, constants.COPYFILE_EXCL)
    const originalInspection = record.inspection

    const adapter = await this.getAdapter()
    const work = await this.makeWorkingCopy(id)
    const prepared = join(this.workRoot, `${id.slice(0, 8)}-${randomUUID()}-prepared.cdr`)
    const handle = await adapter.openDocument(work)
    try {
      const named = await adapter.nameShapes(handle, assignments)
      if (named !== assignments.length) throw new AppError('SHEET_PREPARE_FAILED', `Only ${named} of ${assignments.length} objects could be named.`)
      await adapter.saveAs(handle, prepared, X7_FILE_VERSION)
    } finally {
      await adapter.closeDocument(handle).catch((err) => log.warn('templates.close_failed', { error: err }))
      await rm(work, { force: true })
    }
    try {
      if ((await stat(prepared)).size === 0) throw new AppError('SHEET_PREPARE_FAILED', 'CorelDRAW saved an empty file.')
      const staged = `${library}.new`
      await copyFile(prepared, staged)
      await rename(staged, library)
    } finally {
      await rm(prepared, { force: true })
    }

    const inspection = await this.inspectLibraryCopy(id)
    const missing = assignments.filter((a) => !inspection.objects.some((o) => o.name === a.name))
    if (missing.length > 0) {
      await copyFile(original, library)
      throw new AppError('SHEET_PREPARE_FAILED', `${missing.length} objects were not found after preparing the template. The template was left unchanged.`)
    }
    log.info('templates.sheet_prepared', { id, columns: config.columns, rows: config.rows, objects: assignments.length })
    return this.write({
      ...record,
      inspection,
      pages: inspection.pages,
      objectCount: inspection.objects.length,
      corelVersion: inspection.corelVersion,
      sheet: { ...config, preparedAt: new Date().toISOString() },
      sheetMapping: null,
      sheetOriginalInspection: originalInspection
    })
  }

  /** Restores the client's original layout (unnamed objects) and forgets the sheet configuration. */
  async revertSheet(id: string): Promise<TemplateRecord> {
    const record = await this.get(id)
    const original = join(this.dir(id), ORIGINAL_FILE)
    if (!record.sheet?.preparedAt || !(await pathExists(original))) return record
    await copyFile(original, join(this.dir(id), TEMPLATE_FILE))
    const inspection = await this.inspectLibraryCopy(id)
    const { sheetOriginalInspection: _drop, ...rest } = record
    return this.write({ ...rest, inspection, pages: inspection.pages, objectCount: inspection.objects.length, sheet: null, sheetMapping: null })
  }

  /** Fonts used by the template that are not installed on this PC (CorelDRAW would substitute them without telling). */
  async missingFonts(id: string): Promise<string[]> {
    const record = await this.get(id)
    const fonts = [...new Set([...record.inspection.objects.map((o) => o.font), ...(record.inspection.unnamed ?? []).map((o) => o.font)].filter(Boolean))]
    if (fonts.length === 0) return []
    return (await this.getAdapter()).checkFonts(fonts)
  }

  async saveSheetMapping(id: string, mapping: unknown): Promise<TemplateRecord> {
    let parsed
    try {
      parsed = parseSheetMapping(mapping)
    } catch (err) {
      throw new AppError('INVALID_ARGS', (err as Error).message)
    }
    const record = await this.get(id)
    if (!record.sheet) throw new AppError('INVALID_ARGS', 'This template is not prepared as a sheet.')
    return this.write({ ...record, sheetMapping: parsed })
  }

  async rename(id: string, name: unknown): Promise<TemplateRecord> {
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120) throw new AppError('INVALID_ARGS', 'Name must be 1–120 characters.')
    return this.write({ ...(await this.get(id)), name: name.trim() })
  }

  private async write(record: TemplateRecord): Promise<TemplateRecord> {
    const next = { ...record, updatedAt: new Date().toISOString() }
    await writeJsonAtomic(join(this.dir(record.id), META_FILE), next)
    return next
  }

  async remove(id: string): Promise<void> {
    const dir = this.dir(id)
    await this.get(id)
    await rm(dir, { recursive: true, force: true })
    log.info('templates.removed', { id })
  }

  /** Whether the user's original file still exists and still matches what was imported. */
  async sourceStatus(id: string): Promise<TemplateSourceStatus> {
    const record = await this.get(id)
    if (!(await pathExists(record.sourcePath))) return { exists: false, changed: false }
    const info = await stat(record.sourcePath)
    if (info.size !== record.sizeBytes) return { exists: true, changed: true }
    return { exists: true, changed: (await sha256File(record.sourcePath)) !== record.sourceHash }
  }

  async pageImages(id: string): Promise<{ pageIndex: number; dataUrl: string }[]> {
    const record = await this.get(id)
    const out: { pageIndex: number; dataUrl: string }[] = []
    for (const page of record.inspection.pages) {
      const file = join(this.dir(id), 'pages', `page-p${page.index}.png`)
      if (await pathExists(file)) out.push({ pageIndex: page.index, dataUrl: await fileToDataUrl(file) })
    }
    return out
  }
}

function parseDetectionOptions(value: unknown): DetectionOptions {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new AppError('INVALID_ARGS', 'Invalid layout options.')
  const v = value as Record<string, unknown>
  const int = (x: unknown, max: number): number | undefined => {
    if (x === undefined || x === null) return undefined
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > max) throw new AppError('INVALID_ARGS', `Grid size must be a whole number from 1 to ${max}.`)
    return x
  }
  if (v.order !== undefined && v.order !== 'rows' && v.order !== 'columns') throw new AppError('INVALID_ARGS', 'Invalid card order.')
  return { columns: int(v.columns, 12), rows: int(v.rows, 20), pageIndex: int(v.pageIndex, 50), order: v.order as DetectionOptions['order'] }
}
