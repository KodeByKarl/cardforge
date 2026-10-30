import { useEffect, useMemo, useRef, useState } from 'react'
import { suggestSheetMapping } from '../../../shared/sheet/compose'
import type { DetectionResult, LineFill, SheetConfig, SheetMapping, SheetOrder } from '../../../shared/sheet/types'
import type { PageInfo, TemplateRecord } from '../../../shared/template/types'
import { api, errorMessage, unwrap } from '../api'
import { useMissingFonts, useSheetData, useSheetIssues } from '../state/sheet'
import { useTemplates } from '../state/templates'
import { Icon } from './icons'
import { Badge, Banner, Button, Dialog } from './ui'

/** Card positions drawn over a rendered page: numbered outlines, plus boxes for chosen objects. Percent-positioned, so it scales with the image. */
export function SheetOverlay({ page, cells, boxes }: { page: PageInfo; cells: { index: number; region: { left: number; bottom: number; right: number; top: number } }[]; boxes: { left: number; bottom: number; right: number; top: number; active: boolean }[] }) {
  const pos = (b: { left: number; bottom: number; right: number; top: number }) => ({
    left: `${(b.left / page.widthMm) * 100}%`,
    top: `${((page.heightMm - b.top) / page.heightMm) * 100}%`,
    width: `${((b.right - b.left) / page.widthMm) * 100}%`,
    height: `${((b.top - b.bottom) / page.heightMm) * 100}%`
  })
  return (
    <>
      {cells.map((c) => (
        <div key={`c${c.index}`} className="pointer-events-none absolute border border-dashed border-overlay/60" style={pos(c.region)}>
          <span className="absolute left-0.5 top-0.5 rounded-sm bg-overlay px-1 text-2xs font-semibold leading-3 text-white">{c.index}</span>
        </div>
      ))}
      {boxes.map((b, i) => (
        <div key={`b${i}`} className={`pointer-events-none absolute border ${b.active ? 'border-2 border-overlay bg-overlay/25' : 'border-overlay/50'}`} style={pos(b)} />
      ))}
    </>
  )
}

const linesPreview = (lines: string[]) => lines.map((l) => (l.trim() ? l.trim() : '·')).join(' ⏎ ')

/** Step 1 for a template with unnamed text: detect the card grid, show it on the page, and prepare the private copy. */
export function SheetPrepare({ record, onAnalysis, onPrepared }: { record: TemplateRecord; onAnalysis: (a: DetectionResult | null) => void; onPrepared: (r: TemplateRecord) => void }) {
  const [columns, setColumns] = useState('')
  const [rows, setRows] = useState('')
  const [order, setOrder] = useState<SheetOrder>('rows')
  const [analysis, setAnalysis] = useState<DetectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const opts = useMemo(() => ({ columns: columns ? Number(columns) : undefined, rows: rows ? Number(rows) : undefined, order }), [columns, rows, order])

  useEffect(() => {
    let stale = false
    setError(null)
    unwrap(api.templates.analyzeSheet(record.id, opts)).then(
      (a) => {
        if (stale) return
        setAnalysis(a)
        onAnalysis(a)
      },
      (e) => {
        if (stale) return
        setAnalysis(null)
        onAnalysis(null)
        setError(errorMessage(e))
      }
    )
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, opts])

  const prepare = async () => {
    setBusy(true)
    setError(null)
    try {
      onPrepared(await unwrap(api.templates.prepareSheet(record.id, opts)))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const cfg = analysis?.config
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="Prepare card sheet" data-testid="sheet-prepare">
      <h3 className="text-base">This template has {record.inspection.unnamedTextCount} unnamed text objects</h3>
      <p className="muted mt-1">
        If the page holds several cards, The system can find the repeated card positions and fill each one with a different record. Your original file is never modified: it names the objects in its own private copy.
      </p>
      {error && (
        <div className="mt-3">
          <Banner tone="error" title="Could not detect a card layout">
            {error}
          </Banner>
        </div>
      )}
      {cfg && (
        <>
          <div className="well mt-3 p-3" aria-live="polite" data-testid="sheet-detected">
            <p className="font-semibold">
              Detected {cfg.columns} column{cfg.columns === 1 ? '' : 's'} × {cfg.rows} row{cfg.rows === 1 ? '' : 's'} = <span data-testid="sheet-cell-count">{cfg.cells.length}</span> cards per sheet
            </p>
            <p className="muted text-xs">
              Each card has {cfg.roles.length} text object{cfg.roles.length === 1 ? '' : 's'}. Card 1 is top-left; cards follow in reading order. The numbered outlines on the page show what was found.
            </p>
            {cfg.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-warn" aria-label="Layout warnings">
                {cfg.warnings.slice(0, 6).map((w, i) => (
                  <li key={i} className="flex gap-1.5 text-xs">
                    <Icon name="alert" size={13} className="mt-0.5" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <table className="mt-3 w-full border-separate border-spacing-0" aria-label="Objects of the first card">
            <thead>
              <tr>
                <th className="table-head">Text on card 1</th>
                <th className="table-head">Font</th>
              </tr>
            </thead>
            <tbody>
              {cfg.roles.map((r) => (
                <tr key={r.id}>
                  <td className="table-cell max-w-[260px] truncate" title={linesPreview(r.templateLines)}>
                    {r.isLabel && <Badge>caption</Badge>} <span className="font-mono text-xs">{linesPreview(r.templateLines)}</span>
                  </td>
                  <td className="table-cell text-xs text-fg-muted">
                    {r.font} {r.sizePt} pt
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-fg-muted">Not right? Set the grid yourself</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="label block">Columns</span>
            <input className="input w-20" type="number" min={1} max={12} value={columns} placeholder="auto" onChange={(e) => setColumns(e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="label block">Rows</span>
            <input className="input w-20" type="number" min={1} max={20} value={rows} placeholder="auto" onChange={(e) => setRows(e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="label block">Reading order</span>
            <select className="input" value={order} onChange={(e) => setOrder(e.target.value as SheetOrder)}>
              <option value="rows">Across, then down</option>
              <option value="columns">Down, then across</option>
            </select>
          </label>
        </div>
      </details>
      <div className="mt-4">
        <Button variant="primary" loading={busy} disabled={!cfg || busy} onClick={prepare} data-testid="prepare-sheet">
          Prepare as {cfg ? `${cfg.cells.length}-card` : 'card'} sheet
        </Button>
        {busy && <p className="muted mt-2 text-xs">Naming the objects in CorelDRAW… this takes about a minute for large templates.</p>}
      </div>
    </section>
  )
}

const KEEP = '__keep__'
const BLANK = '__blank__'
const fillValue = (f: LineFill | undefined) => (!f || f.kind === 'blank' ? BLANK : f.kind === 'keep' ? KEEP : `col:${f.columnLabel}`)

/** Maps each text object of one card (replicated to all cards) to spreadsheet columns, line by line. */
export function SheetMappingEditor({ record, onHighlight, onError, onChanged }: { record: TemplateRecord; onHighlight: (roleId: string | null) => void; onError: (m: string | null) => void; onChanged: (r: TemplateRecord) => void }) {
  const sheet = record.sheet as SheetConfig
  const { dataset, samples } = useSheetData()
  const { issues } = useSheetIssues()
  const { update } = useTemplates()
  const [mapping, setMapping] = useState<SheetMapping>(() => record.sheetMapping ?? suggestBlank(sheet))
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>(record.sheetMapping ? 'saved' : 'unsaved')
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [reverting, setReverting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const columns = (dataset?.columns ?? []).filter((c) => c.include)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const persist = (next: SheetMapping) => {
    setMapping(next)
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        update(await unwrap(api.templates.saveSheetMapping(record.id, next)))
        setSaveState('saved')
      } catch (err) {
        setSaveState('unsaved')
        onError(errorMessage(err))
      }
    }, 400)
  }
  const setLine = (roleId: string, line: number, value: string) => {
    const fills = [...(mapping.fields[roleId] ?? [])]
    fills[line] = value === KEEP ? { kind: 'keep' } : value === BLANK ? { kind: 'blank' } : { kind: 'column', columnLabel: value.slice(4) }
    persist({ ...mapping, fields: { ...mapping.fields, [roleId]: fills } })
  }
  const autoMatch = () => dataset && persist({ ...suggestSheetMapping(sheet, dataset.columns, samples), acknowledged: mapping.acknowledged })

  const revert = async () => {
    setReverting(true)
    try {
      onChanged(await unwrap(api.templates.revertSheet(record.id)))
      setConfirmRevert(false)
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setReverting(false)
    }
  }
  const missingFonts = useMissingFonts(record.id)
  const prefixIssue = issues.find((i) => i.code === 'PREFIX_UNCONFIRMED')
  const errors = issues.filter((i) => i.severity === 'error' && i.code !== 'PREFIX_UNCONFIRMED' && i.code !== 'NO_MAPPING')
  const warnings = issues.filter((i) => i.severity === 'warning' && i.code !== 'GRID_WARNING')
  const dataRoles = sheet.roles.filter((r) => !r.isLabel).length
  const mapped = sheet.roles.reduce((n, r) => n + (mapping.fields[r.id] ?? []).filter((f, i) => f.kind === 'column' && r.templateLines[i]?.trim()).length, 0)

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Card field mapping" data-testid="sheet-mapping">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2">
        <h3 className="text-sm">Card fields</h3>
        <p className="text-xs text-fg-muted" aria-live="polite">
          {sheet.columns} × {sheet.rows} = <strong>{sheet.cells.length}</strong> cards per sheet · <span className="font-semibold text-ok">{mapped}</span> field{mapped === 1 ? '' : 's'} mapped · {saveState === 'saved' ? 'saved' : saveState === 'saving' ? 'saving…' : 'not saved yet'}
        </p>
        <div className="ml-auto flex gap-2">
          <Button disabled={!dataset} onClick={autoMatch} title={dataset ? 'Match template text to columns by the kind of value' : 'Import a spreadsheet first'}>
            Auto-match
          </Button>
          <Button onClick={() => setConfirmRevert(true)} title="Go back to the client's original layout to change the grid">
            Change layout…
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!dataset && <p className="muted border-b border-line bg-surface-2 px-4 py-1.5 text-xs">No spreadsheet is loaded, so there are no columns to choose from.</p>}
        <ul className="divide-y divide-line">
          {sheet.roles.map((role) => (
            <li key={role.id} className="px-4 py-2" onMouseEnter={() => onHighlight(role.id)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(role.id)}>
              <p className="flex flex-wrap items-center gap-1 font-medium">
                {role.label}
                {role.isLabel ? <Badge>caption · kept as designed</Badge> : <Badge tone="info">fills on every card</Badge>}
                {role.mixedFormatting && <Badge tone="warn">mixed formatting</Badge>}
              </p>
              <div className="mt-1 space-y-1">
                {role.templateLines.map((line, i) => {
                  if (!line.trim()) return null
                  return (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,15rem)] items-center gap-2">
                      <span className="truncate font-mono text-xs text-fg-muted" title={line}>
                        {role.templateLines.length > 1 ? `line ${i + 1}: ` : ''}
                        {line.trim()}
                      </span>
                      <select className="input h-control w-full" aria-label={`${role.label}${role.templateLines.length > 1 ? ` line ${i + 1}` : ''} fill from`} value={fillValue(mapping.fields[role.id]?.[i])} onChange={(e) => setLine(role.id, i, e.target.value)}>
                        <option value={KEEP}>Keep template text</option>
                        <option value={BLANK}>Leave blank</option>
                        {columns.map((c) => (
                          <option key={c.key} value={`col:${c.label}`}>
                            {c.label}
                          </option>
                        ))}
                        {(() => {
                          const f = mapping.fields[role.id]?.[i]
                          return f?.kind === 'column' && !columns.some((c) => c.label === f.columnLabel) ? <option value={`col:${f.columnLabel}`}>{f.columnLabel} (not in current sheet)</option> : null
                        })()}
                      </select>
                    </div>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="shrink-0 space-y-1 border-t border-line bg-surface-2 px-4 py-2" aria-label="Mapping check" data-testid="sheet-issues">
        {prefixIssue && (
          <div className="rounded border border-err/40 bg-err-soft p-2" role="alert">
            <p className="flex items-start gap-1.5 text-err">
              <Icon name="alert" size={13} className="mt-0.5" />
              <span>{prefixIssue.message}</span>
            </p>
          </div>
        )}
        {(prefixIssue || mapping.acknowledged.includes('prefix')) && (
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="check"
              data-testid="ack-prefix"
              checked={mapping.acknowledged.includes('prefix')}
              onChange={(e) => persist({ ...mapping, acknowledged: e.target.checked ? [...new Set([...mapping.acknowledged, 'prefix'])] : mapping.acknowledged.filter((a) => a !== 'prefix') })}
            />
            The client confirmed the control-number prefix used in the spreadsheet is correct. The system prints the spreadsheet value as is.
          </label>
        )}
        {missingFonts && missingFonts.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warn" data-testid="font-warning">
            <Icon name="alert" size={13} className="mt-0.5" />
            Font{missingFonts.length > 1 ? 's' : ''} not installed on this PC: {missingFonts.join(', ')}. CorelDRAW will substitute {missingFonts.length > 1 ? 'them' : 'it'} and text widths will change.
          </p>
        )}
        {errors.map((i, n) => (
          <p key={`e${n}`} className="flex items-start gap-1.5 text-xs text-err">
            <Icon name="alert" size={13} className="mt-0.5" />
            {i.message}
          </p>
        ))}
        {warnings.slice(0, 4).map((i, n) => (
          <p key={`w${n}`} className="flex items-start gap-1.5 text-xs text-warn">
            <Icon name="alert" size={13} className="mt-0.5" />
            {i.message}
          </p>
        ))}
        {issues.length === 0 && dataRoles > 0 && <p className="text-xs text-ok">Mapping complete for this spreadsheet.</p>}
      </div>
      {confirmRevert && (
        <Dialog
          title="Change the card layout?"
          onClose={() => setConfirmRevert(false)}
          footer={
            <>
              <Button data-autofocus onClick={() => setConfirmRevert(false)}>
                Keep layout
              </Button>
              <Button variant="danger-solid" loading={reverting} onClick={revert}>
                Restore original
              </Button>
            </>
          }
        >
          <p>The template goes back to the client’s original (unnamed) layout and the field mapping below is cleared. You can then detect the grid again.</p>
        </Dialog>
      )}
    </section>
  )
}

/** Default before anything is chosen: captions are kept, every data line prints blank (never the template's sample text). */
function suggestBlank(sheet: SheetConfig): SheetMapping {
  return {
    version: 1,
    acknowledged: [],
    fields: Object.fromEntries(sheet.roles.map((r) => [r.id, r.templateLines.map((l): LineFill => (r.isLabel || !l.trim() ? { kind: 'keep' } : { kind: 'blank' }))]))
  }
}

