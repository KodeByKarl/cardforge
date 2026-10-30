import { useEffect, useMemo, useState } from 'react'
import { planFileNames } from '../../../shared/generation/naming'
import { buildGenerationInputs, hasBlockingMappingIssues } from '../../../shared/template/mapping'
import type { GenerationPlan, GenerationRequest, JobSummary, ResolvedOverwrite } from '../../../shared/template/types'
import type { AppSettings } from '../../../shared/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, Dialog, EmptyState, PageHeader, Progress, Section, StatusDot, useToast, type Tone } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { useCorelStatus } from '../state/corel'
import { useGeneration } from '../state/generation'
import { useJob } from '../state/job'
import { usePrint } from '../state/print'
import { useTemplates } from '../state/templates'
import { SheetGenerateScreen } from './SheetGenerate'

/** Sheet templates use the sheet production screen; single-card templates keep the one-file-per-record screen. */
export function GenerateScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { selected, sheetMode } = useTemplates()
  return sheetMode && selected ? <SheetGenerateScreen template={selected} navigate={navigate} /> : <SingleGenerateScreen navigate={navigate} />
}

function SingleGenerateScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { dataset, validation, state } = useJob()
  const { selected: template, resolved, issues } = useTemplates()
  const { status: corel } = useCorelStatus()
  const generation = useGeneration()
  const print = usePrint()
  const toast = useToast()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const [pattern, setPattern] = useState('')
  const [conflict, setConflict] = useState<{ plan: GenerationPlan; request: GenerationRequest } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    unwrap(api.settings.get()).then(
      (s) => {
        setSettings(s)
        setOutputDir(s.outputDirectory ?? '')
        setPattern(s.fileNamePattern)
      },
      (err) => setError(errorMessage(err))
    )
  }, [])

  const inputs = useMemo(
    () => (dataset && validation && template ? buildGenerationInputs(dataset, validation, resolved) : { records: [], excluded: [] }),
    [dataset, validation, template, resolved]
  )
  const sampleNames = useMemo(() => planFileNames(inputs.records.slice(0, 3), pattern || '{row}'), [inputs.records, pattern])
  const mappingBlocked = hasBlockingMappingIssues(issues)
  const unmapped = issues.filter((i) => i.message.startsWith('Not mapped')).length
  const ready = !!dataset && !!template && !mappingBlocked && inputs.records.length > 0 && !!corel?.available && outputDir.length > 0 && pattern.trim().length > 0
  const progress = generation.progress
  const running = generation.running

  const buildRequest = (overwrite: ResolvedOverwrite): GenerationRequest => ({
    templateId: template!.id,
    outputDirectory: outputDir,
    fileNamePattern: pattern,
    overwrite,
    records: inputs.records
  })

  const start = async (request: GenerationRequest) => {
    setConflict(null)
    setStarting(true)
    try {
      const { jobId } = await unwrap(api.generation.start(request))
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
    const policy = settings?.overwritePolicy ?? 'ask'
    // "ask" checks for existing files first and lets the operator decide; nothing is overwritten silently.
    const request = buildRequest(policy === 'ask' ? 'skip' : policy)
    try {
      const plan = await unwrap(api.generation.plan(request))
      if (plan.conflicts > 0 && policy === 'ask') {
        setStarting(false)
        setConflict({ plan, request })
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
  const blocker = !dataset || inputs.records.length === 0 ? 'Import records first' : !template ? 'Choose a template first' : mappingBlocked ? 'Fix the field mapping first' : !corel?.available ? 'CorelDRAW is not available' : !outputDir ? 'Choose an output folder' : null

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Generate to CorelDRAW"
        description="One editable CDR file per employee. Printing is done in CorelDRAW."
        actions={
          running ? (
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>
              Cancel generation…
            </Button>
          ) : (
            <Button variant="primary" loading={starting} disabled={!ready || starting} onClick={onGenerate} title={blocker ?? undefined} data-testid="generate-button">
              <Icon name="generate" size={14} />
              {`Generate ${inputs.records.length} card${inputs.records.length === 1 ? '' : 's'} to CorelDRAW`}
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
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto wide:grid-cols-[minmax(360px,2fr)_minmax(0,3fr)] wide:overflow-hidden">
        <div className="space-y-5 p-4 wide:overflow-y-auto wide:border-r wide:border-line">
          <Section title="Before you generate">
            <ul className="divide-y divide-line border-y border-line">
              <Check
                tone={!!dataset && inputs.records.length > 0 ? 'ok' : 'error'}
                label="Records"
                value={
                  dataset
                    ? `${inputs.records.length} of ${dataset.records.length} from ${state.workbook?.fileName ?? 'the spreadsheet'}${inputs.excluded.length ? ` · ${inputs.excluded.length} excluded (errors)` : ''}`
                    : 'No spreadsheet imported'
                }
                action={<Button onClick={() => navigate('import')}>Review</Button>}
              />
              <Check
                tone={!template || mappingBlocked ? 'error' : unmapped > 0 ? 'warn' : 'ok'}
                label="Template and mapping"
                value={!template ? 'No template selected' : mappingBlocked ? 'The mapping has errors' : `${template.name}${unmapped ? ` · ${unmapped} object(s) keep their template text` : ''}`}
                action={<Button onClick={() => navigate('template')}>Review</Button>}
              />
              <Check
                tone={!corel ? 'neutral' : !corel.available ? 'error' : corel.isX7 ? 'ok' : 'warn'}
                label="CorelDRAW"
                value={!corel ? 'Checking…' : corel.available ? `${corel.progId}${corel.isX7 ? ' (X7)' : ' — not X7, validation pending'}` : corel.detail}
              />
            </ul>
          </Section>

          <Section title="Output">
            <div className="space-y-3">
              <div>
                <label htmlFor="out-dir" className="mb-1 block font-medium">
                  Output folder
                </label>
                <div className="flex gap-2">
                  <input id="out-dir" className="input min-w-0 flex-1 font-mono text-xs" readOnly value={outputDir} placeholder="Choose a folder" />
                  <Button onClick={pickFolder} disabled={running}>
                    <Icon name="folder" size={14} />
                    Choose…
                  </Button>
                </div>
              </div>
              <div>
                <label htmlFor="file-pattern" className="mb-1 block font-medium">
                  File names
                </label>
                <input id="file-pattern" className="input w-full font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} disabled={running} />
                <p className="muted mt-1 text-xs">
                  {'{row}'} = spreadsheet row, {'{col:Header}'} = any column. Example: {sampleNames.join(', ') || '—'}
                </p>
              </div>
              <p className="muted text-xs">
                Existing files: {settings?.overwritePolicy === 'skip' ? 'skipped' : settings?.overwritePolicy === 'suffix' ? 'kept; new files get a number suffix' : 'you will be asked first'} (change in Settings). Files are saved in CorelDRAW X7
                (v17) format.
              </p>
              <X7Notice version={corel?.isX7 ? 'Version 17' : (template?.inspection.corelVersion ?? null)} compact />
            </div>
          </Section>
        </div>

        <div className="flex min-h-0 flex-col p-4">
          {!progress ? (
            <EmptyState title="No generation run yet">
              {ready ? 'Press “Generate” to create the files. Progress, failures and warnings appear here, and you can cancel safely at any time.' : blocker ? `${blocker} to enable generation.` : 'Complete the checks on the left.'}
            </EmptyState>
          ) : (
            <>
              <RunSummary />
              {!running && lastJob && <Completion job={lastJob} onPrint={() => { print.selectSource(lastJob.id); navigate('print') }} />}
              <JobLog />
            </>
          )}
        </div>
      </div>

      {conflict && (
        <Dialog
          title="Some files already exist"
          width={480}
          onClose={() => setConflict(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConflict(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => start({ ...conflict.request, overwrite: 'overwrite' })}>
                Overwrite {conflict.plan.conflicts}
              </Button>
              <Button onClick={() => start({ ...conflict.request, overwrite: 'suffix' })}>Keep both</Button>
              <Button variant="primary" data-autofocus onClick={() => start({ ...conflict.request, overwrite: 'skip' })}>
                Skip existing
              </Button>
            </>
          }
        >
          <p className="font-medium">
            {conflict.plan.conflicts} of {conflict.plan.items.length} files already exist in this folder.
          </p>
          <ul className="muted mt-1 list-disc pl-5 text-xs">
            {conflict.plan.items
              .filter((i) => i.exists)
              .slice(0, 5)
              .map((i) => (
                <li key={i.fileName} className="break-all">
                  {i.fileName}
                </li>
              ))}
          </ul>
          <p className="muted mt-2 text-xs">“Keep both” adds a number to new file names. Nothing is overwritten unless you choose Overwrite.</p>
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
                Stop after current card
              </Button>
            </>
          }
        >
          <p>The card being created now is finished first. Files already created are kept.</p>
        </Dialog>
      )}
    </div>
  )
}

export function Check({ tone, label, value, action }: { tone: Tone; label: string; value: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <StatusDot tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className={`truncate ${tone === 'error' ? 'text-err' : 'muted'}`} title={value}>
          {value}
        </p>
      </div>
      {action}
    </li>
  )
}

/** Batch progress: bar, current record, and the three counters that matter. */
export function RunSummary() {
  const { progress, running } = useGeneration()
  if (!progress) return null
  const status = running
    ? progress.current
      ? `Working on row ${progress.current.rowNumber}: ${progress.current.fileName}`
      : 'Opening the template in CorelDRAW…'
    : progress.status === 'completed'
      ? 'Finished.'
      : progress.status === 'cancelled'
        ? 'Stopped by the operator. Cards created so far are kept.'
        : `Stopped: ${progress.error ?? 'error'}`
  return (
    <div className="mb-3 shrink-0" data-testid="run-summary">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <p className="text-lg font-semibold tabular-nums">
          {progress.done} <span className="text-fg-muted">/ {progress.total}</span>
        </p>
        <p className="tabular-nums">
          <span className="font-semibold text-ok">{progress.succeeded}</span> created
        </p>
        <p className="tabular-nums">
          <span className={`font-semibold ${progress.failed ? 'text-err' : ''}`}>{progress.failed}</span> failed
        </p>
        <p className="tabular-nums">
          <span className="font-semibold">{progress.skipped}</span> skipped
        </p>
      </div>
      <Progress value={progress.sheet ? progress.sheet.sheetsDone : progress.done} max={progress.sheet ? progress.sheet.sheetsTotal : progress.total} label="Generation progress" tone={progress.failed ? 'warn' : 'info'} />
      {progress.sheet && (
        <p className="mt-1 text-xs tabular-nums text-fg-muted" data-testid="sheet-progress">
          Sheet {progress.sheet.sheetsDone.toLocaleString()} of {progress.sheet.sheetsTotal.toLocaleString()} · file {Math.min(progress.sheet.batchesDone + (running ? 1 : 0), progress.sheet.batchesTotal).toLocaleString()} of {progress.sheet.batchesTotal.toLocaleString()}
        </p>
      )}
      <p className="mt-1.5 truncate text-xs text-fg-muted" role="status" aria-live="polite">
        {running && <span className="spinner mr-1.5 align-[-2px]" aria-hidden />}
        {status}
      </p>
    </div>
  )
}

export function Completion({ job, onPrint }: { job: JobSummary; onPrint?: () => void }) {
  const toast = useToast()
  return (
    <div className="mb-3 shrink-0 space-y-2">
      <Banner
        tone={job.status === 'completed' && job.failed === 0 ? 'ok' : job.status === 'failed' ? 'error' : 'warn'}
        title={`${job.succeeded} editable CDR file(s) created${job.failed ? `, ${job.failed} failed` : ''}${job.skipped ? `, ${job.skipped} skipped` : ''}.`}
      >
        Review them in CorelDRAW before printing. {job.reportPath && <span className="break-all">Report: {job.reportPath}</span>}
      </Banner>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => unwrap(api.generation.openFolder(job.id)).catch((e) => toast.push('error', errorMessage(e)))}>
          <Icon name="folder" size={14} />
          Open output folder
        </Button>
        {onPrint && job.files.some((f) => /\.cdr$/i.test(f)) && (
          <Button variant="primary" onClick={onPrint} data-testid="go-print">
            <Icon name="print" size={14} />
            Print…
          </Button>
        )}
        {job.files.length > 0 && (
          <Button onClick={() => unwrap(api.generation.openFile(job.id, 0)).catch((e) => toast.push('error', errorMessage(e)))}>Open first card in CorelDRAW</Button>
        )}
      </div>
      <X7Notice version={job.corelVersion} compact />
    </div>
  )
}

export function JobLog() {
  const { entries } = useGeneration()
  const [onlyProblems, setOnlyProblems] = useState(false)
  const shown = [...entries].reverse().filter((e) => !onlyProblems || e.status !== 'ok' || e.overflow.length > 0)
  if (entries.length === 0) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center gap-3">
        <h3 className="label">Results</h3>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input type="checkbox" className="check" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only failures and warnings
        </label>
      </div>
      <div className="min-h-[8rem] flex-1 overflow-auto rounded border border-line" data-testid="job-log">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-head w-14">Row</th>
              <th className="table-head">File</th>
              <th className="table-head w-24">Result</th>
              <th className="table-head">Notes</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={`${e.rowNumber}-${i}`}>
                <td className="table-cell tabular-nums">{e.rowNumber}</td>
                <td className="table-cell break-all">{e.fileName}</td>
                <td className="table-cell">
                  <Badge tone={e.status === 'ok' ? (e.overflow.length ? 'warn' : 'ok') : e.status === 'failed' ? 'error' : 'neutral'}>{e.status === 'ok' ? 'created' : e.status}</Badge>
                </td>
                <td className="table-cell text-xs">{[e.message, ...e.overflow].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted p-4 text-center">No failures or warnings.</p>}
      </div>
    </div>
  )
}
