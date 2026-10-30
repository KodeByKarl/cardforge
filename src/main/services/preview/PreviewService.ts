import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import type { PreviewRequest, PreviewResult } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import { parsePreviewRequest } from '../../validation'
import type { CorelAdapter, DocHandle } from '../corel/CorelAdapter'
import { fileToDataUrl } from '../fsutil'
import type { TemplateStore } from '../templates/TemplateStore'

const CACHE_LIMIT = 300
/** Full A4 sheet renders are large; the cache is bounded by size as well as by count so memory stays controlled. */
const CACHE_BYTES_LIMIT = 160 * 1024 * 1024
const RECOVERABLE = new Set(['COREL_RESTARTED', 'BRIDGE_EXITED', 'BRIDGE_TIMEOUT', 'COREL_GONE'])

interface Session {
  templateId: string
  sourceHash: string
  handle: DocHandle
  workPath: string
}

/**
 * Renders previews with CorelDRAW itself: the record's text is written into a private working copy of the
 * template and the pages are exported as PNG. What the user sees is CorelDRAW's own rendering.
 */
export class PreviewService {
  private session: Session | null = null
  private readonly cache = new Map<string, { templateId: string; result: PreviewResult; bytes: number }>()
  private cacheBytes = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: TemplateStore,
    private readonly getAdapter: () => Promise<CorelAdapter>,
    private readonly tmpDir: string,
    private readonly safeMarginMm: () => number
  ) {}

  async render(untrusted: unknown): Promise<PreviewResult> {
    const request = parsePreviewRequest(untrusted)
    const run = this.chain.then(() => this.renderNow(request))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async renderNow(request: PreviewRequest, retried = false): Promise<PreviewResult> {
    const template = await this.store.get(request.templateId)
    const pageInfo = new Map(template.inspection.pages.map((p) => [p.index, p]))
    for (const p of request.pages) if (!pageInfo.has(p)) throw new AppError('INVALID_ARGS', `The template has no page ${p}.`)

    const safe = this.safeMarginMm()
    const sorted = Object.fromEntries(Object.entries(request.values).sort(([a], [b]) => a.localeCompare(b)))
    const key = createHash('sha256').update(JSON.stringify([template.id, template.sourceHash, template.updatedAt, request.dpi, request.pages, sorted, safe, request.clearRegions ?? null, request.clearPage ?? null])).digest('hex')
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit) // refresh LRU position (its bytes stay counted)
      return hit.result
    }

    try {
      const adapter = await this.getAdapter()
      const session = await this.openSession(adapter, template.id, template.sourceHash)
      const applied = await adapter.applyText(session.handle, request.values, safe, { clearRegions: request.clearRegions, clearPage: request.clearPage })
      await mkdir(this.tmpDir, { recursive: true })
      const files = await adapter.exportPages(session.handle, { dir: this.tmpDir, prefix: randomUUID(), dpi: request.dpi, pages: request.pages })
      const pages = []
      for (const f of files) {
        const info = pageInfo.get(f.pageIndex)!
        pages.push({ pageIndex: f.pageIndex, dataUrl: await fileToDataUrl(f.path), widthPx: f.widthPx, heightPx: f.heightPx, widthMm: info.widthMm, heightMm: info.heightMm })
        await rm(f.path, { force: true })
      }
      const result: PreviewResult = { pages, objects: applied.objects, notFound: applied.notFound, rendererVersion: template.inspection.corelVersion }
      this.remember(key, template.id, result)
      return result
    } catch (err) {
      if (!retried && err instanceof AppError && RECOVERABLE.has(err.code)) {
        log.warn('preview.recovering', { code: err.code })
        this.session = null
        return this.renderNow(request, true)
      }
      throw err
    }
  }

  private remember(key: string, templateId: string, result: PreviewResult): void {
    const bytes = result.pages.reduce((n, p) => n + p.dataUrl.length, 0)
    this.cache.set(key, { templateId, result, bytes })
    this.cacheBytes += bytes
    while ((this.cache.size > CACHE_LIMIT || this.cacheBytes > CACHE_BYTES_LIMIT) && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value!
      this.cacheBytes -= this.cache.get(oldest)!.bytes
      this.cache.delete(oldest)
    }
  }

  private async openSession(adapter: CorelAdapter, templateId: string, sourceHash: string): Promise<Session> {
    if (this.session?.templateId === templateId && this.session.sourceHash === sourceHash) return this.session
    await this.closeSession(adapter)
    const workPath = await this.store.makeWorkingCopy(templateId)
    const handle = await adapter.openDocument(workPath)
    this.session = { templateId, sourceHash, handle, workPath }
    return this.session
  }

  private async closeSession(adapter?: CorelAdapter): Promise<void> {
    const s = this.session
    this.session = null
    if (!s) return
    if (adapter) await adapter.closeDocument(s.handle).catch((err) => log.warn('preview.close_failed', { error: err }))
    await rm(s.workPath, { force: true }).catch(() => undefined)
  }

  /** Drops the open working copy and cached renders of a template (after re-inspection or removal). */
  async invalidate(templateId: string, adapter?: CorelAdapter): Promise<void> {
    await this.chain
    if (this.session?.templateId === templateId) await this.closeSession(adapter)
    for (const [k, v] of this.cache) {
      if (v.templateId !== templateId) continue
      this.cacheBytes -= v.bytes
      this.cache.delete(k)
    }
  }

  async close(adapter?: CorelAdapter): Promise<void> {
    await this.chain
    await this.closeSession(adapter)
    this.cache.clear()
    this.cacheBytes = 0
  }

  /** Cache size, exposed for the large-batch memory report and tests. */
  cacheStats(): { entries: number; bytes: number } {
    return { entries: this.cache.size, bytes: this.cacheBytes }
  }
}
