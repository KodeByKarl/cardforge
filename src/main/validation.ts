import { isAbsolute } from 'node:path'
import type { GenerationRecordInput, GenerationRequest, PreviewRequest, ResolvedOverwrite, ShapeValues } from '../shared/template/types'
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

export function parsePreviewRequest(value: unknown): PreviewRequest {
  if (!isRecord(value)) invalid('Preview request must be an object.')
  const dpi = value.dpi
  if (typeof dpi !== 'number' || !Number.isInteger(dpi) || dpi < 36 || dpi > 600) invalid('Preview resolution must be 36–600 dpi.')
  const pages = value.pages
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 20 || !pages.every((p) => Number.isInteger(p) && p >= 1)) {
    invalid('Preview pages must be a list of page numbers.')
  }
  return { templateId: parseId(value.templateId, 'template id'), values: parseShapeValues(value.values), dpi, pages: [...new Set(pages as number[])] }
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
