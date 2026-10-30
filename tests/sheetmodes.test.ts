import { describe, expect, it } from 'vitest'
import { parseSheetGenerationRequest } from '../src/main/validation'
import { planBatches, verifyBatches } from '../src/shared/sheet/batches'
import { buildSheetValues, cellExtentIssues, classifyLine, recordsForSheet, suggestSheetMapping } from '../src/shared/sheet/compose'
import { detectSheetGrid } from '../src/shared/sheet/detect'
import type { UnnamedText } from '../src/shared/sheet/types'
import type { ColumnConfig, ImportRecord } from '../src/shared/types'

const COLS_X = [15, 118]
const ROW_TOP = [55, 111, 168, 224, 281]
function obj(uid: number, left: number, top: number, w: number, h: number, text: string, font = 'Arial', size = 9): UnnamedText {
  return { uid: `u${uid}`, pageIndex: 1, path: [], text, font, sizePt: size, bold: false, italic: false, alignment: 1, isParagraph: false, mixedFormatting: false, bounds: { left, right: left + w, top, bottom: top - h } }
}
/** Synthetic layout shaped like the client's second template: name, caption stack, address, precinct, control number per card. */
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

const columns: ColumnConfig[] = [
  { key: 'c0', label: 'CONTROL NO.', index: 0, kind: 'text', include: true, required: true, duplicateKey: false, unique: true },
  { key: 'c1', label: 'FULL NAME', index: 1, kind: 'text', include: true, required: true, duplicateKey: true },
  { key: 'c2', label: 'BIRTHDATE', index: 2, kind: 'text', include: true, required: false, duplicateKey: false },
  { key: 'c3', label: 'ADDRESS', index: 3, kind: 'multiline', include: true, required: false, duplicateKey: false }
]
const rec = (i: number): ImportRecord => ({ rowNumber: i + 4, values: { c0: `PL ${String(i + 1).padStart(6, '0')}`, c1: `SURNAME${i},GIVEN${i}`, c2: '', c3: `BRGY ${i}, TOWN, PROV` } })
const samples = new Map(columns.map((c) => [c.key, Array.from({ length: 30 }, (_, i) => rec(i).values[c.key]!)]))

describe('production modes', () => {
  const recs = Array.from({ length: 25 }, (_, i) => rec(i))
  it('unique: ten different records per sheet', () => {
    const items = planBatches(25, 10, 25, 'unique').sheetPlan.sheets
    expect(items).toHaveLength(3)
    expect(recordsForSheet('unique', 10, recs, items[1]!).map((r) => r.rowNumber)).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
    expect(recordsForSheet('unique', 10, recs, items[2]!)).toHaveLength(5)
  })

  it('copies: every record gets its own sheet and fills all positions with the same record', () => {
    const p = planBatches(25, 10, 25, 'copies')
    expect(p.sheetPlan.sheets).toHaveLength(25)
    expect(verifyBatches(p)).toEqual([])
    const one = recordsForSheet('copies', 10, recs, p.sheetPlan.sheets[6]!)
    expect(one).toHaveLength(10)
    expect(new Set(one.map((r) => r.rowNumber))).toEqual(new Set([10]))
  })

  it('copies: 40,897 records -> 40,897 sheets -> 1,636 files of 25, every record on exactly one sheet', () => {
    const p = planBatches(40_897, 10, 25, 'copies')
    expect(p.sheetPlan.sheets).toHaveLength(40_897)
    expect(p.batches).toHaveLength(1636)
    expect(verifyBatches(p)).toEqual([])
  })

  it('the mode is mandatory in a generation request (never assumed)', () => {
    const base = { templateId: '11111111-1111-4111-8111-111111111111', outputDirectory: 'C:\\out', cardsPerSheet: 10, sheetsPerFile: 25, exportPdf: false, clearEmpty: true, overwrite: 'resume', columns: [{ key: 'c0', label: 'A' }], records: [{ rowNumber: 4, values: { c0: 'x' } }], excludedRows: [] }
    expect(() => parseSheetGenerationRequest(base)).toThrow(/production mode/)
    expect(() => parseSheetGenerationRequest({ ...base, mode: 'both' })).toThrow()
    expect(parseSheetGenerationRequest({ ...base, mode: 'copies' }).mode).toBe('copies')
  })
})

describe('compatibility with the second client template shape', () => {
  it('classifies precinct numbers separately from control numbers', () => {
    expect(classifyLine('0186A')).toBe('text')
    expect(classifyLine('13774')).toBe('id')
    expect(classifyLine('XX 000001')).toBe('id')
  })

  const det = detectSheetGrid(guideLike(), { pageWidthMm: 210, pageHeightMm: 297 })
  if ('error' in det) throw new Error(det.error)
  const config = { ...det.config, preparedAt: 'now' }

  it('maps name, address and control number; leaves the precinct blank because no column holds it', () => {
    const m = suggestSheetMapping(config, columns, samples)
    const lineFor = (text: string) => {
      const role = config.roles.find((r) => r.templateLines[0] === text)!
      return m.fields[role.id]![0]
    }
    expect(lineFor('SAMPLE, NAME GIVEN')).toEqual({ kind: 'column', columnLabel: 'FULL NAME' })
    expect(lineFor('SAMPLE, TOWN, PROV')).toEqual({ kind: 'column', columnLabel: 'ADDRESS' })
    expect(lineFor('00000')).toEqual({ kind: 'column', columnLabel: 'CONTROL NO.' })
    expect(lineFor('0000A')).toEqual({ kind: 'blank' }) // precinct: never invented
    const caption = config.roles.find((r) => r.isLabel)!
    expect(m.fields[caption.id]!.every((f) => f.kind === 'keep')).toBe(true)
    // Birthdate has no placement on this template, so nothing maps to it.
    expect(JSON.stringify(m.fields)).not.toContain('BIRTHDATE')
  })

  it('printed values: precinct stays blank, caption untouched, every card has its own record', () => {
    const m = suggestSheetMapping(config, columns, samples)
    const sv = buildSheetValues(config, m, Array.from({ length: 10 }, (_, i) => rec(i)), columns)
    const precinct = config.roles.find((r) => r.templateLines[0] === '0000A')!
    const caption = config.roles.find((r) => r.isLabel)!
    for (const cell of config.cells) {
      expect(sv.values[cell.objects[precinct.id]!]).toBe('')
      expect(sv.values[cell.objects[caption.id]!]).toBeUndefined()
    }
    const nameRole = config.roles.find((r) => r.templateLines[0] === 'SAMPLE, NAME GIVEN')!
    expect(new Set(config.cells.map((c) => sv.values[c.objects[nameRole.id]!])).size).toBe(10)
  })
})

describe('text beyond its card position', () => {
  const det = detectSheetGrid(guideLike(), { pageWidthMm: 210, pageHeightMm: 297 })
  if ('error' in det) throw new Error(det.error)
  it('flags an object that crosses into the neighbouring position and ignores ordinary text', () => {
    const cell = det.config.cells[0]!
    const name = cell.objects[det.config.roles[0]!.id]!
    const inside = { name, bounds: { left: cell.region.left + 2, right: cell.region.right - 2, top: cell.region.top - 2, bottom: cell.region.bottom + 2 } }
    expect(cellExtentIssues(det.config, [inside])).toEqual([])
    const wide = { name, bounds: { ...inside.bounds, right: cell.region.right + 30 } }
    expect(cellExtentIssues(det.config, [wide])).toHaveLength(1)
  })
})
