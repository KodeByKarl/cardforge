import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { objectNamesByPosition, suggestMapping } from '../../../shared/template/mapping'
import type { MappingEntry, SavedMapping, TemplateObject, TemplateRecord, TemplateSourceStatus } from '../../../shared/template/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, Dialog, EmptyState, PageHeader, StatusDot, type Tone } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { useJob } from '../state/job'
import { pageLabel, useTemplates } from '../state/templates'

export function TemplateScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { list, listError, selected, select, update, refresh } = useTemplates()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runImport = async (work: () => Promise<TemplateRecord | null>) => {
    setError(null)
    setBusy('Inspecting the template in CorelDRAW… The first start of CorelDRAW can take a minute.')
    try {
      const record = await work()
      if (record) {
        await refresh()
        update(record)
        await select(record.id)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Template setup"
        description="Choose a CorelDRAW template and connect its named text objects to spreadsheet columns."
        actions={
          <Button variant="primary" loading={busy !== null} disabled={busy !== null} onClick={() => runImport(() => unwrap(api.templates.pickAndImport()))}>
            Add template…
          </Button>
        }
      />
      {(busy || error || listError) && (
        <div className="space-y-1.5 border-b border-line px-4 py-2">
          {busy && <Banner tone="info" title={busy} />}
          {(error ?? listError) && (
            <Banner tone="error" title="Template problem">
              {error ?? listError}
            </Banner>
          )}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(160px,200px)_minmax(0,1fr)] wide:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-line bg-surface-2" aria-label="Template library">
          <TemplateDrop disabled={busy !== null} onPath={(path) => runImport(() => unwrap(api.templates.import(path)))} />
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {list.length === 0 && <li className="muted px-1 py-4 text-center">No templates yet.</li>}
            {list.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t.id)}
                  aria-current={selected?.id === t.id ? 'true' : undefined}
                  className={`w-full rounded px-2 py-1.5 text-left ${selected?.id === t.id ? 'bg-surface font-medium shadow-card' : 'hover:bg-hover'}`}
                >
                  <p className="truncate">{t.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {t.pages.length === 2 ? 'Front + back' : `${t.pages.length} page${t.pages.length === 1 ? '' : 's'}`} · {t.objectCount} objects
                    {t.hasMapping ? ' · mapped' : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-h-0 min-w-0">
          {selected ? (
            <TemplateDetail key={selected.id} record={selected} navigate={navigate} onBusy={setBusy} onError={setError} />
          ) : (
            <EmptyState title="Select or add a template">
              In CorelDRAW, give every variable text object a name in the Object Manager (for example FullName, JobTitle, Email). Static artwork stays unnamed. The original file is never modified: CardForge keeps its own
              copy.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateDrop({ onPath, disabled }: { onPath: (path: string) => void; disabled: boolean }) {
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || disabled) return
    if (!file.name.toLowerCase().endsWith('.cdr')) {
      setRejected(`“${file.name}” is not a CorelDRAW .cdr file.`)
      return
    }
    setRejected(null)
    onPath(api.excel.pathForFile(file))
  }
  return (
    <div className="p-2">
      <div
        data-testid="template-drop"
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded border border-dashed px-3 py-2.5 text-center text-xs ${over ? 'border-accent bg-accent-soft' : 'border-line-strong text-fg-muted'}`}
      >
        Drop a .cdr template here
        {rejected && (
          <p className="mt-1 text-err" role="alert">
            {rejected}
          </p>
        )}
      </div>
    </div>
  )
}

function TemplateDetail({
  record,
  navigate,
  onBusy,
  onError
}: {
  record: TemplateRecord
  navigate: (s: ScreenKey) => void
  onBusy: (msg: string | null) => void
  onError: (msg: string | null) => void
}) {
  const { update, select, refresh, issues } = useTemplates()
  const { dataset } = useJob()
  const [images, setImages] = useState<{ pageIndex: number; dataUrl: string }[]>([])
  const [source, setSource] = useState<TemplateSourceStatus | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const pages = record.inspection.pages

  useEffect(() => {
    unwrap(api.templates.pageImages(record.id)).then(setImages, () => setImages([]))
    unwrap(api.templates.sourceStatus(record.id)).then(setSource, () => setSource(null))
  }, [record.id, record.updatedAt])

  const reinspect = async () => {
    onBusy('Re-inspecting the template in CorelDRAW…')
    onError(null)
    try {
      update(await unwrap(api.templates.reinspect(record.id)))
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      onBusy(null)
    }
  }

  const reimport = async () => {
    onBusy('Importing the updated template…')
    onError(null)
    try {
      const fresh = await unwrap(api.templates.import(record.sourcePath))
      if (record.mapping) update(await unwrap(api.templates.saveMapping(fresh.id, record.mapping)))
      await refresh()
      await select(fresh.id)
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      onBusy(null)
    }
  }

  const remove = async () => {
    setConfirmRemove(false)
    try {
      await unwrap(api.templates.remove(record.id))
      await select(null)
      await refresh()
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  const first = pages[0]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base">{record.name}</h2>
          <p className="truncate text-xs text-fg-muted" title={record.sourcePath}>
            {record.sourcePath}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {first && (
              <Badge>
                {first.widthMm} × {first.heightMm} mm
              </Badge>
            )}
            <Badge>{pages.length === 2 ? 'Front + back' : `${pages.length} page(s)`}</Badge>
            <Badge>{record.inspection.objects.length} named text objects</Badge>
            {record.inspection.unnamedTextCount > 0 && <Badge>{record.inspection.unnamedTextCount} unnamed (static) text</Badge>}
            <Badge tone="info">Inspected with CorelDRAW {record.inspection.corelVersion.replace(/^Version /, '')}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={reinspect}>Re-inspect</Button>
          <Button onClick={() => setConfirmRemove(true)}>Remove…</Button>
        </div>
      </div>

      {(source && (!source.exists || source.changed)) && (
        <div className="space-y-1.5 border-b border-line px-4 py-2">
          {!source.exists && (
            <Banner tone="info" title="The original file is no longer at its imported location.">
              The library copy is still used, so generation is unaffected.
            </Banner>
          )}
          {source.changed && (
            <Banner
              tone="warn"
              title="The original template has changed since it was imported."
              actions={
                <Button onClick={reimport} className="h-6 px-2 text-xs">
                  Import new version
                </Button>
              }
            >
              Cards are generated from the imported version. The mapping is carried over.
            </Banner>
          )}
        </div>
      )}

      {/* Two panes when there is room (artwork | mapping); one scrolling column otherwise. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(240px,4fr)_minmax(0,7fr)] lg:overflow-hidden">
        <section aria-label="Template pages" className="border-b border-line bg-canvas p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap justify-center gap-4 lg:flex-col lg:items-center">
            {pages.map((p) => {
              const img = images.find((i) => i.pageIndex === p.index)
              return (
                <figure key={p.index} className="w-full" style={{ maxWidth: `min(100%, calc(34vh * ${p.widthMm / p.heightMm}))` }}>
                  <div className="relative bg-white shadow-card" style={{ aspectRatio: `${p.widthMm} / ${p.heightMm}` }}>
                    {img ? <img src={img.dataUrl} alt={`${pageLabel(p.index, pages.length)} of ${record.name}`} className="h-full w-full" draggable={false} /> : <p className="p-3 text-xs text-fg-muted">No image</p>}
                    {record.inspection.objects
                      .filter((o) => o.pageIndex === p.index)
                      .map((o, i) => (
                        <ObjectBox key={`${o.name}-${i}`} object={o} widthMm={p.widthMm} heightMm={p.heightMm} active={highlight === o.name} />
                      ))}
                  </div>
                  <figcaption className="mt-1 text-center text-xs tabular-nums text-fg-muted">
                    {pageLabel(p.index, pages.length)} · {p.widthMm} × {p.heightMm} mm
                  </figcaption>
                </figure>
              )
            })}
          </div>
          <div className="mt-3 empty:hidden">
            <X7Notice version={record.inspection.corelVersion} compact />
          </div>
        </section>

        <div className="flex min-h-0 flex-col bg-surface">
          <MappingEditor record={record} onHighlight={setHighlight} onError={onError} onImport={() => navigate('import')} />
          {issues.length > 0 && (
            <ul className="shrink-0 space-y-0.5 border-t border-line bg-surface-2 px-4 py-2" aria-label="Mapping check">
              {issues.map((i, n) => (
                <li key={n} className={`flex items-start gap-1.5 ${i.severity === 'error' ? 'text-err' : 'text-warn'}`}>
                  <Icon name="alert" size={13} className="mt-0.5" />
                  <span>
                    {i.objectName ? <strong>{i.objectName}: </strong> : null}
                    {i.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!dataset && (
            <div className="shrink-0 border-t border-line p-2">
              <Banner tone="info" title="Import a spreadsheet to map columns." actions={<Button onClick={() => navigate('import')} className="h-6 px-2 text-xs">Go to Excel import</Button>} />
            </div>
          )}
        </div>
      </div>

      {confirmRemove && (
        <Dialog
          title="Remove template from library?"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <Button data-autofocus onClick={() => setConfirmRemove(false)}>
                Keep template
              </Button>
              <Button variant="danger-solid" onClick={remove}>
                Remove from library
              </Button>
            </>
          }
        >
          <p>
            “{record.name}” and its saved mapping are removed from CardForge. The original .cdr file is not touched.
          </p>
        </Dialog>
      )}
    </div>
  )
}

function ObjectBox({ object, widthMm, heightMm, active }: { object: TemplateObject; widthMm: number; heightMm: number; active: boolean }) {
  const b = object.bounds
  const style = {
    left: `${(b.left / widthMm) * 100}%`,
    top: `${((heightMm - b.top) / heightMm) * 100}%`,
    width: `${((b.right - b.left) / widthMm) * 100}%`,
    height: `${((b.top - b.bottom) / heightMm) * 100}%`
  }
  return (
    <div
      className={`pointer-events-none absolute border ${active ? 'border-2 border-overlay bg-overlay/20' : 'border-dashed border-overlay/50'}`}
      style={style}
      title={object.name}
    />
  )
}

const KEEP = '__keep__'
const BLANK = '__blank__'

function entryValue(entry: MappingEntry | undefined): string {
  if (!entry || entry.kind === 'keep') return KEEP
  if (entry.kind === 'blank') return BLANK
  return `col:${entry.columnLabel}`
}

function MappingEditor({ record, onHighlight, onError, onImport }: { record: TemplateRecord; onHighlight: (name: string | null) => void; onError: (m: string | null) => void; onImport: () => void }) {
  const { update, resolved } = useTemplates()
  const { dataset } = useJob()
  const [mapping, setMapping] = useState<SavedMapping>(record.mapping ?? { version: 1, entries: {} })
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>(record.mapping ? 'saved' : 'unsaved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const columns = (dataset?.columns ?? []).filter((c) => c.include)
  const names = useMemo(() => objectNamesByPosition(record.inspection.objects), [record.inspection.objects])
  const pages = record.inspection.pages.length

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const persist = (next: SavedMapping) => {
    setMapping(next)
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        update(await unwrap(api.templates.saveMapping(record.id, next)))
        setSaveState('saved')
      } catch (err) {
        setSaveState('unsaved')
        onError(errorMessage(err))
      }
    }, 400)
  }

  const setEntry = (name: string, value: string) => {
    const entry: MappingEntry = value === KEEP ? { kind: 'keep' } : value === BLANK ? { kind: 'blank' } : { kind: 'column', columnLabel: value.slice(4) }
    persist({ version: 1, entries: { ...mapping.entries, [name]: entry } })
  }

  const autoMatch = () => {
    if (!dataset) return
    const suggested = suggestMapping(record.inspection.objects, dataset.columns)
    // Keep explicit choices; only fill objects that are unmapped.
    const entries = { ...suggested.entries }
    for (const [name, e] of Object.entries(mapping.entries)) if (e.kind !== 'keep') entries[name] = e
    persist({ version: 1, entries })
  }

  const statusOf = (name: string): { tone: Tone; label: string } => {
    const res = resolved.get(name)
    if (res?.kind === 'missing') return { tone: 'error', label: 'Column missing' }
    if (res?.kind === 'column') return { tone: 'ok', label: 'Mapped' }
    if (res?.kind === 'blank') return { tone: 'neutral', label: 'Blank' }
    return { tone: 'warn', label: 'Template text' }
  }
  const counts = names.reduce(
    (acc, n) => {
      const k = resolved.get(n)?.kind
      if (k === 'column') acc.mapped++
      else if (k === 'missing') acc.missing++
      else if (k === 'blank') acc.blank++
      else acc.keep++
      return acc
    },
    { mapped: 0, missing: 0, blank: 0, keep: 0 }
  )

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, name: string) => {
    if (e.key === 'Escape') onHighlight(null)
    else onHighlight(name)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Field mapping">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2">
        <h3 className="text-sm">Field mapping</h3>
        <p className="text-xs text-fg-muted" aria-live="polite">
          <span className="font-semibold text-ok">{counts.mapped}</span> mapped
          {counts.keep > 0 && <> · <span className="font-semibold text-warn">{counts.keep}</span> keep template text</>}
          {counts.missing > 0 && <> · <span className="font-semibold text-err">{counts.missing}</span> missing column</>}
          {counts.blank > 0 && <> · {counts.blank} blank</>} · {saveState === 'saved' ? 'saved' : saveState === 'saving' ? 'saving…' : 'not saved yet'}
        </p>
        <Button className="ml-auto" disabled={!dataset} onClick={autoMatch} title={dataset ? 'Match object names to column headers' : 'Import a spreadsheet first'}>
          Auto-match
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!dataset && (
          <p className="muted border-b border-line bg-surface-2 px-4 py-1.5 text-xs">
            No spreadsheet is loaded, so there are no columns to choose from.{' '}
            <button type="button" className="text-accent underline" onClick={onImport}>
              Import data
            </button>
          </p>
        )}
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-head w-6">
                <span className="sr-only">Status</span>
              </th>
              <th className="table-head">Text object</th>
              <th className="table-head compact:hidden">Template text</th>
              <th className="table-head w-[min(15rem,40%)]">Fill from</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const objs = record.inspection.objects.filter((o) => o.name === name)
              const o = objs[0]!
              const res = resolved.get(name)
              const status = statusOf(name)
              const value = entryValue(mapping.entries[name])
              const savedLabel = mapping.entries[name]?.kind === 'column' ? (mapping.entries[name] as { columnLabel: string }).columnLabel : null
              const column = res?.kind === 'column' ? res.column : null
              return (
                <tr key={name} onMouseEnter={() => onHighlight(name)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(name)} onKeyDown={(e) => onRowKey(e, name)} className="hover:bg-surface-2 focus-within:bg-surface-2">
                  <td className="table-cell pt-2">
                    <StatusDot tone={status.tone} label={status.label} />
                  </td>
                  <td className="table-cell">
                    <p className="flex flex-wrap items-center gap-1 font-medium">
                      {name}
                      {column ? (column.required ? <Badge tone="info">Required</Badge> : <Badge>Optional</Badge>) : null}
                      {o.isParagraph && <Badge>frame</Badge>}
                      {o.mixedFormatting && <Badge tone="warn">mixed</Badge>}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {[...new Set(objs.map((x) => pageLabel(x.pageIndex, pages)))].join(' + ')}
                      {o.path.length > 0 && <span> · in {o.path.join(' › ')}</span>}
                      {' · '}
                      {o.font} {o.sizePt}pt{o.bold ? ' bold' : ''}
                    </p>
                    <p className={`text-xs ${status.tone === 'error' ? 'text-err' : status.tone === 'warn' ? 'text-warn' : 'text-fg-muted'}`}>{status.label}</p>
                  </td>
                  <td className="table-cell max-w-[200px] truncate text-fg-muted compact:hidden" title={o.text}>
                    {o.text || <span className="italic">empty</span>}
                  </td>
                  <td className="table-cell">
                    <select className="input h-control w-full" aria-invalid={res?.kind === 'missing' || undefined} value={value} onChange={(e) => setEntry(name, e.target.value)} aria-label={`Fill ${name} from`}>
                      <option value={KEEP}>Keep template text</option>
                      <option value={BLANK}>Leave blank</option>
                      {columns.map((c) => (
                        <option key={c.key} value={`col:${c.label}`}>
                          {c.label}
                        </option>
                      ))}
                      {savedLabel && !columns.some((c) => c.label === savedLabel) && <option value={`col:${savedLabel}`}>{savedLabel} (not in current sheet)</option>}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
