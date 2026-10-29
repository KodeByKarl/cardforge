import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { objectNamesByPosition, suggestMapping } from '../../../shared/template/mapping'
import type { MappingEntry, SavedMapping, TemplateObject, TemplateRecord, TemplateSourceStatus } from '../../../shared/template/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Badge, Banner, PageHeader } from '../components/ui'
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
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => runImport(() => unwrap(api.templates.pickAndImport()))}>
            Add template…
          </button>
        }
      />
      <div className="space-y-2 px-6 pt-3 empty:hidden">
        {busy && <Banner tone="info" title={busy} />}
        {(error ?? listError) && (
          <Banner tone="error" title="Template problem">
            {error ?? listError}
          </Banner>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-stone-200 dark:border-stone-800">
          <TemplateDrop disabled={busy !== null} onPath={(path) => runImport(() => unwrap(api.templates.import(path)))} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {list.length === 0 && <p className="muted px-1 py-6 text-center">No templates yet.</p>}
            {list.map((t) => (
              <button
                key={t.id}
                onClick={() => select(t.id)}
                className={`mb-1 w-full rounded-md px-3 py-2 text-left ${
                  selected?.id === t.id ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700' : 'hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
                }`}
              >
                <p className="truncate font-medium">{t.name}</p>
                <p className="muted text-xs">
                  {t.pages.length === 2 ? 'Front + back' : `${t.pages.length} page${t.pages.length === 1 ? '' : 's'}`} · {t.objectCount} named objects
                  {t.hasMapping ? ' · mapped' : ''}
                </p>
              </button>
            ))}
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {selected ? <TemplateDetail key={selected.id} record={selected} navigate={navigate} onBusy={setBusy} onError={setError} /> : <NoSelection />}
        </main>
      </div>
    </div>
  )
}

function NoSelection() {
  return (
    <div className="mx-auto max-w-lg p-10 text-center">
      <p className="font-medium">Select or add a template</p>
      <p className="muted mt-1">
        In CorelDRAW, give every variable text object a name in the Object Manager (for example FullName, JobTitle, Email). Static artwork stays
        unnamed. The original file is never modified: CardForge keeps its own copy.
      </p>
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
    <div className="p-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs ${over ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40' : 'border-stone-300 dark:border-stone-700'}`}
      >
        Drop a .cdr template here
        {rejected && <p className="mt-1 text-red-700 dark:text-red-400">{rejected}</p>}
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
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{record.name}</h2>
          <p className="muted text-xs break-all">{record.sourcePath}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
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
          <button className="btn" onClick={reinspect}>
            Re-inspect
          </button>
          {confirmRemove ? (
            <>
              <button className="btn border-red-700 bg-red-700 text-white hover:bg-red-800" onClick={remove}>
                Remove from library
              </button>
              <button className="btn" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirmRemove(true)}>
              Remove…
            </button>
          )}
        </div>
      </div>

      <X7Notice version={record.inspection.corelVersion} />
      {source && !source.exists && (
        <Banner tone="info" title="The original file is no longer at its imported location.">
          The library copy is still used, so generation is unaffected.
        </Banner>
      )}
      {source?.changed && (
        <Banner tone="warn" title="The original template has changed since it was imported.">
          <span>Cards are generated from the imported version. </span>
          <button className="underline" onClick={reimport}>
            Import the new version
          </button>
          <span> (the mapping is carried over).</span>
        </Banner>
      )}

      <section>
        <h3 className="eyebrow mb-2">Template pages (exported by CorelDRAW)</h3>
        <div className="flex flex-wrap gap-4">
          {pages.map((p) => {
            const img = images.find((i) => i.pageIndex === p.index)
            return (
              <figure key={p.index} className="w-full max-w-md">
                <div className="relative overflow-hidden rounded border border-stone-300 bg-white dark:border-stone-700" style={{ aspectRatio: `${p.widthMm} / ${p.heightMm}` }}>
                  {img ? <img src={img.dataUrl} alt={`${pageLabel(p.index, pages.length)} of ${record.name}`} className="h-full w-full" /> : <p className="muted p-4">No image</p>}
                  {record.inspection.objects
                    .filter((o) => o.pageIndex === p.index)
                    .map((o, i) => (
                      <ObjectBox key={`${o.name}-${i}`} object={o} widthMm={p.widthMm} heightMm={p.heightMm} active={highlight === o.name} />
                    ))}
                </div>
                <figcaption className="muted mt-1 text-xs">
                  {pageLabel(p.index, pages.length)} · {p.widthMm} × {p.heightMm} mm
                </figcaption>
              </figure>
            )
          })}
        </div>
      </section>

      <MappingEditor record={record} onHighlight={setHighlight} onError={onError} />

      {issues.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="eyebrow">Mapping check</h3>
          {issues.map((i, n) => (
            <p key={n} className={i.severity === 'error' ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300'}>
              {i.objectName ? <strong>{i.objectName}: </strong> : null}
              {i.message}
            </p>
          ))}
        </section>
      )}
      {!dataset && (
        <Banner tone="info" title="Import a spreadsheet to map columns.">
          <button className="underline" onClick={() => navigate('import')}>
            Go to Excel import
          </button>
        </Banner>
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
      className={`pointer-events-none absolute border ${active ? 'border-2 border-teal-600 bg-teal-500/15' : 'border-dashed border-teal-600/40'}`}
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

function MappingEditor({ record, onHighlight, onError }: { record: TemplateRecord; onHighlight: (name: string | null) => void; onError: (m: string | null) => void }) {
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

  return (
    <section>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="eyebrow">Field mapping</h3>
        <span className="muted text-xs">{saveState === 'saved' ? 'Saved to this template' : saveState === 'saving' ? 'Saving…' : 'Not saved yet'}</span>
        <button className="btn ml-auto" disabled={!dataset} onClick={autoMatch}>
          Auto-match columns
        </button>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-head">Text object</th>
              <th className="table-head">Where</th>
              <th className="table-head">Template text</th>
              <th className="table-head">Format</th>
              <th className="table-head w-64">Fill from</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const objs = record.inspection.objects.filter((o) => o.name === name)
              const o = objs[0]!
              const res = resolved.get(name)
              const value = entryValue(mapping.entries[name])
              const savedLabel = mapping.entries[name]?.kind === 'column' ? (mapping.entries[name] as { columnLabel: string }).columnLabel : null
              return (
                <tr key={name} onMouseEnter={() => onHighlight(name)} onMouseLeave={() => onHighlight(null)} className="hover:bg-stone-50 dark:hover:bg-stone-900">
                  <td className="table-cell font-medium">{name}</td>
                  <td className="table-cell muted text-xs">
                    {[...new Set(objs.map((x) => pageLabel(x.pageIndex, pages)))].join(' + ')}
                    {o.path.length > 0 && <span> · in {o.path.join(' › ')}</span>}
                  </td>
                  <td className="table-cell max-w-[220px] truncate" title={o.text}>
                    {o.text || <span className="muted italic">empty</span>}
                  </td>
                  <td className="table-cell text-xs">
                    {o.font} {o.sizePt}pt{o.bold ? ' bold' : ''}
                    {o.isParagraph && <Badge>frame</Badge>} {o.mixedFormatting && <Badge tone="warn">mixed</Badge>}
                  </td>
                  <td className="table-cell">
                    <select
                      className={`input h-7 w-full ${res?.kind === 'missing' ? 'border-red-500' : ''}`}
                      value={value}
                      onChange={(e) => setEntry(name, e.target.value)}
                      aria-label={`Fill ${name} from`}
                    >
                      <option value={KEEP}>Keep template text</option>
                      <option value={BLANK}>Leave blank</option>
                      {columns.map((c) => (
                        <option key={c.key} value={`col:${c.label}`}>
                          {c.label}
                        </option>
                      ))}
                      {savedLabel && !columns.some((c) => c.label === savedLabel) && (
                        <option value={`col:${savedLabel}`}>{savedLabel} (not in current sheet)</option>
                      )}
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
