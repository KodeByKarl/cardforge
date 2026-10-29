// Stable boundary between the app and CorelDRAW. Services (templates, preview, generation) only use
// these primitives, so the real PowerShell/COM implementation and the test mock are interchangeable.

import type { ApplyResult, ExportedPage, ShapeValues, TemplateInspection } from '../../../shared/template/types'

/** CDR file format to write: 17 = CorelDRAW X7, so X7 can open files produced on newer versions. */
export const X7_FILE_VERSION = 17

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
  openDocument(path: string): Promise<DocHandle>
  closeDocument(handle: DocHandle): Promise<void>
  inspect(handle: DocHandle): Promise<TemplateInspection>
  /** Replaces the text of named objects and reports overflow per object. */
  applyText(handle: DocHandle, values: ShapeValues, safeMarginMm: number): Promise<ApplyResult>
  /** Renders whole pages (exact page area) to PNG files in `dir`. */
  exportPages(handle: DocHandle, options: { dir: string; prefix: string; dpi: number; pages: number[] }): Promise<ExportedPage[]>
  saveAs(handle: DocHandle, path: string, fileVersion: number): Promise<void>
  dispose(): Promise<void>
}
