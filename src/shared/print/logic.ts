// Pure print logic: settings validation, page ranges, estimates, job status. No Node/Electron imports.

import {
  COLOR_MODES,
  MAX_COPIES,
  ORIENTATIONS,
  PAPER_SIZES,
  SCALINGS,
  SHEET_SENT,
  SHEET_TERMINAL,
  type PrintColorMode,
  type PrintJobStatus,
  type PrintOrientation,
  type PrintPaper,
  type PrintScaling,
  type PrintSettings,
  type PrintSheetRecord,
  type PrinterStatus
} from './types'

/** Parses "1-3, 5" against a page count. Returns the sorted unique pages, or an operator-readable error. */
export function parsePageRange(range: string, pageCount: number): { ok: true; pages: number[] } | { ok: false; error: string } {
  const text = range.trim()
  if (text === '') return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1) }
  const pages = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!m) return { ok: false, error: `“${part.trim()}” is not a valid page or range. Use a form like 1-3,5.` }
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from < 1 || to < from) return { ok: false, error: `Page range “${part.trim()}” is not valid.` }
    if (to > pageCount) return { ok: false, error: `Page ${to} is beyond the last page (${pageCount}).` }
    for (let p = from; p <= to; p++) pages.add(p)
  }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) }
}

/** Syntax-only check of a range (page count unknown). */
export function isValidPageRangeSyntax(range: string): boolean {
  return range.trim() === '' || /^\s*\d+\s*(-\s*\d+\s*)?(,\s*\d+\s*(-\s*\d+\s*)?)*$/.test(range)
}

export function pagesToPrint(range: string, pageCount: number): number {
  const parsed = parsePageRange(range, pageCount)
  return parsed.ok ? parsed.pages.length : 0
}

export function estimateTotalPages(pagesPerFile: number[], copies: number): number {
  return pagesPerFile.reduce((n, p) => n + p, 0) * copies
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Unknown ${what}.`)
  return value as T
}

/** Validates untrusted settings (renderer payload or stored preset). Throws Error with an operator-readable message. */
export function parsePrintSettings(input: unknown): PrintSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Print settings must be an object.')
  const raw = input as Record<string, unknown>
  const printer = raw['printer']
  if (typeof printer !== 'string' || printer.trim() === '' || printer.length > 260 || /[\u0000-\u001f]/.test(printer)) throw new Error('Choose a printer.')
  const copies = raw['copies']
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) throw new Error(`Copies must be a whole number from 1 to ${MAX_COPIES}.`)
  const pageRange = typeof raw['pageRange'] === 'string' ? raw['pageRange'] : ''
  if (pageRange.length > 100 || !isValidPageRangeSyntax(pageRange)) throw new Error('Page range must look like 1-3,5.')
  return {
    printer,
    copies,
    paper: oneOf<PrintPaper>(raw['paper'], PAPER_SIZES, 'paper size'),
    orientation: oneOf<PrintOrientation>(raw['orientation'], ORIENTATIONS, 'orientation'),
    pageRange: pageRange.trim(),
    scaling: oneOf<PrintScaling>(raw['scaling'], SCALINGS, 'scaling'),
    color: oneOf<PrintColorMode>(raw['color'], COLOR_MODES, 'color mode')
  }
}

export function defaultPrintSettings(printer = ''): PrintSettings {
  return { printer, copies: 1, paper: 'A4', orientation: 'portrait', pageRange: '', scaling: 'asDocument', color: 'color' }
}

/** Whether the printer can take a job right now. Offline and error are blockers; paused only warns (jobs wait in the queue). */
export function printerBlocker(name: string, status: PrinterStatus, detail: string): string | null {
  if (status === 'offline') return `Printer “${name}” is offline. Turn it on or reconnect it, or choose another printer.`
  if (status === 'error') return `Printer “${name}” reports an error${detail ? ` (${detail})` : ''}. Fix it or choose another printer.`
  return null
}

/** Overall status of a job from its sheets. */
export function jobStatus(sheets: PrintSheetRecord[], cancelRequested: boolean): PrintJobStatus {
  if (sheets.some((s) => s.state === 'queued' || s.state === 'submitting')) return cancelRequested ? 'running' : sheets.every((s) => s.state === 'queued') ? 'queued' : 'running'
  if (sheets.some((s) => s.state === 'uncertain')) return 'attention'
  if (sheets.some((s) => s.state === 'failed')) return 'failed'
  if (sheets.length > 0 && sheets.every((s) => s.state === 'cancelled')) return 'cancelled'
  if (sheets.some((s) => s.state === 'cancelled')) return 'attention'
  return 'done'
}

/** True while CorelDRAW work or Windows queue tracking is still expected for the job. */
export function isActiveJob(sheets: PrintSheetRecord[]): boolean {
  return sheets.some((s) => s.state === 'queued' || s.state === 'submitting')
}

export function isTerminalSheet(s: PrintSheetRecord): boolean {
  return SHEET_TERMINAL.includes(s.state)
}

export function wasSent(s: PrintSheetRecord): boolean {
  return SHEET_SENT.includes(s.state)
}

/** Settings fingerprint used to recognise an identical re-submission. */
export function settingsKey(s: PrintSettings): string {
  return JSON.stringify([s.printer.toLowerCase(), s.copies, s.paper, s.orientation, s.pageRange, s.scaling, s.color])
}

/** Spooler status text -> what the sheet is doing. Windows reports flags like "Printing, Retained". */
export function classifySpoolerStatus(status: string): 'printing' | 'spooled' | 'problem' {
  const s = status.toLowerCase()
  if (/error|offline|paperout|paper out|paperproblem|userintervention|user intervention|blocked|deleting/.test(s)) return 'problem'
  if (/printing|printed/.test(s)) return 'printing'
  return 'spooled'
}
