import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isActiveJob } from '../../../shared/print/logic'
import type { PrintJobRecord } from '../../../shared/print/types'
import { api, unwrap } from '../api'

interface PrintContextValue {
  /** Print jobs, newest first. Updated live while a job is sending or being followed in the Windows queue. */
  jobs: PrintJobRecord[]
  /** A job that is still sending files to CorelDRAW. */
  active: PrintJobRecord | undefined
  /** Generation job chosen as the print source (set by "Print" buttons on other screens). */
  sourceJobId: string | null
  selectSource(id: string | null): void
  refresh(): Promise<void>
}

const PrintContext = createContext<PrintContextValue | null>(null)

/** Subscribed once at app level so print progress keeps arriving while the operator is on other screens. */
export function PrintProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<PrintJobRecord[]>([])
  const [sourceJobId, selectSource] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setJobs(await unwrap(api.print.history()))
    } catch {
      // History is informational; the print screen shows an empty list.
    }
  }, [])

  useEffect(() => {
    void refresh()
    return api.print.onProgress((job) => {
      setJobs((list) => {
        const i = list.findIndex((j) => j.id === job.id)
        if (i === -1) return [job, ...list]
        const next = [...list]
        next[i] = job
        return next
      })
    })
  }, [refresh])

  const value = useMemo<PrintContextValue>(() => ({ jobs, active: jobs.find((j) => isActiveJob(j.sheets)), sourceJobId, selectSource, refresh }), [jobs, sourceJobId, refresh])
  return <PrintContext.Provider value={value}>{children}</PrintContext.Provider>
}

export function usePrint(): PrintContextValue {
  const ctx = useContext(PrintContext)
  if (!ctx) throw new Error('usePrint must be used inside PrintProvider')
  return ctx
}
