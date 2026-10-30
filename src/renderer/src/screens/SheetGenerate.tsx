import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_SHEETS_PER_FILE, planBatches } from '../../../shared/sheet/batches'
import type { SheetGenerationPlan, SheetGenerationRequest, SheetOverwrite } from '../../../shared/sheet/types'
import type { JobSummary, TemplateRecord } from '../../../shared/template/types'
import type { AppSettings } from '../../../shared/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { SheetModePicker } from '../components/SheetModePicker'
import { Banner, Button, Dialog, EmptyState, PageHeader, Section, useToast } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { useCorelStatus } from '../state/corel'
import { useGeneration } from '../state/generation'
import { usePrint } from '../state/print'
import { useMissingFonts, useSheetData } from '../state/sheet'
import { useSheetSettings } from '../state/sheetSettings'
import { useTemplates } from '../state/templates'
import { Check, Completion, JobLog, RunSummary } from './GenerateScreen'

const LARGE_JOB_SHEETS = 100

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min` : `${Math.max(1, Math.round(seconds))} s`
}

/** Production screen for multi-card A4 sheets: settings, a plan the operator can read, safe start, resume, cancel, verification. */
export function SheetGenerateScreen({ template, navigate }: { template: TemplateRecord; navigate: (s: ScreenKey) => void }) {
  const sheet = template.sheet!
  const { dataset, eligible, excludedRows } = useSheetData()
  const { issues } = useTemplates()
  const { status: corel } = useCorelStatus()
  const generation = useGeneration()
  const print = usePrint()
  const toast = useToast()
  const [settings, setSettings] = useSheetSettings(template)
  const missingFonts = useMissingFonts(template.id)
  const [app, setApp] = useState<AppSettings | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [confirmStart, setConfirmStart] = useState<SheetGenerationRequest | null>(null)
  const [conflict, setConflict] = useState<{ plan: SheetGenerationPlan; request: SheetGenerationRequest } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    unwrap(api.settings.get()).then(
      (s) => {
        setApp(s)
        setOutputDir(s.outputDirectory ?? '')
      },
      (err) => setError(errorMessage(err))
    )
  }, [])

  const progress = generation.progress
  const running = generation.running
  useEffect(() => {
    if (running && startedAt.current === null) startedAt.current = Date.now()
    if (!running) startedAt.current = null
  }, [running])

  const plan = useMemo(() => (eligible.length > 0 ? planBatches(eligible.length, settings.cardsPerSheet, Math.min(settings.sheetsPerFile, MAX_SHEETS_PER_FILE), settings.mode ?? 'unique') : null), [eligible.length, settings.cardsPerSheet, settings.sheetsPerFile, settings.mode])
  const sheets = plan?.sheetPlan.sheets.length ?? 0
  const lastSheet = plan?.sheetPlan.sheets.at(-1)
  const blocking = issues.filter((i) => i.severity === 'error')
  const ready = !!settings.mode && !!dataset && eligible.length > 0 && blocking.length === 0 && !!corel?.available && outputDir.length > 0
  const blocker = !settings.mode ? 'Choose the production mode' : !dataset || eligible.length === 0 ? 'Import records first' : blocking.length > 0 ? blocking[0]!.message : !corel?.available ? 'CorelDRAW is not available' : !outputDir ? 'Choose an output folder' : null

  const buildRequest = (overwrite: SheetOverwrite): SheetGenerationRequest => ({
    templateId: template.id,
    outputDirectory: outputDir,
    mode: settings.mode!,
    cardsPerSheet: settings.cardsPerSheet,
    sheetsPerFile: settings.sheetsPerFile,
    exportPdf: settings.exportPdf,
    clearEmpty: settings.clearEmpty,
    overwrite,
    columns: dataset!.columns.filter((c) => c.include).map((c) => ({ key: c.key, label: c.label })),
    records: eligible.map((r) => ({ rowNumber: r.rowNumber, values: r.values })),
    excludedRows
  })

  const start = async (request: SheetGenerationRequest) => {
    setConflict(null)
    setConfirmStart(null)
    setStarting(true)
    try {
      const { jobId } = await unwrap(api.sheets.start(request))
      generation.begin(jobId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setStarting(false)
    }
  }

  const onGenerate = async () => {
    setError(null)
    setStarting(true)
    try {
      const request = buildRequest('resume')
      const planned = await unwrap(api.sheets.plan(request))
      if (planned.problems.length > 0) throw new Error(`The sheet plan is not safe: ${planned.problems[0]}`)
      if (planned.conflicts > 0 || planned.resumable) {
        setStarting(false)
        setConflict({ plan: planned, request })
      } else if (planned.sheets > LARGE_JOB_SHEETS) {
        setStarting(false)
        setConfirmStart(request)
      } else await start(request)
    } catch (err) {
      setStarting(false)
      setError(errorMessage(err))
    }
  }

  const pickFolder = async () => {
    const dir = await unwrap(api.generation.pickOutputDirectory()).catch(() => null)
    if (dir) setOutputDir(dir)
  }

  const lastJob: JobSummary | undefined = progress && !running ? generation.history.find((j) => j.id === progress.jobId) : undefined
  const elapsed = startedAt.current && running ? (Date.now() - startedAt.current) / 1000 : 0
  const eta = running && progress?.sheet && progress.sheet.sheetsDone > 2 && elapsed > 0 ? (elapsed / progress.sheet.sheetsDone) * (progress.sheet.sheetsTotal - progress.sheet.sheetsDone) : null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Generate card sheets"
        description="Editable CDR files with several A4 sheets each. Printing is done in CorelDRAW."
        actions={
          running ? (
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              Cancel generation…
            </Button>
          ) : (
            <Button variant="primary" loading={starting} disabled={!ready || starting} onClick={onGenerate} title={blocker ?? undefined} data-testid="generate-button">
              <Icon name="generate" size={14} />
              {`Generate ${sheets.toLocaleString()} sheet${sheets === 1 ? '' : 's'}`}
            </Button>
          )
        }
      />
      {error && (
        <div className="border-b border-line px-4 py-2">
          <Banner tone="error" title="Generation problem">
            {error}
          </Banner>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto wide:grid-cols-[minmax(380px,2fr)_minmax(0,3fr)] wide:overflow-hidden">
        <div className="space-y-5 p-4 wide:overflow-y-auto wide:border-r wide:border-line">
          <Section title="Before you generate">
            <ul className="divide-y divide-line border-y border-line">
              <Check
                tone={eligible.length > 0 ? (excludedRows.length ? 'warn' : 'ok') : 'error'}
                label="Records"
                value={dataset ? `${eligible.length.toLocaleString()} printable of ${dataset.records.length.toLocaleString()}${excludedRows.length ? ` · ${excludedRows.length.toLocaleString()} left out because of errors` : ''}` : 'No spreadsheet imported'}
                action={<Button onClick={() => navigate('import')}>Review</Button>}
              />
              <Check
                tone={blocking.length > 0 ? 'error' : issues.length > 0 ? 'warn' : 'ok'}
                label="Template and mapping"
                value={blocking.length > 0 ? blocking[0]!.message : `${template.name} · ${sheet.cells.length} cards per sheet${issues.length ? ` · ${issues.length} note(s)` : ''}`}
                action={<Button onClick={() => navigate('template')}>Review</Button>}
              />
              <Check tone={missingFonts === null ? 'neutral' : missingFonts.length > 0 ? 'warn' : 'ok'} label="Fonts" value={missingFonts === null ? 'Checking…' : missingFonts.length > 0 ? `Not installed: ${missingFonts.join(', ')} — CorelDRAW will substitute` : 'All template fonts are installed'} />
              <Check tone={!corel ? 'neutral' : !corel.available ? 'error' : corel.isX7 ? 'ok' : 'warn'} label="CorelDRAW" value={!corel ? 'Checking…' : corel.available ? `${corel.progId}${corel.isX7 ? ' (X7)' : ' — not X7, validation pending'}` : corel.detail} />
            </ul>
          </Section>

          <Section title="Production">
            <div className="space-y-3">
              <SheetModePicker value={settings.mode} onChange={(m) => setSettings({ mode: m })} cards={settings.cardsPerSheet} disabled={running} />
              <label className="block">
                <span className="mb-1 block font-medium">Cards per sheet</span>
                <select className="input w-full" value={settings.cardsPerSheet} onChange={(e) => setSettings({ cardsPerSheet: Number(e.target.value) })} disabled={running} data-testid="gen-cards-per-sheet">
                  {Array.from({ length: sheet.cells.length }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {n === sheet.cells.length ? ` — all ${n} positions of this template` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">Sheets per file</span>
                <input className="input w-28" type="number" min={1} max={MAX_SHEETS_PER_FILE} value={settings.sheetsPerFile} disabled={running} data-testid="gen-sheets-per-file" onChange={(e) => setSettings({ sheetsPerFile: Math.min(MAX_SHEETS_PER_FILE, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
                <span className="muted mt-1 block text-xs">One CDR file holds this many A4 pages. Smaller files open faster and are easier to resume; larger files mean fewer files to manage.</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="check" checked={settings.exportPdf} disabled={running} onChange={(e) => setSettings({ exportPdf: e.target.checked })} data-testid="gen-pdf" />
                Also export a print-ready PDF next to each CDR
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="check" checked={settings.clearEmpty} disabled={running} onChange={(e) => setSettings({ clearEmpty: e.target.checked })} />
                Remove the artwork of unused card positions on the last sheet
              </label>
              {plan && settings.mode && (
                <div className="well p-3" aria-live="polite" data-testid="gen-plan">
                  <p className="font-semibold tabular-nums">
                    {eligible.length.toLocaleString()} records → {sheets.toLocaleString()} sheets → {plan.batches.length.toLocaleString()} file{plan.batches.length === 1 ? '' : 's'}
                  </p>
                  <p className="muted text-xs">
                    {settings.mode === 'copies'
                      ? `${settings.cardsPerSheet} identical copies of each record on its own sheet. Each record appears on exactly one sheet.`
                      : `${settings.cardsPerSheet} different records per sheet${lastSheet && lastSheet.count < settings.cardsPerSheet ? `; the last sheet holds ${lastSheet.count}` : ''}. Each record appears exactly once.`}
                  </p>
                </div>
              )}
            </div>
          </Section>

          <Section title="Output">
            <div className="space-y-3">
              <div>
                <label htmlFor="sheet-out-dir" className="mb-1 block font-medium">
                  Output folder
                </label>
                <div className="flex gap-2">
                  <input id="sheet-out-dir" className="input min-w-0 flex-1 font-mono text-xs" readOnly value={outputDir} placeholder="Choose a folder" />
                  <Button onClick={pickFolder} disabled={running}>
                    <Icon name="folder" size={14} />
                    Choose…
                  </Button>
                </div>
              </div>
              <p className="muted text-xs">
                Files are named “{template.name} sheets 00001-00025.cdr” and saved in CorelDRAW X7 (v17) format. A manifest, a report and a print summary are written next to them. This system never sends anything to a printer.
                {app && ` Existing files are handled when you start (resume, skip, keep both or overwrite).`}
              </p>
              <X7Notice version={corel?.isX7 ? 'Version 17' : (template.inspection.corelVersion ?? null)} compact />
            </div>
          </Section>
        </div>

        <div className="flex min-h-0 flex-col p-4">
          {!progress ? (
            <EmptyState title="No generation run yet">{ready ? 'Press “Generate”. Progress, failures and warnings appear here. You can cancel safely and resume later; finished files are kept and verified.' : blocker ? `${blocker} to enable generation.` : 'Complete the checks on the left.'}</EmptyState>
          ) : (
            <>
              <RunSummary />
              {eta !== null && <p className="-mt-2 mb-2 text-xs text-fg-muted">About {duration(eta)} remaining (based on the speed so far).</p>}
              {!running && lastJob && (
                <>
                  <Completion job={lastJob} onPrint={() => { print.selectSource(lastJob.id); navigate('print') }} />
                  {lastJob.sheetJob && (
                    <div className="mb-3 shrink-0 space-y-1" data-testid="verification">
                      {lastJob.sheetJob.verification.map((v, i) => (
                        <Banner key={i} tone={v.startsWith('OK') ? 'ok' : 'warn'} title={v.startsWith('OK') ? 'Output verified' : 'Verification finding'}>
                          {v}
                        </Banner>
                      ))}
                      {lastJob.sheetJob.summaryPath && <p className="muted break-all text-xs">Print summary: {lastJob.sheetJob.summaryPath}</p>}
                      {lastJob.status !== 'completed' && <p className="text-xs text-warn">The job did not finish. Start it again with the same settings and choose “Resume”: finished files are kept.</p>}
                    </div>
                  )}
                </>
              )}
              <JobLog />
            </>
          )}
        </div>
      </div>

      {conflict && (
        <Dialog
          title={conflict.plan.resumable ? 'Resume the earlier run?' : 'Some files already exist'}
          width={500}
          onClose={() => setConflict(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConflict(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => start({ ...conflict.request, overwrite: 'overwrite' })}>
                Overwrite all
              </Button>
              <Button onClick={() => start({ ...conflict.request, overwrite: 'suffix' })}>Keep both</Button>
              <Button variant="primary" data-autofocus onClick={() => start({ ...conflict.request, overwrite: conflict.plan.resumable ? 'resume' : 'skip' })}>
                {conflict.plan.resumable ? 'Resume' : 'Skip existing'}
              </Button>
            </>
          }
        >
          {conflict.plan.resumable ? (
            <p>
              {conflict.plan.completed} of {conflict.plan.batches.length} files were already completed by an identical run. Resume generates only the remaining {conflict.plan.batches.length - conflict.plan.completed} and keeps the finished ones (their size is checked).
            </p>
          ) : (
            <p>{conflict.plan.conflicts} of {conflict.plan.batches.length} output files already exist in this folder.</p>
          )}
          {conflict.plan.conflicts > 0 && conflict.plan.resumable && <p className="muted mt-2 text-xs">{conflict.plan.conflicts} other existing file(s) were not made by that run; Resume skips them rather than replacing them.</p>}
        </Dialog>
      )}

      {confirmStart && (
        <Dialog
          title="Start a large job?"
          width={480}
          onClose={() => setConfirmStart(null)}
          footer={
            <>
              <Button data-autofocus onClick={() => setConfirmStart(null)}>
                Not yet
              </Button>
              <Button variant="primary" onClick={() => start(confirmStart)}>
                Start generating
              </Button>
            </>
          }
        >
          <p>
            This creates {sheets.toLocaleString()} sheets in {plan?.batches.length.toLocaleString()} files and can take a long time. CorelDRAW is used in the background; you can cancel safely at any time and resume later. Nothing is printed.
          </p>
        </Dialog>
      )}

      {confirmCancel && progress && (
        <Dialog
          title="Stop generating?"
          onClose={() => setConfirmCancel(false)}
          footer={
            <>
              <Button data-autofocus onClick={() => setConfirmCancel(false)}>
                Keep going
              </Button>
              <Button
                variant="danger-solid"
                onClick={() => {
                  void api.generation.cancel(progress.jobId).catch((e) => toast.push('error', errorMessage(e)))
                  setConfirmCancel(false)
                }}
              >
                Stop after current sheet
              </Button>
            </>
          }
        >
          <p>The file being built is discarded; files already finished are kept and can be resumed later.</p>
        </Dialog>
      )}
    </div>
  )
}
