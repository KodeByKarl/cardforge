import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { JobLogEntry, JobProgress, JobSummary } from '../../../shared/template/types'
import { api, unwrap } from '../api'

interface GenerationContextValue {
  /** Latest progress of the current or most recent job in this session. */
  progress: JobProgress | null
  /** Per-record results of that job, newest last. */
  entries: JobLogEntry[]
  history: JobSummary[]
  running: boolean
  begin(jobId: string): void
  refreshHistory(): Promise<void>
}

const GenerationContext = createContext<GenerationContextValue | null>(null)

/** Subscribed once at app level so progress keeps arriving while the user is on other screens. */
export function GenerationProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [entries, setEntries] = useState<JobLogEntry[]>([])
  const [history, setHistory] = useState<JobSummary[]>([])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await unwrap(api.generation.history()))
    } catch {
      // History is informational; the dashboard shows an empty list.
    }
  }, [])

  useEffect(() => {
    void refreshHistory()
    return api.generation.onProgress((p) => {
      setProgress((prev) => (prev && prev.jobId !== p.jobId && prev.status === 'running' ? prev : p))
      if (p.entry) setEntries((list) => [...list, p.entry!])
      if (p.status !== 'running') void refreshHistory()
    })
  }, [refreshHistory])

  const begin = useCallback((jobId: string) => {
    setEntries([])
    setProgress({ jobId, status: 'running', total: 0, done: 0, succeeded: 0, failed: 0, skipped: 0, current: null, entry: null, error: null })
  }, [])

  return (
    <GenerationContext.Provider value={{ progress, entries, history, running: progress?.status === 'running', begin, refreshHistory }}>
      {children}
    </GenerationContext.Provider>
  )
}

export function useGeneration(): GenerationContextValue {
  const ctx = useContext(GenerationContext)
  if (!ctx) throw new Error('useGeneration must be used inside GenerationProvider')
  return ctx
}
