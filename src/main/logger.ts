import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

let logDirectory: string | null = null
let consoleOutput = true

/** Unit tests turn console mirroring off to keep output readable. */
export function setConsoleOutput(enabled: boolean): void {
  consoleOutput = enabled
}

/** Structured JSON-lines logging to <userData>/logs/app-YYYY-MM-DD.log, mirrored to the console. */
export function initLogger(directory: string): void {
  mkdirSync(directory, { recursive: true })
  logDirectory = directory
}

export function getLogDirectory(): string | null {
  return logDirectory
}

function write(level: Level, event: string, data?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, event, ...data }
  const line = JSON.stringify(entry, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
  )
  if (consoleOutput) {
    if (level === 'error') console.error(line)
    else console.log(line)
  }
  if (!logDirectory) return
  try {
    appendFileSync(join(logDirectory, `app-${entry.time.slice(0, 10)}.log`), line + '\n', 'utf8')
  } catch (err) {
    console.error('Failed to write log file', err)
  }
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => write('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data)
}
