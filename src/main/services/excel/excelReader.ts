import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import ExcelJS from 'exceljs'
import type { CellGrid, SheetData, SheetSummary, SourceFormat, WorkbookInfo } from '../../../shared/types'
import { parseCsv } from '../../../shared/import/csv'
import { AppError } from '../../errors'
import { MAX_SPREADSHEET_BYTES, assertReadableFile, assertSafePath } from '../../paths'

export const SPREADSHEET_EXTENSIONS = ['.xlsx', '.csv'] as const
export const MAX_ROWS = 20_000
export const MAX_COLUMNS = 200

/**
 * Converts one ExcelJS cell value to the text an operator would expect on a card.
 * ExcelJS's own `cell.text` ignores number formats and prints dates via Date#toString, so we handle those here.
 */
export function cellToString(value: ExcelJS.CellValue, numFmt?: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return formatNumber(value, numFmt)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('')
    if ('error' in value) return ''
    if ('formula' in value || 'sharedFormula' in value) {
      return 'result' in value && value.result !== undefined ? cellToString(value.result as ExcelJS.CellValue, numFmt) : ''
    }
    if ('hyperlink' in value) {
      const text = (value as ExcelJS.CellHyperlinkValue).text as unknown
      if (typeof text === 'string') return text
      if (text && typeof text === 'object' && 'richText' in text) return cellToString(text as ExcelJS.CellRichTextValue)
      return (value as ExcelJS.CellHyperlinkValue).hyperlink
    }
  }
  return String(value)
}

function formatNumber(value: number, numFmt?: string): string {
  // Phone numbers stored as numbers with a zero-padded format (e.g. "00000000000") keep their leading zeros.
  if (numFmt && /^0+$/.test(numFmt) && Number.isInteger(value)) return String(value).padStart(numFmt.length, '0')
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toFixed(0)
  return String(value)
}

/** Drops trailing empty rows and columns and pads rows to a rectangle. */
export function trimGrid(rows: CellGrid): CellGrid {
  let lastRow = rows.length - 1
  while (lastRow >= 0 && (rows[lastRow] ?? []).every((c) => c.trim() === '')) lastRow--
  const kept = rows.slice(0, lastRow + 1)
  let width = 0
  for (const row of kept) {
    for (let c = row.length - 1; c >= 0; c--) {
      if ((row[c] ?? '').trim() !== '') {
        width = Math.max(width, c + 1)
        break
      }
    }
  }
  return kept.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
}

function formatOf(path: string): SourceFormat {
  return extname(path).toLowerCase() === '.csv' ? 'csv' : 'xlsx'
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // Excel's "CSV" (not "CSV UTF-8") export on Windows uses the ANSI code page.
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

async function loadWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(path)
  } catch (err) {
    throw new AppError(
      'UNREADABLE_WORKBOOK',
      'The file could not be read as an Excel workbook. It may be corrupt, password-protected, or an older .xls file saved with an .xlsx extension.',
      err
    )
  }
  return workbook
}

function readWorksheet(sheet: ExcelJS.Worksheet): { rows: CellGrid; truncated: boolean } {
  const rowCount = Math.min(sheet.rowCount, MAX_ROWS)
  const columnCount = Math.min(sheet.columnCount, MAX_COLUMNS)
  const rows: CellGrid = []
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r)
    const values: string[] = []
    for (let c = 1; c <= columnCount; c++) {
      const cell = row.getCell(c)
      // Merged cells report the master's value on every slave; keep it only on the master to avoid fake duplicates.
      values.push(cell.isMerged && cell.master !== cell ? '' : cellToString(cell.value, cell.numFmt))
    }
    rows.push(values)
  }
  return { rows: trimGrid(rows), truncated: sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS }
}

async function readCsv(path: string): Promise<{ rows: CellGrid; truncated: boolean }> {
  const all = parseCsv(decodeText(await readFile(path)))
  const truncated = all.length > MAX_ROWS || all.some((r) => r.length > MAX_COLUMNS)
  return { rows: trimGrid(all.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLUMNS))), truncated }
}

const CSV_SHEET_NAME = 'CSV'

export async function openWorkbook(untrustedPath: unknown): Promise<WorkbookInfo> {
  const path = assertSafePath(untrustedPath, SPREADSHEET_EXTENSIONS)
  const sizeBytes = await assertReadableFile(path, MAX_SPREADSHEET_BYTES)
  const format = formatOf(path)
  let sheets: SheetSummary[]
  if (format === 'csv') {
    const { rows } = await readCsv(path)
    sheets = [{ name: CSV_SHEET_NAME, rowCount: rows.length, columnCount: rows[0]?.length ?? 0 }]
  } else {
    const workbook = await loadWorkbook(path)
    sheets = workbook.worksheets
      .filter((ws) => ws.state === 'visible')
      .map((ws) => ({ name: ws.name, rowCount: ws.actualRowCount, columnCount: ws.actualColumnCount }))
    if (sheets.length === 0) throw new AppError('NO_SHEETS', 'The workbook has no visible worksheets.')
  }
  return { filePath: path, fileName: basename(path), format, sizeBytes, sheets }
}

export async function readSheet(untrustedPath: unknown, sheetName: unknown): Promise<SheetData> {
  const path = assertSafePath(untrustedPath, SPREADSHEET_EXTENSIONS)
  await assertReadableFile(path, MAX_SPREADSHEET_BYTES)
  if (typeof sheetName !== 'string') throw new AppError('INVALID_SHEET', 'No worksheet was selected.')
  if (formatOf(path) === 'csv') return { sheetName: CSV_SHEET_NAME, ...(await readCsv(path)) }

  const workbook = await loadWorkbook(path)
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) throw new AppError('SHEET_NOT_FOUND', `Worksheet "${sheetName}" was not found in the workbook.`)
  return { sheetName, ...readWorksheet(sheet) }
}
