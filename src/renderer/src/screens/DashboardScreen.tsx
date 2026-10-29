import { useState } from 'react'
import { hasBlockingMappingIssues } from '../../../shared/template/mapping'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { Badge, PageHeader, StatusDot } from '../components/ui'
import { useCorelStatus } from '../state/corel'
import { useGeneration } from '../state/generation'
import { useJob } from '../state/job'
import { useTemplates } from '../state/templates'

export function DashboardScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { state, validation, reset } = useJob()
  const { selected, issues } = useTemplates()
  const { history, running, progress } = useGeneration()
  const { status: corel, error: corelError } = useCorelStatus()
  const [openError, setOpenError] = useState<string | null>(null)

  const startNew = () => {
    reset()
    navigate('import')
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Dashboard"
        actions={
          <button className="btn btn-primary" onClick={startNew} disabled={running}>
            New generation project
          </button>
        }
      />
      <div className="grid max-w-5xl gap-4 p-6">
        <section className="panel divide-y divide-stone-100 dark:divide-stone-800">
          <h2 className="eyebrow px-4 py-2.5">Current project</h2>
          <StatusRow
            tone={state.phase === 'error' ? 'error' : validation ? (validation.recordsWithErrors > 0 ? 'warn' : 'ok') : 'neutral'}
            label="Excel data"
            value={
              state.phase === 'error'
                ? state.error
                : validation && state.workbook
                  ? `${state.workbook.fileName} · ${state.sheetName} · ${validation.totalRecords} records, ${validation.recordsWithErrors} with errors`
                  : 'No spreadsheet imported'
            }
            action={
              <button className="btn" onClick={() => navigate('import')}>
                {state.workbook ? 'Review' : 'Import'}
              </button>
            }
          />
          <StatusRow
            tone={!selected ? 'neutral' : hasBlockingMappingIssues(issues) ? 'error' : issues.length ? 'warn' : 'ok'}
            label="CDR template"
            value={!selected ? 'No template selected' : `${selected.name} · ${selected.inspection.objects.length} named objects${selected.mapping ? ' · mapping saved' : ' · not mapped yet'}`}
            action={
              <button className="btn" onClick={() => navigate('template')}>
                {selected ? 'Review' : 'Choose'}
              </button>
            }
          />
          <StatusRow
            tone={corelError ? 'error' : !corel ? 'neutral' : !corel.available ? 'error' : corel.isX7 ? 'ok' : 'warn'}
            label="CorelDRAW"
            value={corelError ?? (corel ? (corel.available ? `${corel.progId}${corel.isX7 ? '' : ' · not X7: X7 validation pending'}` : corel.detail) : 'Checking…')}
            action={
              <button className="btn" onClick={() => navigate('settings')}>
                Details
              </button>
            }
          />
          {running && progress && (
            <StatusRow
              tone="info"
              label="Generation running"
              value={`${progress.done} of ${progress.total} cards`}
              action={
                <button className="btn" onClick={() => navigate('generate')}>
                  View
                </button>
              }
            />
          )}
        </section>

        <section className="panel">
          <h2 className="eyebrow px-4 py-2.5">Recent jobs</h2>
          {history.length === 0 ? (
            <div className="border-t border-stone-100 px-4 py-8 text-center dark:border-stone-800">
              <p className="font-medium">No generation jobs yet</p>
              <p className="muted mx-auto mt-1 max-w-md">Generated batches will be listed here with their output folder and report.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-stone-100 dark:border-stone-800">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="table-head">Finished</th>
                    <th className="table-head">Template</th>
                    <th className="table-head">Result</th>
                    <th className="table-head">CorelDRAW</th>
                    <th className="table-head" />
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 10).map((job) => (
                    <tr key={job.id}>
                      <td className="table-cell whitespace-nowrap">{new Date(job.finishedAt ?? job.startedAt).toLocaleString()}</td>
                      <td className="table-cell">{job.templateName}</td>
                      <td className="table-cell">
                        <Badge tone={job.status === 'completed' && job.failed === 0 ? 'ok' : job.status === 'failed' ? 'error' : 'warn'}>{job.status}</Badge>{' '}
                        <span className="text-xs">
                          {job.succeeded} created{job.failed ? `, ${job.failed} failed` : ''}
                          {job.skipped ? `, ${job.skipped} skipped` : ''}
                        </span>
                      </td>
                      <td className="table-cell muted text-xs">{job.corelVersion.replace(/^Version /, '') || '—'}</td>
                      <td className="table-cell text-right">
                        <button className="btn" onClick={() => unwrap(api.generation.openFolder(job.id)).catch((e) => setOpenError(errorMessage(e)))}>
                          Open folder
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {openError && <p className="px-4 py-2 text-red-700 dark:text-red-400">{openError}</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function StatusRow({
  tone,
  label,
  value,
  action
}: {
  tone: 'neutral' | 'ok' | 'warn' | 'error' | 'info'
  label: string
  value: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <StatusDot tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className="muted truncate">{value}</p>
      </div>
      {action}
    </div>
  )
}
