import { randomUUID } from 'node:crypto'
import { parsePrintSettings } from '../../../shared/print/logic'
import type { PrintPreset, PrintSettings } from '../../../shared/print/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import { readJson, writeJsonAtomic } from '../fsutil'

const MAX_PRESETS = 50

interface Stored {
  presets: PrintPreset[]
  last: PrintSettings | null
}

/** Saved printer presets and the settings used last, persisted to <userData>/print-presets.json. */
export class PresetStore {
  private data: Stored | null = null

  constructor(private readonly file: string) {}

  private async load(): Promise<Stored> {
    if (this.data) return this.data
    const data: Stored = { presets: [], last: null }
    try {
      const raw = await readJson<{ presets?: unknown; last?: unknown }>(this.file)
      if (Array.isArray(raw.presets)) {
        for (const p of raw.presets as Partial<PrintPreset>[]) {
          try {
            if (typeof p.id === 'string' && typeof p.name === 'string') data.presets.push({ id: p.id, name: p.name, settings: parsePrintSettings(p.settings) })
          } catch {
            log.warn('print.preset_dropped', { name: p.name })
          }
        }
      }
      if (raw.last) data.last = parsePrintSettings(raw.last)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('print.presets_load_failed', { error: err })
    }
    this.data = data
    return data
  }

  private save(d: Stored): Promise<void> {
    return writeJsonAtomic(this.file, d)
  }

  async list(): Promise<{ presets: PrintPreset[]; last: PrintSettings | null }> {
    const d = await this.load()
    return { presets: [...d.presets], last: d.last }
  }

  async remember(untrusted: unknown): Promise<void> {
    const d = await this.load()
    d.last = this.parse(untrusted)
    await this.save(d)
  }

  /** Saves under a name; an existing preset with the same name (any case) is replaced. */
  async saveAs(name: unknown, untrusted: unknown): Promise<PrintPreset> {
    if (typeof name !== 'string' || name.trim() === '' || name.trim().length > 60) throw new AppError('INVALID_ARGS', 'A preset name is 1 to 60 characters.')
    const d = await this.load()
    const settings = this.parse(untrusted)
    const clean = name.trim()
    const existing = d.presets.find((p) => p.name.toLowerCase() === clean.toLowerCase())
    if (!existing && d.presets.length >= MAX_PRESETS) throw new AppError('TOO_MANY_PRESETS', 'Delete an old preset first.')
    const preset: PrintPreset = { id: existing?.id ?? randomUUID(), name: clean, settings }
    d.presets = [...d.presets.filter((p) => p.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name))
    await this.save(d)
    return preset
  }

  async remove(id: unknown): Promise<void> {
    const d = await this.load()
    d.presets = d.presets.filter((p) => p.id !== id)
    await this.save(d)
  }

  private parse(untrusted: unknown): PrintSettings {
    try {
      return parsePrintSettings(untrusted)
    } catch (err) {
      throw new AppError('INVALID_ARGS', (err as Error).message)
    }
  }
}
