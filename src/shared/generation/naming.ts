import type { GenerationRecordInput } from '../template/types'

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Produces a Windows-safe file name stem (no extension) from arbitrary record text. */
export function sanitizeFileName(input: string, fallback = 'card'): string {
  let name = input
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (name.length > 120) name = name.slice(0, 120).trim()
  if (name.length === 0) name = fallback
  if (RESERVED_NAMES.test(name)) name = `_${name}`
  return name
}

/**
 * Expands a file name pattern. Tokens: {row} = spreadsheet row number, {col:Header} = that column's value
 * (header matched ignoring case). Unknown columns expand to nothing. The result is sanitised.
 */
export function renderFileName(pattern: string, record: Pick<GenerationRecordInput, 'rowNumber' | 'fields'>): string {
  const lookup = new Map(Object.entries(record.fields).map(([k, v]) => [k.trim().toLowerCase(), v]))
  const raw = pattern
    .replace(/\{row\}/gi, String(record.rowNumber))
    .replace(/\{col:([^}]+)\}/gi, (_m, label: string) => lookup.get(label.trim().toLowerCase()) ?? '')
    // Separators left dangling by empty tokens, e.g. "12 - " when the name is blank.
    .replace(/^[\s\-_.]+|[\s\-_]+$/g, '')
  return sanitizeFileName(raw, `row ${record.rowNumber}`)
}

/** File names for a batch; repeated names within the batch get " (2)", " (3)"… */
export function planFileNames(records: Pick<GenerationRecordInput, 'rowNumber' | 'fields'>[], pattern: string): string[] {
  const used = new Map<string, number>()
  return records.map((r) => {
    const stem = renderFileName(pattern, r)
    const key = stem.toLowerCase()
    const count = (used.get(key) ?? 0) + 1
    used.set(key, count)
    return count === 1 ? `${stem}.cdr` : `${stem} (${count}).cdr`
  })
}
