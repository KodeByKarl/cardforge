import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultPrintSettings, isActiveJob, isValidPageRangeSyntax } from '../../../shared/print/logic'
import {
  COLOR_MODES,
  MAX_COPIES,
  PAPER_SIZES,
  type PrintJobRecord,
  type PrintPlan,
  type PrintPreset,
  type PrintPreview,
  type PrintSettings,
  type PrintSheetRecord,
  type PrintSheetState,
  type PrintSource,
  type PrinterInfo,
  type PrinterStatus
} from '../../../shared/print/types'
import type { JobSummary } from '../../../shared/template/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, Dialog, EmptyState, PageHeader, Section, Segmented, Spinner, useToast, type Tone } from '../components/ui'
import { useCorelStatus } from '../state/corel'
import { useGeneration } from '../state/generation'
import { usePrint } from '../state/print'

const PRINTER_TONE: Record<PrinterStatus, Tone> = { ready: 'ok', busy: 'info', paused: 'warn', offline: 'error', error: 'error', unknown: 'neutral' }
const PRINTER_LABEL: Record<PrinterStatus, string> = { ready: 'Ready', busy: 'Printing', paused: 'Paused', offline: 'Offline', error: 'Error', unknown: 'Unknown' }

const SHEET_TONE: Record<PrintSheetState, Tone> = { queued: 'neutral', submitting: 'info', submitted: 'info', spooled: 'info', printing: 'info', completed: 'ok', failed: 'error', cancelled: 'neutral', uncertain: 'warn' }
const SHEET_LABEL: Record<PrintSheetState, string> = {
  queued: 'Waiting',
  submitting: 'Sending…',
  submitted: 'Submitted',
  spooled: 'In Windows queue',
  printing: 'Printing',
  completed: 'Completed',
  failed: 'Failed (not sent)',
  cancelled: 'Cancelled',
  uncertain: 'Check printer'
}

const JOB_TONE: Record<PrintJobRecord['status'], Tone> = { queued: 'neutral', running: 'info', done: 'ok', failed: 'error', cancelled: 'neutral', attention: 'warn' }
const JOB_LABEL: Record<PrintJobRecord['status'], string> = { queued: 'Waiting', running: 'Sending', done: 'Sent', failed: 'Some failed', cancelled: 'Cancelled', attention: 'Needs attention' }

const hasCdr = (j: JobSummary) => j.files.some((f) => /\.cdr$/i.test(f))
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function PrintScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const toast = useToast()
  const { status: corel } = useCorelStatus()
  const generation = useGeneration()
  const print = usePrint()

  const sources = useMemo(() => generation.history.filter(hasCdr), [generation.history])
  const sourceId = sources.some((j) => j.id === print.sourceJobId) ? print.sourceJobId : (sources[0]?.id ?? null)

  const [source, setSource] = useState<PrintSource | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null)
  const [printersError, setPrintersError] = useState<string | null>(null)
  const [settings, setSettings] = useState<PrintSettings>(defaultPrintSettings())
  const [presets, setPresets] = useState<PrintPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [loadedSettings, setLoadedSettings] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<PrintPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPrinters = useCallback(async () => {
    setPrintersError(null)
    try {
      setPrinters(await unwrap(api.print.printers()))
    } catch (err) {
      setPrinters([])
      setPrintersError(errorMessage(err))
    }
  }, [])

  // Printers, saved presets and the settings used last time.
  useEffect(() => {
    void loadPrinters()
    unwrap(api.print.presets()).then(
      ({ presets: p, last }) => {
        setPresets(p)
        if (last) setSettings(last)
        setLoadedSettings(true)
      },
      () => setLoadedSettings(true)
    )
  }, [loadPrinters])

  // Pick the Windows default printer only when nothing was remembered. A remembered printer that has disappeared is kept
  // visible (and blocks printing) instead of being swapped for another one.
  useEffect(() => {
    if (!printers || !loadedSettings) return
    setSettings((s) => (s.printer ? s : { ...s, printer: (printers.find((p) => p.isDefault) ?? printers[0])?.name ?? '' }))
  }, [printers, loadedSettings])

  useEffect(() => {
    setSource(null)
    setSelected(new Set())
    if (!sourceId) return
    let alive = true
    unwrap(api.print.source(sourceId)).then(
      (s) => {
        if (!alive) return
        setSource(s)
        setSelected(new Set(s.files.filter((f) => f.exists).map((f) => f.fileIndex)))
      },
      (err) => alive && setError(errorMessage(err))
    )
    return () => {
      alive = false
    }
  }, [sourceId])

  const printer = printers?.find((p) => p.name === settings.printer)
  const patch = (p: Partial<PrintSettings>) => setSettings((s) => ({ ...s, ...p }))
  const rangeOk = isValidPageRangeSyntax(settings.pageRange)
  const busy = print.active !== undefined
  const canReview = !!sourceId && selected.size > 0 && !!settings.printer && rangeOk && !busy && !planning && corel?.available !== false

  const review = async () => {
    if (!sourceId) return
    setPlanning(true)
    setError(null)
    try {
      setPlan(await unwrap(api.print.plan({ sourceJobId: sourceId, fileIndexes: [...selected].sort((a, b) => a - b), settings })))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPlanning(false)
    }
  }

  const savePreset = async () => {
    try {
      const saved = await unwrap(api.print.savePreset(presetName, settings))
      setPresets((list) => [...list.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)))
      setPresetName('')
      toast.push('ok', `Preset “${saved.name}” saved.`)
    } catch (err) {
      toast.push('error', errorMessage(err))
    }
  }

  const removePreset = async (id: string) => {
    try {
      await unwrap(api.print.removePreset(id))
      setPresets((list) => list.filter((p) => p.id !== id))
    } catch (err) {
      toast.push('error', errorMessage(err))
    }
  }

  const start = async (allowDuplicates: boolean) => {
    if (!plan) return
    try {
      await unwrap(api.print.start({ planId: plan.planId, confirmed: true, allowDuplicates }))
      await unwrap(api.print.remember(plan.settings)).catch(() => undefined)
      setPlan(null)
      void print.refresh()
      toast.push('ok', 'Sending to the printer. Follow each file in Print jobs below.')
    } catch (err) {
      setPlan(null)
      setError(errorMessage(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Print"
        description="Send generated CDR sheets straight to a printer through CorelDRAW"
        actions={
          <Button variant="primary" onClick={() => void review()} disabled={!canReview} loading={planning} data-testid="print-review">
            <Icon name="print" size={14} />
            Review &amp; print…
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1200px] gap-5 p-4 wide:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            {error && <Banner tone="error" title="Printing could not continue" actions={<Button variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Banner>}
            {corel && !corel.available && <Banner tone="error" title="CorelDRAW is not available">Printing goes through CorelDRAW. Install it, then reopen this screen.</Banner>}
            {corel?.available && !corel.isX7 && (
              <Banner tone="warn" title="Printing has not been verified on CorelDRAW X7 on this PC">
                The print commands follow the X7 type library, but the production workstation must confirm them (see PRINTING.md) before relying on this.
              </Banner>
            )}

            <Section title="Sheets to print" aside={source ? `${selected.size} of ${source.files.length} selected` : undefined}>
              {sources.length === 0 ? (
                <EmptyState
                  title="Nothing to print yet"
                  action={<Button variant="primary" onClick={() => navigate('generate')}>Go to Generate</Button>}
                >
                  Generate CDR sheets first. They appear here when they are done.
                </EmptyState>
              ) : (
                <SheetPicker
                  sources={sources}
                  sourceId={sourceId}
                  onSource={print.selectSource}
                  source={source}
                  selected={selected}
                  onSelected={setSelected}
                  disabled={busy}
                />
              )}
            </Section>

            {source && sourceId && <PreviewPanel sourceJobId={sourceId} source={source} />}

            <Section title="Print jobs" aside={<Button variant="ghost" onClick={() => void print.refresh()}><Icon name="refresh" size={13} />Refresh</Button>}>
              <JobList jobs={print.jobs} />
            </Section>
          </div>

          <aside className="min-w-0 space-y-4 wide:sticky wide:top-4 wide:self-start" aria-label="Print settings">
            <Section title="Printer" aside={<button type="button" className="hover:text-fg" onClick={() => void loadPrinters()}>Refresh</button>}>
              <PrinterField printers={printers} error={printersError} settings={settings} printer={printer} onChange={patch} disabled={busy} />
            </Section>
            <Section title="Settings">
              <SettingsFields settings={settings} printer={printer} rangeOk={rangeOk} onChange={patch} disabled={busy} />
            </Section>
            <Section title="Presets">
              <div className="space-y-2">
                {presets.length === 0 && <p className="muted text-xs">No presets yet. Set up a printer and save it under a name.</p>}
                <ul className="space-y-1">
                  {presets.map((p) => (
                    <li key={p.id} className="flex items-center gap-1.5">
                      <button type="button" className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left hover:bg-hover" onClick={() => setSettings(p.settings)} disabled={busy} title={`${p.settings.printer} · ${p.settings.paper} · ${p.settings.copies} copies`}>
                        {p.name}
                      </button>
                      <button type="button" className="rounded p-1 text-fg-muted hover:bg-hover hover:text-err" aria-label={`Delete preset ${p.name}`} onClick={() => void removePreset(p.id)}>
                        <Icon name="x" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-1.5">
                  <input className="input min-w-0 flex-1" placeholder="Preset name" value={presetName} maxLength={60} aria-label="Preset name" onChange={(e) => setPresetName(e.target.value)} />
                  <Button onClick={() => void savePreset()} disabled={presetName.trim() === '' || !settings.printer}>Save</Button>
                </div>
              </div>
            </Section>
          </aside>
        </div>
      </div>

      {plan && <ConfirmDialog plan={plan} onCancel={() => setPlan(null)} onConfirm={(allow) => void start(allow)} />}
    </div>
  )
}

function SheetPicker({ sources, sourceId, onSource, source, selected, onSelected, disabled }: { sources: JobSummary[]; sourceId: string | null; onSource: (id: string) => void; source: PrintSource | null; selected: Set<number>; onSelected: (s: Set<number>) => void; disabled: boolean }) {
  const printable = source?.files.filter((f) => f.exists) ?? []
  const toggle = (i: number) => {
    const next = new Set(selected)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    onSelected(next)
  }
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2">
        <span className="shrink-0 font-medium">Generation job</span>
        <select className="input min-w-0 flex-1" value={sourceId ?? ''} onChange={(e) => onSource(e.target.value)} disabled={disabled} data-testid="print-source">
          {sources.map((j) => (
            <option key={j.id} value={j.id}>
              {j.templateName} · {when(j.startedAt)} · {j.files.filter((f) => /\.cdr$/i.test(f)).length} file(s)
            </option>
          ))}
        </select>
      </label>
      {source?.warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs text-warn">
          <Icon name="alert" size={13} className="mt-0.5" />
          {w}
        </p>
      ))}
      {!source ? (
        <p className="muted"><Spinner /> Loading files…</p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs">
            <button type="button" className="underline" onClick={() => onSelected(new Set(printable.map((f) => f.fileIndex)))} disabled={disabled}>Select all</button>
            <button type="button" className="underline" onClick={() => onSelected(new Set())} disabled={disabled}>Select none</button>
          </div>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded border border-line" data-testid="print-files">
            {source.files.map((f) => (
              <li key={f.fileIndex}>
                <label className={`flex items-center gap-2 px-2 py-1.5 ${f.exists ? 'cursor-pointer hover:bg-hover' : 'opacity-60'}`}>
                  <input type="checkbox" className="check" checked={selected.has(f.fileIndex)} disabled={!f.exists || disabled} onChange={() => toggle(f.fileIndex)} />
                  <Icon name="file" size={14} className="text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                  {!f.exists && <Badge tone="error">Missing</Badge>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function PreviewPanel({ sourceJobId, source }: { sourceJobId: string; source: PrintSource }) {
  const first = source.files.find((f) => f.exists)?.fileIndex ?? null
  const [fileIndex, setFileIndex] = useState<number | null>(first)
  const [page, setPage] = useState(0)
  const [preview, setPreview] = useState<PrintPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef(new Map<string, PrintPreview>())

  useEffect(() => {
    setFileIndex(first)
    setPage(0)
    setPreview(null)
  }, [sourceJobId, first])

  const load = useCallback(
    async (index: number) => {
      const key = `${sourceJobId}:${index}`
      const hit = cache.current.get(key)
      if (hit) {
        setPreview(hit)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const result = await unwrap(api.print.preview(sourceJobId, index))
        cache.current.set(key, result)
        setPreview(result)
      } catch (err) {
        setPreview(null)
        setError(errorMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [sourceJobId]
  )

  if (first === null) return null
  const current = preview?.pages[page]
  return (
    <Section title="Preview" aside={preview ? `${preview.fileName} · page ${page + 1} of ${preview.pageCount}` : undefined}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input" aria-label="File to preview" value={fileIndex ?? ''} onChange={(e) => { setFileIndex(Number(e.target.value)); setPage(0); setPreview(null) }}>
            {source.files.filter((f) => f.exists).map((f) => (
              <option key={f.fileIndex} value={f.fileIndex}>{f.fileName}</option>
            ))}
          </select>
          <Button onClick={() => fileIndex !== null && void load(fileIndex)} loading={loading} data-testid="print-load-preview">
            <Icon name="preview" size={14} />
            {preview ? 'Reload preview' : 'Show preview'}
          </Button>
          {preview && preview.pages.length > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page"><Icon name="chevronLeft" size={14} /></Button>
              <Button onClick={() => setPage((p) => Math.min(preview.pages.length - 1, p + 1))} disabled={page >= preview.pages.length - 1} aria-label="Next page"><Icon name="chevronRight" size={14} /></Button>
            </div>
          )}
        </div>
        {error && <Banner tone="error" title="Preview failed">{error}</Banner>}
        {!preview && !error && <p className="muted text-xs">CorelDRAW renders the real sheet, so what you see is what will print. Check names and spelling before printing.</p>}
        {preview && current && (
          <div className="space-y-1.5">
            <div className="grid place-items-center rounded border border-line bg-surface-2 p-3">
              <img src={current.dataUrl} alt={`${preview.fileName}, page ${current.pageIndex}`} className="max-h-[520px] max-w-full bg-white shadow-card" />
            </div>
            <p className="text-xs text-fg-muted">
              Page size {current.widthMm} × {current.heightMm} mm
              {preview.pageCount > preview.pages.length && ` · showing the first ${preview.pages.length} of ${preview.pageCount} pages`}
            </p>
            {preview.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-warn">
                <Icon name="alert" size={13} className="mt-0.5" />
                {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

function PrinterField({ printers, error, settings, printer, onChange, disabled }: { printers: PrinterInfo[] | null; error: string | null; settings: PrintSettings; printer: PrinterInfo | undefined; onChange: (p: Partial<PrintSettings>) => void; disabled: boolean }) {
  if (!printers) return <p className="muted"><Spinner /> Finding printers…</p>
  const missing = settings.printer !== '' && !printer
  return (
    <div className="space-y-2">
      {error && <Banner tone="error" title="Could not list printers">{error}</Banner>}
      {printers.length === 0 && !error && <Banner tone="warn" title="No printers installed">Add a printer in Windows settings, then refresh.</Banner>}
      <select className="input w-full" aria-label="Printer" value={settings.printer} onChange={(e) => onChange({ printer: e.target.value })} disabled={disabled} data-testid="print-printer">
        {missing && <option value={settings.printer}>{settings.printer} (not installed)</option>}
        {printers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
            {p.isDefault ? ' (default)' : ''}
          </option>
        ))}
      </select>
      {printer && (
        <p className="flex items-center gap-1.5 text-xs">
          <Badge tone={PRINTER_TONE[printer.status]}>{PRINTER_LABEL[printer.status]}</Badge>
          <span className="truncate text-fg-muted">{printer.port}</span>
        </p>
      )}
      {missing && <p className="text-xs text-err">This printer is not available. It will not be replaced by another one: choose a printer yourself.</p>}
    </div>
  )
}

function SettingsFields({ settings, printer, rangeOk, onChange, disabled }: { settings: PrintSettings; printer: PrinterInfo | undefined; rangeOk: boolean; onChange: (p: Partial<PrintSettings>) => void; disabled: boolean }) {
  const unlisted = (size: string) => !!printer && printer.paperSizes.length > 0 && !printer.paperSizes.includes(size)
  return (
    <div className="space-y-3" aria-disabled={disabled}>
      <label className="block">
        <span className="mb-1 block font-medium">Copies</span>
        <input className="input w-24" type="number" min={1} max={MAX_COPIES} value={settings.copies} disabled={disabled} data-testid="print-copies" onChange={(e) => onChange({ copies: Math.min(MAX_COPIES, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
      </label>
      <label className="block">
        <span className="mb-1 block font-medium">Paper size</span>
        <select className="input w-full" value={settings.paper} disabled={disabled} onChange={(e) => onChange({ paper: e.target.value as PrintSettings['paper'] })} data-testid="print-paper">
          {PAPER_SIZES.map((p) => (
            <option key={p} value={p}>
              {p}
              {unlisted(p) ? ' (not listed by printer)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="mb-1 block font-medium">Orientation</span>
        <Segmented label="Orientation" value={settings.orientation} onChange={(orientation) => onChange({ orientation })} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
      </div>
      <label className="block">
        <span className="mb-1 block font-medium">Pages</span>
        <input className={`input w-full ${rangeOk ? '' : 'border-err'}`} value={settings.pageRange} placeholder="All pages, or e.g. 1-3,5" disabled={disabled} aria-invalid={!rangeOk} data-testid="print-range" onChange={(e) => onChange({ pageRange: e.target.value })} />
        {!rangeOk && <span className="mt-1 block text-xs text-err">Use a form like 1-3,5.</span>}
      </label>
      <div>
        <span className="mb-1 block font-medium">Scaling</span>
        <Segmented label="Scaling" value={settings.scaling} onChange={(scaling) => onChange({ scaling })} options={[{ value: 'asDocument', label: '100 %', title: 'Print at the size designed' }, { value: 'fitToPage', label: 'Fit to paper', title: 'Scale the page to the paper' }]} />
      </div>
      <label className="block">
        <span className="mb-1 block font-medium">Color</span>
        <select className="input w-full" value={settings.color} disabled={disabled} onChange={(e) => onChange({ color: e.target.value as PrintSettings['color'] })}>
          {COLOR_MODES.map((c) => (
            <option key={c} value={c}>{c === 'color' ? 'Full color' : c === 'grayscale' ? 'Grayscale' : 'Black only'}</option>
          ))}
        </select>
        {printer?.supportsColor === false && <span className="mt-1 block text-xs text-fg-muted">This printer reports black-and-white only.</span>}
      </label>
    </div>
  )
}

function ConfirmDialog({ plan, onCancel, onConfirm }: { plan: PrintPlan; onCancel: () => void; onConfirm: (allowDuplicates: boolean) => void }) {
  const [ok, setOk] = useState(false)
  const [allowDup, setAllowDup] = useState(false)
  const s = plan.settings
  const blocked = plan.blockers.length > 0
  const needsDup = plan.duplicates.length > 0
  const rows: [string, string][] = [
    ['Printer', s.printer],
    ['Sheets (CDR files)', String(plan.sheetCount)],
    ['Copies of each', String(s.copies)],
    ['Paper', `${s.paper}, ${s.orientation}`],
    ['Pages', s.pageRange === '' ? 'All pages' : s.pageRange],
    ['Scaling', s.scaling === 'fitToPage' ? 'Fit to paper' : '100 %'],
    ['Color', s.color === 'color' ? 'Full color' : s.color === 'grayscale' ? 'Grayscale' : 'Black only']
  ]
  return (
    <Dialog
      title="Confirm printing"
      onClose={onCancel}
      width={520}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm(allowDup)} disabled={blocked || !ok || (needsDup && !allowDup)} data-testid="print-confirm">
            <Icon name="print" size={14} />
            Print {plan.estimatedPages} page{plan.estimatedPages === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words font-medium">{v}</dd>
            </div>
          ))}
          <dt className="text-fg-muted">Total pages to print</dt>
          <dd className="text-base font-semibold" data-testid="print-total">{plan.estimatedPages}</dd>
        </dl>
        <ul className="max-h-32 overflow-y-auto rounded border border-line text-xs">
          {plan.files.map((f) => (
            <li key={f.fileIndex} className="flex justify-between gap-2 border-b border-line px-2 py-1 last:border-0">
              <span className="truncate">{f.fileName}</span>
              <span className="shrink-0 text-fg-muted">{f.pagesToPrint} of {f.pages} page(s)</span>
            </li>
          ))}
        </ul>
        {plan.blockers.map((b, i) => <Banner key={i} tone="error" title="Cannot print">{b}</Banner>)}
        {plan.warnings.map((w, i) => <Banner key={i} tone="warn" title="Check before printing">{w}</Banner>)}
        {needsDup && (
          <Banner tone="warn" title="Already sent to this printer">
            <ul className="list-disc pl-4">
              {plan.duplicates.map((d) => (
                <li key={d.fileIndex}>{d.fileName} ({d.state}, {when(d.at)})</li>
              ))}
            </ul>
            <label className="mt-1.5 flex items-center gap-1.5">
              <input type="checkbox" className="check" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />
              Print these again
            </label>
          </Banner>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="check mt-0.5" checked={ok} disabled={blocked} onChange={(e) => setOk(e.target.checked)} data-testid="print-ack" />
          <span>I checked the printer and its paper. Send these {plan.estimatedPages} page(s) to <strong>{s.printer}</strong>.</span>
        </label>
      </div>
    </Dialog>
  )
}

function JobList({ jobs }: { jobs: PrintJobRecord[] }) {
  if (jobs.length === 0) return <p className="muted">No print jobs yet.</p>
  return (
    <ul className="space-y-3" data-testid="print-jobs">
      {jobs.slice(0, 15).map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </ul>
  )
}

function JobCard({ job }: { job: PrintJobRecord }) {
  const toast = useToast()
  const print = usePrint()
  const [working, setWorking] = useState(false)
  const failed = job.sheets.filter((s) => s.state === 'failed').length
  const queued = job.sheets.filter((s) => s.state === 'queued').length
  const attention = job.sheets.filter((s) => s.state === 'uncertain').length
  const run = async (fn: () => Promise<unknown>) => {
    setWorking(true)
    try {
      await fn()
      await print.refresh()
    } catch (err) {
      toast.push('error', errorMessage(err))
    } finally {
      setWorking(false)
    }
  }
  return (
    <li className="rounded border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5">
        <Badge tone={JOB_TONE[job.status]}>{JOB_LABEL[job.status]}</Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{job.templateName} → {job.settings.printer}</span>
        <span className="text-xs text-fg-muted">{when(job.createdAt)} · {job.sheets.length} file(s) × {job.settings.copies} · {job.estimatedPages} page(s)</span>
        {queued > 0 && isActiveJob(job.sheets) && <Button onClick={() => void run(() => unwrap(api.print.cancel(job.id)))} loading={working}>Cancel pending</Button>}
        {failed > 0 && !isActiveJob(job.sheets) && <Button variant="primary" onClick={() => void run(() => unwrap(api.print.retryFailed(job.id)))} loading={working}>Retry {failed} failed</Button>}
      </div>
      {attention > 0 && (
        <p className="border-b border-line bg-warn-soft px-2.5 py-1 text-xs text-warn">
          {attention} file(s) have an unknown outcome and were not retried automatically. Check the printer and its queue before printing them again.
        </p>
      )}
      <ul className="divide-y divide-line">
        {job.sheets.map((s) => (
          <SheetRow key={s.fileIndex} sheet={s} />
        ))}
      </ul>
    </li>
  )
}

function SheetRow({ sheet }: { sheet: PrintSheetRecord }) {
  return (
    <li className="flex flex-wrap items-start gap-2 px-2.5 py-1.5">
      <Badge tone={SHEET_TONE[sheet.state]}>{SHEET_LABEL[sheet.state]}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate">{sheet.fileName}{sheet.attempts > 1 ? ` · attempt ${sheet.attempts}` : ''}{sheet.spoolerJobId !== null ? ` · Windows job ${sheet.spoolerJobId}` : ''}</p>
        {sheet.note && <p className="text-xs text-fg-muted">{sheet.note}</p>}
        {sheet.error && <p className="break-words text-xs text-err">{sheet.error}</p>}
      </div>
    </li>
  )
}
