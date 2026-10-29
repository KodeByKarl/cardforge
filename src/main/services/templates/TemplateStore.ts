import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { parseSavedMapping } from '../../../shared/template/mapping'
import type { TemplateInspection, TemplateRecord, TemplateSourceStatus, TemplateSummary } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import { assertReadableFile, assertSafePath } from '../../paths'
import { parseId } from '../../validation'
import type { CorelAdapter } from '../corel/CorelAdapter'
import { fileToDataUrl, pathExists, readJson, sha256File, writeJsonAtomic } from '../fsutil'

export const TEMPLATE_EXTENSIONS = ['.cdr'] as const
export const MAX_TEMPLATE_BYTES = 300 * 1024 * 1024
const THUMBNAIL_DPI = 150
const TEMPLATE_FILE = 'template.cdr'
const META_FILE = 'meta.json'

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
    hasMapping: r.mapping !== null
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
