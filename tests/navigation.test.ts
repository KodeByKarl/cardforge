import { describe, expect, it } from 'vitest'
import { buildDataset } from '../src/shared/import/dataset'
import { buildColumns } from '../src/shared/import/headers'
import {
  CSS_PX_PER_MM,
  cardCssSize,
  clampIndex,
  dpiForZoom,
  fitZoom,
  gridPage,
  pageOfIndex,
  searchRecords,
  stepIndex,
  zoomIn,
  zoomOut
} from '../src/shared/preview/navigation'

const grid = [['Full Name', 'Email'], ['Ana Cruz', 'ana@acme.ph'], ['José Peña', 'jose@acme.ph'], ['Ben Santos', 'ben@acme.ph']]
const columns = buildColumns(grid, 0)
const { records } = buildDataset(grid, 0, columns)

describe('preview navigation', () => {
  it('searches across included columns, ignoring case and accents', () => {
    expect(searchRecords(records, columns, 'pena').map((r) => r.rowNumber)).toEqual([3])
    expect(searchRecords(records, columns, 'ACME.PH')).toHaveLength(3)
    expect(searchRecords(records, columns, '  ')).toHaveLength(3)
    expect(searchRecords(records, columns, 'zzz')).toEqual([])
    const noEmail = columns.map((c) => (c.label === 'Email' ? { ...c, include: false } : c))
    expect(searchRecords(records, noEmail, 'ben@')).toEqual([])
  })

  it('steps through records without wrapping and clamps out-of-range indexes', () => {
    expect(stepIndex(0, -1, 3)).toBe(0)
    expect(stepIndex(1, 1, 3)).toBe(2)
    expect(stepIndex(2, 1, 3)).toBe(2)
    expect(clampIndex(10, 3)).toBe(2)
    expect(clampIndex(5, 0)).toBe(0)
  })

  it('pages the grid and finds the page of a record', () => {
    expect(gridPage(25, 0, 12)).toEqual({ page: 0, pageCount: 3, start: 0, end: 12 })
    expect(gridPage(25, 2, 12)).toEqual({ page: 2, pageCount: 3, start: 24, end: 25 })
    expect(gridPage(25, 9, 12).page).toBe(2)
    expect(gridPage(0, 0, 12)).toEqual({ page: 0, pageCount: 1, start: 0, end: 0 })
    expect(pageOfIndex(13, 12)).toBe(1)
  })
})

describe('zoom and dimensions', () => {
  it('draws a 90 x 50 mm card at its real CSS size at 100% and keeps the aspect ratio', () => {
    expect(cardCssSize(90, 50, 1)).toEqual({ width: Math.round(90 * CSS_PX_PER_MM), height: Math.round(50 * CSS_PX_PER_MM) })
    const z = cardCssSize(90, 50, 2.5)
    expect(z.width / z.height).toBeCloseTo(90 / 50, 2)
  })

  it('steps through zoom levels within bounds', () => {
    expect(zoomIn(1)).toBe(1.5)
    expect(zoomOut(1)).toBe(0.75)
    expect(zoomIn(4)).toBe(4)
    expect(zoomOut(0.25)).toBe(0.25)
    expect(zoomIn(1.2)).toBe(1.5)
  })

  it('fits the card into the available space', () => {
    const z = fitZoom(90, 50, 680, 1000)
    expect(cardCssSize(90, 50, z).width).toBeLessThanOrEqual(680)
    expect(fitZoom(90, 50, 100000, 100000)).toBe(4)
    expect(fitZoom(0, 50, 100, 100)).toBe(1)
  })

  it('chooses render resolution buckets from zoom and screen density', () => {
    expect(dpiForZoom(1, 1)).toBe(96)
    expect(dpiForZoom(1, 1.5)).toBe(150)
    expect(dpiForZoom(2, 1.5)).toBe(300)
    expect(dpiForZoom(10, 2)).toBe(600)
  })
})
