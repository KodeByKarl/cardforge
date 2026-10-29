// Stable boundary between the app and CorelDRAW. The real implementation (PowerShell COM bridge)
// arrives in Phase 5 once the proof of concept has been run on the client's machine.

/** A text object found in a template, identified by its Object Manager name. */
export interface TemplateTextObject {
  name: string
  pageIndex: number
  currentText: string
  /** Position and size in millimetres, from the page's bottom-left (CorelDRAW convention). */
  bounds: { x: number; y: number; width: number; height: number } | null
  fontName: string | null
  fontSizePt: number | null
  isParagraphText: boolean | null
}

export interface TemplateInfo {
  templatePath: string
  pageCount: number
  pageWidthMm: number
  pageHeightMm: number
  textObjects: TemplateTextObject[]
}

/** Text to write into each named template object. */
export type ShapeTextValues = Record<string, string>

export interface GenerateItem {
  values: ShapeTextValues
  outputPath: string
}

export interface CorelAdapter {
  readonly kind: 'real' | 'mock'
  /** Starts or connects to CorelDRAW. Throws AppError('COREL_UNAVAILABLE') on failure. */
  connect(): Promise<void>
  inspectTemplate(templatePath: string): Promise<TemplateInfo>
  /** Opens a private working copy of the template; the original file is never opened for writing. */
  beginBatch(templatePath: string): Promise<void>
  /** Replaces text in named objects and saves an editable CDR to outputPath. */
  generateOne(item: GenerateItem): Promise<void>
  endBatch(): Promise<void>
  dispose(): Promise<void>
}
