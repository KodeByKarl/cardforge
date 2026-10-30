import { describe, expect, it } from 'vitest'
import { buildSheetValues, classifyLine, composeRoleText, hasBlockingSheetIssues, parseSheetMapping, planSheets, prefixDiscrepancy, sheetMappingIssues, suggestSheetMapping, verifyPlan } from '../src/shared/sheet/compose'
import { detectSheetGrid, looksLikeLabel } from '../src/shared/sheet/detect'
import type { UnnamedText } from '../src/shared/sheet/types'
import type { ColumnConfig, ImportRecord } from '../src/shared/types'

const COLS_X = [15, 118]
const ROW_TOP = [55, 111, 168, 224, 281]

function obj(uid: number, left: number, top: number, w: number, h: number, text: string, font = 'Arial', size = 9): UnnamedText {
  return { uid: `u${uid}`, pageIndex: 1, path: [], text, font, sizePt: size, bold: false, italic: false, alignment: 1, isParagraph: false, mixedFormatting: false, bounds: { left, right: left + w, top, bottom: top - h } }
}

/** Synthetic sheet shaped like a 2 x 5 card layout: a name plus one composite padded value text per card. Reversed order on purpose. */
function layoutLike(): UnnamedText[] {
  const out: UnnamedText[] = []
  let uid = 1
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 2; c++) {
      const x = COLS_X[c]!
      const top = ROW_TOP[r]!
      out.push(obj(uid++, x, top - 2, 30, 3.5, 'SAMPLE NAME,GIVEN'))
      out.push(obj(uid++, x + 16, top - 20, 33, 11, '  SAMPLE ADDRESS,TOWN,PROV\r          \r         XX 000001', 'Segoe Print', 11))
    }
  return out.reverse()
}

function guideLike(): UnnamedText[] {
  const out: UnnamedText[] = []
  let uid = 1
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 2; c++) {
      const x = COLS_X[c]!
      const top = ROW_TOP[r]!
      out.push(obj(uid++, x + 3, top - 4, 35, 3.5, 'SAMPLE, NAME GIVEN', 'Gotham Black', 9))
      out.push(obj(uid++, x, top - 14, 17, 8.4, 'ADDRESS:\rPRECINCT NO:\rCONTROL NO.:', 'Arial', 8))
      out.push(obj(uid++, x + 17, top - 20, 35, 2.4, 'SAMPLE, TOWN, PROV', 'Gotham Medium', 8))
      out.push(obj(uid++, x + 17, top - 24, 7, 2, '0000A', 'Gotham Medium', 8))
      out.push(obj(uid++, x + 17, top - 28, 6, 2, '00000', 'Gotham Medium', 8))
    }
  return out
}

describe('detectSheetGrid', () => {
  it('finds a 2 x 5 grid of 10 cards in reading order and replicates roles', () => {
    const r = detectSheetGrid(layoutLike(), { pageWidthMm: 210, pageHeightMm: 297 })
    if ('error' in r) throw new Error(r.error)
    expect(r.config.columns).toBe(2)
    expect(r.config.rows).toBe(5)
    expect(r.config.cells).toHaveLength(10)
    expect(r.config.roles).toHaveLength(2)
    expect(r.config.warnings).toEqual([])
    expect(r.assignments).toHaveLength(20)
    expect(new Set(r.assignments.map((a) => a.name)).size).toBe(20)
    const [c1, c2, c3] = r.config.cells
    expect([c1!.col, c1!.row, c2!.col, c2!.row, c3!.col, c3!.row]).toEqual([1, 1, 2, 1, 1, 2]) // left to right, then next row down
    expect(c1!.objects['f1']).toBe('C01_f1')
    // Reading order follows the geometry, not the order in which CorelDRAW reported the objects.
    const byUid = new Map(layoutLike().map((o) => [o.uid, o]))
    const topLeft = r.assignments.find((a) => a.name === 'C01_f1')!
    expect(byUid.get(topLeft.uid)!.bounds.left).toBe(15)
    expect(byUid.get(topLeft.uid)!.bounds.top).toBe(279) // y grows upwards: the top row of the page is the largest y
  })

  it('treats the stacked caption of the guide layout as a label', () => {
    const r = detectSheetGrid(guideLike())
    if ('error' in r) throw new Error(r.error)
    expect(r.config.cells).toHaveLength(10)
    expect(r.config.roles).toHaveLength(5)
    expect(r.config.roles.filter((x) => x.isLabel)).toHaveLength(1)
    expect(looksLikeLabel('ADDRESS:\rPRECINCT NO:\rCONTROL NO.:')).toBe(true)
    expect(looksLikeLabel('XX 000001')).toBe(false)
  })

  it('supports column-major order and a forced grid', () => {
    const r = detectSheetGrid(layoutLike(), { order: 'columns' })
    if ('error' in r) throw new Error(r.error)
    expect(r.config.cells.find((c) => c.index === 2)).toMatchObject({ col: 1, row: 2 })
    const forced = detectSheetGrid(layoutLike(), { columns: 2, rows: 5 })
    if ('error' in forced) throw new Error(forced.error)
    expect(forced.config.cells).toHaveLength(10)
  })

  it('warns instead of hiding an uneven layout', () => {
    const objs = layoutLike().filter((o) => o.uid !== 'u3')
    const r = detectSheetGrid(objs)
    if ('error' in r) throw new Error(r.error)
    expect(r.config.warnings.length).toBeGreaterThan(0)
  })

  it('reports a clear error for a page with no text', () => {
    expect(detectSheetGrid([])).toEqual({ error: expect.stringContaining('no unnamed text') })
  })
})

describe('planSheets / verifyPlan', () => {
  it('10-up: 40,897 records -> 4,090 sheets, last with 7', () => {
    const p = planSheets(40_897, 10)
    expect(p.sheets).toHaveLength(4090)
    expect(p.sheets.at(-1)).toEqual({ number: 4090, first: 40_890, count: 7 })
    expect(verifyPlan(p)).toEqual([])
  })
  it('8-up: 40,900 records -> 5,113 sheets, last with 4', () => {
    const p = planSheets(40_900, 8)
    expect(p.sheets).toHaveLength(5113)
    expect(p.sheets.at(-1)).toMatchObject({ number: 5113, count: 4 })
    expect(p.sheets[1]).toEqual({ number: 2, first: 8, count: 8 })
    expect(verifyPlan(p)).toEqual([])
  })
  it('covers every record exactly once for many sizes', () => {
    for (const total of [1, 7, 8, 9, 10, 99, 100, 101, 1000]) for (const per of [1, 8, 10]) expect(verifyPlan(planSheets(total, per))).toEqual([])
  })
  it('detects gaps, overlaps and bad numbering', () => {
    const p = planSheets(20, 10)
    expect(verifyPlan({ ...p, sheets: [p.sheets[0]!, { ...p.sheets[1]!, first: 11 }] }).length).toBeGreaterThan(0)
    expect(verifyPlan({ ...p, sheets: [p.sheets[0]!] }).length).toBeGreaterThan(0)
    expect(verifyPlan({ ...p, sheets: [p.sheets[1]!, p.sheets[0]!] }).length).toBeGreaterThan(0)
    expect(() => planSheets(5, 0)).toThrow()
  })
})

const columns: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c2', label: 'BIRTHDATE', index: 2, kind: 'text', include: true, required: false, duplicateKey: false },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number, over: Partial<Record<string, string>> = {}): ImportRecord => ({
  rowNumber: i + 4,
  values: { c0: `PL ${String(i + 1).padStart(6, '0')}`, c1: `SURNAME${i},GIVEN${i}`, c2: '', c3: `BRGY ${i}, TOWN, PROV`, ...over } as Record<string, string>
})
const samples = (n = 20) => new Map<string, string[]>(columns.map((c) => [c.key, Array.from({ length: n }, (_, i) => rec(i).values[c.key]!)]))

describe('mapping suggestions and composition', () => {
  const det = detectSheetGrid(layoutLike(), { pageWidthMm: 210, pageHeightMm: 297 })
  if ('error' in det) throw new Error(det.error)
  const config = { ...det.config, preparedAt: 'now' }

  it('classifies sample lines by the kind of value they hold', () => {
    expect(classifyLine('XX 000001')).toBe('id')
    expect(classifyLine('13774')).toBe('id')
    expect(classifyLine('SAMPLE JR.,GIVEN')).toBe('name')
    expect(classifyLine('SAMPLE TOWN,CITY,PROVINCE')).toBe('address')
    expect(classifyLine('   ')).toBe('empty')
  })

  it('maps name, address and control number onto the right lines', () => {
    const m = suggestSheetMapping(config, columns, samples())
    expect(m.fields['f1']).toEqual([{ kind: 'column', columnLabel: 'FULL NAME' }])
    expect(m.fields['f2']![0]).toEqual({ kind: 'column', columnLabel: 'ADDRESS' })
    expect(m.fields['f2']![1]).toEqual({ kind: 'keep' }) // whitespace-only spacer line
    expect(m.fields['f2']![2]).toEqual({ kind: 'column', columnLabel: 'CONTROL NO.' })
  })

  it('keeps the padding of each template line and flattens line breaks inside values', () => {
    const m = suggestSheetMapping(config, columns, samples())
    const role = config.roles[1]!
    const key = new Map(columns.map((c) => [c.label, c.key]))
    const text = composeRoleText(role, m.fields['f2'], rec(0, { c3: 'LINE ONE\nLINE TWO' }), key)
    expect(text).toBe('  LINE ONE LINE TWO\n          \n         PL 000001')
  })

  it('fills only the used cells of a sheet and blanks the rest (final partly filled sheet)', () => {
    const m = suggestSheetMapping(config, columns, samples())
    const sv = buildSheetValues(config, m, [rec(0), rec(1), rec(2), rec(3)], columns)
    expect(sv.filled).toBe(4)
    expect(sv.emptyRegions).toHaveLength(6)
    expect(sv.values['C01_f1']).toBe('SURNAME0,GIVEN0')
    expect(sv.values['C04_f1']).toBe('SURNAME3,GIVEN3')
    expect(sv.values['C05_f1']).toBe('')
    expect(sv.values['C10_f2']).toBe('')
    expect(Object.keys(sv.values)).toHaveLength(20)
  })

  it('puts a different record on every card of a sheet', () => {
    const m = suggestSheetMapping(config, columns, samples())
    const sv = buildSheetValues(config, m, Array.from({ length: 10 }, (_, i) => rec(i)), columns)
    const names = config.cells.map((c) => sv.values[c.objects['f1']!])
    expect(new Set(names).size).toBe(10)
  })

  it('blank optional values leave no stray padding', () => {
    const role = config.roles[1]!
    const key = new Map(columns.map((c) => [c.label, c.key]))
    expect(composeRoleText(role, [{ kind: 'column', columnLabel: 'ADDRESS' }, { kind: 'keep' }, { kind: 'column', columnLabel: 'BIRTHDATE' }], rec(0, { c3: '' }), key)).toBe('')
  })
})

describe('mapping checks', () => {
  const det = detectSheetGrid(layoutLike())
  if ('error' in det) throw new Error(det.error)
  const config = { ...det.config, preparedAt: 'now' }

  it('flags the template prefix versus data prefix and does not convert anything', () => {
    expect(prefixDiscrepancy('XX 000001', ['PL 000001', 'PL 000002'])).toEqual({ template: 'XX', data: ['PL'] })
    expect(prefixDiscrepancy('PL 000001', ['PL 000009'])).toBeNull()
    expect(prefixDiscrepancy('SOME TEXT', ['PL 1'])).toBeNull()
  })

  it('blocks generation until the prefix is confirmed, then lets it through', () => {
    const m = suggestSheetMapping(config, columns, samples())
    let issues = sheetMappingIssues(config, m, columns, samples())
    expect(issues.some((i) => i.code === 'PREFIX_UNCONFIRMED')).toBe(true)
    expect(hasBlockingSheetIssues(issues)).toBe(true)
    issues = sheetMappingIssues(config, { ...m, acknowledged: ['prefix'] }, columns, samples())
    expect(hasBlockingSheetIssues(issues)).toBe(false)
  })

  it('reports missing columns, unmapped fields and sample text kept on cards', () => {
    const m = suggestSheetMapping(config, columns, samples())
    const broken = { ...m, acknowledged: ['prefix'], fields: { ...m.fields, f1: [{ kind: 'column' as const, columnLabel: 'GONE' }], f2: [{ kind: 'keep' as const }, { kind: 'keep' as const }, { kind: 'blank' as const }] } }
    const codes = sheetMappingIssues(config, broken, columns, samples()).map((i) => i.code)
    expect(codes).toContain('MISSING_COLUMN')
    expect(codes).toContain('KEEP_SAMPLE_TEXT')
    expect(codes).toContain('UNMAPPED_FIELD')
    expect(sheetMappingIssues({ ...config, preparedAt: null }, m, columns, samples()).some((i) => i.code === 'NOT_PREPARED')).toBe(true)
    expect(sheetMappingIssues(config, null, columns, samples()).some((i) => i.code === 'NO_MAPPING')).toBe(true)
  })

  it('parses stored mappings strictly', () => {
    expect(parseSheetMapping({ fields: { f1: [{ kind: 'column', columnLabel: 'A' }, { kind: 'keep' }] }, acknowledged: ['prefix', 'x'] })).toEqual({ version: 1, fields: { f1: [{ kind: 'column', columnLabel: 'A' }, { kind: 'keep' }] }, acknowledged: ['prefix'] })
    expect(() => parseSheetMapping({ fields: { bad: [] } })).toThrow()
    expect(() => parseSheetMapping({ fields: { f1: [{ kind: 'column' }] } })).toThrow()
    expect(() => parseSheetMapping(null)).toThrow()
  })
})
