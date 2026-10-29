import { useEffect, useState } from 'react'
import type { ScreenKey } from '../App'
import { api, errorMessage, unwrap } from '../api'
import { PageHeader, StatusDot } from '../components/ui'
import { useJob } from '../state/job'
import type { CorelDetection } from '../../../shared/types'

export function DashboardScreen({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { state, validation, reset } = useJob()
  const [corel, setCorel] = useState<CorelDetection | null>(null)
  const [corelError, setCorelError] = useState<string | null>(null)

  useEffect(() => {
    unwrap(api.corel.detect()).then(setCorel, (err) => setCorelError(errorMessage(err)))
  }, [])

  const startNew = () => {
    reset()
    navigate('import')
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Dashboard"
        actions={
          <button className="btn btn-primary" onClick={startNew}>
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
          <StatusRow tone="neutral" label="CDR template" value="Template setup is not built yet (Phase 4)." />
          <StatusRow
            tone={corelError ? 'error' : !corel ? 'neutral' : corel.x7Registered ? 'ok' : 'warn'}
            label="CorelDRAW"
            value={corelError ?? (corel ? corel.detail : 'Checking…')}
            action={
              <button className="btn" onClick={() => navigate('settings')}>
                Details
              </button>
            }
          />
        </section>

        <section className="panel">
          <h2 className="eyebrow px-4 py-2.5">Recent jobs</h2>
          <div className="border-t border-stone-100 px-4 py-8 text-center dark:border-stone-800">
            <p className="font-medium">No generation jobs yet</p>
            <p className="muted mx-auto mt-1 max-w-md">
              Generated batches will be listed here. CDR generation becomes available once the CorelDRAW X7 integration has been verified on
              the production computer.
            </p>
          </div>
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
  tone: 'neutral' | 'ok' | 'warn' | 'error'
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
