import type { CellGrid, ColumnConfig, Dataset, ImportRecord } from '../types'
import { normalizeValue } from './normalize'

/**
 * Converts the rows below the header into normalised records for the included columns.
 * Rows with no content in any included column are skipped and reported, not silently dropped.
 */
export function buildDataset(grid: CellGrid, headerRowIndex: number, columns: ColumnConfig[]): Dataset {
  const included = columns.filter((c) => c.include)
  const records: ImportRecord[] = []
  const skippedEmptyRows: number[] = []

  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const row = grid[i] ?? []
    const values: Record<string, string> = {}
    let hasContent = false
    for (const column of included) {
      const value = normalizeValue(row[column.index] ?? '', column.kind)
      values[column.key] = value
      if (value.length > 0) hasContent = true
    }
    if (hasContent) records.push({ rowNumber: i + 1, values })
    else skippedEmptyRows.push(i + 1)
  }

  // Blank rows after the last record are just the end of the sheet, not something to report.
  const lastRecordRow = records.at(-1)?.rowNumber ?? 0
  return { columns, records, skippedEmptyRows: skippedEmptyRows.filter((r) => r < lastRecordRow) }
}
