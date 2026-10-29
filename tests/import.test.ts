import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from '../src/shared/import/csv'
import { buildDataset } from '../src/shared/import/dataset'
import { buildColumns, columnLetter, detectHeaderRow, guessFieldKind } from '../src/shared/import/headers'
import { isPlausibleEmail, isPlausiblePhone, normalizeMultiline, normalizeText, normalizeValue } from '../src/shared/import/normalize'
import { validateDataset } from '../src/shared/import/validate'
import type { CellGrid } from '../src/shared/types'

const HEADERS = ['Full Name', 'Job Title', 'Company', 'Mobile Number', 'Telephone Number', 'Email', 'Address']

function load(grid: CellGrid) {
  const header = detectHeaderRow(grid)
  const columns = buildColumns(grid, header)
  const dataset = buildDataset(grid, header, columns)
  return { header, columns, dataset, result: validateDataset(dataset) }
}

describe('csv', () => {
  it('parses quoted fields, escaped quotes, embedded newlines and CRLF', () => {
    const text = 'Name,Address\r\n"Cruz, Ana","Unit 5\nMakati"\r\n"He said ""hi""",x\r\n'
    expect(parseCsv(text)).toEqual([
      ['Name', 'Address'],
      ['Cruz, Ana', 'Unit 5\nMakati'],
      ['He said "hi"', 'x']
    ])
  })

  it('strips a UTF-8 BOM and detects semicolon and tab delimiters', () => {
    expect(parseCsv('﻿a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('"x;y",b,c')).toBe(',')
  })

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,\n1,,')).toEqual([
      ['a', 'b', ''],
      ['1', '', '']
    ])
  })
})

describe('normalize', () => {
  it('trims, collapses spaces and removes invisible characters', () => {
    expect(normalizeText('  Ana ​  Cruz\t ')).toBe('Ana Cruz')
  })

  it('NFC-normalises accented characters so duplicates compare equal', () => {
    expect(normalizeText('Peña')).toBe('Peña')
  })

  it('keeps meaningful line breaks in multiline fields', () => {
    expect(normalizeMultiline(' Unit 5 \r\n\r\n  Makati City ')).toBe('Unit 5\nMakati City')
  })

  it('lowercases emails and strips mailto:', () => {
    expect(normalizeValue(' MAILTO:Ana.Cruz@Example.COM ', 'email')).toBe('ana.cruz@example.com')
  })

  it('never reformats phone digits', () => {
    expect(normalizeValue('+63 (917) 123-4567\n02 8123 4567', 'phone')).toBe('+63 (917) 123-4567 / 02 8123 4567')
  })

  it('validates plausible emails and phones', () => {
    expect(isPlausibleEmail('ana@example.com')).toBe(true)
    expect(isPlausibleEmail('ana@example')).toBe(false)
    expect(isPlausibleEmail('ana example.com')).toBe(false)
    expect(isPlausiblePhone('+63 917 123 4567')).toBe(true)
    expect(isPlausiblePhone('(02) 8123-4567 loc. 204')).toBe(true)
    expect(isPlausiblePhone('call me')).toBe(false)
    expect(isPlausiblePhone('123')).toBe(false)
  })
})

describe('headers', () => {
  it('detects headers below a title row and blank rows', () => {
    const grid: CellGrid = [
      ['Employee Calling Cards 2026', '', ''],
      ['', '', ''],
      ['Full Name', 'Email', 'Mobile'],
      ['Ana Cruz', 'ana@example.com', '0917 123 4567']
    ]
    expect(detectHeaderRow(grid)).toBe(2)
  })

  it('returns -1 for an empty grid', () => {
    expect(detectHeaderRow([])).toBe(-1)
    expect(detectHeaderRow([['', '']])).toBe(-1)
  })

  it('names blank headers by column letter and de-duplicates repeats', () => {
    const columns = buildColumns([['Name', '', 'Phone', 'phone']], 0)
    expect(columns.map((c) => c.label)).toEqual(['Name', 'Column B', 'Phone', 'phone (2)'])
    expect(columns[1]!.include).toBe(false)
  })

  it('guesses field kinds from header text without hardcoding a fixed set', () => {
    expect(guessFieldKind('E-mail Address')).toBe('email')
    expect(guessFieldKind('Mobile Number')).toBe('phone')
    expect(guessFieldKind('Office Address')).toBe('multiline')
    expect(guessFieldKind('Department')).toBe('text')
  })

  it('converts column indexes to letters', () => {
    expect([0, 25, 26, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA'])
  })
})

describe('dataset + validation', () => {
  it('imports a valid sheet with no issues', () => {
    const { header, dataset, result } = load([
      HEADERS,
      ['Ana Cruz', 'Manager', 'Acme', '0917 123 4567', '(02) 8123 4567', 'ana@acme.ph', 'Makati'],
      ['Ben Santos', 'Engineer', 'Acme', '0918 555 0000', '', 'ben@acme.ph', 'Taguig']
    ])
    expect(header).toBe(0)
    expect(dataset.records.map((r) => r.rowNumber)).toEqual([2, 3])
    expect(result.issues).toEqual([])
    expect(result.validRecords).toBe(2)
  })

  it('reports an empty sheet as an error', () => {
    const { result } = load([])
    expect(result.issues.map((i) => i.code)).toEqual(['EMPTY_SHEET'])
  })

  it('reports a header-only sheet as having no data rows', () => {
    const { result } = load([HEADERS])
    expect(result.issues.map((i) => i.code)).toEqual(['NO_DATA_ROWS'])
  })

  it('flags missing required values with the spreadsheet row number', () => {
    const { result } = load([
      ['Full Name', 'Email'],
      ['', 'x@acme.ph'],
      ['Ana', 'ana@acme.ph']
    ])
    expect(result.recordsWithErrors).toBe(1)
    expect(result.byRow.get(2)?.[0]?.code).toBe('MISSING_REQUIRED')
  })

  it('treats a missing (absent) column as empty cells, not a crash', () => {
    const grid: CellGrid = [['Full Name', 'Email'], ['Ana']]
    const { dataset, result } = load(grid)
    expect(dataset.records[0]!.values['c1']).toBe('')
    expect(result.recordsWithErrors).toBe(0)
  })

  it('warns on duplicates (case-insensitive) and points at the first occurrence', () => {
    const { result } = load([
      ['Full Name', 'Email', 'Title'],
      ['Ana Cruz', 'ana@acme.ph', 'Manager'],
      ['ANA CRUZ', 'Ana@Acme.ph', 'Director'],
      ['Ben', 'ben@acme.ph', 'Engineer']
    ])
    const dup = result.issues.filter((i) => i.code === 'DUPLICATE_RECORD')
    expect(dup).toHaveLength(1)
    expect(dup[0]!.rowNumber).toBe(3)
    expect(dup[0]!.message).toContain('row 2')
    expect(result.duplicateGroups).toBe(1)
  })

  it('warns about long names without rejecting them', () => {
    const longName = 'Maria Concepcion Josefina Dela Cruz-Villanueva Santos III'
    const { result } = load([['Full Name'], [longName]])
    expect(result.issues.map((i) => i.code)).toEqual(['LONG_VALUE'])
    expect(result.validRecords).toBe(1)
  })

  it('preserves special characters exactly', () => {
    const name = 'José Peña-Ñuñez & Söhne <O\'Brien> “Ana” 王小明'
    const { dataset, result } = load([['Full Name'], [name]])
    expect(dataset.records[0]!.values['c0']).toBe(name)
    expect(result.issues).toEqual([])
  })

  it('skips blank rows between records and reports them, but ignores trailing blanks', () => {
    const { dataset } = load([['Full Name'], ['Ana'], [''], ['Ben'], [''], ['']])
    expect(dataset.records.map((r) => r.rowNumber)).toEqual([2, 4])
    expect(dataset.skippedEmptyRows).toEqual([3])
  })

  it('flags invalid emails and phones as warnings', () => {
    const { result } = load([
      ['Full Name', 'Email', 'Mobile'],
      ['Ana', 'ana.acme.ph', 'n/a']
    ])
    expect(result.issues.map((i) => i.code).sort()).toEqual(['INVALID_EMAIL', 'INVALID_PHONE'])
    expect(result.recordsWithWarnings).toBe(1)
  })

  it('errors when every column is excluded', () => {
    const grid: CellGrid = [['Full Name'], ['Ana']]
    const columns = buildColumns(grid, 0).map((c) => ({ ...c, include: false }))
    const result = validateDataset(buildDataset(grid, 0, columns))
    expect(result.issues.map((i) => i.code)).toEqual(['NO_COLUMNS_INCLUDED'])
  })

  it('handles a 500-record batch quickly', () => {
    const grid: CellGrid = [HEADERS]
    for (let i = 0; i < 500; i++) grid.push([`Person ${i}`, 'Staff', 'Acme', '0917 000 0000', '', `p${i}@acme.ph`, 'Makati'])
    const started = performance.now()
    const { result } = load(grid)
    expect(result.totalRecords).toBe(500)
    expect(result.issues).toEqual([])
    expect(performance.now() - started).toBeLessThan(500)
  })
})
