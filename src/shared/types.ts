// Types shared by the main process, preload bridge, and renderer.
// Keep this file free of Node/Electron/DOM imports.

/** A sheet as a rectangular grid of display strings. grid[i] is spreadsheet row i + 1. */
export type CellGrid = string[][]

export type SourceFormat = 'xlsx' | 'csv'

export interface SheetSummary {
  name: string
  rowCount: number
  columnCount: number
}

export interface WorkbookInfo {
  filePath: string
  fileName: string
  format: SourceFormat
  sizeBytes: number
  sheets: SheetSummary[]
}

export interface SheetData {
  sheetName: string
  rows: CellGrid
  /** True when the sheet exceeded the row/column import limits and was cut off. */
  truncated: boolean
}

export type FieldKind = 'text' | 'multiline' | 'email' | 'phone'

export interface ColumnConfig {
  /** Stable key derived from the column position, e.g. "c0". */
  key: string
  /** Header text as shown to the user (made unique). */
  label: string
  /** Zero-based column index in the source grid. */
  index: number
  kind: FieldKind
  include: boolean
  required: boolean
  /** Part of the duplicate-detection key. */
  duplicateKey: boolean
}

export interface ImportRecord {
  /** 1-based spreadsheet row number, as the user sees it in Excel. */
  rowNumber: number
  values: Record<string, string>
}

export interface Dataset {
  columns: ColumnConfig[]
  records: ImportRecord[]
  skippedEmptyRows: number[]
}

export type IssueSeverity = 'error' | 'warning'

export type IssueCode =
  | 'EMPTY_SHEET'
  | 'NO_DATA_ROWS'
  | 'NO_COLUMNS_INCLUDED'
  | 'MISSING_REQUIRED'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'DUPLICATE_RECORD'
  | 'LONG_VALUE'

export interface ValidationIssue {
  severity: IssueSeverity
  code: IssueCode
  message: string
  /** Absent for sheet-level issues. */
  rowNumber?: number
  columnKey?: string
}

export interface ValidationResult {
  issues: ValidationIssue[]
  /** Issues indexed by row number for fast table rendering. */
  byRow: Map<number, ValidationIssue[]>
  totalRecords: number
  validRecords: number
  recordsWithErrors: number
  recordsWithWarnings: number
  duplicateGroups: number
}

export type OverwritePolicy = 'ask' | 'skip' | 'suffix'

export interface AppSettings {
  outputDirectory: string | null
  overwritePolicy: OverwritePolicy
  /** Tokens: {row}, {col:<Header Label>}. Sanitised before use. */
  fileNamePattern: string
  exportPdf: boolean
  /** Distance from the card edge that text should stay inside; used for overflow warnings. */
  safeMarginMm: number
}

export interface CorelDetection {
  installed: boolean
  /** COM ProgIDs found in the registry, e.g. "CorelDRAW.Application.17". */
  progIds: string[]
  /** True when the X7 ProgID (version 17) is registered. */
  x7Registered: boolean
  detail: string
}

export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  userDataPath: string
  logDirectory: string
}

export interface IpcError {
  code: string
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
