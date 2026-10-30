import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSheetValues, planSheets } from '../../../shared/sheet/compose'
import { CSS_PX_PER_MM, cardCssSize, clampIndex, dpiForZoom, fitZoom, recordTitle, searchRecords, zoomIn, zoomOut } from '../../../shared/preview/navigation'
import type { SheetCell, SheetRole } from '../../../shared/sheet/types'
import type { TemplateRecord } from '../../../shared/template/types'
import type { ImportRecord } from '../../../shared/types'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, EmptyState, IconButton, PageHeader, Spinner, useElementSize } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { useSheetData } from '../state/sheet'
import { useSheetSettings } from '../state/sheetSettings'
import { useCorelRender } from './PreviewScreen'

type Zoom = number | 'fit'
const MAX_DPI = 300
const CARD_DETAIL_DPI = 200
const MAX_MATCHES = 5000

const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement

/** Map "C03_f2" back to its card position and text number. */
function parseObjectName(name: string): { cell: number; role: string } | null {
  const m = /^C(\d+)_(f\d+)$/.exec(name)
  return m ? { cell: Number(m[1]), role: m[2]! } : null
}

/**
 * The print-production workspace for card sheets: one full A4 page rendered by CorelDRAW with a different record in
 * every card position. Sheets render on demand (never all at once) and the main process keeps a size-bounded cache.
 */
export function SheetPreview({ template }: { template: TemplateRecord }) {
  const sheet = template.sheet!
  const mapping = template.sheetMapping!
  const { dataset, eligible, excludedRows } = useSheetData()
  const [settings, setSettings] = useSheetSettings(template)
  const [sheetNumber, setSheetNumber] = useState(1)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [selected, setSelected] = useState<number | null>(null)
  const [showOutlines, setShowOutlines] = useState(true)
  const [showMargin, setShowMargin] = useState(false)
  const [panel, setPanel] = useState(() => window.innerWidth >= 1180)
  const [query, setQuery] = useState('')
  const [matchAt, setMatchAt] = useState(0)
  const [jump, setJump] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>()

  const columns = dataset?.columns ?? []
  const plan = useMemo(() => planSheets(eligible.length, settings.cardsPerSheet), [eligible.length, settings.cardsPerSheet])
  const sheetCount = plan.sheets.length
  const current = clampIndex(sheetNumber - 1, sheetCount) + 1
  const item = plan.sheets[current - 1]
  const records = useMemo(() => (item ? eligible.slice(item.first, item.first + item.count) : []), [eligible, item])
  const built = useMemo(() => buildSheetValues(sheet, mapping, records, columns), [sheet, mapping, records, columns])
  const page = template.inspection.pages.find((p) => p.index === sheet.pageIndex) ?? template.inspection.pages[0]!

  // Fit leaves room for the caption row and padding; a fixed page aspect ratio is kept at every zoom.
  // A whole A4 page must fit even in a very small window, so the fit may go below the usual 25 % floor.
  const fit = Math.max(0.1, fitZoom(page.widthMm, page.heightMm, canvasSize.w - 48, canvasSize.h - 64, 0.1))
  const effective = zoom === 'fit' ? fit : zoom
  const dpi = Math.min(MAX_DPI, Math.max(selected ? CARD_DETAIL_DPI : 0, dpiForZoom(effective, window.devicePixelRatio || 1)))
  const { result, error, loading, retry } = useCorelRender(template, built.values, dpi, [page.index], settings.clearEmpty ? { regions: built.emptyRegions, page: page.index } : undefined)

  // Search by control number or name across every eligible record; results jump to the sheet and card that holds them.
  const matches = useMemo(() => {
    if (!query.trim()) return [] as number[]
    const rowIndex = new Map(eligible.map((r, i) => [r.rowNumber, i]))
    return searchRecords(eligible, columns, query)
      .slice(0, MAX_MATCHES)
      .map((r) => rowIndex.get(r.rowNumber)!)
  }, [query, eligible, columns])

  const goToRecord = useCallback(
    (recordIndex: number) => {
      const s = Math.floor(recordIndex / settings.cardsPerSheet) + 1
      setSheetNumber(s)
      setSelected((recordIndex % settings.cardsPerSheet) + 1)
    },
    [settings.cardsPerSheet]
  )
  useEffect(() => {
    setMatchAt(0)
    if (matches.length > 0) goToRecord(matches[0]!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])
  const stepMatch = (d: number) => {
    if (matches.length === 0) return
    const next = (matchAt + d + matches.length) % matches.length
    setMatchAt(next)
    goToRecord(matches[next]!)
  }
  const goSheet = (n: number) => {
    setSheetNumber(clampIndex(n - 1, sheetCount) + 1)
    setSelected(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role=dialog]')) return
      const act = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      if (e.key === '/') return act(() => searchRef.current?.focus())
      if (e.key === 'ArrowRight' || e.key === 'PageDown') act(() => goSheet(current + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') act(() => goSheet(current - 1))
      else if (e.key === 'Home') act(() => goSheet(1))
      else if (e.key === 'End') act(() => goSheet(sheetCount))
      else if (e.key === '+' || e.key === '=') act(() => setZoom(zoomIn(effective)))
      else if (e.key === '-') act(() => setZoom(zoomOut(effective)))
      else if (e.key === '0') act(() => setZoom('fit'))
      else if (e.key === '1') act(() => setZoom(1))
      else if (e.key === 'Escape') act(() => setSelected(null))
      else if (e.key === 'i' || e.key === 'I') act(() => setPanel((v) => !v))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, sheetCount, effective])

  // Warnings for this sheet: text that may not fit (measured by CorelDRAW) and mapped fields that are empty for a record.
  const overflow = useMemo(() => {
    const byCell = new Map<number, string[]>()
    for (const o of result?.objects ?? []) {
      if (!o.overflow) continue
      const p = parseObjectName(o.name)
      if (!p) continue
      byCell.set(p.cell, [...(byCell.get(p.cell) ?? []), `${sheet.roles.find((r) => r.id === p.role)?.label ?? o.name}: ${o.reason ?? 'may not fit'}`])
    }
    return byCell
  }, [result, sheet.roles])
  const blanks = useMemo(() => {
    const byCell = new Map<number, string[]>()
    records.forEach((rec, i) => {
      const labels: string[] = []
      for (const role of sheet.roles) {
        role.templateLines.forEach((line, li) => {
          const fill = mapping.fields[role.id]?.[li]
          if (fill?.kind !== 'column' || !line.trim()) return
          const col = columns.find((c) => c.label === fill.columnLabel)
          if (col && !rec.values[col.key]) labels.push(fill.columnLabel)
        })
      }
      if (labels.length > 0) byCell.set(i + 1, [...new Set(labels)])
    })
    return byCell
  }, [records, sheet.roles, mapping, columns])

  if (sheetCount === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Sheet preview" />
        <EmptyState title="No printable records">Every record has errors, so no sheet can be built. Fix the spreadsheet or review the import issues.</EmptyState>
      </div>
    )
  }

  const size = cardCssSize(page.widthMm, page.heightMm, effective)
  const px = (mm: number) => mm * CSS_PX_PER_MM * effective
  const selectedCell = selected ? sheet.cells.find((c) => c.index === selected) : undefined
  const selectedRecord = selected ? records[selected - 1] : undefined
  const warningCount = overflow.size + blanks.size
  const first = records[0]
  const last = records.at(-1)

  return (
    <div className="flex h-full flex-col" data-testid="sheet-preview">
      <PageHeader title="Sheet preview" description={`A4 ${page.widthMm} × ${page.heightMm} mm · ${settings.cardsPerSheet} cards per sheet · rendered by CorelDRAW ${template.inspection.corelVersion.replace(/^Version /, '')}`} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-3 py-1.5" role="toolbar" aria-label="Sheet controls">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2 top-[7px] text-fg-subtle" />
          <input
            ref={searchRef}
            className="input w-44 pl-7 wide:w-60"
            type="search"
            aria-label="Search by control number or name"
            placeholder="Control no. or name…  ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') {
                setQuery('')
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        {query.trim() && (
          <span className="flex items-center gap-1 text-xs tabular-nums text-fg-muted" aria-live="polite" data-testid="match-status">
            {matches.length === 0 ? 'No match' : `Match ${matchAt + 1} of ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''}`}
            <IconButton label="Previous match (Shift+Enter)" icon="chevronLeft" disabled={matches.length < 2} onClick={() => stepMatch(-1)} />
            <IconButton label="Next match (Enter)" icon="chevronRight" disabled={matches.length < 2} onClick={() => stepMatch(1)} />
          </span>
        )}
        <div className="flex items-center gap-1 border-l border-line pl-2">
          <IconButton label="Previous sheet (←)" icon="chevronLeft" disabled={current <= 1} onClick={() => goSheet(current - 1)} />
          <span className="min-w-[8.5rem] text-center tabular-nums" aria-live="polite" data-testid="sheet-position">
            Sheet <strong>{current.toLocaleString()}</strong> of {sheetCount.toLocaleString()}
          </span>
          <IconButton label="Next sheet (→)" icon="chevronRight" disabled={current >= sheetCount} onClick={() => goSheet(current + 1)} />
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (jump) goSheet(Number(jump))
              setJump('')
            }}
          >
            <input className="input w-20" type="number" min={1} max={sheetCount} aria-label="Go to sheet number" placeholder="Go to…" value={jump} onChange={(e) => setJump(e.target.value)} />
          </form>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Zoom out (−)" icon="zoomOut" onClick={() => setZoom(zoomOut(effective))} />
          <span className="w-11 text-center tabular-nums" aria-label={`Zoom ${Math.round(effective * 100)} percent`}>
            {Math.round(effective * 100)}%
          </span>
          <IconButton label="Zoom in (+)" icon="zoomIn" onClick={() => setZoom(zoomIn(effective))} />
          <Button className={zoom === 'fit' ? 'btn-pressed' : ''} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} title="Fit the sheet to the window (0)">
            <Icon name="fit" size={14} />
            Fit
          </Button>
          <Button className={zoom === 1 ? 'btn-pressed' : ''} aria-pressed={zoom === 1} onClick={() => setZoom(1)} title="Real size on this display (1)">
            100%
          </Button>
          <IconButton label={panel ? 'Hide details panel (I)' : 'Show details panel (I)'} icon="sidebar" pressed={panel} onClick={() => setPanel((v) => !v)} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={canvasRef} className="flex min-h-0 flex-1 overflow-auto bg-canvas" data-testid="sheet-canvas" tabIndex={0} aria-label="A4 sheet preview canvas">
            <figure className="m-auto flex flex-col items-center p-4">
              <div className="relative bg-white shadow-card" style={{ width: size.width, height: size.height }} data-testid="sheet-frame">
                {result?.pages[0] ? (
                  <img src={result.pages[0].dataUrl} alt={`Sheet ${current} of ${sheetCount}`} className={`h-full w-full object-fill transition-opacity ${loading ? 'opacity-50' : ''}`} draggable={false} />
                ) : (
                  !error && (
                    <span className="absolute inset-0 grid place-items-center text-fg-subtle">
                      <Spinner label="Rendering sheet" />
                    </span>
                  )
                )}
                {showMargin && <div className="pointer-events-none absolute border border-dashed border-err/70" style={{ inset: px(3) }} aria-hidden title="Safety margin" />}
                {sheet.cells.map((cell) => {
                  const rec = records[cell.index - 1]
                  const empty = !rec
                  const warn = overflow.has(cell.index) ? 'err' : blanks.has(cell.index) ? 'warn' : null
                  const r = cell.region
                  return (
                    <button
                      key={cell.index}
                      type="button"
                      data-testid={`cell-${cell.index}`}
                      aria-label={empty ? `Card ${cell.index}: empty position` : `Card ${cell.index}: ${recordTitle(rec, columns) || `row ${rec.rowNumber}`}${warn ? ', has warnings' : ''}`}
                      aria-pressed={selected === cell.index}
                      onClick={() => setSelected(selected === cell.index ? null : cell.index)}
                      className={`absolute text-left outline-offset-0 ${selected === cell.index ? 'border-2 border-overlay bg-overlay/10' : showOutlines ? 'border border-dashed border-overlay/40 hover:border-overlay hover:bg-overlay/10' : 'border border-transparent hover:border-overlay/60'}`}
                      style={{ left: px(r.left), top: px(page.heightMm - r.top), width: px(r.right - r.left), height: px(r.top - r.bottom) }}
                    >
                      {showOutlines && <span className="absolute left-0.5 top-0.5 rounded-sm bg-overlay px-1 text-2xs font-semibold leading-3 text-white">{cell.index}</span>}
                      {warn && <span className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border border-white ${warn === 'err' ? 'bg-err' : 'bg-warn'}`} aria-hidden />}
                      {empty && <span className="absolute inset-0 grid place-items-center bg-white/60 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">empty</span>}
                    </button>
                  )
                })}
              </div>
              <figcaption className="mt-1 h-5 text-xs tabular-nums text-fg-muted">
                Sheet {current.toLocaleString()} · {page.widthMm} × {page.heightMm} mm
                {first && last && ` · rows ${first.rowNumber}–${last.rowNumber}`}
              </figcaption>
            </figure>
          </div>
          {loading && (
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-xs shadow-card" role="status">
              <Spinner />
              Rendering sheet in CorelDRAW…
            </div>
          )}
          {error && (
            <div className="absolute inset-x-3 bottom-9 mx-auto max-w-lg">
              <Banner tone="error" title="CorelDRAW could not render this sheet" actions={<Button onClick={retry} className="h-6 px-2 text-xs">Retry</Button>}>
                {error}
              </Banner>
            </div>
          )}
          <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface px-3 text-xs text-fg-muted">
            <span className="tabular-nums">
              {item?.count ?? 0} of {settings.cardsPerSheet} positions filled · {dpi} dpi
            </span>
            {warningCount === 0 && result && !loading ? <span className="text-ok">No problems on this sheet</span> : warningCount > 0 ? <span className={overflow.size ? 'text-err' : 'text-warn'}>{overflow.size ? `${overflow.size} card(s) with text that may not fit` : ''}{overflow.size && blanks.size ? ' · ' : ''}{blanks.size ? `${blanks.size} card(s) with blank fields` : ''}</span> : null}
            <label className="ml-auto flex items-center gap-1.5">
              <input type="checkbox" className="check" checked={showOutlines} onChange={(e) => setShowOutlines(e.target.checked)} /> Card outlines
            </label>
            <label className="flex items-center gap-1.5" title="Dashed line at the safety margin set in Settings">
              <input type="checkbox" className="check" checked={showMargin} onChange={(e) => setShowMargin(e.target.checked)} /> Print margin
            </label>
          </div>
        </div>

        {panel && (
          <aside aria-label="Sheet details" className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-3" data-testid="sheet-inspector">
            {selectedCell && selectedRecord ? (
              <CardDetail cell={selectedCell} record={selectedRecord} roles={sheet.roles} values={built.values} columns={columns} overflow={overflow.get(selectedCell.index)} blank={blanks.get(selectedCell.index)} image={result?.pages[0]?.dataUrl} pageWidthMm={page.widthMm} pageHeightMm={page.heightMm} />
            ) : selectedCell ? (
              <p className="muted">Card {selectedCell.index} has no record on this sheet{settings.clearEmpty ? ' and its artwork is removed from the render and the output' : ''}.</p>
            ) : (
              <>
                <p className="text-base font-semibold">Sheet {current.toLocaleString()}</p>
                <p className="muted text-xs">Click a card on the page to zoom in and see its record.</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-fg-muted">Records</dt>
                  <dd className="tabular-nums">{eligible.length.toLocaleString()} printable</dd>
                  <dt className="text-fg-muted">Sheets</dt>
                  <dd className="tabular-nums">{sheetCount.toLocaleString()}</dd>
                  <dt className="text-fg-muted">This sheet</dt>
                  <dd className="tabular-nums">{item?.count} cards</dd>
                  {excludedRows.length > 0 && (
                    <>
                      <dt className="text-fg-muted">Left out</dt>
                      <dd className="tabular-nums text-warn">{excludedRows.length} with errors</dd>
                    </>
                  )}
                </dl>
                {sheet.cells.length > 1 && (
                  <label className="mt-3 block text-xs">
                    <span className="label block">Cards per sheet</span>
                    <select className="input w-full" value={settings.cardsPerSheet} onChange={(e) => setSettings({ cardsPerSheet: Number(e.target.value) })} data-testid="cards-per-sheet">
                      {Array.from({ length: sheet.cells.length }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                          {n === sheet.cells.length ? ` (all ${n} positions)` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="muted mt-1 block">The first {settings.cardsPerSheet} positions are used; the rest stay empty.</span>
                  </label>
                )}
                <div className="mt-3 space-y-1">
                  {[...overflow.entries()].map(([cell, notes]) => (
                    <Banner key={`o${cell}`} tone="warn" title={`Card ${cell}: text may not fit`}>
                      {notes.join(' · ')}
                    </Banner>
                  ))}
                  {[...blanks.entries()].map(([cell, labels]) => (
                    <Banner key={`b${cell}`} tone="warn" title={`Card ${cell}: blank ${labels.join(', ')}`} />
                  ))}
                </div>
                <div className="mt-3 empty:hidden">
                  <X7Notice version={template.inspection.corelVersion} compact />
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

/** One card, magnified: a crop of the CorelDRAW render of this sheet, plus the record's values. */
function CardDetail({
  cell,
  record,
  roles,
  values,
  columns,
  overflow,
  blank,
  image,
  pageWidthMm,
  pageHeightMm
}: {
  cell: SheetCell
  record: ImportRecord
  roles: SheetRole[]
  values: Record<string, string>
  columns: { key: string; label: string }[]
  overflow?: string[]
  blank?: string[]
  image?: string
  pageWidthMm: number
  pageHeightMm: number
}) {
  const r = cell.region
  const w = r.right - r.left
  const h = r.top - r.bottom
  const SCALE = 3.2 // CSS px per mm of the magnified crop
  const title = recordTitle(record, columns as never)
  return (
    <div data-testid="card-detail">
      <p className="truncate text-base font-semibold" title={title}>
        {title || <span className="muted italic">no name</span>}
      </p>
      <p className="muted text-xs tabular-nums">
        Card {cell.index} · spreadsheet row {record.rowNumber}
      </p>
      <div className="mt-2 overflow-hidden rounded border border-line bg-white" style={{ width: Math.min(w * SCALE, 256), height: (Math.min(w * SCALE, 256) / w) * h }}>
        {image ? (
          <div
            role="img"
            aria-label={`Card ${cell.index} magnified`}
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${image})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${(pageWidthMm / w) * 100}% ${(pageHeightMm / h) * 100}%`,
              backgroundPosition: `${(r.left / (pageWidthMm - w)) * 100}% ${((pageHeightMm - r.top) / (pageHeightMm - h)) * 100}%`
            }}
          />
        ) : (
          <span className="grid h-full place-items-center">
            <Spinner label="Rendering" />
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1 empty:hidden">
        {overflow?.map((o, i) => (
          <Banner key={i} tone="warn" title="Text may not fit">
            {o}
          </Banner>
        ))}
        {blank && <Banner tone="warn" title={`Blank: ${blank.join(', ')}`}>This record has no value for a mapped field.</Banner>}
        {!overflow && !blank && <Badge tone="ok">No problems</Badge>}
      </div>
      <h4 className="label mb-1 mt-3">Printed on this card</h4>
      <dl className="divide-y divide-line border-y border-line">
        {roles
          .filter((role) => !role.isLabel && cell.objects[role.id] && values[cell.objects[role.id]!] !== undefined)
          .map((role) => (
            <div key={role.id} className="py-1.5">
              <dt className="text-xs text-fg-muted">{role.label}</dt>
              <dd className="whitespace-pre-wrap break-words font-mono text-xs">{values[cell.objects[role.id]!]?.trim() || <span className="muted italic">blank</span>}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}
