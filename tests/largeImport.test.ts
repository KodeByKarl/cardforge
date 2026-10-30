import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildDataset } from '../src/shared/import/dataset'
import { buildColumns, detectHeaderRow } from '../src/shared/import/headers'
import { validateDataset } from '../src/shared/import/validate'
import { openWorkbook, readSheet } from '../src/main/services/excel/excelReader'
import { TMP_DIR, syntheticRow, writeSyntheticWorkbook } from './helpers/largeWorkbook'

const N = 40_900
const FILE = join(TMP_DIR, 'synthetic-40900.xlsx')
const DUPES = [100, 20_000]
const NO_NAME = [7]
const NO_ADDR = [9, 10]
const BLANK_AFTER = [50, 30_000]

describe('large dataset import (synthetic 40,900 records, header on row 3)', () => {
  const timings: Record<string, number> = {}
  const progress: [string, number, number][] = []
  let grid: string[][] = []
  let truncated = true

  beforeAll(async () => {
    await writeSyntheticWorkbook(FILE, { records: N, duplicateIdAt: DUPES, missingNameAt: NO_NAME, blankAddressAt: NO_ADDR, blankRowAfter: BLANK_AFTER })
    const info = await openWorkbook(FILE)
    expect(info.sheets[0]!.name).toBe('sample list')
    const t0 = performance.now()
    const data = await readSheet(FILE, 'sample list', (phase, done, total) => progress.push([phase, done, total]))
    timings['read'] = performance.now() - t0
    grid = data.rows
    truncated = data.truncated
  }, 180_000)

  it('reads every row without truncation and reports progress', () => {
    expect(truncated).toBe(false)
    // title row + 2 header-area rows + header + records + blank separator rows
    expect(grid.length).toBe(3 + N + BLANK_AFTER.length)
    const reading = progress.filter((p) => p[0] === 'reading')
    expect(reading.length).toBeGreaterThan(10)
    expect(reading.at(-1)![1]).toBe(reading.at(-1)![2])
  })

  it('finds the header on row 3 and builds sensible column defaults', () => {
    expect(detectHeaderRow(grid)).toBe(2)
    const cols = buildColumns(grid, 2)
    const byLabel = Object.fromEntries(cols.map((c) => [c.label, c]))
    expect(byLabel['CONTROL NO.']).toMatchObject({ required: true, unique: true, kind: 'text' })
    expect(byLabel['FULL NAME']).toMatchObject({ required: true })
    expect(byLabel['BIRTHDATE']!.required).toBe(false)
  })

  it('keeps every record exactly once with original Excel row numbers and control-number formatting', () => {
    const cols = buildColumns(grid, 2)
    const t0 = performance.now()
    const dataset = buildDataset(grid, 2, cols)
    timings['build'] = performance.now() - t0
    expect(dataset.records.length).toBe(N)
    const rows = dataset.records.map((r) => r.rowNumber)
    expect(new Set(rows).size).toBe(N)
    expect(rows).toEqual([...rows].sort((a, b) => a - b))
    const id = cols.find((c) => c.label === 'CONTROL NO.')!.key
    // Row numbers skip the two blank separator rows, so they are the real spreadsheet rows.
    expect(dataset.records[0]!.rowNumber).toBe(4)
    expect(dataset.records[0]!.values[id]).toBe(syntheticRow(0)[0])
    expect(dataset.records[51]!.rowNumber).toBe(4 + 51 + 1) // one blank row after record 50
    expect(dataset.records[N - 1]!.values[id]).toBe(syntheticRow(N - 1)[0])
    expect(dataset.skippedEmptyRows.length).toBe(BLANK_AFTER.length)
  })

  it('validates required fields, blank optionals and duplicate control numbers', () => {
    const cols = buildColumns(grid, 2)
    const dataset = buildDataset(grid, 2, cols)
    const t0 = performance.now()
    const v = validateDataset(dataset)
    timings['validate'] = performance.now() - t0
    const dupIssues = v.issues.filter((i) => i.code === 'DUPLICATE_ID')
    expect(dupIssues.length).toBe(DUPES.length)
    expect(v.issues.filter((i) => i.code === 'MISSING_REQUIRED').length).toBe(NO_NAME.length)
    expect(v.recordsWithErrors).toBe(NO_NAME.length)
    // Blank ADDRESS / BIRTHDATE are optional: no issue.
    expect(v.issues.some((i) => i.message.includes('ADDRESS'))).toBe(false)
    expect(v.totalRecords).toBe(N)
  })

  it('stays fast enough to run in the renderer without freezing it', () => {
    // Generous ceilings; the measured values are written to LARGE_BATCH_TEST_REPORT.md.
    console.info(`[perf] read=${timings['read']?.toFixed(0)}ms build=${timings['build']?.toFixed(0)}ms validate=${timings['validate']?.toFixed(0)}ms`)
    expect(timings['build']).toBeLessThan(2_000)
    expect(timings['validate']).toBeLessThan(3_000)
  })
})
