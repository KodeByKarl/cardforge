import { useEffect, useMemo, useState } from 'react'
import { planFileNames } from '../../../shared/generation/naming'
import { buildGenerationInputs, hasBlockingMappingIssues } from '../../../shared/template/mapping'
import type { GenerationPlan, GenerationRequest, JobSummary, ResolvedOverwrite } from '../../../shared/template/types'
import type { AppSettings } from '../../../shared/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Badge, Banner, PageHeader, Stat, StatusDot } from '../components/ui'
import { X7Notice } from '../components/X7Notice'
import { useCorelStatus } from '../state/corel'
import { useGeneration } from '../state/generation'
import { useJob } from '../state/job'
import { useTemplates } from '../state/templates'

export function GenerateScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { dataset, validation, state } = useJob()
  const { selected: template, resolved, issues } = useTemplates()
  const { status: corel } = useCorelStatus()
  const generation = useGeneration()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const [pattern, setPattern] = useState('')
  const [conflict, setConflict] = useState<{ plan: GenerationPlan; request: GenerationRequest } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    unwrap(api.settings.get()).then((s) => {
      setSettings(s)
      setOutputDir(s.outputDirectory ?? '')
      setPattern(s.fileNamePattern)
    }, (err) => setError(errorMessage(err)))
  }, [])

  const inputs = useMemo(
    () => (dataset && validation && template ? buildGenerationInputs(dataset, validation, resolved) : { records: [], excluded: [] }),
    [dataset, validation, template, resolved]
  )
  const sampleNames = useMemo(() => planFileNames(inputs.records.slice(0, 3), pattern || '{row}'), [inputs.records, pattern])
  const mappingBlocked = hasBlockingMappingIssues(issues)
  const unmapped = issues.filter((i) => i.message.startsWith('Not mapped')).length
  const ready = !!dataset && !!template && !mappingBlocked && inputs.records.length > 0 && !!corel?.available && outputDir.length > 0 && pattern.trim().length > 0

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
    const policy = settings?.overwritePolicy ?? 'ask'
    // "ask" checks for existing files first and lets the operator decide; nothing is overwritten silently.
    const request = buildRequest(policy === 'ask' ? 'skip' : policy)
    try {
      const plan = await unwrap(api.generation.plan(request))
      if (plan.conflicts > 0 && policy === 'ask') setConflict({ plan, request })
      else await start(request)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pickFolder = async () => {
    const dir = await unwrap(api.generation.pickOutputDirectory()).catch(() => null)
    if (dir) setOutputDir(dir)
  }

  const progress = generation.progress
  const running = generation.running
  const lastJob: JobSummary | undefined = progress && !running ? generation.history.find((j) => j.id === progress.jobId) : undefined

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Generate to CorelDRAW" description="Creates one editable CDR file per employee from the template. Printing is done by the operator in CorelDRAW." />
      <div className="grid max-w-5xl gap-4 p-6">
        {error && (
          <Banner tone="error" title="Generation problem">
            {error}
          </Banner>
        )}

        <section className="panel divide-y divide-stone-100 dark:divide-stone-800">
          <h2 className="eyebrow px-4 py-2.5">Ready to generate?</h2>
          <Check
            ok={!!dataset && inputs.records.length > 0}
            label="Records"
            value={
              dataset
                ? `${inputs.records.length} of ${dataset.records.length} records from ${state.workbook?.fileName ?? 'the spreadsheet'}${inputs.excluded.length ? ` · ${inputs.excluded.length} excluded because of errors` : ''}`
                : 'No spreadsheet imported'
            }
            action={<button className="btn" onClick={() => navigate('import')}>Review</button>}
          />
          <Check
            ok={!!template && !mappingBlocked}
            warn={!!template && !mappingBlocked && unmapped > 0}
            label="Template and mapping"
            value={
              !template
                ? 'No template selected'
                : mappingBlocked
                  ? 'The mapping has errors'
                  : `${template.name}${unmapped ? ` · ${unmapped} object(s) keep their template text` : ''}`
            }
            action={<button className="btn" onClick={() => navigate('template')}>Review</button>}
          />
          <Check
            ok={!!corel?.available}
            warn={!!corel?.available && !corel.isX7}
            label="CorelDRAW"
            value={!corel ? 'Checking…' : corel.available ? `${corel.progId}${corel.isX7 ? ' (X7)' : ' — not X7, validation pending'}` : corel.detail}
          />
        </section>

        <section className="panel space-y-4 p-4">
          <h2 className="eyebrow">Output</h2>
          <div>
            <p className="mb-1.5 font-medium">Output folder</p>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs" readOnly value={outputDir} placeholder="Choose a folder" />
              <button className="btn" onClick={pickFolder} disabled={running}>
                Choose…
              </button>
            </div>
          </div>
          <div>
            <p className="mb-1.5 font-medium">File names</p>
            <input className="input w-full font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} disabled={running} aria-label="File name pattern" />
            <p className="muted mt-1 text-xs">
              {'{row}'} = spreadsheet row, {'{col:Header}'} = any column. Example: {sampleNames.join(', ') || '—'}
            </p>
          </div>
          <p className="muted text-xs">
            Existing files: {settings?.overwritePolicy === 'skip' ? 'skipped' : settings?.overwritePolicy === 'suffix' ? 'kept; new files get a number suffix' : 'you will be asked first'} (change in Settings). Files are saved in
            CorelDRAW X7 (v17) format.
          </p>
          <X7Notice version={corel?.isX7 ? 'Version 17' : (template?.inspection.corelVersion ?? null)} compact />
        </section>

        {conflict && (
          <section className="panel border-amber-300 p-4 dark:border-amber-800">
            <p className="font-medium">
              {conflict.plan.conflicts} of {conflict.plan.items.length} files already exist in this folder.
            </p>
            <ul className="muted mt-1 list-disc pl-5 text-xs">
              {conflict.plan.items
                .filter((i) => i.exists)
                .slice(0, 5)
                .map((i) => (
                  <li key={i.fileName}>{i.fileName}</li>
                ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => start({ ...conflict.request, overwrite: 'skip' })}>
                Skip existing files
              </button>
              <button className="btn" onClick={() => start({ ...conflict.request, overwrite: 'suffix' })}>
                Keep both (add number)
              </button>
              <button className="btn border-red-700 text-red-700 dark:text-red-400" onClick={() => start({ ...conflict.request, overwrite: 'overwrite' })}>
                Overwrite {conflict.plan.conflicts} file(s)
              </button>
              <button className="btn btn-ghost" onClick={() => setConflict(null)}>
                Cancel
              </button>
            </div>
          </section>
        )}

        {!running && !conflict && (
          <div>
            <button className="btn btn-primary h-10 px-5 text-[15px]" disabled={!ready || starting} onClick={onGenerate}>
              {starting ? 'Starting…' : `Generate ${inputs.records.length} card${inputs.records.length === 1 ? '' : 's'} to CorelDRAW`}
            </button>
          </div>
        )}

        {progress && (
          <section className="panel p-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <Stat label="Done" value={`${progress.done} / ${progress.total || inputs.records.length}`} />
              <Stat label="Created" value={progress.succeeded} tone="ok" />
              <Stat label="Failed" value={progress.failed} tone={progress.failed ? 'error' : 'neutral'} />
              <Stat label="Skipped" value={progress.skipped} />
              {running && (
                <div className="ml-auto">
                  {confirmCancel ? (
                    <span className="flex items-center gap-2">
                      <span className="muted text-xs">Stop after the current card?</span>
                      <button
                        className="btn border-red-700 text-red-700 dark:text-red-400"
                        onClick={() => {
                          void api.generation.cancel(progress.jobId)
                          setConfirmCancel(false)
                        }}
                      >
                        Stop
                      </button>
                      <button className="btn" onClick={() => setConfirmCancel(false)}>
                        Continue
                      </button>
                    </span>
                  ) : (
                    <button className="btn" onClick={() => setConfirmCancel(true)}>
                      Cancel…
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-stone-200 dark:bg-stone-800">
              <div className="h-full bg-teal-600 transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="muted mt-2 text-xs">
              {running
                ? progress.current
                  ? `Working on row ${progress.current.rowNumber}: ${progress.current.fileName}`
                  : 'Opening the template in CorelDRAW…'
                : progress.status === 'completed'
                  ? 'Finished.'
                  : progress.status === 'cancelled'
                    ? 'Stopped by the operator. Cards created so far are kept.'
                    : `Stopped: ${progress.error ?? 'error'}`}
            </p>
            {!running && lastJob && <Completion job={lastJob} />}
            <JobLog />
          </section>
        )}
      </div>
    </div>
  )
}

function Check({ ok, warn = false, label, value, action }: { ok: boolean; warn?: boolean; label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <StatusDot tone={!ok ? 'error' : warn ? 'warn' : 'ok'} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className="muted truncate">{value}</p>
      </div>
      {action}
    </div>
  )
}

function Completion({ job }: { job: JobSummary }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mt-3 space-y-2">
      <Banner
        tone={job.status === 'completed' && job.failed === 0 ? 'ok' : job.status === 'failed' ? 'error' : 'warn'}
        title={`${job.succeeded} editable CDR file(s) created${job.failed ? `, ${job.failed} failed` : ''}${job.skipped ? `, ${job.skipped} skipped` : ''}.`}
      >
        Review them in CorelDRAW before printing. {job.reportPath && <span className="break-all">Report: {job.reportPath}</span>}
      </Banner>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => unwrap(api.generation.openFolder(job.id)).catch((e) => setError(errorMessage(e)))}>
          Open output folder
        </button>
        {job.files.length > 0 && (
          <button className="btn" onClick={() => unwrap(api.generation.openFile(job.id, 0)).catch((e) => setError(errorMessage(e)))}>
            Open first card in CorelDRAW
          </button>
        )}
      </div>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <X7Notice version={job.corelVersion} compact />
    </div>
  )
}

function JobLog() {
  const { entries } = useGeneration()
  const [onlyProblems, setOnlyProblems] = useState(false)
  const shown = [...entries].reverse().filter((e) => !onlyProblems || e.status !== 'ok' || e.overflow.length > 0)
  if (entries.length === 0) return null
  return (
    <div className="mt-4">
      <label className="muted mb-2 flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only failures and warnings
      </label>
      <div className="max-h-72 overflow-y-auto rounded border border-stone-200 dark:border-stone-800">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-head w-16">Row</th>
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
      </div>
    </div>
  )
}
