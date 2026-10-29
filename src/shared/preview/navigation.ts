import type { ColumnConfig, ImportRecord } from '../types'

/** CSS pixels per millimetre (CSS defines 96 px per inch). At zoom 1 the card is drawn at its real size. */
export const CSS_PX_PER_MM = 96 / 25.4

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function zoomIn(zoom: number): number {
  return ZOOM_LEVELS.find((z) => z > zoom + 1e-9) ?? MAX_ZOOM
}

export function zoomOut(zoom: number): number {
  return [...ZOOM_LEVELS].reverse().find((z) => z < zoom - 1e-9) ?? MIN_ZOOM
}

/** Zoom that fits a card (or cards side by side) into a box, never above MAX_ZOOM. */
export function fitZoom(widthMm: number, heightMm: number, boxWidthPx: number, boxHeightPx: number): number {
  if (widthMm <= 0 || heightMm <= 0 || boxWidthPx <= 0 || boxHeightPx <= 0) return 1
  const z = Math.min(boxWidthPx / (widthMm * CSS_PX_PER_MM), boxHeightPx / (heightMm * CSS_PX_PER_MM))
  return clampZoom(Math.floor(z * 100) / 100)
}

/** On-screen size of a card in CSS px; the aspect ratio always matches the real card. */
export function cardCssSize(widthMm: number, heightMm: number, zoom: number): { width: number; height: number } {
  return { width: Math.round(widthMm * CSS_PX_PER_MM * zoom), height: Math.round(heightMm * CSS_PX_PER_MM * zoom) }
}

const DPI_BUCKETS = [72, 96, 150, 200, 300, 450, 600]

/** Render resolution for a zoom level, snapped to a few buckets so renders are reused from cache. */
export function dpiForZoom(zoom: number, devicePixelRatio = 1): number {
  const needed = 96 * zoom * devicePixelRatio
  return DPI_BUCKETS.find((d) => d >= needed) ?? DPI_BUCKETS[DPI_BUCKETS.length - 1]!
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Records whose included values contain the query, ignoring case and accents ("pena" finds "Peña"). */
export function searchRecords(records: ImportRecord[], columns: ColumnConfig[], query: string): ImportRecord[] {
  const q = fold(query.trim())
  if (!q) return records
  const keys = columns.filter((c) => c.include).map((c) => c.key)
  return records.filter((r) => keys.some((k) => fold(r.values[k] ?? '').includes(q)))
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(length - 1, Math.max(0, index))
}

/** Moves within [0, length) without wrapping. */
export function stepIndex(index: number, delta: number, length: number): number {
  return clampIndex(index + delta, length)
}

export interface GridPage {
  page: number
  pageCount: number
  start: number
  end: number
}

export function gridPage(total: number, page: number, pageSize: number): GridPage {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(pageCount - 1, Math.max(0, page))
  return { page: p, pageCount, start: p * pageSize, end: Math.min(total, (p + 1) * pageSize) }
}

export function pageOfIndex(index: number, pageSize: number): number {
  return Math.floor(Math.max(0, index) / pageSize)
}
