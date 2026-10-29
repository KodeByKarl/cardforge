// Template, preview and generation types shared by main and renderer.

export interface PageInfo {
  /** 1-based. Page 1 is the front, page 2 (if present) the back. */
  index: number
  name: string
  widthMm: number
  heightMm: number
}

/** Millimetres from the page's bottom-left corner (CorelDRAW convention, y grows upwards). */
export interface Bounds {
  left: number
  bottom: number
  right: number
  top: number
}

/** A named text object found in a CDR template. */
export interface TemplateObject {
  name: string
  pageIndex: number
  /** Names of the groups/PowerClips containing the object, outermost first. */
  path: string[]
  text: string
  font: string
  sizePt: number
  bold: boolean
  italic: boolean
  /** cdrAlignment: 0 none, 1 left, 2 right, 3 centre, 4 full justify, 5 force justify. */
  alignment: number
  isParagraph: boolean
  /** Replacing text flattens mixed formatting (e.g. a bold first word); flagged so the user knows. */
  mixedFormatting: boolean
  bounds: Bounds
}

export interface TemplateInspection {
  pages: PageInfo[]
  objects: TemplateObject[]
  /** Text objects without a name; they are static artwork and cannot be mapped. */
  unnamedTextCount: number
  corelVersion: string
}

/** Text to write into named template objects, keyed by object name. */
export type ShapeValues = Record<string, string>

export interface ObjectMetric {
  name: string
  pageIndex: number
  overflow: boolean
  reason: string | null
  bounds: Bounds
}

export interface ApplyResult {
  objects: ObjectMetric[]
  notFound: string[]
  /** How the bridge resets the document between records: CorelDRAW Undo, or explicit restore of text + base formatting. */
  revertMode?: 'undo' | 'restore'
}

export interface ExportedPage {
  pageIndex: number
  path: string
  widthPx: number
  heightPx: number
}

export type MappingEntry = { kind: 'column'; columnLabel: string } | { kind: 'keep' } | { kind: 'blank' }

/** Stored per template; columns are referenced by header label so a mapping works for future spreadsheets. */
export interface SavedMapping {
  version: 1
  entries: Record<string, MappingEntry>
}

export interface TemplateSummary {
  id: string
  name: string
  sourcePath: string
  importedAt: string
  updatedAt: string
  pages: PageInfo[]
  objectCount: number
  corelVersion: string
  hasMapping: boolean
}

export interface TemplateRecord extends TemplateSummary {
  sourceHash: string
  sizeBytes: number
  inspection: TemplateInspection
  mapping: SavedMapping | null
}

export interface TemplateSourceStatus {
  exists: boolean
  changed: boolean
}

export interface PreviewRequest {
  templateId: string
  values: ShapeValues
  dpi: number
  pages: number[]
}

export interface PreviewPage {
  pageIndex: number
  dataUrl: string
  widthPx: number
  heightPx: number
  widthMm: number
  heightMm: number
}

export interface PreviewResult {
  pages: PreviewPage[]
  objects: ObjectMetric[]
  notFound: string[]
  rendererVersion: string
}

export interface CorelStatus {
  available: boolean
  progId: string | null
  /** True only when automation is running against CorelDRAW X7 itself. */
  isX7: boolean
  version: string | null
  detail: string
}

// ---- Generation (Phase 5) ----

export type ResolvedOverwrite = 'overwrite' | 'skip' | 'suffix'

export interface GenerationRecordInput {
  rowNumber: number
  values: ShapeValues
  /** Column label → value, used by the file name pattern. */
  fields: Record<string, string>
}

export interface GenerationRequest {
  templateId: string
  outputDirectory: string
  fileNamePattern: string
  overwrite: ResolvedOverwrite
  records: GenerationRecordInput[]
}

export interface PlannedItem {
  rowNumber: number
  fileName: string
  outputPath: string
  exists: boolean
}

export interface GenerationPlan {
  items: PlannedItem[]
  conflicts: number
}

export type JobStatus = 'running' | 'completed' | 'cancelled' | 'failed'

export interface JobLogEntry {
  rowNumber: number
  fileName: string
  status: 'ok' | 'failed' | 'skipped'
  message: string | null
  overflow: string[]
  /** Time spent on this record in CorelDRAW (apply + save), for benchmarking. */
  durationMs: number | null
}

export interface JobProgress {
  jobId: string
  status: JobStatus
  total: number
  done: number
  succeeded: number
  failed: number
  skipped: number
  current: { rowNumber: number; fileName: string } | null
  entry: JobLogEntry | null
  error: string | null
}

export interface JobSummary {
  id: string
  templateId: string
  templateName: string
  corelVersion: string
  startedAt: string
  finishedAt: string | null
  status: JobStatus
  total: number
  succeeded: number
  failed: number
  skipped: number
  outputDirectory: string
  reportPath: string | null
  files: string[]
  error: string | null
}
