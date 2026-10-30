import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { hasBlockingMappingIssues, missingFieldsFor, objectNamesByPosition, shapeValuesFor } from '../../../shared/template/mapping'
import type { Bounds, PreviewResult, TemplateRecord } from '../../../shared/template/types'
import type { ImportRecord } from '../../../shared/types'
import {
  CSS_PX_PER_MM,
  cardCssSize,
  chooseLayout,
  clampIndex,
  dpiForZoom,
  gridPage,
  recordTitle,
  searchRecords,
  stepIndex,
  zoomIn,
  zoomOut
} from '../../../shared/preview/navigation'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, EmptyState, IconButton, PageHeader, Segmented, Spinner, useElementSize } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { SheetPreview } from './SheetPreview'
import { useJob } from '../state/job'
import { pageLabel, useTemplates } from '../state/templates'

type Side = 'both' | number
type Zoom = number | 'fit'
const GRID_PAGE_SIZE = 12
const GRID_DPI = 96
const MAX_SINGLE_DPI = 450
const PAGE_GAP_MM = 6
/** Crop-mark margin (14px each side) and caption row: fixed chrome around every card on the pasteboard. */
const CHROME = { x: 28, y: 28 + 20 }
const INSPECTOR_KEY = 'cardforge.preview.inspector'

interface InspectorPrefs {
  open: boolean
  width: number
}

function readInspectorPrefs(): InspectorPrefs {
  const fallback = { open: window.innerWidth >= 1180, width: 300 }
  try {
    const raw = localStorage.getItem(INSPECTOR_KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<InspectorPrefs>
    return { open: typeof p.open === 'boolean' ? p.open : fallback.open, width: Math.min(520, Math.max(240, Number(p.width) || 300)) }
  } catch {
    return fallback
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
}

export function PreviewScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { dataset, validation } = useJob()
  const { selected: template, issues } = useTemplates()
  const [mode, setMode] = useState<'single' | 'grid'>('single')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [side, setSide] = useState<Side>('both')
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [prefs, setPrefs] = useState<InspectorPrefs>(readInspectorPrefs)
  const searchRef = useRef<HTMLInputElement>(null)

  const records = useMemo(() => (dataset ? searchRecords(dataset.records, dataset.columns, query) : []), [dataset, query])
  const current = clampIndex(index, records.length)
  const gate = !dataset ? 'import' : !template ? 'template' : hasBlockingMappingIssues(issues) ? 'mapping' : null

  const updatePrefs = useCallback((patch: Partial<InspectorPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(INSPECTOR_KEY, JSON.stringify(next))
      } catch {
        // Not persisted; applies for this session.
      }
      return next
    })
  }, [])

  // Canvas size drives Fit and the front/back arrangement.
  const [canvasRef, canvasSize] = useElementSize<HTMLDivElement>()
  const allPages = template?.inspection.pages ?? []
  const pages = side === 'both' ? allPages : allPages.filter((p) => p.index === side)
  const { layout, zoom: fit } = chooseLayout(pages, PAGE_GAP_MM, canvasSize.w - 32, canvasSize.h - 32, CHROME)
  const effectiveZoom = zoom === 'fit' ? fit : zoom

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (template?.sheet?.preparedAt) return // the sheet workspace has its own shortcuts
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role=dialog]')) return
      const n = records.length
      const act = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      if (e.key === '/') return act(() => searchRef.current?.focus())
      if (e.key === 'g' || e.key === 'G') return act(() => setMode((m) => (m === 'grid' ? 'single' : 'grid')))
      if (mode !== 'single') return
      if (e.key === 'ArrowRight') act(() => setIndex(stepIndex(current, 1, n)))
      else if (e.key === 'ArrowLeft') act(() => setIndex(stepIndex(current, -1, n)))
      else if (e.key === 'Home') act(() => setIndex(0))
      else if (e.key === 'End') act(() => setIndex(Math.max(0, n - 1)))
      else if (e.key === '+' || e.key === '=') act(() => setZoom(zoomIn(effectiveZoom)))
      else if (e.key === '-') act(() => setZoom(zoomOut(effectiveZoom)))
      else if (e.key === '0') act(() => setZoom('fit'))
      else if (e.key === '1') act(() => setZoom(1))
      else if (e.key === 'i' || e.key === 'I') act(() => updatePrefs({ open: !prefs.open }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, current, records.length, effectiveZoom, prefs.open, updatePrefs])

  const header = (
    <PageHeader
      title="Card preview"
      description={template ? `Rendered by CorelDRAW ${template.inspection.corelVersion.replace(/^Version /, '')} from “${template.name}”.` : 'Previews are rendered by CorelDRAW from the real template.'}
      actions={
        !gate && (
          <Segmented
            label="Preview mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'single', label: <><Icon name="single" size={14} />Single</>, title: 'One record at a time (G)' },
              { value: 'grid', label: <><Icon name="grid" size={14} />Grid</>, title: 'Contact sheet of records (G)' }
            ]}
          />
        )
      }
    />
  )

  if (!gate && template?.sheet?.preparedAt) return <SheetPreview template={template} />

  if (gate) {
    const content =
      gate === 'import'
        ? { title: 'No spreadsheet imported', hint: 'Cards are previewed from your employee records.', action: 'Go to Excel import', to: 'import' as ScreenKey }
        : gate === 'template'
          ? { title: 'No template selected', hint: 'Choose the CorelDRAW template the cards are built from.', action: 'Go to Template setup', to: 'template' as ScreenKey }
          : { title: 'The field mapping has errors', hint: 'Fix the highlighted mapping problems before previewing.', action: 'Fix the mapping', to: 'template' as ScreenKey }
    return (
      <div className="flex h-full flex-col">
        {header}
        <EmptyState
          title={content.title}
          action={
            <Button variant="primary" onClick={() => navigate(content.to)}>
              {content.action}
            </Button>
          }
        >
          {content.hint}
        </EmptyState>
      </div>
    )
  }

  const record = records[current]

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-3 py-1.5" role="toolbar" aria-label="Preview controls">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2 top-[7px] text-fg-subtle" />
          <input
            ref={searchRef}
            className="input w-40 pl-7 wide:w-56"
            type="search"
            aria-label="Search records"
            placeholder="Search records…  ( / )"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
          />
        </div>
        {allPages.length > 1 && (
          <select className="input" value={String(side)} onChange={(e) => setSide(e.target.value === 'both' ? 'both' : Number(e.target.value))} aria-label="Pages shown">
            <option value="both">{allPages.length === 2 ? 'Front and back' : 'All pages'}</option>
            {allPages.map((p) => (
              <option key={p.index} value={p.index}>
                {pageLabel(p.index, allPages.length)} only
              </option>
            ))}
          </select>
        )}

        {mode === 'single' && records.length > 0 && (
          <div className="flex items-center gap-1 border-l border-line pl-2">
            <IconButton label="Previous record (←)" icon="chevronLeft" disabled={current === 0} onClick={() => setIndex(stepIndex(current, -1, records.length))} />
            <span className="min-w-[8.5rem] text-center tabular-nums" aria-live="polite">
              Record <strong>{current + 1}</strong> of {records.length}
              {record && <span className="muted compact:hidden"> · row {record.rowNumber}</span>}
            </span>
            <IconButton label="Next record (→)" icon="chevronRight" disabled={current >= records.length - 1} onClick={() => setIndex(stepIndex(current, 1, records.length))} />
          </div>
        )}
        {mode === 'grid' && (
          <span className="muted tabular-nums">
            {records.length} of {dataset!.records.length} records
          </span>
        )}

        {mode === 'single' && (
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Zoom out (−)" icon="zoomOut" onClick={() => setZoom(zoomOut(effectiveZoom))} />
            <span className="w-11 text-center tabular-nums" aria-label={`Zoom ${Math.round(effectiveZoom * 100)} percent`}>
              {Math.round(effectiveZoom * 100)}%
            </span>
            <IconButton label="Zoom in (+)" icon="zoomIn" onClick={() => setZoom(zoomIn(effectiveZoom))} />
            <Button className={zoom === 'fit' ? 'btn-pressed' : ''} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} title="Fit the cards to the window (0)">
              <Icon name="fit" size={14} />
              Fit
            </Button>
            <Button className={zoom === 1 ? 'btn-pressed' : ''} aria-pressed={zoom === 1} onClick={() => setZoom(1)} title="Real size on this display (1)">
              100%
            </Button>
            <IconButton label={prefs.open ? 'Hide details panel (I)' : 'Show details panel (I)'} icon="sidebar" pressed={prefs.open} onClick={() => updatePrefs({ open: !prefs.open })} />
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <EmptyState title="No records match" action={<Button onClick={() => setQuery('')}>Clear search</Button>}>
          Nothing found for “{query}”.
        </EmptyState>
      ) : mode === 'single' ? (
        <SingleView
          template={template!}
          record={record!}
          pages={pages.map((p) => p.index)}
          side={side}
          zoom={effectiveZoom}
          layout={layout}
          canvasRef={canvasRef}
          onZoom={setZoom}
          inspector={prefs}
          onInspectorWidth={(width) => updatePrefs({ width })}
        />
      ) : (
        <GridView
          template={template!}
          records={records}
          side={side}
          onOpen={(i) => {
            setIndex(i)
            setMode('single')
          }}
          validationRows={validation?.byRow}
        />
      )}
    </div>
  )
}

/** Renders one record through CorelDRAW; keeps the previous image on screen while the next one renders. */
export function useCorelRender(template: TemplateRecord, values: Record<string, string> | null, dpi: number, pages: number[], clear?: { regions: Bounds[]; page: number }) {
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const key = JSON.stringify([template.id, template.updatedAt, values, dpi, pages, nonce, clear ?? null])
  useEffect(() => {
    if (!values) return
    let stale = false
    setLoading(true)
    setError(null)
    unwrap(api.preview.render({ templateId: template.id, values, dpi, pages, ...(clear && clear.regions.length > 0 ? { clearRegions: clear.regions, clearPage: clear.page } : {}) }))
      .then((r) => !stale && setResult(r), (err) => !stale && setError(errorMessage(err)))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { result, error, loading, retry: () => setNonce((n) => n + 1) }
}

function SingleView({
  template,
  record,
  pages: pageIndexes,
  side,
  zoom,
  layout,
  canvasRef,
  onZoom,
  inspector,
  onInspectorWidth
}: {
  template: TemplateRecord
  record: ImportRecord
  pages: number[]
  side: Side
  zoom: number
  layout: 'row' | 'column'
  canvasRef: (el: HTMLDivElement | null) => void
  onZoom: (z: Zoom) => void
  inspector: InspectorPrefs
  onInspectorWidth: (w: number) => void
}) {
  const { validation, dataset } = useJob()
  const { resolved } = useTemplates()
  const allPages = template.inspection.pages
  const pages = allPages.filter((p) => pageIndexes.includes(p.index))
  const dpi = Math.min(MAX_SINGLE_DPI, dpiForZoom(zoom, window.devicePixelRatio || 1))
  const values = useMemo(() => shapeValuesFor(record, resolved), [record, resolved])
  const { result, error, loading, retry } = useCorelRender(template, values, dpi, pageIndexes)
  const canvasEl = useRef<HTMLDivElement | null>(null)

  const setCanvas = useCallback(
    (el: HTMLDivElement | null) => {
      canvasEl.current = el
      canvasRef(el)
    },
    [canvasRef]
  )

  // Ctrl + wheel zooms the artwork, like other print tools. Needs a non-passive native listener to stop page zoom.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => {
    const el = canvasEl.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      onZoom(e.deltaY < 0 ? zoomIn(zoomRef.current) : zoomOut(zoomRef.current))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onZoom])

  const missing = missingFieldsFor(record, resolved)
  const rowIssues = validation?.byRow.get(record.rowNumber) ?? []
  const overflow = (result?.objects ?? []).filter((o) => o.overflow)
  const notFound = result?.notFound ?? []
  const title = recordTitle(record, dataset?.columns ?? [])
  const orderedNames = objectNamesByPosition(template.inspection.objects).filter((n) => n in values)
  const gapPx = Math.round(PAGE_GAP_MM * CSS_PX_PER_MM * zoom)
  const problems = rowIssues.length + missing.length + overflow.length + notFound.length + (error ? 1 : 0)

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div ref={setCanvas} className="flex min-h-0 flex-1 overflow-auto bg-canvas" data-testid="preview-canvas" tabIndex={0} aria-label="Card preview canvas">
          <div className={`m-auto flex p-4 ${layout === 'column' ? 'flex-col' : 'flex-row'} items-center`} style={{ gap: gapPx }} data-layout={layout}>
            {pages.map((p) => {
              const size = cardCssSize(p.widthMm, p.heightMm, zoom)
              const img = result?.pages.find((r) => r.pageIndex === p.index)
              return (
                <figure key={p.index} className="flex flex-col items-center">
                  <div className="crop">
                    <div className="relative bg-white shadow-card" style={{ width: size.width, height: size.height }} data-testid="card-frame">
                      {img ? (
                        <img src={img.dataUrl} alt={`${pageLabel(p.index, allPages.length)} for row ${record.rowNumber}`} className={`h-full w-full object-fill transition-opacity ${loading ? 'opacity-50' : ''}`} draggable={false} />
                      ) : (
                        !error && (
                          <span className="absolute inset-0 grid place-items-center text-xs text-fg-subtle">
                            <Spinner label="Rendering" />
                          </span>
                        )
                      )}
                    </div>
                  </div>
                  <figcaption className="h-5 text-xs tabular-nums text-fg-muted">
                    {pageLabel(p.index, allPages.length)} · {p.widthMm} × {p.heightMm} mm
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </div>
        {loading && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-xs shadow-card" role="status">
            <Spinner />
            Rendering in CorelDRAW…
          </div>
        )}
        {error && (
          <div className="absolute inset-x-3 bottom-3 mx-auto max-w-lg">
            <Banner tone="error" title="CorelDRAW could not render this card" actions={<Button onClick={retry} className="h-6 px-2 text-xs">Retry</Button>}>
              {error}
            </Banner>
          </div>
        )}
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface px-3 text-xs text-fg-muted">
          <span className="tabular-nums">
            {side === 'both' && pages.length > 1 ? `${pages.length} pages` : pageLabel(pages[0]?.index ?? 1, allPages.length)} · {dpi} dpi render
          </span>
          {problems === 0 && result && !loading ? (
            <span className="text-ok">No problems found</span>
          ) : problems > 0 ? (
            <span className={overflow.length || notFound.length || error || rowIssues.some((i) => i.severity === 'error') ? 'text-err' : 'text-warn'}>
              {problems} {problems === 1 ? 'problem' : 'problems'}
              {overflow.length > 0 && ` · ${overflow.length} may not fit`}
            </span>
          ) : null}
        </div>
      </div>

      {inspector.open && (
        <>
          <ResizeHandle width={inspector.width} onChange={onInspectorWidth} />
          <aside aria-label="Record details" className="shrink-0 overflow-y-auto border-l border-line bg-surface p-3" style={{ width: inspector.width }} data-testid="inspector">
            <p className="truncate text-base font-semibold" title={title}>
              {title || <span className="muted italic">no name</span>}
            </p>
            <p className="muted text-xs tabular-nums">
              Spreadsheet row {record.rowNumber} · {pages[0]?.widthMm} × {pages[0]?.heightMm} mm
            </p>
            <div className="mt-3 space-y-1.5">
              {error && <Banner tone="error" title="Render failed">{error}</Banner>}
              {rowIssues.map((i, n) => (
                <Banner key={`v${n}`} tone={i.severity === 'error' ? 'error' : 'warn'} title={i.message} />
              ))}
              {missing.map((m) => (
                <Banner key={`m${m.objectName}`} tone="warn" title={`${m.objectName} will be blank`}>
                  Column “{m.columnLabel}” is empty for this row.
                </Banner>
              ))}
              {overflow.map((o) => (
                <Banner key={`o${o.name}${o.pageIndex}`} tone="warn" title={`${o.name} may not fit`}>
                  {o.reason} (measured by CorelDRAW)
                </Banner>
              ))}
              {notFound.map((n) => (
                <Banner key={`n${n}`} tone="error" title={`The template has no object named ${n}.`} />
              ))}
              {!error && result && problems === 0 && !loading && <Banner tone="ok" title="No problems found" />}
            </div>
            <h4 className="label mb-1 mt-4">Values on this card</h4>
            <dl className="divide-y divide-line border-y border-line">
              {orderedNames.map((name) => (
                <div key={name} className="py-1.5">
                  <dt className="text-xs text-fg-muted">{name}</dt>
                  <dd className="whitespace-pre-line break-words">{values[name] || <span className="muted italic">blank</span>}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 empty:hidden">
              <X7Notice version={template.inspection.corelVersion} compact />
            </div>
          </aside>
        </>
      )}
    </div>
  )
}

/** Draggable (and arrow-key operable) divider between the canvas and the details panel. */
function ResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null)
  const clamp = (w: number) => Math.min(520, Math.max(240, Math.round(w)))
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(clamp(drag.current.w - (e.clientX - drag.current.x)))
  }
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') onChange(clamp(width + 16))
    else if (e.key === 'ArrowRight') onChange(clamp(width - 16))
    else return
    e.preventDefault()
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details panel"
      aria-valuenow={width}
      aria-valuemin={240}
      aria-valuemax={520}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={onKey}
      className="-mx-0.5 w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/40 focus-visible:bg-accent/60"
    />
  )
}

interface Thumb {
  dataUrl: string
  overflow: number
  error?: string
}

type Density = 'compact' | 'regular' | 'large'
const DENSITY_MIN: Record<Density, number> = { compact: 150, regular: 210, large: 300 }

function GridView({
  template,
  records,
  side,
  onOpen,
  validationRows
}: {
  template: TemplateRecord
  records: ImportRecord[]
  side: Side
  onOpen: (index: number) => void
  validationRows: Map<number, { severity: string }[]> | undefined
}) {
  const { resolved } = useTemplates()
  const { dataset } = useJob()
  const [page, setPage] = useState(0)
  const [density, setDensity] = useState<Density>('regular')
  const [thumbs, setThumbs] = useState<Map<string, Thumb>>(new Map())
  const pageIndex = side === 'both' ? 1 : side
  const pg = gridPage(records.length, page, GRID_PAGE_SIZE)
  const visible = records.slice(pg.start, pg.end)
  const pageInfo = template.inspection.pages.find((p) => p.index === pageIndex)!
  const keyOf = (r: ImportRecord) => `${template.id}:${template.updatedAt}:${pageIndex}:${r.rowNumber}:${JSON.stringify(shapeValuesFor(r, resolved))}`

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, Math.ceil(records.length / GRID_PAGE_SIZE) - 1)))
  }, [records.length])

  // Render the visible page one card at a time; CorelDRAW handles one request at a time anyway.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const r of visible) {
        if (cancelled) return
        const key = keyOf(r)
        if (thumbs.has(key)) continue
        let thumb: Thumb
        try {
          const result = await unwrap(api.preview.render({ templateId: template.id, values: shapeValuesFor(r, resolved), dpi: GRID_DPI, pages: [pageIndex] }))
          thumb = { dataUrl: result.pages[0]?.dataUrl ?? '', overflow: result.objects.filter((o) => o.overflow).length }
        } catch (err) {
          thumb = { dataUrl: '', overflow: 0, error: errorMessage(err) }
        }
        if (cancelled) return
        setThumbs((m) => new Map(m).set(key, thumb))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pg.start, pg.end, records, pageIndex, template.updatedAt, resolved])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3">
        <ul className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${DENSITY_MIN[density]}px, 1fr))` }} data-testid="preview-grid">
          {visible.map((r, i) => {
            const thumb = thumbs.get(keyOf(r))
            const missing = missingFieldsFor(r, resolved).length
            const errors = (validationRows?.get(r.rowNumber) ?? []).filter((x) => x.severity === 'error').length
            const name = recordTitle(r, dataset?.columns ?? [])
            return (
              <li key={r.rowNumber}>
                <button type="button" onClick={() => onOpen(pg.start + i)} aria-label={`Open ${name || `row ${r.rowNumber}`}`} className="w-full rounded border border-line bg-surface p-2 text-left hover:border-accent">
                  <div className="relative w-full bg-white shadow-card" style={{ aspectRatio: `${pageInfo.widthMm} / ${pageInfo.heightMm}` }}>
                    {thumb?.dataUrl ? (
                      <img src={thumb.dataUrl} alt="" className="h-full w-full object-fill" draggable={false} />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center text-xs text-fg-subtle">{thumb?.error ? 'Render failed' : <Spinner label="Rendering" />}</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{name || <span className="muted italic">no name</span>}</span>
                    <span className="text-2xs tabular-nums text-fg-muted">row {r.rowNumber}</span>
                  </div>
                  {(errors > 0 || missing > 0 || (thumb && thumb.overflow > 0)) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {errors > 0 && <Badge tone="error">error</Badge>}
                      {missing > 0 && <Badge tone="warn">{missing} blank</Badge>}
                      {thumb && thumb.overflow > 0 && <Badge tone="warn">overflow</Badge>}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-3 py-1.5">
        <span className="muted mr-auto text-xs">{pageLabel(pageIndex, template.inspection.pages.length)} shown · overflow is known once a card has rendered</span>
        <Segmented
          label="Tile size"
          value={density}
          onChange={setDensity}
          options={[
            { value: 'compact', label: 'S' },
            { value: 'regular', label: 'M' },
            { value: 'large', label: 'L' }
          ]}
        />
        <Button disabled={pg.page === 0} onClick={() => setPage(pg.page - 1)}>
          Previous
        </Button>
        <span className="muted tabular-nums">
          Page {pg.page + 1} of {pg.pageCount}
        </span>
        <Button disabled={pg.page >= pg.pageCount - 1} onClick={() => setPage(pg.page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
