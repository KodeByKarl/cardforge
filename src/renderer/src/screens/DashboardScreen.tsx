import { hasBlockingMappingIssues } from '../../../shared/template/mapping'
import type { JobSummary } from '../../../shared/template/types'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Button, EmptyState, PageHeader, Section, StatusDot, useToast, type Tone } from '../components/ui'
import { corelMajor, useCorelStatus } from '../state/corel'
import { useGeneration } from '../state/generation'
import { useJob } from '../state/job'
import { useTemplates } from '../state/templates'

function jobTone(job: JobSummary): Tone {
  return job.status === 'failed' ? 'error' : job.status === 'completed' && job.failed === 0 ? 'ok' : 'warn'
}

export function DashboardScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { state, validation, reset } = useJob()
  const { selected, issues, mappingSaved, sheetMode } = useTemplates()
  const { history, running, progress } = useGeneration()
  const { status: corel, error: corelError } = useCorelStatus()
  const toast = useToast()

  const startNew = () => {
    reset()
    navigate('import')
  }
  const openFolder = (job: JobSummary) => unwrap(api.generation.openFolder(job.id)).catch((e) => toast.push('error', errorMessage(e)))
  const latest = history[0]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Dashboard"
        description="Import → Template → Preview → Generate"
        actions={
          <Button variant="primary" onClick={startNew} disabled={running} data-testid="new-generation">
            <Icon name="plus" size={14} />
            New generation
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid items-start gap-x-8 gap-y-6 p-4 wide:grid-cols-[minmax(340px,2fr)_minmax(0,3fr)]">
          <div className="space-y-6">
            <Section title="Current project">
              <ul className="divide-y divide-line border-y border-line">
                <StatusRow
                  tone={state.phase === 'error' ? 'error' : validation ? (validation.recordsWithErrors > 0 ? 'warn' : 'ok') : 'neutral'}
                  label="Excel data"
                  value={
                    state.phase === 'error'
                      ? state.error
                      : validation && state.workbook
                        ? `${state.workbook.fileName} · ${state.sheetName} · ${validation.totalRecords} records${validation.recordsWithErrors ? `, ${validation.recordsWithErrors} with errors` : ''}`
                        : 'No spreadsheet imported'
                  }
                  action={<Button onClick={() => navigate('import')}>{state.workbook ? 'Review' : 'Import'}</Button>}
                />
                <StatusRow
                  tone={!selected ? 'neutral' : hasBlockingMappingIssues(issues) ? 'error' : issues.length ? 'warn' : 'ok'}
                  label="CDR template"
                  value={!selected ? 'No template selected' : `${selected.name} · ${sheetMode ? `${selected.sheet!.cells.length} cards per sheet` : `${selected.inspection.objects.length} named objects`}${mappingSaved ? ' · mapping saved' : ' · not mapped yet'}`}
                  action={<Button onClick={() => navigate('template')}>{selected ? 'Review' : 'Choose'}</Button>}
                />
                {running && progress && (
                  <StatusRow tone="info" label="Generation running" value={`${progress.done} of ${progress.total} cards`} action={<Button onClick={() => navigate('generate')}>View</Button>} />
                )}
              </ul>
            </Section>

            <Section title="System">
              <ul className="divide-y divide-line border-y border-line">
                <StatusRow
                  tone={corelError ? 'error' : !corel ? 'neutral' : !corel.available ? 'error' : corel.isX7 ? 'ok' : 'warn'}
                  label="CorelDRAW"
                  value={corelError ?? (corel ? (corel.available ? `Version ${corelMajor(corel.version) ?? '?'} (${corel.progId})${corel.isX7 ? '' : ' · not X7: X7 validation pending'}` : corel.detail) : 'Checking…')}
                  action={<Button onClick={() => navigate('settings')}>Details</Button>}
                />
              </ul>
            </Section>
          </div>

          <div className="space-y-6">
            {latest && (
              <Section title="Latest result" aside={new Date(latest.finishedAt ?? latest.startedAt).toLocaleString()}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{latest.templateName}</p>
                    <p className="muted">
                      <span className={latest.failed ? 'text-err' : 'text-ok'}>{latest.succeeded} created</span>
                      {latest.failed > 0 && <span className="text-err">, {latest.failed} failed</span>}
                      {latest.skipped > 0 && <span>, {latest.skipped} skipped</span>} of {latest.total}
                    </p>
                  </div>
                  <Button onClick={() => openFolder(latest)}>
                    <Icon name="folder" size={14} />
                    Open folder
                  </Button>
                </div>
              </Section>
            )}

            <Section title="Recent jobs">
              {history.length === 0 ? (
                <EmptyState title="No generation jobs yet">Generated batches are listed here with their output folder and report.</EmptyState>
              ) : (
                <div className="overflow-x-auto rounded border border-line">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="table-head">Finished</th>
                        <th className="table-head">Template</th>
                        <th className="table-head">Result</th>
                        <th className="table-head compact:hidden">CorelDRAW</th>
                        <th className="table-head">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.slice(0, 10).map((job) => (
                        <tr key={job.id} className="hover:bg-surface-2">
                          <td className="table-cell whitespace-nowrap tabular-nums">{new Date(job.finishedAt ?? job.startedAt).toLocaleString()}</td>
                          <td className="table-cell">{job.templateName}</td>
                          <td className="table-cell">
                            <Badge tone={jobTone(job)}>{job.status}</Badge>{' '}
                            <span className="text-xs">
                              {job.succeeded} created{job.failed ? `, ${job.failed} failed` : ''}
                              {job.skipped ? `, ${job.skipped} skipped` : ''}
                            </span>
                          </td>
                          <td className="table-cell muted text-xs compact:hidden">{job.corelVersion.replace(/^Version /, '') || '—'}</td>
                          <td className="table-cell text-right">
                            <Button className="h-6 px-2 text-xs" onClick={() => openFolder(job)}>
                              Open folder
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusRow({ tone, label, value, action }: { tone: Tone; label: string; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <StatusDot tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className={`truncate ${tone === 'error' ? 'text-err' : 'muted'}`}>{value}</p>
      </div>
      {action}
    </li>
  )
}
