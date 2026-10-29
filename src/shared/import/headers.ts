import type { CellGrid, ColumnConfig, FieldKind } from '../types'
import { normalizeText } from './normalize'

const HEADER_SCAN_ROWS = 20

function looksLikeData(value: string): boolean {
  return /^[\d\s+()./-]+$/.test(value) || value.includes('@')
}

/**
 * Finds the most likely header row in the first rows of a sheet.
 * Real client sheets often start with a title ("Employee List 2026") or blank rows above the headers,
 * so we score each row: wide, all-text, unique values win; rows that look like data lose.
 * Returns -1 for an empty grid. The user can always override the choice in the UI.
 */
export function detectHeaderRow(grid: CellGrid): number {
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS)
  const width = Math.max(0, ...grid.slice(0, limit).map(nonEmptyCount))
  if (width === 0) return -1

  let bestIndex = -1
  let bestScore = -Infinity
  for (let i = 0; i < limit; i++) {
    const cells = (grid[i] ?? []).map(normalizeText).filter((c) => c.length > 0)
    if (cells.length < Math.min(2, width)) continue
    const unique = new Set(cells.map((c) => c.toLowerCase())).size
    const dataLike = cells.filter(looksLikeData).length
    const score = cells.length / width + unique / cells.length - (dataLike / cells.length) * 2 - i * 0.01
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }
  return bestIndex === -1 ? firstNonEmptyRow(grid) : bestIndex
}

function nonEmptyCount(row: string[]): number {
  return row.filter((c) => normalizeText(c).length > 0).length
}

function firstNonEmptyRow(grid: CellGrid): number {
  return grid.findIndex((row) => nonEmptyCount(row) > 0)
}

export function columnLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

export function guessFieldKind(label: string): FieldKind {
  const l = label.toLowerCase()
  if (/e-?mail/.test(l)) return 'email'
  if (/(phone|mobile|cell|tel|fax|landline|contact\s*no|number)/.test(l)) return 'phone'
  if (/(address|addr|location)/.test(l)) return 'multiline'
  return 'text'
}

function isNameColumn(label: string): boolean {
  return /\bname\b/i.test(label)
}

/**
 * Builds column configs from the header row. Blank headers become "Column C";
 * repeated headers get a numeric suffix so every label is unique.
 */
export function buildColumns(grid: CellGrid, headerRowIndex: number): ColumnConfig[] {
  const width = Math.max(0, ...grid.map((r) => r.length))
  const header = headerRowIndex >= 0 ? (grid[headerRowIndex] ?? []) : []
  const seen = new Map<string, number>()
  const columns: ColumnConfig[] = []

  for (let index = 0; index < width; index++) {
    const raw = normalizeText(header[index] ?? '')
    let label = raw.length > 0 ? raw : `Column ${columnLetter(index)}`
    const count = (seen.get(label.toLowerCase()) ?? 0) + 1
    seen.set(label.toLowerCase(), count)
    if (count > 1) label = `${label} (${count})`
    const kind = guessFieldKind(label)
    columns.push({
      key: `c${index}`,
      label,
      index,
      kind,
      include: raw.length > 0,
      required: false,
      duplicateKey: false
    })
  }

  // Default duplicate key: name + email columns when present, otherwise every included column.
  const keyed = columns.filter((c) => c.include && (isNameColumn(c.label) || c.kind === 'email'))
  for (const c of keyed.length > 0 ? keyed : columns.filter((c) => c.include)) c.duplicateKey = true
  // A name column is almost always mandatory on a calling card.
  const nameColumn = columns.find((c) => c.include && isNameColumn(c.label))
  if (nameColumn) nameColumn.required = true

  return columns
}
