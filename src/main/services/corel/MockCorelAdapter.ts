import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrintSettings } from '../../../shared/print/types'
import type { NameAssignment } from '../../../shared/sheet/types'
import type { ApplyResult, ExportedPage, ShapeValues, TemplateInspection } from '../../../shared/template/types'
import { AppError } from '../../errors'
import type { CorelAdapter, CorelConnection, DocHandle } from './CorelAdapter'

// Smallest valid PNG (1x1 transparent pixel).
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

export const MOCK_CDR_CONTENT = 'MOCK CDR - written by MockCorelAdapter, not a CorelDRAW file'

/**
 * TEST ONLY — never wired into the running app. Simulates CorelDRAW in memory so services can be tested
 * without CorelDRAW. Overflow is simulated as "value longer than maxChars".
 */
export class MockCorelAdapter implements CorelAdapter {
  readonly kind = 'mock' as const
  readonly calls: string[] = []
  readonly open = new Map<DocHandle, { path: string; values: ShapeValues }>()
  failOn: ((op: string, detail: string) => AppError | null) | null = null
  maxChars = 30
  private next = 1

  constructor(private readonly inspection: TemplateInspection) {}

  private check(op: string, detail = ''): void {
    this.calls.push(op)
    const err = this.failOn?.(op, detail)
    if (err) throw err
  }

  private doc(handle: DocHandle) {
    const d = this.open.get(handle)
    if (!d) throw new AppError('UNKNOWN_DOCUMENT', `Unknown document handle '${handle}'.`)
    return d
  }

  async connect(): Promise<CorelConnection> {
    this.check('connect')
    return { version: 'Mock 0.0', progId: 'CorelDRAW.Application.Mock' }
  }

  async openDocument(path: string): Promise<DocHandle> {
    this.check('openDocument', path)
    const handle = `m${this.next++}`
    this.open.set(handle, { path, values: {} })
    return handle
  }

  async docInfo(handle: DocHandle): Promise<{ pages: number }> {
    this.check('docInfo')
    this.doc(handle)
    return { pages: this.inspection.pages.length }
  }

  async closeDocument(handle: DocHandle): Promise<void> {
    this.check('closeDocument')
    this.open.delete(handle)
  }

  async inspect(handle: DocHandle): Promise<TemplateInspection> {
    this.check('inspect')
    this.doc(handle)
    return structuredClone(this.inspection)
  }

  async applyText(handle: DocHandle, values: ShapeValues): Promise<ApplyResult> {
    this.check('applyText', JSON.stringify(values))
    const doc = this.doc(handle)
    const result: ApplyResult = { objects: [], notFound: [] }
    for (const [name, value] of Object.entries(values)) {
      const obj = this.inspection.objects.find((o) => o.name === name)
      if (!obj) {
        result.notFound.push(name)
        continue
      }
      doc.values[name] = value
      const overflow = value.length > this.maxChars
      result.objects.push({ name, pageIndex: obj.pageIndex, overflow, reason: overflow ? 'Mock overflow' : null, bounds: obj.bounds })
    }
    return result
  }

  async addSheetPages(handle: DocHandle, count: number): Promise<number> {
    this.check('addSheetPages', String(count))
    this.doc(handle)
    return this.inspection.pages.length + count
  }

  async nameShapes(handle: DocHandle, items: NameAssignment[]): Promise<number> {
    this.check('nameShapes', JSON.stringify(items))
    this.doc(handle)
    return items.length
  }

  async exportPages(handle: DocHandle, options: { dir: string; prefix: string; dpi: number; pages: number[] }): Promise<ExportedPage[]> {
    this.check('exportPages')
    this.doc(handle)
    const files: ExportedPage[] = []
    for (const pageIndex of options.pages) {
      const page = this.inspection.pages.find((p) => p.index === pageIndex)
      if (!page) throw new AppError('INVALID_ARGS', `Page ${pageIndex} does not exist.`)
      const path = join(options.dir, `${options.prefix}-p${pageIndex}.png`)
      await writeFile(path, TINY_PNG)
      files.push({ pageIndex, path, widthPx: Math.round((page.widthMm / 25.4) * options.dpi), heightPx: Math.round((page.heightMm / 25.4) * options.dpi) })
    }
    return files
  }

  async saveAs(handle: DocHandle, path: string): Promise<void> {
    this.check('saveAs', path)
    const doc = this.doc(handle)
    await writeFile(path, `${MOCK_CDR_CONTENT}\n${JSON.stringify(doc.values)}`, 'utf8')
    doc.path = path
  }

  missingFonts: string[] = []
  async checkFonts(fonts: string[]): Promise<string[]> {
    this.check('checkFonts')
    return fonts.filter((f) => this.missingFonts.includes(f))
  }

  async exportPdf(handle: DocHandle, path: string): Promise<void> {
    this.check('exportPdf', path)
    this.doc(handle)
    await writeFile(path, '%PDF-1.7 mock', 'utf8')
  }

  /** Settings applied by configurePrint and the PrintOut submissions, newest last (print tests). */
  readonly printed: { path: string; settings: PrintSettings }[] = []
  private readonly configured = new Map<DocHandle, PrintSettings>()

  async configurePrint(handle: DocHandle, settings: PrintSettings): Promise<void> {
    this.check('configurePrint', settings.printer)
    this.doc(handle)
    this.configured.set(handle, settings)
  }

  async printOut(handle: DocHandle): Promise<void> {
    const doc = this.doc(handle)
    const settings = this.configured.get(handle)
    if (!settings) throw new AppError('PRINT_NOT_CONFIGURED', 'configurePrint must be called first.')
    this.check('printOut', doc.path)
    this.printed.push({ path: doc.path, settings })
  }

  async dispose(): Promise<void> {
    this.open.clear()
  }
}
