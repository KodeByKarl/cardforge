// Stable boundary between the app and CorelDRAW. Services (templates, preview, generation) only use
// these primitives, so the real PowerShell/COM implementation and the test mock are interchangeable.

import type { NameAssignment } from '../../../shared/sheet/types'
import type { ApplyResult, Bounds, ExportedPage, ShapeValues, TemplateInspection } from '../../../shared/template/types'

/** CDR file format to write: 17 = CorelDRAW X7, so X7 can open files produced on newer versions. */
export const X7_FILE_VERSION = 17

/** Static artwork inside these regions (page coordinates, mm) is removed for this render/save. Undone before the next record. */
export interface ApplyOptions {
  clearRegions?: Bounds[]
  clearPage?: number
  /** Only objects on this page are filled (documents with several copies of the same sheet). */
  page?: number
  /** Fill permanently: no Undo group, used when each page of a multi-sheet document is filled exactly once. */
  keep?: boolean
}

export interface CorelConnection {
  version: string
  progId: string
}

/** Opaque handle to a document opened by the adapter. Invalid after the adapter restarts. */
export type DocHandle = string

export interface CorelAdapter {
  readonly kind: 'real' | 'mock'
  /** Starts or attaches to CorelDRAW. Throws AppError('COREL_UNAVAILABLE') on failure. */
  connect(): Promise<CorelConnection>
  /** Opens a CDR. Callers pass private working copies only, never the user's original template. */
  openDocument(path: string, options?: { light?: boolean }): Promise<DocHandle>
  /** Page count of an open document (no indexing; fine for a light open). */
  docInfo(handle: DocHandle): Promise<{ pages: number }>
  closeDocument(handle: DocHandle): Promise<void>
  inspect(handle: DocHandle): Promise<TemplateInspection>
  /** Replaces the text of named objects and reports overflow per object. */
  applyText(handle: DocHandle, values: ShapeValues, safeMarginMm: number, options?: ApplyOptions): Promise<ApplyResult>
  /** Names unnamed text objects (by their inspection uid) in the open working copy. */
  nameShapes(handle: DocHandle, items: NameAssignment[]): Promise<number>
  /** Appends `count` copies of a page; returns the new page count. */
  addSheetPages(handle: DocHandle, count: number, sourcePage?: number): Promise<number>
  /** Renders whole pages (exact page area) to PNG files in `dir`. */
  exportPages(handle: DocHandle, options: { dir: string; prefix: string; dpi: number; pages: number[] }): Promise<ExportedPage[]>
  saveAs(handle: DocHandle, path: string, fileVersion: number): Promise<void>
  /** Writes every page of the document as one PDF. */
  exportPdf(handle: DocHandle, path: string): Promise<void>
  dispose(): Promise<void>
}
