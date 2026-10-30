import { useCallback, useState } from 'react'
import { DEFAULT_SHEETS_PER_FILE } from '../../../shared/sheet/batches'
import type { TemplateRecord } from '../../../shared/template/types'

export interface SheetSettings {
  /** How many of the template's card positions are filled on each sheet. */
  cardsPerSheet: number
  sheetsPerFile: number
  exportPdf: boolean
  /** Remove the artwork of card positions without a record on the last sheet. */
  clearEmpty: boolean
}

const key = (id: string) => `cardforge.sheet.${id}`

function load(template: TemplateRecord): SheetSettings {
  const cells = template.sheet?.cells.length ?? 1
  const defaults: SheetSettings = { cardsPerSheet: cells, sheetsPerFile: DEFAULT_SHEETS_PER_FILE, exportPdf: false, clearEmpty: true }
  try {
    const raw = localStorage.getItem(key(template.id))
    if (!raw) return defaults
    const p = JSON.parse(raw) as Partial<SheetSettings>
    const int = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d)
    return {
      cardsPerSheet: int(p.cardsPerSheet, 1, cells, cells),
      sheetsPerFile: int(p.sheetsPerFile, 1, 500, DEFAULT_SHEETS_PER_FILE),
      exportPdf: p.exportPdf === true,
      clearEmpty: p.clearEmpty !== false
    }
  } catch {
    return defaults
  }
}

/** Production settings of a sheet template, remembered per template on this computer. */
export function useSheetSettings(template: TemplateRecord): [SheetSettings, (patch: Partial<SheetSettings>) => void] {
  const [settings, setSettings] = useState(() => load(template))
  const update = useCallback(
    (patch: Partial<SheetSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch }
        try {
          localStorage.setItem(key(template.id), JSON.stringify(next))
        } catch {
          // Not remembered; applies for this session.
        }
        return next
      })
    },
    [template.id]
  )
  return [settings, update]
}
