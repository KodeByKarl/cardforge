import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { mappingIssues, resolveMapping, type MappingIssue, type ResolvedEntry } from '../../../shared/template/mapping'
import type { TemplateRecord, TemplateSummary } from '../../../shared/template/types'
import { ApiError, api, errorMessage, unwrap } from '../api'
import { useJob } from './job'

interface TemplatesContextValue {
  list: TemplateSummary[]
  listError: string | null
  selected: TemplateRecord | null
  loading: boolean
  refresh(): Promise<void>
  select(id: string | null): Promise<void>
  /** Replace the selected record after a server-side change (mapping saved, re-inspected, renamed). */
  update(record: TemplateRecord): void
  /** Mapping resolved against the currently imported spreadsheet. */
  resolved: Map<string, ResolvedEntry>
  issues: MappingIssue[]
}

const TemplatesContext = createContext<TemplatesContextValue | null>(null)
const SELECTED_KEY = 'cardforge.selectedTemplate'

function rememberSelection(id: string | null): void {
  try {
    if (id) localStorage.setItem(SELECTED_KEY, id)
    else localStorage.removeItem(SELECTED_KEY)
  } catch {
    // Storage unavailable: selection just isn't remembered.
  }
}

export function TemplatesProvider({ children }: { children: ReactNode }) {
  const { dataset } = useJob()
  const [list, setList] = useState<TemplateSummary[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<TemplateRecord | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setList(await unwrap(api.templates.list()))
      setListError(null)
    } catch (err) {
      setListError(errorMessage(err))
    }
  }, [])

  const select = useCallback(async (id: string | null) => {
    rememberSelection(id)
    if (!id) {
      setSelected(null)
      return
    }
    setLoading(true)
    try {
      setSelected(await unwrap(api.templates.get(id)))
    } catch (err) {
      setSelected(null)
      // A remembered template that was removed is not an error worth showing; just forget it.
      if (err instanceof ApiError && err.code === 'TEMPLATE_NOT_FOUND') rememberSelection(null)
      else setListError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    let saved: string | null = null
    try {
      saved = localStorage.getItem(SELECTED_KEY)
    } catch {
      saved = null
    }
    if (saved) void select(saved)
  }, [refresh, select])

  const update = useCallback(
    (record: TemplateRecord) => {
      setSelected(record)
      void refresh()
    },
    [refresh]
  )

  const columns = dataset?.columns ?? []
  const resolved = useMemo(
    () => (selected ? resolveMapping(selected.mapping, selected.inspection.objects, columns) : new Map<string, ResolvedEntry>()),
    [selected, columns]
  )
  const issues = useMemo(() => (selected ? mappingIssues(selected.inspection.objects, selected.mapping, columns) : []), [selected, columns])

  return (
    <TemplatesContext.Provider value={{ list, listError, selected, loading, refresh, select, update, resolved, issues }}>{children}</TemplatesContext.Provider>
  )
}

export function useTemplates(): TemplatesContextValue {
  const ctx = useContext(TemplatesContext)
  if (!ctx) throw new Error('useTemplates must be used inside TemplatesProvider')
  return ctx
}

export function pageLabel(index: number, pageCount: number): string {
  if (pageCount === 2) return index === 1 ? 'Front' : 'Back'
  return `Page ${index}`
}
