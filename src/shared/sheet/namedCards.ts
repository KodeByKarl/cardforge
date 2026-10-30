import type { TemplateObject } from '../template/types'
import { detectSheetGrid, looksLikeLabel } from './detect'
import type { SheetCell, SheetConfig, SheetRole, UnnamedText } from './types'

const CARD_OBJECT = /^(.*?)(\d+)_(.+)$/

/**
 * Templates whose designer already named every card's text objects "<prefix><number>_<field>" (card01_FullName,
 * card02_FullName, ...) are card sheets that need no renaming. Returns the sheet configuration, or null when the
 * names do not describe at least two cards with a common field. Nothing about the prefix or the field names is
 * fixed: the grouping only relies on the "<text><number>_<text>" shape and on geometry.
 */
export function detectNamedSheet(objects: TemplateObject[], page?: { widthMm: number; heightMm: number }): SheetConfig | null {
  const parsed = objects.flatMap((o) => {
    const m = CARD_OBJECT.exec(o.name)
    return m ? [{ obj: o, prefix: m[1]!, card: Number(m[2]), field: m[3]! }] : []
  })
  // The most common prefix wins; other names stay ordinary single-card objects.
  const cardsByPrefix = new Map<string, Set<number>>()
  for (const p of parsed) cardsByPrefix.set(p.prefix, (cardsByPrefix.get(p.prefix) ?? new Set()).add(p.card))
  const prefix = [...cardsByPrefix.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0]
  if (prefix === undefined || cardsByPrefix.get(prefix)!.size < 2) return null
  const items = parsed.filter((p) => p.prefix === prefix)
  const pageIndex = mostCommonPage(items.map((i) => i.obj.pageIndex))
  const onPage = items.filter((i) => i.obj.pageIndex === pageIndex)

  const cardNumbers = [...new Set(onPage.map((i) => i.card))].sort((a, b) => a - b)
  const geometry: UnnamedText[] = onPage.map((i) => ({ ...i.obj, uid: i.obj.name }))
  const grid = detectSheetGrid(geometry, { pageIndex, pageWidthMm: page?.widthMm, pageHeightMm: page?.heightMm })
  if ('error' in grid) return null

  // Each card number takes the grid slot that contains its objects.
  const bounds = (list: TemplateObject[]) => ({
    left: Math.min(...list.map((o) => o.bounds.left)),
    right: Math.max(...list.map((o) => o.bounds.right)),
    top: Math.max(...list.map((o) => o.bounds.top)),
    bottom: Math.min(...list.map((o) => o.bounds.bottom))
  })
  const slotOf = (b: { left: number; right: number; top: number; bottom: number }) => {
    const cx = (b.left + b.right) / 2
    const cy = (b.top + b.bottom) / 2
    return grid.config.cells.find((c) => cx >= c.region.left && cx <= c.region.right && cy >= c.region.bottom && cy <= c.region.top)
  }
  const warnings: string[] = []
  const cells: SheetCell[] = []
  const cardObjects = new Map<number, typeof onPage>()
  cardNumbers.forEach((card, rank) => {
    const mine = onPage.filter((i) => i.card === card)
    cardObjects.set(card, mine)
    const slot = slotOf(bounds(mine.map((i) => i.obj)))
    if (!slot) {
      warnings.push(`Card ${card} could not be placed on the detected grid.`)
      return
    }
    cells.push({ index: rank + 1, col: slot.col, row: slot.row, region: slot.region, objects: {} })
  })
  if (cells.length !== cardNumbers.length || new Set(cells.map((c) => `${c.col},${c.row}`)).size !== cells.length) return null

  // Fields come from the card with the most objects; reading order top to bottom, then left to right.
  const refCard = cardNumbers.reduce((best, c) => (cardObjects.get(c)!.length > cardObjects.get(best)!.length ? c : best))
  const refItems = cardObjects.get(refCard)!
  const origin = bounds(refItems.map((i) => i.obj))
  const ordered = [...refItems].sort((a, b) => Math.round(b.obj.bounds.top * 2) - Math.round(a.obj.bounds.top * 2) || a.obj.bounds.left - b.obj.bounds.left)
  const roles: SheetRole[] = ordered.map((i, n) => ({
    id: `f${n + 1}`,
    label: `${i.field} · ${i.obj.font} ${i.obj.sizePt} pt`,
    templateLines: i.obj.text.split(/\r\n|\r|\n/),
    isParagraph: i.obj.isParagraph,
    font: i.obj.font,
    sizePt: i.obj.sizePt,
    mixedFormatting: i.obj.mixedFormatting,
    isLabel: looksLikeLabel(i.obj.text),
    relBounds: { left: i.obj.bounds.left - origin.left, top: i.obj.bounds.top - origin.top, right: i.obj.bounds.right - origin.left, bottom: i.obj.bounds.bottom - origin.top }
  }))

  cardNumbers.forEach((card, rank) => {
    const cell = cells[rank]!
    for (const [n, ref] of ordered.entries()) {
      const match = cardObjects.get(card)!.find((i) => i.field === ref.field)
      if (match) cell.objects[`f${n + 1}`] = match.obj.name
      else warnings.push(`Card ${card} has no object for the field “${ref.field}”.`)
    }
  })
  // Layout order follows the card numbers; make the reported grid agree with the cells actually found.
  const columns = new Set(cells.map((c) => c.col)).size
  const rows = new Set(cells.map((c) => c.row)).size
  return { version: 1, pageIndex, columns, rows, order: 'rows', cells, roles, warnings, preparedAt: new Date().toISOString() }
}

function mostCommonPage(pages: number[]): number {
  const counts = new Map<number, number>()
  for (const p of pages) counts.set(p, (counts.get(p) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1
}
