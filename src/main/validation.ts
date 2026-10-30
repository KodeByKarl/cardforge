import { isAbsolute } from 'node:path'
import type { SheetGenerationRequest } from '../shared/sheet/types'
import type { Bounds, GenerationRecordInput, GenerationRequest, PreviewRequest, ResolvedOverwrite, ShapeValues } from '../shared/template/types'
import { AppError } from './errors'

// Validators for untrusted IPC payloads. Each throws AppError('INVALID_ARGS') with an operator-readable message.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function invalid(message: string): never {
  throw new AppError('INVALID_ARGS', message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseId(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`Invalid ${what}.`)
  return value
}

function parseStringMap(value: unknown, what: string, maxKeys: number, maxValue: number): Record<string, string> {
  if (!isRecord(value)) invalid(`${what} must be an object.`)
  const entries = Object.entries(value)
  if (entries.length > maxKeys) invalid(`${what} has too many entries.`)
  const out: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > 300) invalid(`${what} has an invalid key.`)
    if (typeof v !== 'string' || v.length > maxValue) invalid(`${what}: value for “${k}” must be text up to ${maxValue} characters.`)
    out[k] = v
  }
  return out
}

export function parseShapeValues(value: unknown): ShapeValues {
  return parseStringMap(value, 'Values', 200, 4000)
}

export function parseRegions(value: unknown): Bounds[] {
  if (!Array.isArray(value) || value.length > 100) invalid('Invalid regions.')
  return value.map((r: unknown) => {
    if (!isRecord(r)) invalid('Invalid region.')
    const { left, bottom, right, top } = r
    if (![left, bottom, right, top].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10_000)) invalid('Invalid region.')
    return { left: left as number, bottom: bottom as number, right: right as number, top: top as number }
  })
}

export function parsePreviewRequest(value: unknown): PreviewRequest {
  if (!isRecord(value)) invalid('Preview request must be an object.')
  const dpi = value.dpi
  if (typeof dpi !== 'number' || !Number.isInteger(dpi) || dpi < 36 || dpi > 600) invalid('Preview resolution must be 36–600 dpi.')
  const pages = value.pages
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 20 || !pages.every((p) => Number.isInteger(p) && p >= 1)) {
    invalid('Preview pages must be a list of page numbers.')
  }
  const request: PreviewRequest = { templateId: parseId(value.templateId, 'template id'), values: parseShapeValues(value.values), dpi, pages: [...new Set(pages as number[])] }
  if (value.clearRegions !== undefined) {
    request.clearRegions = parseRegions(value.clearRegions)
    request.clearPage = typeof value.clearPage === 'number' && Number.isInteger(value.clearPage) && value.clearPage >= 1 ? value.clearPage : 1
  }
  return request
}

export const MAX_SHEET_RECORDS = 250_000

export function parseSheetGenerationRequest(value: unknown): SheetGenerationRequest {
  if (!isRecord(value)) invalid('Generation request must be an object.')
  const { outputDirectory, mode, cardsPerSheet, sheetsPerFile, exportPdf, clearEmpty, overwrite, columns, records, excludedRows } = value
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory) || outputDirectory.length > 400 || outputDirectory.includes('\0')) invalid('Choose a valid output folder.')
  const int = (v: unknown, min: number, max: number, what: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) invalid(`${what} must be a whole number from ${min} to ${max}.`)
    return v
  }
  if (mode !== 'unique' && mode !== 'copies') invalid('Choose the production mode: different records on every card, or copies of one record.')
  if (!['resume', 'skip', 'suffix', 'overwrite'].includes(overwrite as string)) invalid('Invalid overwrite choice.')
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 200) invalid('Invalid columns.')
  const cols = columns.map((c: unknown) => {
    if (!isRecord(c) || typeof c.key !== 'string' || typeof c.label !== 'string' || c.key.length > 20 || c.label.length > 200) invalid('Invalid column.')
    return { key: c.key, label: c.label }
  })
  if (!Array.isArray(records) || records.length === 0) invalid('There are no records to generate.')
  if (records.length > MAX_SHEET_RECORDS) invalid(`A job can contain at most ${MAX_SHEET_RECORDS} records.`)
  const keys = new Set(cols.map((c) => c.key))
  const parsed = records.map((r: unknown) => {
    if (!isRecord(r) || typeof r.rowNumber !== 'number' || !Number.isInteger(r.rowNumber) || r.rowNumber < 1) invalid('Invalid record.')
    if (!isRecord(r.values)) invalid('Invalid record values.')
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(r.values)) {
      if (!keys.has(k) || typeof v !== 'string' || v.length > 4000) invalid('Invalid record value.')
      values[k] = v
    }
    return { rowNumber: r.rowNumber, values }
  })
  const excluded = Array.isArray(excludedRows) ? excludedRows.filter((n): n is number => Number.isInteger(n)).slice(0, 100_000) : []
  return {
    templateId: parseId(value.templateId, 'template id'),
    outputDirectory,
    mode,
    cardsPerSheet: int(cardsPerSheet, 1, 100, 'Cards per sheet'),
    sheetsPerFile: int(sheetsPerFile, 1, 500, 'Sheets per file'),
    exportPdf: exportPdf === true,
    clearEmpty: clearEmpty !== false,
    overwrite: overwrite as SheetGenerationRequest['overwrite'],
    columns: cols,
    records: parsed,
    excludedRows: excluded
  }
}

const OVERWRITE: readonly ResolvedOverwrite[] = ['overwrite', 'skip', 'suffix']
export const MAX_BATCH = 5000

export function parseGenerationRequest(value: unknown): GenerationRequest {
  if (!isRecord(value)) invalid('Generation request must be an object.')
  const { outputDirectory, fileNamePattern, overwrite, records } = value
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory) || outputDirectory.length > 400 || outputDirectory.includes('\0')) {
    invalid('Choose a valid output folder.')
  }
  if (typeof fileNamePattern !== 'string' || fileNamePattern.trim().length === 0 || fileNamePattern.length > 200) invalid('Invalid file name pattern.')
  if (!OVERWRITE.includes(overwrite as ResolvedOverwrite)) invalid('Invalid overwrite choice.')
  if (!Array.isArray(records) || records.length === 0) invalid('There are no records to generate.')
  if (records.length > MAX_BATCH) invalid(`A batch can contain at most ${MAX_BATCH} records.`)
  const parsed: GenerationRecordInput[] = records.map((r: unknown) => {
    if (!isRecord(r) || typeof r.rowNumber !== 'number' || !Number.isInteger(r.rowNumber) || r.rowNumber < 1) invalid('Invalid record.')
    return { rowNumber: r.rowNumber, values: parseShapeValues(r.values), fields: parseStringMap(r.fields, 'Fields', 300, 4000) }
  })
  return {
    templateId: parseId(value.templateId, 'template id'),
    outputDirectory,
    fileNamePattern,
    overwrite: overwrite as ResolvedOverwrite,
    records: parsed
  }
}
