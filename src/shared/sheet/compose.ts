import type { ColumnConfig, ImportRecord } from '../types'
import type { Bounds, ShapeValues } from '../template/types'
import type { LineFill, SheetConfig, SheetMapping, SheetMappingIssue, SheetMode, SheetPlan, SheetRole } from './types'

// ---- Imposition: which records go on which sheet ----

export const MAX_CARDS_PER_SHEET = 100

/** Splits `total` records into consecutive sheets of `perSheet` cards; only the last sheet may be partly filled. */
export function planSheets(total: number, perSheet: number): SheetPlan {
  if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > MAX_CARDS_PER_SHEET) throw new RangeError(`Cards per sheet must be 1–${MAX_CARDS_PER_SHEET}.`)
  const sheets = []
  for (let first = 0, n = 1; first < total; first += perSheet, n++) sheets.push({ number: n, first, count: Math.min(perSheet, total - first) })
  return { perSheet, total, sheets }
}

/** Proves that every record appears on exactly one sheet, in order. Returns problems (empty = correct). */
export function verifyPlan(plan: SheetPlan): string[] {
  const problems: string[] = []
  let next = 0
  plan.sheets.forEach((s, i) => {
    if (s.number !== i + 1) problems.push(`Sheet ${i + 1} is numbered ${s.number}.`)
    if (s.first !== next) problems.push(`Sheet ${s.number} starts at record ${s.first} but ${next} was expected.`)
    if (s.count < 1 || s.count > plan.perSheet) problems.push(`Sheet ${s.number} holds ${s.count} cards.`)
    if (s.count < plan.perSheet && i !== plan.sheets.length - 1) problems.push(`Sheet ${s.number} is partly filled but is not the last sheet.`)
    next = s.first + s.count
  })
  if (next !== plan.total) problems.push(`${next} of ${plan.total} records are on a sheet.`)
  return problems
}

// ---- Text composition ----

const leadingSpace = (line: string) => /^[ \t]*/.exec(line)![0]

/** A value that must stay on one line: line breaks become spaces. */
function oneLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

/** The text of one role for one record. Leading padding of each template line is kept so values still line up with fixed labels. */
export function composeRoleText(role: SheetRole, fills: LineFill[] | undefined, record: ImportRecord, columnKeyByLabel: Map<string, string>): string {
  const lines = role.templateLines.map((tpl, i) => {
    const fill = fills?.[i] ?? { kind: 'blank' as const }
    if (fill.kind === 'keep') return tpl
    if (fill.kind === 'blank') return ''
    const key = columnKeyByLabel.get(fill.columnLabel)
    const value = key === undefined ? '' : oneLine(record.values[key] ?? '')
    return value.length > 0 ? leadingSpace(tpl) + value : ''
  })
  return lines.every((l) => l.trim().length === 0) ? '' : lines.join('\n')
}

/** The record shown in each card position of a sheet (index 0 = card 1). */
export function recordsForSheet(mode: SheetMode, cardsPerSheet: number, records: ImportRecord[], item: { first: number; count: number }): ImportRecord[] {
  if (mode === 'copies') return Array.from({ length: cardsPerSheet }, () => records[item.first]!)
  return records.slice(item.first, item.first + item.count)
}

export interface SheetValues {
  values: ShapeValues
  /** Card slices with no record on this sheet. Their artwork can be cleared. */
  emptyRegions: Bounds[]
  filled: number
}

/** Values for every object of the sheet: used cells get their record's text, unused cells are blanked. */
export function buildSheetValues(config: SheetConfig, mapping: SheetMapping, records: ImportRecord[], columns: ColumnConfig[]): SheetValues {
  const byLabel = new Map(columns.map((c) => [c.label, c.key]))
  const values: ShapeValues = {}
  const emptyRegions: Bounds[] = []
  for (const cell of config.cells) {
    const record = records[cell.index - 1]
    if (!record) emptyRegions.push(cell.region)
    for (const role of config.roles) {
      const name = cell.objects[role.id]
      if (!name) continue
      if (!record) {
        values[name] = ''
        continue
      }
      // Captions stay exactly as designed; everything else is composed from data (or blank).
      if (role.isLabel && isAllKeep(mapping.fields[role.id])) continue
      values[name] = composeRoleText(role, mapping.fields[role.id], record, byLabel)
    }
  }
  return { values, emptyRegions, filled: Math.min(records.length, config.cells.length) }
}

function isAllKeep(fills: LineFill[] | undefined): boolean {
  return !fills || fills.every((f) => f.kind === 'keep')
}

// ---- Suggestions: match template samples to spreadsheet columns by their shape ----

type LineClass = 'id' | 'name' | 'address' | 'date' | 'text' | 'empty'

export function classifyLine(line: string): LineClass {
  const t = line.trim()
  if (t.length === 0) return 'empty'
  if (/^[A-Za-z]{1,4}[ -]?\d{3,}$/.test(t) || /^\d{3,}$/.test(t)) return 'id'
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return 'date'
  const commas = (t.match(/,/g) ?? []).length
  if (commas >= 2) return 'address'
  if (commas === 1 && !/\d/.test(t)) return 'name'
  return 'text'
}

function classifyColumn(column: ColumnConfig, samples: string[]): LineClass {
  const l = column.label.toLowerCase()
  if (column.unique || /(control|ctrl)\s*(no|num|#)|\bid\b/.test(l)) return 'id'
  if (/birth|dob|date/.test(l)) return 'date'
  if (/address|addr|location/.test(l)) return 'address'
  if (/name/.test(l)) return 'name'
  const first = samples.find((s) => s.trim().length > 0)
  return first ? classifyLine(first) : 'text'
}

export function shapeOf(value: string): string {
  return value.replace(/\d/g, '9').replace(/\p{Lu}/gu, 'A').replace(/\p{Ll}/gu, 'a')
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n]! / Math.max(m, n)
}

function modalShape(samples: string[]): string {
  const counts = new Map<string, number>()
  for (const s of samples.slice(0, 200)) if (s.trim()) counts.set(shapeOf(s.trim()), (counts.get(shapeOf(s.trim())) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/**
 * Proposes, never imposes: each data line of each role is paired with the best-matching column (same kind of value,
 * most similar shape). Roles that look like captions are kept; anything without a match is left blank so that sample
 * text from the template can never be printed on every card by accident.
 */
export function suggestSheetMapping(config: SheetConfig, columns: ColumnConfig[], samplesByKey: Map<string, string[]>): SheetMapping {
  const cols = columns.filter((c) => c.include)
  const info = cols.map((c) => {
    const samples = samplesByKey.get(c.key) ?? []
    return { column: c, cls: classifyColumn(c, samples), shape: modalShape(samples) }
  })
  const slots: { roleId: string; line: number; text: string; cls: LineClass }[] = []
  for (const role of config.roles) {
    if (role.isLabel) continue
    role.templateLines.forEach((text, line) => {
      const cls = classifyLine(text)
      if (cls !== 'empty') slots.push({ roleId: role.id, line, text, cls })
    })
  }
  const candidates: { slot: number; col: number; score: number }[] = []
  slots.forEach((s, si) =>
    info.forEach((c, ci) => {
      if (c.cls !== s.cls) return
      candidates.push({ slot: si, col: ci, score: 2 + similarity(shapeOf(s.text.trim()), c.shape) })
    })
  )
  candidates.sort((a, b) => b.score - a.score)
  const slotTaken = new Set<number>()
  const colTaken = new Set<number>()
  const chosen = new Map<number, number>()
  for (const c of candidates) {
    if (slotTaken.has(c.slot) || colTaken.has(c.col)) continue
    slotTaken.add(c.slot)
    colTaken.add(c.col)
    chosen.set(c.slot, c.col)
  }

  const fields: SheetMapping['fields'] = {}
  for (const role of config.roles) {
    fields[role.id] = role.templateLines.map((text, line): LineFill => {
      if (role.isLabel || text.trim().length === 0) return { kind: 'keep' }
      const si = slots.findIndex((s) => s.roleId === role.id && s.line === line)
      const ci = chosen.get(si)
      return ci === undefined ? { kind: 'blank' } : { kind: 'column', columnLabel: info[ci]!.column.label }
    })
  }
  return { version: 1, fields, acknowledged: [] }
}

// ---- Checks ----

const prefixOf = (value: string) => /^[A-Za-z]+/.exec(value.trim())?.[0]?.toUpperCase() ?? null

/** If the template sample of an id-like line has a letter prefix different from the data's, return both. Never converts anything. */
export function prefixDiscrepancy(templateSample: string, columnSamples: string[]): { template: string; data: string[] } | null {
  if (classifyLine(templateSample) !== 'id') return null
  const t = prefixOf(templateSample)
  if (!t) return null
  const seen = new Set<string>()
  for (const s of columnSamples.slice(0, 500)) {
    const p = prefixOf(s)
    if (p) seen.add(p)
  }
  return seen.size > 0 && !seen.has(t) ? { template: t, data: [...seen].sort() } : null
}

/** Problems with the current mapping against the loaded spreadsheet. Errors block generation. */
export function sheetMappingIssues(config: SheetConfig, mapping: SheetMapping | null, columns: ColumnConfig[], samplesByKey: Map<string, string[]>): SheetMappingIssue[] {
  const issues: SheetMappingIssue[] = []
  if (!config.preparedAt) issues.push({ severity: 'error', code: 'NOT_PREPARED', message: 'The template has not been prepared yet: the objects on the sheet are still unnamed.' })
  for (const w of config.warnings) issues.push({ severity: 'warning', code: 'GRID_WARNING', message: w })
  if (!mapping) {
    issues.push({ severity: 'error', code: 'NO_MAPPING', message: 'Map the template fields to spreadsheet columns first.' })
    return issues
  }
  const byLabel = new Map(columns.filter((c) => c.include).map((c) => [c.label, c]))
  for (const role of config.roles) {
    const fills = mapping.fields[role.id]
    role.templateLines.forEach((line, i) => {
      if (line.trim().length === 0) return
      const fill = fills?.[i]
      if (fill?.kind === 'column') {
        const col = byLabel.get(fill.columnLabel)
        if (!col) issues.push({ severity: 'error', code: 'MISSING_COLUMN', roleId: role.id, message: `${role.label}: column “${fill.columnLabel}” is not in the current spreadsheet.` })
        else {
          const d = prefixDiscrepancy(line, samplesByKey.get(col.key) ?? [])
          if (d && !mapping.acknowledged.includes('prefix')) {
            issues.push({
              severity: 'error',
              code: 'PREFIX_UNCONFIRMED',
              roleId: role.id,
              message: `The template sample uses the prefix “${d.template}” but the spreadsheet uses ${d.data.map((p) => `“${p}”`).join(', ')}. The system does not convert prefixes. Confirm the correct one with the client.`
            })
          }
        }
      } else if (fill?.kind === 'keep' && !role.isLabel) {
        issues.push({ severity: 'warning', code: 'KEEP_SAMPLE_TEXT', roleId: role.id, message: `${role.label}: the template’s sample text would be printed on every card.` })
      } else if ((!fill || fill.kind === 'blank') && !role.isLabel) {
        issues.push({ severity: 'warning', code: 'UNMAPPED_FIELD', roleId: role.id, message: `${role.label}: not mapped, it will print blank.` })
      }
    })
  }
  return issues
}

export const hasBlockingSheetIssues = (issues: SheetMappingIssue[]) => issues.some((i) => i.severity === 'error')

/** Strict parse of a stored/received mapping; unknown keys are dropped and every entry is validated. */
export function parseSheetMapping(input: unknown): SheetMapping {
  if (typeof input !== 'object' || input === null) throw new Error('The sheet mapping is not an object.')
  const raw = input as { fields?: unknown; acknowledged?: unknown }
  if (typeof raw.fields !== 'object' || raw.fields === null) throw new Error('The sheet mapping has no fields.')
  const fields: SheetMapping['fields'] = {}
  for (const [roleId, lines] of Object.entries(raw.fields as Record<string, unknown>)) {
    if (!/^f\d{1,3}$/.test(roleId) || !Array.isArray(lines) || lines.length > 50) throw new Error(`Invalid mapping for ${roleId}.`)
    fields[roleId] = lines.map((l): LineFill => {
      const e = l as { kind?: unknown; columnLabel?: unknown }
      if (e?.kind === 'keep' || e?.kind === 'blank') return { kind: e.kind }
      if (e?.kind === 'column' && typeof e.columnLabel === 'string' && e.columnLabel.length > 0 && e.columnLabel.length <= 200) return { kind: 'column', columnLabel: e.columnLabel }
      throw new Error(`Invalid mapping entry for ${roleId}.`)
    })
  }
  const acknowledged = Array.isArray(raw.acknowledged) ? raw.acknowledged.filter((a): a is string => a === 'prefix') : []
  return { version: 1, fields, acknowledged }
}

/** Text that extends beyond the card position it belongs to (it would overlap a neighbouring card or the sheet edge). */
export function cellExtentIssues(config: SheetConfig, objects: { name: string; bounds: Bounds }[], toleranceMm = 0.5): { cell: number; roleId: string; message: string }[] {
  const out: { cell: number; roleId: string; message: string }[] = []
  for (const o of objects) {
    const m = /^C(\d+)_(f\d+)$/.exec(o.name)
    if (!m) continue
    const cell = config.cells.find((c) => c.index === Number(m[1]))
    if (!cell) continue
    const r = cell.region
    const b = o.bounds
    if (b.left < r.left - toleranceMm || b.right > r.right + toleranceMm || b.top > r.top + toleranceMm || b.bottom < r.bottom - toleranceMm) {
      out.push({ cell: cell.index, roleId: m[2]!, message: 'text extends beyond its card position' })
    }
  }
  return out
}
