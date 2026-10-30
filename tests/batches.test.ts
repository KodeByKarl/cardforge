import { describe, expect, it } from 'vitest'
import { DEFAULT_SHEETS_PER_FILE, batchFileName, planBatches, verifyBatches } from '../src/shared/sheet/batches'
import { validateDataset } from '../src/shared/import/validate'
import { buildColumns } from '../src/shared/import/headers'
import { buildDataset } from '../src/shared/import/dataset'
import { parseSheetGenerationRequest } from '../src/main/validation'

describe('planBatches', () => {
  it('splits the 40,897-record job into 4,090 sheets and 164 files of 25 sheets (last file has 15)', () => {
    const p = planBatches(40_897, 10, DEFAULT_SHEETS_PER_FILE)
    expect(p.sheetPlan.sheets).toHaveLength(4090)
    expect(p.batches).toHaveLength(164)
    expect(p.batches[0]).toEqual({ index: 1, firstSheet: 1, lastSheet: 25, sheetCount: 25, firstRecord: 0, recordCount: 250 })
    expect(p.batches.at(-1)).toMatchObject({ index: 164, firstSheet: 4076, lastSheet: 4090, sheetCount: 15, recordCount: 147 })
    expect(verifyBatches(p)).toEqual([])
  })

  it('every record belongs to exactly one batch for many shapes of job', () => {
    for (const total of [1, 9, 10, 11, 249, 250, 251, 5000]) {
      for (const per of [1, 8, 10]) {
        for (const files of [1, 3, 25, 500]) {
          const p = planBatches(total, per, files)
          expect(verifyBatches(p)).toEqual([])
          expect(p.batches.reduce((n, b) => n + b.recordCount, 0)).toBe(total)
        }
      }
    }
  })

  it('detects tampered plans (gap, overlap, wrong totals)', () => {
    const p = planBatches(100, 10, 3)
    expect(verifyBatches({ ...p, batches: [p.batches[0]!, { ...p.batches[1]!, firstRecord: p.batches[1]!.firstRecord + 1 }, ...p.batches.slice(2)] }).length).toBeGreaterThan(0)
    expect(verifyBatches({ ...p, batches: p.batches.slice(0, -1) }).length).toBeGreaterThan(0)
    expect(() => planBatches(10, 10, 0)).toThrow()
    expect(() => planBatches(10, 10, 501)).toThrow()
  })

  it('names files so they sort in sheet order', () => {
    const p = planBatches(40_897, 10, 25)
    expect(batchFileName('Cards', p.batches[0]!, 4090)).toBe('Cards sheets 00001-00025.cdr')
    expect(batchFileName('Cards', p.batches[163]!, 4090, 'pdf')).toBe('Cards sheets 04076-04090.pdf')
    const names = p.batches.map((b) => batchFileName('X', b, 4090))
    expect([...names].sort()).toEqual(names)
  })
})

describe('sheet generation request validation', () => {
  const base = {
    templateId: '11111111-1111-4111-8111-111111111111',
    outputDirectory: 'C:\\out',
    mode: 'unique',
    cardsPerSheet: 10,
    sheetsPerFile: 25,
    exportPdf: false,
    clearEmpty: true,
    overwrite: 'resume',
    columns: [{ key: 'c0', label: 'A' }],
    records: [{ rowNumber: 4, values: { c0: 'x' } }],
    excludedRows: []
  }
  it('accepts a well-formed request', () => {
    expect(parseSheetGenerationRequest(base).records).toHaveLength(1)
  })
  it('rejects unsafe or malformed requests', () => {
    expect(() => parseSheetGenerationRequest({ ...base, outputDirectory: 'relative' })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, cardsPerSheet: 0 })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, sheetsPerFile: 501 })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, overwrite: 'delete' })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, records: [] })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, records: [{ rowNumber: 0, values: {} }] })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, records: [{ rowNumber: 4, values: { other: 'x' } }] })).toThrow()
    expect(() => parseSheetGenerationRequest({ ...base, templateId: '../x' })).toThrow()
  })
})

describe('control numbers and duplicates', () => {
  const grid = [
    ['CONTROL NO.', 'FULL NAME', 'BIRTHDATE', 'ADDRESS'],
    ['PL 000001', 'A,B', '', 'X'],
    ['PL 000002', 'C,D', '', 'Y'],
    ['PL 000002', 'E,F', '', 'Z'],
    ['', 'G,H', '', 'W'],
    ['pl 000001', 'I,J', '', 'V']
  ]
  it('flags a repeated control number once per repeat (case-insensitive), names the first row, and errors on a missing one', () => {
    const cols = buildColumns(grid, 0)
    const v = validateDataset(buildDataset(grid, 0, cols))
    const dup = v.issues.filter((i) => i.code === 'DUPLICATE_ID')
    expect(dup.map((i) => i.rowNumber)).toEqual([4, 6])
    expect(dup[0]!.message).toContain('row 3')
    expect(v.issues.filter((i) => i.code === 'MISSING_REQUIRED').map((i) => i.rowNumber)).toEqual([5])
    expect(v.recordsWithErrors).toBe(1)
  })
  it('keeps zero-padded control numbers exactly as typed', () => {
    const cols = buildColumns(grid, 0)
    const ds = buildDataset(grid, 0, cols)
    expect(ds.records[0]!.values['c0']).toBe('PL 000001')
  })
})
