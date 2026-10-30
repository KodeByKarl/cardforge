// Types for direct printing, shared by the main process, preload bridge and renderer.
// Keep this file free of Node/Electron/DOM imports.

export const PAPER_SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal'] as const
export type PrintPaper = (typeof PAPER_SIZES)[number]

export const ORIENTATIONS = ['portrait', 'landscape'] as const
export type PrintOrientation = (typeof ORIENTATIONS)[number]

export const SCALINGS = ['asDocument', 'fitToPage'] as const
/** asDocument prints at 100 %; fitToPage scales the page to the paper. */
export type PrintScaling = (typeof SCALINGS)[number]

export const COLOR_MODES = ['color', 'grayscale', 'black'] as const
export type PrintColorMode = (typeof COLOR_MODES)[number]

export const MAX_COPIES = 99

export interface PrintSettings {
  printer: string
  copies: number
  paper: PrintPaper
  orientation: PrintOrientation
  /** Pages of every file, e.g. "1-3,5". Empty prints every page. */
  pageRange: string
  scaling: PrintScaling
  color: PrintColorMode
}

export type PrinterStatus = 'ready' | 'busy' | 'paused' | 'offline' | 'error' | 'unknown'

export interface PrinterInfo {
  name: string
  isDefault: boolean
  status: PrinterStatus
  statusDetail: string
  port: string
  /** null when the driver does not say. */
  supportsColor: boolean | null
  /** Paper names reported by the driver (e.g. "A4"); empty when unknown. */
  paperSizes: string[]
}

export interface SpoolerJob {
  id: number
  documentName: string
  /** Windows job status text, e.g. "Printing", "Spooling", "Error, Offline". */
  status: string
}

export interface PrintPreset {
  id: string
  name: string
  settings: PrintSettings
}

/**
 * Lifecycle of one CDR file in a print job.
 * submitted = CorelDRAW accepted PrintOut; spooled = seen in the Windows queue; printing = queue says printing;
 * completed = it was printing and then left the queue (the closest Windows gives to "printed");
 * uncertain = the outcome is unknown and a reprint could duplicate paper, so nothing retries it automatically.
 */
export type PrintSheetState = 'queued' | 'submitting' | 'submitted' | 'spooled' | 'printing' | 'completed' | 'failed' | 'cancelled' | 'uncertain'

export const SHEET_TERMINAL: readonly PrintSheetState[] = ['completed', 'failed', 'cancelled', 'uncertain']
/** States after which the file may already have reached the printer. */
export const SHEET_SENT: readonly PrintSheetState[] = ['submitted', 'spooled', 'printing', 'completed', 'uncertain']

export interface PrintSheetRecord {
  /** Index into the source generation job's files. */
  fileIndex: number
  file: string
  fileName: string
  /** Pages in the document; null until counted. */
  pages: number | null
  state: PrintSheetState
  attempts: number
  spoolerJobId: number | null
  note: string | null
  error: string | null
  updatedAt: string
}

export type PrintJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'attention'

export interface PrintJobRecord {
  id: string
  sourceJobId: string
  templateName: string
  corelVersion: string
  createdAt: string
  finishedAt: string | null
  settings: PrintSettings
  /** Pages sent per file after applying the range, times copies; the figure the operator confirmed. */
  estimatedPages: number
  status: PrintJobStatus
  sheets: PrintSheetRecord[]
}

export interface PrintPlanFile {
  fileIndex: number
  fileName: string
  pages: number
  pagesToPrint: number
}

export interface PrintPlan {
  planId: string
  sourceJobId: string
  templateName: string
  settings: PrintSettings
  printerStatus: PrinterStatus
  files: PrintPlanFile[]
  sheetCount: number
  /** Total sheets of paper: sum of pagesToPrint x copies. */
  estimatedPages: number
  /** Stop printing from starting. */
  blockers: string[]
  warnings: string[]
  /** Files already sent to this printer recently; printing them again needs explicit approval. */
  duplicates: { fileIndex: number; fileName: string; state: PrintSheetState; at: string }[]
}

export interface PrintPlanRequest {
  sourceJobId: string
  /** Subset of the source job's files; every .cdr file when omitted. */
  fileIndexes?: number[]
  settings: PrintSettings
}

export interface PrintStartRequest {
  planId: string
  /** Operator ticked the confirmation in the dialog. */
  confirmed: boolean
  /** Operator accepted re-printing files listed in plan.duplicates. */
  allowDuplicates: boolean
}

export interface PrintProgressEvent {
  job: PrintJobRecord
}

export interface PrintPreviewPage {
  pageIndex: number
  dataUrl: string
  widthMm: number
  heightMm: number
}

export interface PrintPreview {
  fileIndex: number
  fileName: string
  pageCount: number
  pages: PrintPreviewPage[]
  /** Generation-report warnings (overflow, fonts) for the source job. */
  warnings: string[]
}

export interface PrintSourceFile {
  fileIndex: number
  fileName: string
  exists: boolean
}

export interface PrintSource {
  jobId: string
  templateName: string
  finishedAt: string | null
  files: PrintSourceFile[]
  warnings: string[]
}
