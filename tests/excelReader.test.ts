import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cellToString, openWorkbook, readSheet, trimGrid } from '../src/main/services/excel/excelReader'

const TMP = resolve(__dirname, '.tmp', 'excel')

async function writeXlsx(name: string, build: (wb: ExcelJS.Workbook) => void): Promise<string> {
  const wb = new ExcelJS.Workbook()
  build(wb)
  const path = join(TMP, name)
  await wb.xlsx.writeFile(path)
  return path
}

beforeAll(() => mkdirSync(TMP, { recursive: true }))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('excel reader', () => {
  it('lists visible worksheets only', async () => {
    const path = await writeXlsx('sheets.xlsx', (wb) => {
      wb.addWorksheet('Employees').addRow(['Full Name']).commit()
      wb.addWorksheet('Lookup', { state: 'hidden' }).addRow(['x'])
      wb.addWorksheet('Contractors').addRow(['Full Name'])
    })
    const info = await openWorkbook(path)
    expect(info.format).toBe('xlsx')
    expect(info.sheets.map((s) => s.name)).toEqual(['Employees', 'Contractors'])
  })

  it('reads typed cells as card-ready text', async () => {
    const path = await writeXlsx('types.xlsx', (wb) => {
      const ws = wb.addWorksheet('Data')
      ws.addRow(['Full Name', 'Mobile', 'Email', 'Joined', 'Code', 'Label'])
      const row = ws.addRow([
        { richText: [{ text: 'Ana ' }, { font: { bold: true }, text: 'Cruz' }] },
        9171234567,
        { text: 'ana@acme.ph', hyperlink: 'mailto:ana@acme.ph' },
        new Date(Date.UTC(2024, 0, 15)),
        { formula: '1+1', result: 2 },
        'plain'
      ])
      row.getCell(2).numFmt = '00000000000'
    })
    const sheet = await readSheet(path, 'Data')
    expect(sheet.rows[1]).toEqual(['Ana Cruz', '09171234567', 'ana@acme.ph', '2024-01-15', '2', 'plain'])
    expect(sheet.truncated).toBe(false)
  })

  it('does not copy merged-cell values into every merged cell', async () => {
    const path = await writeXlsx('merged.xlsx', (wb) => {
      const ws = wb.addWorksheet('Data')
      ws.addRow(['Full Name', 'Address', ''])
      ws.addRow(['Ana', 'Makati City', ''])
      ws.mergeCells('B2:C2')
    })
    const sheet = await readSheet(path, 'Data')
    expect(sheet.rows[1]).toEqual(['Ana', 'Makati City'])
  })

  it('reads an empty worksheet as an empty grid', async () => {
    const path = await writeXlsx('empty.xlsx', (wb) => {
      wb.addWorksheet('Blank')
    })
    const sheet = await readSheet(path, 'Blank')
    expect(sheet.rows).toEqual([])
  })

  it('rejects unknown sheet names', async () => {
    const path = await writeXlsx('one.xlsx', (wb) => {
      wb.addWorksheet('Data').addRow(['x'])
    })
    await expect(readSheet(path, 'Nope')).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' })
  })

  it('reads UTF-8 CSV and falls back to Windows-1252', async () => {
    const utf8 = join(TMP, 'utf8.csv')
    writeFileSync(utf8, '﻿Full Name,Email\r\nJosé Peña,jose@acme.ph\r\n', 'utf8')
    const ansi = join(TMP, 'ansi.csv')
    writeFileSync(ansi, Buffer.from([0x4e, 0x61, 0x6d, 0x65, 0x0d, 0x0a, 0x50, 0x65, 0xf1, 0x61])) // "Name\r\nPeña" in cp1252
    const info = await openWorkbook(utf8)
    expect(info.format).toBe('csv')
    expect((await readSheet(utf8, 'CSV')).rows[1]).toEqual(['José Peña', 'jose@acme.ph'])
    expect((await readSheet(ansi, 'CSV')).rows[1]).toEqual(['Peña'])
  })

  it('rejects unsupported formats, missing files, empty files and corrupt workbooks', async () => {
    await expect(openWorkbook(join(TMP, 'data.xls'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' })
    await expect(openWorkbook(join(TMP, 'notes.txt'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' })
    await expect(openWorkbook(join(TMP, 'missing.xlsx'))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(openWorkbook('relative.xlsx')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(openWorkbook(42)).rejects.toMatchObject({ code: 'INVALID_PATH' })

    const empty = join(TMP, 'empty-file.xlsx')
    writeFileSync(empty, '')
    await expect(openWorkbook(empty)).rejects.toMatchObject({ code: 'EMPTY_FILE' })

    const corrupt = join(TMP, 'corrupt.xlsx')
    writeFileSync(corrupt, 'this is not a zip file')
    await expect(openWorkbook(corrupt)).rejects.toMatchObject({ code: 'UNREADABLE_WORKBOOK' })
  })
})

describe('grid helpers', () => {
  it('trims trailing empty rows and columns and pads to a rectangle', () => {
    expect(trimGrid([['a', '', ''], ['b', 'c'], ['', ' '], []])).toEqual([
      ['a', ''],
      ['b', 'c']
    ])
  })

  it('formats large integers without exponent notation', () => {
    expect(cellToString(639171234567)).toBe('639171234567')
    expect(cellToString(null)).toBe('')
    expect(cellToString({ error: '#N/A' } as ExcelJS.CellErrorValue)).toBe('')
  })
})
