import { stat } from 'node:fs/promises'
import { extname, isAbsolute, normalize } from 'node:path'
import { AppError } from './errors'

export const MAX_SPREADSHEET_BYTES = 50 * 1024 * 1024

/** Accepts only absolute, local paths with an allowed extension. Rejects UNC device paths and NUL bytes. */
export function assertSafePath(value: unknown, allowedExtensions: readonly string[]): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new AppError('INVALID_PATH', 'No valid file path was provided.')
  }
  if (value.includes('\0') || value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\')) {
    throw new AppError('INVALID_PATH', 'The file path contains unsupported characters.')
  }
  const resolved = normalize(value)
  if (!isAbsolute(resolved)) throw new AppError('INVALID_PATH', 'The file path must be absolute.')
  const ext = extname(resolved).toLowerCase()
  if (!allowedExtensions.includes(ext)) {
    throw new AppError(
      'UNSUPPORTED_FILE_TYPE',
      `"${ext || 'no extension'}" files are not supported. Use ${allowedExtensions.join(' or ')}.`
    )
  }
  return resolved
}

export async function assertReadableFile(path: string, maxBytes: number): Promise<number> {
  let info
  try {
    info = await stat(path)
  } catch (err) {
    throw new AppError('FILE_NOT_FOUND', 'The file could not be found. It may have been moved or deleted.', err)
  }
  if (!info.isFile()) throw new AppError('NOT_A_FILE', 'The selected path is not a file.')
  if (info.size === 0) throw new AppError('EMPTY_FILE', 'The file is empty (0 bytes).')
  if (info.size > maxBytes) {
    throw new AppError('FILE_TOO_LARGE', `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`)
  }
  return info.size
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Produces a Windows-safe file name stem (no extension) from arbitrary record text. */
export function sanitizeFileName(input: string, fallback = 'card'): string {
  let name = input
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (name.length > 120) name = name.slice(0, 120).trim()
  if (name.length === 0) name = fallback
  if (RESERVED_NAMES.test(name)) name = `_${name}`
  return name
}
