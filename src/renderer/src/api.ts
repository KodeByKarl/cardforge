import type { IpcResult } from '../../shared/types'

export const api = window.cardforge

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** Converts an IpcResult into a value or a thrown ApiError carrying the operator-facing message. */
export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new ApiError(result.error.code, result.error.message)
  return result.data
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
