import type { ColumnConfig, Dataset, ImportRecord, ValidationResult } from '../types'
import type { GenerationRecordInput, MappingEntry, SavedMapping, ShapeValues, TemplateObject } from './types'

/** Lowercase letters and digits only, so "Full Name", "full_name" and "FullName" compare equal. */
export function mappingKey(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

// Groups of names that mean the same field on a calling card.
const SYNONYMS: string[][] = [
  ['fullname', 'name', 'employeename', 'completename', 'employee'],
  ['jobtitle', 'title', 'position', 'designation', 'role'],
  ['company', 'companyname', 'organization', 'organisation', 'employer'],
  ['mobile', 'mobilenumber', 'mobileno', 'cellphone', 'cell', 'cellular', 'mobilephone', 'cp', 'cpno'],
  ['telephone', 'telephonenumber', 'tel', 'telno', 'phone', 'phonenumber', 'landline', 'officephone', 'office'],
  ['email', 'emailaddress', 'mail'],
  ['address', 'officeaddress', 'location'],
  ['department', 'dept'],
  ['website', 'web', 'url']
]

function synonymGroup(key: string): string[] | undefined {
  return SYNONYMS.find((g) => g.includes(key))
}

/** Unique object names in template order (one name may label several objects, e.g. front and back). */
export function objectNames(objects: TemplateObject[]): string[] {
  return [...new Set(objects.map((o) => o.name))]
}

/** Proposes a mapping by matching object names to column headers (exact key, then synonyms). */
export function suggestMapping(objects: TemplateObject[], columns: ColumnConfig[]): SavedMapping {
  const included = columns.filter((c) => c.include)
  const entries: Record<string, MappingEntry> = {}
  for (const name of objectNames(objects)) {
    const key = mappingKey(name)
    let column = included.find((c) => mappingKey(c.label) === key)
    if (!column) {
      const group = synonymGroup(key)
      if (group) column = included.find((c) => group.includes(mappingKey(c.label)))
    }
    entries[name] = column ? { kind: 'column', columnLabel: column.label } : { kind: 'keep' }
  }
  return { version: 1, entries }
}

export type ResolvedEntry = { kind: 'column'; column: ColumnConfig } | { kind: 'blank' } | { kind: 'keep' } | { kind: 'missing'; columnLabel: string }

/** Finds a column by label: exact first, then ignoring case/spacing. Excluded columns don't count. */
export function findColumn(columns: ColumnConfig[], label: string): ColumnConfig | undefined {
  const included = columns.filter((c) => c.include)
  return included.find((c) => c.label === label) ?? included.find((c) => mappingKey(c.label) === mappingKey(label))
}

export function resolveMapping(mapping: SavedMapping | null, objects: TemplateObject[], columns: ColumnConfig[]): Map<string, ResolvedEntry> {
  const resolved = new Map<string, ResolvedEntry>()
  for (const name of objectNames(objects)) {
    const entry = mapping?.entries[name] ?? { kind: 'keep' }
    if (entry.kind !== 'column') {
      resolved.set(name, entry)
      continue
    }
    const column = findColumn(columns, entry.columnLabel)
    resolved.set(name, column ? { kind: 'column', column } : { kind: 'missing', columnLabel: entry.columnLabel })
  }
  return resolved
}

export interface MappingIssue {
  objectName: string | null
  severity: 'error' | 'warning'
  message: string
}

export function mappingIssues(objects: TemplateObject[], mapping: SavedMapping | null, columns: ColumnConfig[]): MappingIssue[] {
  const issues: MappingIssue[] = []
  if (objects.length === 0) {
    issues.push({
      objectName: null,
      severity: 'error',
      message: 'The template has no named text objects. Name the variable text objects in CorelDRAW’s Object Manager, then re-inspect.'
    })
    return issues
  }
  const resolved = resolveMapping(mapping, objects, columns)
  for (const [name, entry] of resolved) {
    const obj = objects.find((o) => o.name === name)!
    if (entry.kind === 'keep') {
      issues.push({ objectName: name, severity: 'warning', message: `Not mapped: the template text “${obj.text}” will appear on every card.` })
    } else if (entry.kind === 'missing') {
      issues.push({ objectName: name, severity: 'error', message: `Column “${entry.columnLabel}” is not in the imported sheet (or is excluded).` })
    } else if (entry.kind === 'column' && objects.some((o) => o.name === name && o.mixedFormatting)) {
      issues.push({
        objectName: name,
        severity: 'warning',
        message: 'This object has mixed formatting (e.g. one bold word). Replacing its text applies a single formatting to the whole object.'
      })
    }
  }
  const names = new Set(objectNames(objects))
  for (const name of Object.keys(mapping?.entries ?? {})) {
    if (!names.has(name)) issues.push({ objectName: name, severity: 'warning', message: `The saved mapping refers to “${name}”, which is no longer in the template.` })
  }
  return issues
}

/** Text for each mapped object for one record. "keep" objects are omitted so the template text stays untouched. */
export function shapeValuesFor(record: ImportRecord, resolved: Map<string, ResolvedEntry>): ShapeValues {
  const values: ShapeValues = {}
  for (const [name, entry] of resolved) {
    if (entry.kind === 'column') values[name] = record.values[entry.column.key] ?? ''
    else if (entry.kind === 'blank') values[name] = ''
  }
  return values
}

/** Mapped objects that will be blank for this record. */
export function missingFieldsFor(record: ImportRecord, resolved: Map<string, ResolvedEntry>): { objectName: string; columnLabel: string }[] {
  const missing: { objectName: string; columnLabel: string }[] = []
  for (const [name, entry] of resolved) {
    if (entry.kind === 'column' && !(record.values[entry.column.key] ?? '')) missing.push({ objectName: name, columnLabel: entry.column.label })
  }
  return missing
}

export function hasBlockingMappingIssues(issues: MappingIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

/** Records eligible for generation: rows with validation errors are excluded and reported. */
export function buildGenerationInputs(
  dataset: Dataset,
  validation: ValidationResult,
  resolved: Map<string, ResolvedEntry>
): { records: GenerationRecordInput[]; excluded: { rowNumber: number; reason: string }[] } {
  const included = dataset.columns.filter((c) => c.include)
  const records: GenerationRecordInput[] = []
  const excluded: { rowNumber: number; reason: string }[] = []
  for (const record of dataset.records) {
    const errors = (validation.byRow.get(record.rowNumber) ?? []).filter((i) => i.severity === 'error')
    if (errors.length > 0) {
      excluded.push({ rowNumber: record.rowNumber, reason: errors.map((e) => e.message).join(' ') })
      continue
    }
    const fields: Record<string, string> = {}
    for (const c of included) fields[c.label] = record.values[c.key] ?? ''
    records.push({ rowNumber: record.rowNumber, values: shapeValuesFor(record, resolved), fields })
  }
  return { records, excluded }
}

/** Validates an untrusted mapping (from IPC or disk). */
export function parseSavedMapping(input: unknown): SavedMapping {
  if (typeof input !== 'object' || input === null) throw new Error('Mapping must be an object.')
  const raw = input as { version?: unknown; entries?: unknown }
  if (raw.version !== 1 || typeof raw.entries !== 'object' || raw.entries === null) throw new Error('Unsupported mapping format.')
  const entries: Record<string, MappingEntry> = {}
  const list = Object.entries(raw.entries as Record<string, unknown>)
  if (list.length > 500) throw new Error('Too many mapping entries.')
  for (const [name, value] of list) {
    if (name.length === 0 || name.length > 200) throw new Error('Invalid object name in mapping.')
    const e = value as { kind?: unknown; columnLabel?: unknown }
    if (e?.kind === 'keep' || e?.kind === 'blank') entries[name] = { kind: e.kind }
    else if (e?.kind === 'column' && typeof e.columnLabel === 'string' && e.columnLabel.length > 0 && e.columnLabel.length <= 300) {
      entries[name] = { kind: 'column', columnLabel: e.columnLabel }
    } else throw new Error(`Invalid mapping entry for “${name}”.`)
  }
  return { version: 1, entries }
}

/** Object names in reading order: by page, then top to bottom, then left to right (CorelDRAW lists them by stacking order). */
export function objectNamesByPosition(objects: TemplateObject[]): string[] {
  const sorted = [...objects].sort((a, b) => a.pageIndex - b.pageIndex || b.bounds.top - a.bounds.top || a.bounds.left - b.bounds.left)
  return objectNames(sorted)
}
