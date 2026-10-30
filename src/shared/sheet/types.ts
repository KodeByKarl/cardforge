// Sheet (multi-card page) production types, shared by main and renderer. No Node/DOM imports.
import type { Bounds } from '../template/types'

/** Where a variable text object sits in the page, as reported by CorelDRAW. `uid` is only valid within one inspection. */
export interface UnnamedText {
  /** Traversal ordinal of the object in the document ("u12"): stable for the same file, used to name it. */
  uid: string
  pageIndex: number
  path: string[]
  text: string
  font: string
  sizePt: number
  bold: boolean
  italic: boolean
  alignment: number
  isParagraph: boolean
  mixedFormatting: boolean
  bounds: Bounds
}

/** One card position on the sheet. Reading order starts top-left. */
export interface SheetCell {
  /** 1-based reading order: the n-th record of a sheet goes into cell n. */
  index: number
  col: number
  row: number
  /** The slice of the page that belongs to this card, used to find its static artwork. */
  region: Bounds
  /** roleId → name given to the object in the prepared template. */
  objects: Record<string, string>
}

/** One variable (or label) text object of a card, defined by the reference card and replicated in every cell. */
export interface SheetRole {
  id: string
  /** Human label shown in the mapping editor, e.g. "Text 1 (Arial 9 pt)". */
  label: string
  /** The template's own text of the reference card, split into lines (padding preserved). */
  templateLines: string[]
  isParagraph: boolean
  font: string
  sizePt: number
  mixedFormatting: boolean
  /** Looks like a fixed caption (e.g. "ADDRESS:"): never filled from data, kept as is. */
  isLabel: boolean
  /** Position relative to the card's top-left corner, for drawing it in the editor. */
  relBounds: Bounds
}

export type SheetOrder = 'rows' | 'columns'

export interface SheetConfig {
  version: 1
  pageIndex: number
  columns: number
  rows: number
  order: SheetOrder
  cells: SheetCell[]
  roles: SheetRole[]
  /** Findings from detection (uneven cells, unmatched objects). Shown to the operator, never hidden. */
  warnings: string[]
  /** Set once the unnamed objects were named in the private working copy. */
  preparedAt: string | null
}

export interface DetectionOptions {
  pageIndex?: number
  /** Force the grid size instead of auto-detecting it. */
  columns?: number
  rows?: number
  order?: SheetOrder
  /** Objects closer than this belong to the same card (mm). */
  gapMm?: number
  pageWidthMm?: number
  pageHeightMm?: number
}

export interface NameAssignment {
  uid: string
  name: string
}

export interface DetectionResult {
  config: SheetConfig
  assignments: NameAssignment[]
}

/** What goes into one line of a role's text. */
export type LineFill = { kind: 'column'; columnLabel: string } | { kind: 'keep' } | { kind: 'blank' }

export interface SheetMapping {
  version: 1
  /** roleId → one entry per template line of that role. */
  fields: Record<string, LineFill[]>
  /** Operator confirmations of known discrepancies, e.g. "prefix". */
  acknowledged: string[]
}

export interface SheetMappingIssue {
  severity: 'error' | 'warning'
  code: 'MISSING_COLUMN' | 'UNMAPPED_FIELD' | 'KEEP_SAMPLE_TEXT' | 'PREFIX_UNCONFIRMED' | 'GRID_WARNING' | 'NOT_PREPARED' | 'NO_MAPPING'
  message: string
  roleId?: string
}

export interface SheetBatchPlanItem {
  /** 1-based sheet number within the whole job. */
  number: number
  /** Index of the first record on this sheet in the eligible-record list. */
  first: number
  count: number
}

export interface SheetPlan {
  perSheet: number
  total: number
  sheets: SheetBatchPlanItem[]
}

// ---- Bulk sheet generation ----

/** One eligible record: its spreadsheet row and its normalised values keyed by column key. */
export interface SheetRecordInput {
  rowNumber: number
  values: Record<string, string>
}

/**
 * How a sheet is filled. Always chosen explicitly by the operator, never assumed:
 * unique = a different record in every card position; copies = every position of a sheet holds the same record.
 */
export type SheetMode = 'unique' | 'copies'

/** resume: keep batches that a previous identical run completed. skip/suffix/overwrite decide what to do with other existing files. */
export type SheetOverwrite = 'resume' | 'skip' | 'suffix' | 'overwrite'

export interface SheetGenerationRequest {
  templateId: string
  outputDirectory: string
  /** How many cards of the template's grid are used (the first N positions); at most the number of cells. */
  mode: SheetMode
  cardsPerSheet: number
  sheetsPerFile: number
  exportPdf: boolean
  /** Remove the artwork of card positions without a record (final partly filled sheet). */
  clearEmpty: boolean
  overwrite: SheetOverwrite
  columns: { key: string; label: string }[]
  records: SheetRecordInput[]
  /** Spreadsheet rows left out because they have errors; listed in the report. */
  excludedRows: number[]
}

export interface SheetPlanBatch {
  index: number
  fileName: string
  pdfName: string | null
  firstSheet: number
  lastSheet: number
  firstRow: number
  lastRow: number
  records: number
  exists: boolean
  /** Verified as completed by a previous identical run (manifest + file present). */
  completed: boolean
}

export interface SheetGenerationPlan {
  mode: SheetMode
  cardsPerSheet: number
  sheets: number
  records: number
  batches: SheetPlanBatch[]
  conflicts: number
  resumable: boolean
  completed: number
  fingerprint: string
  /** Problems that make the plan unsafe (e.g. records not covered exactly once). Empty = correct. */
  problems: string[]
  /** Things the operator should review but that do not stop the job (e.g. missing fonts). */
  warnings: string[]
}

export interface SheetManifestBatch {
  index: number
  fileName: string
  pdfName: string | null
  firstSheet: number
  lastSheet: number
  firstRow: number
  lastRow: number
  records: number
  status: 'pending' | 'done' | 'failed'
  bytes: number | null
  completedAt: string | null
  message: string | null
}

/** Written next to the output; contains row numbers only, never spreadsheet contents. */
export interface SheetManifest {
  version: 1
  fingerprint: string
  templateId: string
  templateName: string
  createdAt: string
  cardsPerSheet: number
  sheetsPerFile: number
  totalRecords: number
  totalSheets: number
  batches: SheetManifestBatch[]
}
