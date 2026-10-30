import type { Bounds } from '../template/types'
import type { DetectionOptions, DetectionResult, NameAssignment, SheetCell, SheetConfig, SheetRole, UnnamedText } from './types'

const DEFAULT_GAP_MM = 12
const MATCH_TOLERANCE_MM = 4

interface Run {
  lo: number
  hi: number
  items: number[]
}

/** Merges overlapping [lo, hi] spans (in one axis) into runs, ordered ascending by lo. */
function toRuns(spans: { lo: number; hi: number }[]): Run[] {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a]!.lo - spans[b]!.lo)
  const runs: Run[] = []
  for (const i of order) {
    const s = spans[i]!
    const last = runs.at(-1)
    if (last && s.lo <= last.hi) {
      last.hi = Math.max(last.hi, s.hi)
      last.items.push(i)
    } else runs.push({ lo: s.lo, hi: s.hi, items: [i] })
  }
  return runs
}

/**
 * Groups runs into `k` clusters at its k-1 widest gaps, or (when k is not given) at every gap wider than gapMm.
 * Cards are far apart compared with the spacing of text inside a card, so the gaps are unambiguous in practice.
 */
function cluster(spans: { lo: number; hi: number }[], k: number | undefined, gapMm: number): Run[] {
  const runs = toRuns(spans)
  if (runs.length <= 1) return runs
  const gaps = runs.slice(1).map((r, i) => ({ at: i + 1, gap: r.lo - runs[i]!.hi }))
  const cuts = new Set(k !== undefined ? [...gaps].sort((a, b) => b.gap - a.gap).slice(0, Math.max(0, k - 1)).map((g) => g.at) : autoCuts(gaps, gapMm))
  const out: Run[] = []
  runs.forEach((r, i) => {
    const last = out.at(-1)
    if (last && !cuts.has(i)) {
      last.hi = Math.max(last.hi, r.hi)
      last.items.push(...r.items)
    } else out.push({ lo: r.lo, hi: r.hi, items: [...r.items] })
  })
  return out
}

/**
 * Chooses which gaps separate cards. Gaps between cards are clearly wider than gaps between the texts inside one
 * card, so the widest "jump" in the sorted gap sizes marks the boundary; a fixed width is only the fallback.
 */
function autoCuts(gaps: { at: number; gap: number }[], fallbackMm: number): number[] {
  const MIN_CARD_GAP = 6
  const wide = gaps.filter((g) => g.gap >= MIN_CARD_GAP).sort((a, b) => b.gap - a.gap)
  let best = -1
  let bestRatio = 0
  for (let i = 0; i + 1 < wide.length; i++) {
    const ratio = wide[i]!.gap / Math.max(wide[i + 1]!.gap, 0.001)
    if (ratio > bestRatio) {
      bestRatio = ratio
      best = i
    }
  }
  if (bestRatio >= 1.4) return wide.slice(0, best + 1).map((g) => g.at)
  return gaps.filter((g) => g.gap > fallbackMm).map((g) => g.at)
}

const STATIC_LABEL = /^\s*[A-Za-z][A-Za-z0-9 .#/&'-]{0,30}:\s*$/

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/** Fixed captions such as "ADDRESS:" or a stack of them ("ADDRESS:\rCONTROL NO.:") are not fields. */
export function looksLikeLabel(text: string): boolean {
  const lines = splitLines(text).filter((l) => l.trim().length > 0)
  return lines.length > 0 && lines.every((l) => STATIC_LABEL.test(l))
}

/** Midpoints between neighbouring clusters become the edges of each card's region; outer edges extend by half the average gap. */
function edges(runs: Run[], pageMax: number | undefined): { lo: number; hi: number }[] {
  const gaps = runs.slice(1).map((r, i) => r.lo - runs[i]!.hi)
  const half = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / 2 : 5
  return runs.map((r, i) => {
    let lo = i === 0 ? r.lo - half : (runs[i - 1]!.hi + r.lo) / 2
    let hi = i === runs.length - 1 ? r.hi + half : (r.hi + runs[i + 1]!.lo) / 2
    lo = Math.max(0, lo)
    if (pageMax !== undefined) hi = Math.min(pageMax, hi)
    return { lo, hi }
  })
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

/**
 * Finds the grid of cards on a page from the positions of its (unnamed) text objects and replicates the reference
 * card's objects as roles across all cells. Pure geometry: it never looks at what the text says except to spot
 * fixed captions, so it works for any layout with repeated cards.
 */
export function detectSheetGrid(objects: UnnamedText[], options: DetectionOptions = {}): DetectionResult | { error: string } {
  const pageIndex = options.pageIndex ?? mostPopulatedPage(objects)
  const items = objects.filter((o) => o.pageIndex === pageIndex)
  if (items.length === 0) return { error: 'The page has no unnamed text objects to arrange into cards.' }

  const gap = options.gapMm ?? DEFAULT_GAP_MM
  const xRuns = cluster(items.map((o) => ({ lo: o.bounds.left, hi: o.bounds.right })), options.columns, gap)
  // CorelDRAW's y axis points up: the top row has the largest y, so order rows by descending position.
  const yRunsAsc = cluster(items.map((o) => ({ lo: o.bounds.bottom, hi: o.bounds.top })), options.rows, gap)
  const yRuns = [...yRunsAsc].reverse()
  const colOf = new Map<number, number>()
  const rowOf = new Map<number, number>()
  xRuns.forEach((r, c) => r.items.forEach((i) => colOf.set(i, c)))
  yRuns.forEach((r, rr) => r.items.forEach((i) => rowOf.set(i, rr)))

  const columns = xRuns.length
  const rows = yRuns.length
  const order = options.order ?? 'rows'
  const xEdges = edges(xRuns, options.pageWidthMm)
  const yEdgesAsc = edges(yRunsAsc, options.pageHeightMm)
  const yEdges = [...yEdgesAsc].reverse()

  const warnings: string[] = []
  const cells: SheetCell[] = []
  const members: number[][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const index = order === 'rows' ? r * columns + c + 1 : c * rows + r + 1
      const ids = items.map((_, i) => i).filter((i) => colOf.get(i) === c && rowOf.get(i) === r)
      const region: Bounds = { left: xEdges[c]!.lo, right: xEdges[c]!.hi, bottom: yEdges[r]!.lo, top: yEdges[r]!.hi }
      cells.push({ index, col: c + 1, row: r + 1, region, objects: {} })
      members[index - 1] = ids
    }
  }
  cells.sort((a, b) => a.index - b.index)

  // Reference card = the first cell with the most objects.
  let ref = 0
  members.forEach((m, i) => {
    if (m.length > members[ref]!.length) ref = i
  })
  const refCell = cells[ref]!
  const origin = (cell: SheetCell) => ({ x: xRuns[cell.col - 1]!.lo, y: yRuns[cell.row - 1]!.hi })
  const rel = (o: UnnamedText, cell: SheetCell) => {
    const p = origin(cell)
    return { left: o.bounds.left - p.x, top: o.bounds.top - p.y, right: o.bounds.right - p.x, bottom: o.bounds.bottom - p.y }
  }

  const refObjects = members[ref]!.map((i) => items[i]!).sort((a, b) => {
    const ra = rel(a, refCell)
    const rb = rel(b, refCell)
    return Math.round(rb.top * 2) - Math.round(ra.top * 2) || ra.left - rb.left
  })
  const roles: SheetRole[] = refObjects.map((o, i) => {
    const lines = splitLines(o.text)
    return {
      id: `f${i + 1}`,
      label: `Text ${i + 1} · ${o.font} ${o.sizePt} pt`,
      templateLines: lines,
      isParagraph: o.isParagraph,
      font: o.font,
      sizePt: o.sizePt,
      mixedFormatting: o.mixedFormatting,
      isLabel: looksLikeLabel(o.text),
      relBounds: rel(o, refCell)
    }
  })

  const width = Math.max(2, String(cells.length).length)
  const assignments: NameAssignment[] = []
  const nameFor = (cell: SheetCell, roleId: string) => `C${pad(cell.index, width)}_${roleId}`

  cells.forEach((cell, ci) => {
    const pool = members[ci]!.map((i) => items[i]!)
    const taken = new Set<UnnamedText>()
    for (const [ri, role] of roles.entries()) {
      const target = refObjects[ri]!
      const t = rel(target, refCell)
      let best: UnnamedText | null = null
      let bestCost = Infinity
      for (const o of pool) {
        if (taken.has(o)) continue
        const p = rel(o, cell)
        const cost = Math.hypot(p.left - t.left, p.top - t.top) + (o.font === role.font && o.sizePt === role.sizePt ? 0 : 6)
        if (cost < bestCost) {
          best = o
          bestCost = cost
        }
      }
      if (best && bestCost <= MATCH_TOLERANCE_MM + 6) {
        taken.add(best)
        const name = nameFor(cell, role.id)
        cell.objects[role.id] = name
        assignments.push({ uid: best.uid, name })
      } else warnings.push(`Card ${cell.index} has no object matching "${role.label}".`)
    }
    const extra = pool.filter((o) => !taken.has(o)).length
    if (extra > 0) warnings.push(`Card ${cell.index} has ${extra} text object(s) that do not match the reference card; they were left unnamed.`)
  })

  const counts = new Set(members.map((m) => m.length))
  if (counts.size > 1) warnings.push(`Cards do not all contain the same number of text objects (${[...counts].sort().join(', ')}). Check the detected grid.`)

  const config: SheetConfig = { version: 1, pageIndex, columns, rows, order, cells, roles, warnings, preparedAt: null }
  return { config, assignments }
}

function mostPopulatedPage(objects: UnnamedText[]): number {
  const counts = new Map<number, number>()
  for (const o of objects) counts.set(o.pageIndex, (counts.get(o.pageIndex) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1
}
