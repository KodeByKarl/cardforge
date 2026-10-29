import { readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { AppSettings, OverwritePolicy } from '../shared/types'
import { AppError } from './errors'
import { log } from './logger'

export const DEFAULT_SETTINGS: AppSettings = {
  outputDirectory: null,
  overwritePolicy: 'ask',
  fileNamePattern: '{row} - {col:Full Name}',
  exportPdf: false,
  safeMarginMm: 3
}

const OVERWRITE_POLICIES: readonly OverwritePolicy[] = ['ask', 'skip', 'suffix']

/** Validates an untrusted patch (from the renderer or from disk) field by field. */
export function sanitizeSettingsPatch(input: unknown): Partial<AppSettings> {
  if (typeof input !== 'object' || input === null) throw new AppError('INVALID_SETTINGS', 'Settings must be an object.')
  const raw = input as Record<string, unknown>
  const patch: Partial<AppSettings> = {}
  if ('outputDirectory' in raw) {
    const v = raw.outputDirectory
    if (v !== null && (typeof v !== 'string' || !isAbsolute(v))) {
      throw new AppError('INVALID_SETTINGS', 'Output directory must be an absolute path.')
    }
    patch.outputDirectory = v
  }
  if ('overwritePolicy' in raw) {
    if (!OVERWRITE_POLICIES.includes(raw.overwritePolicy as OverwritePolicy)) {
      throw new AppError('INVALID_SETTINGS', 'Unknown overwrite policy.')
    }
    patch.overwritePolicy = raw.overwritePolicy as OverwritePolicy
  }
  if ('fileNamePattern' in raw) {
    const v = raw.fileNamePattern
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > 200) {
      throw new AppError('INVALID_SETTINGS', 'File name pattern must be 1–200 characters.')
    }
    patch.fileNamePattern = v
  }
  if ('exportPdf' in raw) {
    if (typeof raw.exportPdf !== 'boolean') throw new AppError('INVALID_SETTINGS', 'exportPdf must be true or false.')
    patch.exportPdf = raw.exportPdf
  }
  if ('safeMarginMm' in raw) {
    const v = raw.safeMarginMm
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10) throw new AppError('INVALID_SETTINGS', 'Safety margin must be 0–10 mm.')
    patch.safeMarginMm = v
  }
  return patch
}

export class SettingsStore {
  private current: AppSettings = { ...DEFAULT_SETTINGS }

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppSettings> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      this.current = { ...DEFAULT_SETTINGS, ...sanitizeSettingsPatch(parsed) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('settings.load_failed_using_defaults', { error: err })
      }
      this.current = { ...DEFAULT_SETTINGS }
    }
    return this.get()
  }

  get(): AppSettings {
    return { ...this.current }
  }

  async update(patch: unknown): Promise<AppSettings> {
    this.current = { ...this.current, ...sanitizeSettingsPatch(patch) }
    // Write to a temp file then rename so a crash mid-write never leaves corrupt settings.
    const tmp = `${this.filePath}.tmp`
    await writeFile(tmp, JSON.stringify(this.current, null, 2), 'utf8')
    await rename(tmp, this.filePath)
    return this.get()
  }
}
