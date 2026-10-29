import { useEffect, useState } from 'react'
import type { CorelStatus } from '../../../shared/template/types'
import { api, errorMessage, unwrap } from '../api'

/** CorelDRAW availability for status banners. Detection only; it does not start CorelDRAW. */
export function useCorelStatus(): { status: CorelStatus | null; error: string | null } {
  const [status, setStatus] = useState<CorelStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    unwrap(api.corel.status()).then(setStatus, (err) => setError(errorMessage(err)))
  }, [])
  return { status, error }
}

/** "Version 27.2.0.135" → 27; null when unknown. */
export function corelMajor(version: string | null | undefined): number | null {
  const m = /(\d+)\./.exec(version ?? '')
  return m ? Number(m[1]) : null
}
