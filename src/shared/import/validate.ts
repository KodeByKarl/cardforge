import type { ColumnConfig, Dataset, FieldKind, ValidationIssue, ValidationResult } from '../types'
import { isPlausibleEmail, isPlausiblePhone } from './normalize'

/**
 * Character counts above which a value is flagged for review. These are heuristics only;
 * real overflow depends on the template's frame size and font and is checked in the preview phase.
 */
export const LONG_VALUE_THRESHOLDS: Record<FieldKind, number> = {
  text: 45,
  email: 45,
  phone: 40,
  multiline: 160
}

export function validateDataset(dataset: Dataset): ValidationResult {
  const issues: ValidationIssue[] = []
  const included = dataset.columns.filter((c) => c.include)

  if (dataset.columns.length === 0) {
    issues.push({ severity: 'error', code: 'EMPTY_SHEET', message: 'The selected worksheet is empty.' })
  } else if (included.length === 0) {
    issues.push({ severity: 'error', code: 'NO_COLUMNS_INCLUDED', message: 'No columns are included. Include at least one column.' })
  } else if (dataset.records.length === 0) {
    issues.push({ severity: 'error', code: 'NO_DATA_ROWS', message: 'No data rows were found below the header row.' })
  }

  for (const record of dataset.records) {
    for (const column of included) {
      const value = record.values[column.key] ?? ''
      const at = { rowNumber: record.rowNumber, columnKey: column.key }
      if (value.length === 0) {
        if (column.required) {
          issues.push({ ...at, severity: 'error', code: 'MISSING_REQUIRED', message: `"${column.label}" is required but empty.` })
        }
        continue
      }
      if (column.kind === 'email' && !isPlausibleEmail(value)) {
        issues.push({ ...at, severity: 'warning', code: 'INVALID_EMAIL', message: `"${value}" does not look like an email address.` })
      }
      if (column.kind === 'phone' && !isPlausiblePhone(value)) {
        issues.push({ ...at, severity: 'warning', code: 'INVALID_PHONE', message: `"${value}" does not look like a phone number.` })
      }
      const longestLine = Math.max(...value.split('\n').map((l) => l.length))
      const limit = LONG_VALUE_THRESHOLDS[column.kind]
      if ((column.kind === 'multiline' ? value.length : longestLine) > limit) {
        issues.push({
          ...at,
          severity: 'warning',
          code: 'LONG_VALUE',
          message: `"${column.label}" is ${value.length} characters long and may not fit the card. Check it in the preview.`
        })
      }
    }
  }

  const duplicateGroups = findDuplicates(dataset, included, issues)

  const byRow = new Map<number, ValidationIssue[]>()
  for (const issue of issues) {
    if (issue.rowNumber === undefined) continue
    const list = byRow.get(issue.rowNumber) ?? []
    list.push(issue)
    byRow.set(issue.rowNumber, list)
  }

  let recordsWithErrors = 0
  let recordsWithWarnings = 0
  for (const record of dataset.records) {
    const rowIssues = byRow.get(record.rowNumber) ?? []
    if (rowIssues.some((i) => i.severity === 'error')) recordsWithErrors++
    else if (rowIssues.length > 0) recordsWithWarnings++
  }

  return {
    issues,
    byRow,
    totalRecords: dataset.records.length,
    validRecords: dataset.records.length - recordsWithErrors,
    recordsWithErrors,
    recordsWithWarnings,
    duplicateGroups
  }
}

/** Flags every record after the first that shares the duplicate key. Comparison ignores case. */
function findDuplicates(dataset: Dataset, included: ColumnConfig[], issues: ValidationIssue[]): number {
  const keyColumns = included.filter((c) => c.duplicateKey)
  if (keyColumns.length === 0) return 0

  const firstSeen = new Map<string, number>()
  const groups = new Set<string>()
  for (const record of dataset.records) {
    const parts = keyColumns.map((c) => (record.values[c.key] ?? '').toLowerCase())
    if (parts.every((p) => p.length === 0)) continue
    const key = parts.join('\u0000')
    const first = firstSeen.get(key)
    if (first === undefined) {
      firstSeen.set(key, record.rowNumber)
      continue
    }
    groups.add(key)
    issues.push({
      rowNumber: record.rowNumber,
      severity: 'warning',
      code: 'DUPLICATE_RECORD',
      message: `Duplicate of row ${first} (same ${keyColumns.map((c) => c.label).join(' + ')}).`
    })
  }
  return groups.size
}
