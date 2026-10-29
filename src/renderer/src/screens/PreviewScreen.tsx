import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hasBlockingMappingIssues, missingFieldsFor, objectNamesByPosition, shapeValuesFor } from '../../../shared/template/mapping'
import type { PreviewResult, TemplateRecord } from '../../../shared/template/types'
import type { ImportRecord } from '../../../shared/types'
import {
  cardCssSize,
  clampIndex,
  dpiForZoom,
  fitZoom,
  gridPage,
  recordTitle,
  searchRecords,
  stepIndex,
  zoomIn,
  zoomOut
} from '../../../shared/preview/navigation'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Badge, Banner, PageHeader } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { useJob } from '../state/job'
import { pageLabel, useTemplates } from '../state/templates'

type Side = 'both' | number
const GRID_PAGE_SIZE = 12
const GRID_DPI = 96
const MAX_SINGLE_DPI = 450

export function PreviewScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { dataset, validation } = useJob()
  const { selected: template, resolved, issues } = useTemplates()
  const [mode, setMode] = useState<'single' | 'grid'>('single')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [side, setSide] = useState<Side>('both')

  const records = useMemo(() => (dataset ? searchRecords(dataset.records, dataset.columns, query) : []), [dataset, query])
  const current = clampIndex(index, records.length)

  const gate = !dataset ? 'import' : !template ? 'template' : hasBlockingMappingIssues(issues) ? 'mapping' : null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Card preview"
        description={template ? `Rendered by CorelDRAW ${template.inspection.corelVersion.replace(/^Version /, '')} from “${template.name}”.` : 'Previews are rendered by CorelDRAW from the real template.'}
        actions={
          !gate && (
            <div className="flex rounded-md border border-stone-300 p-0.5 dark:border-stone-700" role="tablist">
              {(['single', 'grid'] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`h-7 rounded px-3 ${mode === m ? 'bg-stone-200 font-medium dark:bg-stone-700' : ''}`}>
                  {m === 'single' ? 'Single' : 'Grid'}
                </button>
              ))}
            </div>
          )
        }
      />
      {gate ? (
        <Gate gate={gate} navigate={navigate} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-6 py-2.5 dark:border-stone-800">
            <input
              className="input w-64"
              type="search"
              placeholder="Search employee…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setIndex(0)
              }}
            />
            {template!.inspection.pages.length > 1 && (
              <select className="input" value={String(side)} onChange={(e) => setSide(e.target.value === 'both' ? 'both' : Number(e.target.value))} aria-label="Pages">
                <option value="both">{template!.inspection.pages.length === 2 ? 'Front and back' : 'All pages'}</option>
                {template!.inspection.pages.map((p) => (
                  <option key={p.index} value={p.index}>
                    {pageLabel(p.index, template!.inspection.pages.length)} only
                  </option>
                ))}
              </select>
            )}
            <span className="muted ml-auto tabular-nums">
              {records.length} of {dataset!.records.length} records
            </span>
          </div>
          <div className="px-6 pt-3 empty:hidden">
            <X7Notice version={template!.inspection.corelVersion} />
          </div>
          {records.length === 0 ? (
            <p className="muted p-10 text-center">No records match “{query}”.</p>
          ) : mode === 'single' ? (
            <SingleView template={template!} records={records} index={current} setIndex={setIndex} side={side} />
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
        </>
      )}
    </div>
  )
}

function Gate({ gate, navigate }: { gate: string; navigate: (s: ScreenKey) => void }) {
    const content =
      gate === 'import'
        ? { title: 'No spreadsheet imported', action: 'Go to Excel import', to: 'import' as ScreenKey }
        : gate === 'template'
          ? { title: 'No template selected', action: 'Go to Template setup', to: 'template' as ScreenKey }
          : { title: 'The field mapping has errors', action: 'Fix the mapping', to: 'template' as ScreenKey }
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="font-medium">{content.title}</p>
        <button className="btn btn-primary mt-4" onClick={() => navigate(content.to)}>
          {content.action}
        </button>
      </div>
    )
}

/** Renders one record through CorelDRAW; keeps the previous image on screen while the next one renders. */
function useCorelRender(template: TemplateRecord, values: Record<string, string> | null, dpi: number, pages: number[]) {
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify([template.id, template.updatedAt, values, dpi, pages])
  useEffect(() => {
    if (!values) return
    let stale = false
    setLoading(true)
    setError(null)
    unwrap(api.preview.render({ templateId: template.id, values, dpi, pages }))
      .then((r) => !stale && setResult(r), (err) => !stale && setError(errorMessage(err)))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { result, error, loading }
}

function SingleView({
  template,
  records,
  index,
  setIndex,
  side
}: {
  template: TemplateRecord
  records: ImportRecord[]
  index: number
  setIndex: (i: number) => void
  side: Side
}) {
  const { validation, dataset } = useJob()
  const { resolved } = useTemplates()
  const box = useRef<HTMLDivElement>(null)
  const [boxSize, setBoxSize] = useState({ w: 800, h: 500 })
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const record = records[index]!
  const allPages = template.inspection.pages
  const pages = side === 'both' ? allPages : allPages.filter((p) => p.index === side)
  const first = pages[0]!
  const gapMm = 6
  const totalWidthMm = pages.reduce((sum, p) => sum + p.widthMm, 0) + gapMm * (pages.length - 1)
  const maxHeightMm = Math.max(...pages.map((p) => p.heightMm))
  const effectiveZoom = zoom === 'fit' ? fitZoom(totalWidthMm, maxHeightMm, boxSize.w - 48, boxSize.h - 64) : zoom
  const dpi = Math.min(MAX_SINGLE_DPI, dpiForZoom(effectiveZoom, window.devicePixelRatio || 1))
  const values = useMemo(() => shapeValuesFor(record, resolved), [record, resolved])
  const { result, error, loading } = useCorelRender(
    template,
    values,
    dpi,
    pages.map((p) => p.index)
  )

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowRight') setIndex(stepIndex(index, 1, records.length))
      if (e.key === 'ArrowLeft') setIndex(stepIndex(index, -1, records.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, records.length, setIndex])

  const missing = missingFieldsFor(record, resolved)
  const rowIssues = validation?.byRow.get(record.rowNumber) ?? []
  const overflow = (result?.objects ?? []).filter((o) => o.overflow)
  const title = recordTitle(record, dataset?.columns ?? [])
  const orderedNames = objectNamesByPosition(template.inspection.objects).filter((n) => n in values)

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 px-6 py-2.5">
          <button className="btn" disabled={index === 0} onClick={() => setIndex(stepIndex(index, -1, records.length))} aria-label="Previous record">
            ‹ Previous
          </button>
          <span className="tabular-nums">
            Record <strong>{index + 1}</strong> of {records.length} <span className="muted">· row {record.rowNumber}</span>
          </span>
          <button className="btn" disabled={index >= records.length - 1} onClick={() => setIndex(stepIndex(index, 1, records.length))} aria-label="Next record">
            Next ›
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button className="btn btn-ghost w-8 px-0" onClick={() => setZoom(zoomOut(effectiveZoom))} aria-label="Zoom out">
              −
            </button>
            <span className="w-12 text-center tabular-nums">{Math.round(effectiveZoom * 100)}%</span>
            <button className="btn btn-ghost w-8 px-0" onClick={() => setZoom(zoomIn(effectiveZoom))} aria-label="Zoom in">
              +
            </button>
            <button className={`btn ${zoom === 'fit' ? 'btn-primary' : ''}`} onClick={() => setZoom('fit')}>
              Fit
            </button>
            <button className={`btn ${zoom === 1 ? 'btn-primary' : ''}`} onClick={() => setZoom(1)} title="100%: the card at its real size (depends on display scaling)">
              Actual size
            </button>
          </div>
        </div>
        <div ref={box} className="relative min-h-0 flex-1 overflow-auto bg-stone-200/60 dark:bg-stone-900">
          <div className="flex min-h-full min-w-max items-center justify-center gap-6 p-6">
            {pages.map((p) => {
              const size = cardCssSize(p.widthMm, p.heightMm, effectiveZoom)
              const img = result?.pages.find((r) => r.pageIndex === p.index)
              return (
                <figure key={p.index} className="flex flex-col items-center">
                  <div className="relative bg-white shadow-md" style={{ width: size.width, height: size.height }}>
                    {img && <img src={img.dataUrl} alt={`${pageLabel(p.index, allPages.length)} for row ${record.rowNumber}`} className={`h-full w-full ${loading ? 'opacity-50' : ''}`} />}
                    {loading && <span className="absolute inset-x-0 top-2 text-center text-xs text-stone-600">Rendering in CorelDRAW…</span>}
                  </div>
                  <figcaption className="muted mt-1.5 text-xs">
                    {pageLabel(p.index, allPages.length)} · {p.widthMm} × {p.heightMm} mm
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </div>
      </div>
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-stone-200 p-4 dark:border-stone-800">
        <p className="truncate text-[15px] font-semibold">{title || <span className="muted italic">no name</span>}</p>
        <p className="muted text-xs">
          Spreadsheet row {record.rowNumber} · {first.widthMm} × {first.heightMm} mm
        </p>
        <div className="mt-4 space-y-2">
          {error && <Banner tone="error" title="CorelDRAW could not render this card">{error}</Banner>}
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
          {result?.notFound.map((n) => <Banner key={`n${n}`} tone="error" title={`The template has no object named ${n}.`} />)}
          {!error && result && rowIssues.length === 0 && missing.length === 0 && overflow.length === 0 && !loading && <Banner tone="ok" title="No problems found" />}
        </div>
        <h4 className="eyebrow mb-1 mt-5">Values on this card</h4>
        <dl className="space-y-1.5">
          {orderedNames.map((name) => (
            <div key={name}>
              <dt className="muted text-xs">{name}</dt>
              <dd className="whitespace-pre-line break-words">{values[name] || <span className="muted italic">blank</span>}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  )
}

interface Thumb {
  dataUrl: string
  overflow: number
  error?: string
}

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
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {visible.map((r, i) => {
            const thumb = thumbs.get(keyOf(r))
            const missing = missingFieldsFor(r, resolved).length
            const errors = (validationRows?.get(r.rowNumber) ?? []).filter((x) => x.severity === 'error').length
            const name = recordTitle(r, dataset?.columns ?? [])
            return (
              <button key={r.rowNumber} onClick={() => onOpen(pg.start + i)} className="panel p-2 text-left hover:ring-2 hover:ring-teal-600/40">
                <div className="relative w-full bg-white" style={{ aspectRatio: `${pageInfo.widthMm} / ${pageInfo.heightMm}` }}>
                  {thumb?.dataUrl ? (
                    <img src={thumb.dataUrl} alt={`Row ${r.rowNumber}`} className="h-full w-full" />
                  ) : (
                    <span className="muted absolute inset-0 grid place-items-center text-xs">{thumb?.error ? 'Render failed' : 'Rendering…'}</span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{name || <span className="muted italic">no name</span>}</span>
                  <span className="muted text-[11px]">row {r.rowNumber}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {errors > 0 && <Badge tone="error">error</Badge>}
                  {missing > 0 && <Badge tone="warn">{missing} blank</Badge>}
                  {thumb && thumb.overflow > 0 && <Badge tone="warn">overflow</Badge>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-stone-200 px-6 py-2 dark:border-stone-800">
        <span className="muted mr-auto text-xs">{pageLabel(pageIndex, template.inspection.pages.length)} shown in the grid · overflow is known once a card has rendered</span>
        <button className="btn" disabled={pg.page === 0} onClick={() => setPage(pg.page - 1)}>
          Previous
        </button>
        <span className="muted tabular-nums">
          Page {pg.page + 1} of {pg.pageCount}
        </span>
        <button className="btn" disabled={pg.page >= pg.pageCount - 1} onClick={() => setPage(pg.page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}

