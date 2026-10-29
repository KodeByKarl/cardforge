import type { CellGrid } from '../types'

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const

/**
 * Picks the delimiter that splits the first line into the most fields.
 * Quoted sections are ignored so commas inside "Makati, Metro Manila" don't count.
 */
export function detectDelimiter(text: string): string {
  const firstLine = firstLogicalLine(text)
  let best: string = ','
  let bestCount = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    let count = 0
    let inQuotes = false
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes
      else if (!inQuotes && ch === delimiter) count++
    }
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

function firstLogicalLine(text: string): string {
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) return text.slice(0, i)
  }
  return text
}

/** RFC 4180 parser: quoted fields, escaped quotes (""), CRLF/LF, newlines inside quotes. */
export function parseCsv(input: string, delimiter = detectDelimiter(input)): CellGrid {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: CellGrid = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        field += ch
      }
      i++
      continue
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (ch === '\r' && text[i + 1] === '\n') i++
    } else {
      field += ch
    }
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
