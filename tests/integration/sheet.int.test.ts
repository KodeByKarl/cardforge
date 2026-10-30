import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PreviewService } from '../../src/main/services/preview/PreviewService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { TemplateStore } from '../../src/main/services/templates/TemplateStore'
import { buildSheetValues, suggestSheetMapping } from '../../src/shared/sheet/compose'
import type { ColumnConfig, ImportRecord } from '../../src/shared/types'
import { TMP, corelProgId, createAdapter } from './corelEnv'

const progId = await corelProgId()
const FIXTURE = resolve(__dirname, '../fixtures/sheet-10up-layout.cdr')
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

const columns: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number): ImportRecord => ({ rowNumber: i + 4, values: { c0: `XX ${String(i + 1).padStart(6, '0')}`, c1: `SURNAME${i + 1},GIVEN${i + 1}`, c3: `BRGY ${i + 1},TOWN,PROV` } })
const samples = new Map(columns.map((c) => [c.key, [rec(0).values[c.key]!, rec(1).values[c.key]!]]))

describe.skipIf(!progId || !existsSync(FIXTURE))(`Sheet template preparation and rendering (${progId ?? 'CorelDRAW not installed'})`, () => {
  const root = join(TMP, `sheet-${randomUUID().slice(0, 8)}`)
  const source = join(root, 'sheet-template.cdr')
  let adapter: PowerShellCorelAdapter
  let store: TemplateStore
  let id: string
  let sourceHash: string

  beforeAll(() => {
    mkdirSync(root, { recursive: true })
    copyFileSync(FIXTURE, source)
    sourceHash = sha(source)
    adapter = createAdapter(progId!)
    store = new TemplateStore(join(root, 'library'), join(root, 'work'), async () => adapter)
  })
  afterAll(async () => {
    await adapter?.dispose()
  })

  it('imports a sheet with unnamed text and reports every unnamed object with its position', async () => {
    const record = await store.import(source)
    id = record.id
    expect(record.objectCount).toBe(0)
    expect(record.inspection.unnamedTextCount).toBe(20)
    expect(record.inspection.unnamed).toHaveLength(20)
    expect(record.pages[0]).toMatchObject({ widthMm: 210, heightMm: 297 })
  })

  it('detects the 2 x 5 grid without changing anything', async () => {
    const { config, assignments } = await store.analyzeSheet(id, {})
    expect([config.columns, config.rows, config.cells.length, config.roles.length, assignments.length]).toEqual([2, 5, 10, 2, 20])
    expect(config.warnings).toEqual([])
    expect((await store.get(id)).sheet ?? null).toBeNull()
  })

  it('prepares the private copy (names every card object) and leaves the original file untouched', async () => {
    const record = await store.prepareSheet(id, {})
    expect(record.sheet?.preparedAt).toBeTruthy()
    expect(record.objectCount).toBe(20)
    expect(record.inspection.objects.map((o) => o.name)).toContain('C10_f2')
    expect(sha(source)).toBe(sourceHash)
    expect(existsSync(join(root, 'library', id, 'template.original.cdr'))).toBe(true)
    expect(readdirSync(join(root, 'work'))).toEqual([])
  })

  it('renders a full A4 sheet with unique records per card and removes artwork of empty positions', async () => {
    const record = await store.get(id)
    const mapping = suggestSheetMapping(record.sheet!, columns, samples)
    const preview = new PreviewService(store, async () => adapter, join(root, 'preview'), () => 3)
    const sheet1 = buildSheetValues(record.sheet!, mapping, Array.from({ length: 10 }, (_, i) => rec(i)), columns)
    const full = await preview.render({ templateId: id, values: sheet1.values, dpi: 72, pages: [1] })
    expect(full.pages[0]).toMatchObject({ pageIndex: 1, widthMm: 210, heightMm: 297 })
    expect(full.notFound).toEqual([])
    expect(full.objects).toHaveLength(20)

    // Last sheet: 4 records, 6 empty positions. Their texts are blank and the artwork inside is cleared.
    const last = buildSheetValues(record.sheet!, mapping, [rec(10), rec(11), rec(12), rec(13)], columns)
    expect(last.emptyRegions).toHaveLength(6)
    const handle = await adapter.openDocument(await store.makeWorkingCopy(id))
    const before = await adapter.applyText(handle, last.values, 3)
    expect(before.cleared ?? 0).toBe(0)
    const cleared = await adapter.applyText(handle, last.values, 3, { clearRegions: last.emptyRegions, clearPage: 1 })
    expect(cleared.cleared).toBeGreaterThanOrEqual(6) // at least the six card frames
    expect(cleared.notFound).toEqual([])
    // The next record set must start from the pristine template again (Undo restores the deleted artwork and the index).
    const again = await adapter.applyText(handle, sheet1.values, 3)
    expect(again.notFound).toEqual([])
    expect(again.objects).toHaveLength(20)
    await adapter.closeDocument(handle)
    await preview.close(adapter)
  })

  it('can be reverted to the client layout and prepared again', async () => {
    const reverted = await store.revertSheet(id)
    expect(reverted.sheet ?? null).toBeNull()
    expect(reverted.objectCount).toBe(0)
    expect(reverted.inspection.unnamedTextCount).toBe(20)
    const again = await store.prepareSheet(id, { columns: 2, rows: 5 })
    expect(again.objectCount).toBe(20)
    expect(sha(source)).toBe(sourceHash)
  })
})
