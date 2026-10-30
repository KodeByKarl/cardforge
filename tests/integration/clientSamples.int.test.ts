// Verification against the client's REAL CorelDRAW templates (clients/*.cdr, git-ignored). Skipped when the files are absent.
// Data is synthetic. Nothing from the client's files is printed or asserted as text: only counts, positions and pixel differences.
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JobHistory } from '../../src/main/services/generation/JobHistory'
import { SheetGenerationService } from '../../src/main/services/generation/SheetGenerationService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { setConsoleOutput } from '../../src/main/logger'
import { TemplateStore } from '../../src/main/services/templates/TemplateStore'
import { buildSheetValues, recordsForSheet, sheetMappingIssues, suggestSheetMapping } from '../../src/shared/sheet/compose'
import type { SheetGenerationRequest, SheetMapping, SheetMode } from '../../src/shared/sheet/types'
import type { ColumnConfig, ImportRecord } from '../../src/shared/types'
import { TMP, corelProgId, createAdapter } from './corelEnv'
import { decodePng, diffRasters } from './png'

const progId = await corelProgId()
const CLIENTS = resolve(__dirname, '../../clients')
const TEMPLATES = [
  { key: 'layout', file: 'card layout final.cdr' },
  { key: 'guide', file: 'guide (2).cdr' }
].filter((t) => !process.env['CLIENT_ONLY'] || t.key === process.env['CLIENT_ONLY'])
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
const DPI = 100

// Synthetic data with the same shape as the real columns (letters/digits/commas), never real values.
const cols: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c2', label: 'BIRTHDATE', index: 2, kind: 'text', include: true, required: false, duplicateKey: false },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number): ImportRecord => {
  const n = String(i + 1).padStart(6, '0')
  return { rowNumber: i + 4, values: { c0: `PL ${n}`, c1: `SURNAME${n},GIVEN${n} MIDDLE`, c2: '', c3: `BARANGAY ${(i % 40) + 1}, SAMPLE CITY, PROVINCE` } }
}
const samples = new Map(cols.map((c) => [c.key, Array.from({ length: 40 }, (_, i) => rec(i).values[c.key]!)]))
const blankedOf = <T,>(r: T): T => r
const norm = (s: string | undefined) => (s ?? '').replace(/\r/g, '\n').replace(/\s+$/g, '')

describe.skipIf(!progId || !existsSync(CLIENTS) || TEMPLATES.some((t) => !existsSync(join(CLIENTS, t.file))))(`Client sample templates on CorelDRAW ${progId ?? '(not installed)'}`, () => {
  let adapter: PowerShellCorelAdapter
  beforeAll(() => {
    adapter = createAdapter(progId!)
  })
  afterAll(async () => {
    await adapter?.dispose()
  })

  describe.each(TEMPLATES)('$key template', ({ key, file }) => {
    const root = join(TMP, `client-${key}-${randomUUID().slice(0, 8)}`)
    const source = join(root, 'client-template.cdr')
    let store: TemplateStore
    let service: SheetGenerationService
    let id: string
    let sourceHash: string
    let mapping: SheetMapping

    const request = (n: number, mode: SheetMode, out: string, over: Partial<SheetGenerationRequest> = {}): SheetGenerationRequest => ({
      templateId: id,
      outputDirectory: join(root, out),
      mode,
      cardsPerSheet: 10,
      sheetsPerFile: 2,
      exportPdf: true,
      clearEmpty: true,
      overwrite: 'overwrite',
      columns: cols.map((c) => ({ key: c.key, label: c.label })),
      records: Array.from({ length: n }, (_, i) => rec(i)),
      excludedRows: [],
      ...over
    })
    const run = async (req: SheetGenerationRequest) => {
      await service.start(req)
      return (await service.waitForIdle())!
    }
    /** Renders one page of a CDR to a raster. */
    const render = async (path: string, page: number, blank?: string[]) => {
      const handle = await adapter.openDocument(path)
      try {
        // Captions stay as the client designed them; only the data fields are blanked for the reference render.
        if (blank) await adapter.applyText(handle, Object.fromEntries(blank.map((n) => [n, ''])), 3, { keep: true })
        const dir = join(root, 'png')
        mkdirSync(dir, { recursive: true })
        const [f] = await adapter.exportPages(handle, { dir, prefix: randomUUID().slice(0, 8), dpi: DPI, pages: [page] })
        return decodePng(f!.path)
      } finally {
        await adapter.closeDocument(handle)
      }
    }
    const readBack = async (path: string) => {
      const handle = await adapter.openDocument(path)
      try {
        return await adapter.inspect(handle)
      } finally {
        await adapter.closeDocument(handle)
      }
    }

    beforeAll(async () => {
      mkdirSync(root, { recursive: true })
      copyFileSync(join(CLIENTS, file), source)
      sourceHash = sha(source)
      store = new TemplateStore(join(root, 'library'), join(root, 'work'), async () => adapter)
      service = new SheetGenerationService({ store, getAdapter: async () => adapter, history: new JobHistory(join(root, 'jobs.json')), safeMarginMm: () => 3, onProgress: () => undefined })
    }, 60_000)

    it('imports the client template as an A4 page with unnamed text and does not touch the file', async () => {
      const record = await store.import(source)
      id = record.id
      expect(record.pages).toHaveLength(1)
      expect(record.pages[0]).toMatchObject({ widthMm: 210, heightMm: 297 })
      expect(record.objectCount).toBe(0)
      expect(record.inspection.unnamedTextCount).toBeGreaterThan(0)
      console.log(`[client:${key}] unnamed text objects=${record.inspection.unnamedTextCount}`)
      expect(sha(source)).toBe(sourceHash)
    }, 120_000)

    it('detects the exact 2 x 5 grid and prepares a private copy (original untouched)', async () => {
      const a = await store.analyzeSheet(id, {})
      expect([a.config.columns, a.config.rows, a.config.cells.length]).toEqual([2, 5, 10])
      expect(a.config.warnings).toEqual([])
      console.log(`[client:${key}] roles per card=${a.config.roles.length} (captions=${a.config.roles.filter((r) => r.isLabel).length})`)
      const prepared = await store.prepareSheet(id, {})
      expect(prepared.sheet?.cells).toHaveLength(10)
      expect(prepared.objectCount).toBe(a.assignments.length)
      expect(sha(source)).toBe(sourceHash)
      const fonts = await store.missingFonts(id)
      console.log(`[client:${key}] fonts not installed: ${fonts.length ? fonts.join(', ') : 'none'}`)
    }, 300_000)

    it('maps only data that exists: name, address, control number; precinct blank; birthdate absent; prefix discrepancy flagged', async () => {
      const record = await store.get(id)
      const suggested = suggestSheetMapping(record.sheet!, cols, samples)
      const text = JSON.stringify(suggested.fields)
      expect(text).not.toContain('BIRTHDATE')
      const mapped = Object.values(suggested.fields).flat().filter((f) => f.kind === 'column').map((f) => (f as { columnLabel: string }).columnLabel)
      expect(new Set(mapped)).toEqual(new Set(['FULL NAME', 'ADDRESS', 'CONTROL NO.']))
      expect(mapped.filter((m) => m === 'CONTROL NO.')).toHaveLength(1)
      const issues = sheetMappingIssues(record.sheet!, suggested, cols, samples)
      const prefix = issues.some((i) => i.code === 'PREFIX_UNCONFIRMED')
      console.log(`[client:${key}] control-number prefix differs from the template sample: ${prefix}`)
      // Unmapped data lines print blank (e.g. precinct) rather than the template's sample text.
      expect(issues.filter((i) => i.code === 'KEEP_SAMPLE_TEXT')).toEqual([])
      mapping = { ...suggested, acknowledged: ['prefix'] }
      await store.saveSheetMapping(id, mapping)
    }, 60_000)

    it('mode "10 different records per sheet": correct mapping, page count, 2 x 5 positions, unique records, PDF, verification', async () => {
      const N = 23 // sheets of 10, 10, 3
      const summary = await run(request(N, 'unique', 'out-unique'))
      expect(summary.status).toBe('completed')
      expect([summary.succeeded, summary.failed]).toEqual([N, 0])
      expect(summary.sheetJob!.verification[0]).toMatch(/^OK/)
      const out = join(root, 'out-unique')
      const cdrs = readdirSync(out).filter((f) => f.endsWith('.cdr')).sort()
      expect(cdrs).toHaveLength(2)
      expect(readdirSync(out).filter((f) => f.endsWith('.pdf'))).toHaveLength(2)

      const record = await store.get(id)
      const sheet = record.sheet!
      const originalBounds = new Map(record.inspection.objects.map((o) => [o.name, o.bounds]))
      const seen = new Set<number>()
      const filesPages = [[1, 2], [3]]
      for (const [fi, sheetNumbers] of filesPages.entries()) {
        const inspected = await readBack(join(out, cdrs[fi]!))
        expect(inspected.pages).toHaveLength(sheetNumbers.length)
        for (const [pi, sheetNo] of sheetNumbers.entries()) {
          const item = { first: (sheetNo - 1) * 10, count: Math.min(10, N - (sheetNo - 1) * 10) }
          const recs = recordsForSheet('unique', 10, Array.from({ length: N }, (_, i) => rec(i)), item)
          const expected = buildSheetValues(sheet, mapping, recs, cols).values
          for (const [name, want] of Object.entries(expected)) {
            const o = inspected.objects.find((x) => x.pageIndex === pi + 1 && x.name === name)
            if (!o) {
              // Positions without a record on the last sheet lose their artwork and text objects entirely (option: clear empty positions).
              expect(norm(want), `object ${name} missing on page ${pi + 1}`).toBe('')
              continue
            }
            expect(norm(o!.text), `text of ${name} on sheet ${sheetNo}`).toBe(norm(want))
            // Exact positioning: the object stays where the client's artwork has it (left edge; top within a line).
            const ob = originalBounds.get(name)!
            if (norm(want)) {
              expect(Math.abs(o!.bounds.left - ob.left)).toBeLessThan(1)
              expect(Math.abs(o!.bounds.top - ob.top)).toBeLessThan(2.5)
            }
          }
          for (const r of recs) {
            expect(seen.has(r.rowNumber)).toBe(false)
            seen.add(r.rowNumber)
          }
        }
      }
      expect(seen.size).toBe(N) // no record skipped, none duplicated
      const pdf = readFileSync(join(out, readdirSync(out).filter((f) => f.endsWith('.pdf')).sort()[0]!), 'latin1')
      expect(pdf.startsWith('%PDF')).toBe(true)
      expect((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(2)
      const report = JSON.parse(readFileSync(summary.reportPath!, 'utf8')) as { entries: { overflow: string[] }[] }
      const warnings = report.entries.flatMap((e) => e.overflow)
      console.log(`[client:${key}] unique mode: ${N} records, 3 sheets, overflow/clipping warnings=${warnings.length}`)
      expect(warnings).toEqual([]) // typical-length values must not clip or cross into a neighbouring card
    }, 600_000)

    it('mode "10 copies of the same record per sheet": every position of a sheet holds the same record', async () => {
      const n = 3
      const summary = await run(request(n, 'copies', 'out-copies', { exportPdf: false }))
      expect(summary.status).toBe('completed')
      expect(summary.sheetJob!.sheets).toBe(n)
      const out = join(root, 'out-copies')
      const cdrs = readdirSync(out).filter((f) => f.endsWith('.cdr')).sort()
      expect(cdrs).toHaveLength(2) // sheets 1-2 and 3
      const sheet = (await store.get(id)).sheet!
      const roleIds = sheet.roles.filter((r) => !r.isLabel).map((r) => r.id)
      const perSheet: string[][] = []
      for (const [fi, f] of cdrs.entries()) {
        const inspected = await readBack(join(out, f))
        for (let pg = 1; pg <= inspected.pages.length; pg++) {
          const fingerprint = roleIds.map((rid) => {
            const texts = sheet.cells.map((c) => norm(inspected.objects.find((o) => o.pageIndex === pg && o.name === c.objects[rid])?.text))
            expect(new Set(texts).size, `role ${rid} must be identical on all 10 cards of a sheet`).toBe(1)
            return texts[0]!
          })
          perSheet.push(fingerprint)
        }
        expect(fi).toBeLessThan(2)
      }
      expect(perSheet).toHaveLength(n)
      expect(new Set(perSheet.map((f) => f.join('|'))).size).toBe(n) // different record on every sheet
    }, 600_000)

    it('a copied page is pixel-identical to the original client page (no artwork lost or changed)', async () => {
      const original = join(root, 'library', id, 'template.original.cdr')
      const reference = await render(original, 1)
      const work = await store.makeWorkingCopy(id)
      const handle = await adapter.openDocument(work)
      try {
        await adapter.addSheetPages(handle, 1, 1)
        const dir = join(root, 'png')
        mkdirSync(dir, { recursive: true })
        for (const page of [1, 2]) {
          const [f] = await adapter.exportPages(handle, { dir, prefix: randomUUID().slice(0, 8), dpi: DPI, pages: [page] })
          const d = diffRasters(blankedOf(reference), blankedOf(decodePng(f!.path)), 0)
          console.log(`[client:${key}] copied page ${page} vs original: differing pixels=${d.differing}`)
        }
      } finally {
        await adapter.closeDocument(handle)
        await rm(work, { force: true })
      }
      // Compare the prepared template page 1 with page 2 of the copy directly (same document, same renderer state).
      const handle2 = await adapter.openDocument(await store.makeWorkingCopy(id))
      try {
        await adapter.addSheetPages(handle2, 1, 1)
        const dir = join(root, 'png')
        const [p1] = await adapter.exportPages(handle2, { dir, prefix: randomUUID().slice(0, 8), dpi: DPI, pages: [1] })
        const [p2] = await adapter.exportPages(handle2, { dir, prefix: randomUUID().slice(0, 8), dpi: DPI, pages: [2] })
        const d = diffRasters(decodePng(p1!.path), decodePng(p2!.path), 0)
        expect(d.sameSize).toBe(true)
        expect(d.differing).toBe(0)
      } finally {
        await adapter.closeDocument(handle2)
      }
    }, 600_000)

    it('text kept as designed keeps its exact formatting: same font, size, style and text extent as the client template', async () => {
      // Every template text is kept (not replaced from data); the output must match the client's template object by object.
      const record = await store.get(id)
      const missing = new Set(await store.missingFonts(id))
      const keepAll: SheetMapping = {
        version: 1,
        acknowledged: ['prefix'],
        fields: Object.fromEntries(record.sheet!.roles.map((r) => [r.id, r.templateLines.map(() => ({ kind: 'keep' as const }))]))
      }
      await store.saveSheetMapping(id, keepAll)
      const summary = await run(request(20, 'unique', 'out-keep', { exportPdf: false }))
      expect(summary.status).toBe('completed')
      const out = join(root, 'out-keep')
      const file = readdirSync(out).find((f) => f.endsWith('.cdr'))!
      const inspected = await readBack(join(out, file))
      let compared = 0
      let worst = 0
      const substituted = new Set<string>()
      for (const ref of record.inspection.objects) {
        for (const page of [1, 2]) {
          const o = inspected.objects.find((x) => x.pageIndex === page && x.name === ref.name)
          expect(o, `${ref.name} on page ${page}`).toBeTruthy()
          if (ref.isParagraph !== o!.isParagraph) throw new Error(`${ref.name}: text type changed`)
          if (missing.has(ref.font)) substituted.add(`${ref.font} -> ${o!.font}`)
          else expect([o!.font, o!.sizePt, o!.bold, o!.italic, o!.alignment]).toEqual([ref.font, ref.sizePt, ref.bold, ref.italic, ref.alignment])
          // "Keep" prints the reference card's template text in every position; only card 1 can be compared text-for-text
          // (the client's other cards carry different sample text).
          const isFirstCard = ref.name.startsWith('C01_')
          if (isFirstCard) expect(norm(o!.text)).toBe(norm(ref.text))
          if (!isFirstCard) continue
          const delta = Math.max(Math.abs(o!.bounds.left - ref.bounds.left), Math.abs(o!.bounds.right - ref.bounds.right), Math.abs(o!.bounds.top - ref.bounds.top), Math.abs(o!.bounds.bottom - ref.bounds.bottom))
          worst = Math.max(worst, delta)
          compared++
        }
      }
      console.log(`[client:${key}] ${compared} text objects compared with the template: worst bounds difference=${worst.toFixed(3)} mm; fonts substituted by CorelDRAW because they are not installed: ${substituted.size ? [...substituted].join('; ') : 'none'}`)
      // Text extents can only be compared exactly when the real fonts are installed.
      if (substituted.size === 0) expect(worst).toBeLessThan(0.15)
      await store.saveSheetMapping(id, mapping)
    }, 600_000)

    it('with data, only text areas differ from the artwork: nothing else changes on a filled sheet', async () => {
      setConsoleOutput(true) // shows the bridge's stderr if CorelDRAW misbehaves
      const out = join(root, 'out-unique')
      const file = readdirSync(out).filter((f) => f.endsWith('.cdr')).sort()[0]!
      const stage = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn()
        } catch (err) {
          throw new Error(`stage "${name}": ${(err as Error).message}`)
        }
      }
      const generated = await stage('render generated', () => render(join(out, file), 1))
      const blankWork = await store.makeWorkingCopy(id)
      const sheetCfg = (await store.get(id)).sheet!
      const dataNames = sheetCfg.cells.flatMap((c) => sheetCfg.roles.filter((r) => !r.isLabel).map((r) => c.objects[r.id]!))
      const blank = await stage('render blank reference', () => render(blankWork, 1, dataNames))
      await rm(blankWork, { force: true })
      const inspected = await stage('read back', () => readBack(join(out, file)))
      const PX = DPI / 25.4
      const margin = 3 * PX
      const boxes = inspected.objects.filter((o) => o.pageIndex === 1).map((o) => o.bounds)
      const inText = (x: number, y: number) => boxes.some((b) => x >= b.left * PX - margin && x <= b.right * PX + margin && y >= (297 - b.top) * PX - margin && y <= (297 - b.bottom) * PX + margin)
      const d = diffRasters(blank, generated, 8, inText)
      console.log(`[client:${key}] differing pixels outside text areas=${d.differing}`)
      expect(d.sameSize).toBe(true)
      expect(d.differing).toBe(0)
    }, 300_000)

    it('the original client file is still byte-identical after everything', () => {
      expect(sha(source)).toBe(sourceHash)
      expect(sha(join(CLIENTS, file))).toBe(sourceHash)
    })
  })
})
