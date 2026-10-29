import { useMemo, useState, type DragEvent } from 'react'
import { columnLetter } from '../../../shared/import/headers'
import type { ColumnConfig, Dataset, FieldKind, ValidationIssue, ValidationResult } from '../../../shared/types'
import { api, errorMessage, formatBytes, unwrap } from '../api'
import { Badge, Banner, PageHeader, Stat } from '../components/ui'
import { useJob } from '../state/job'

const ACCEPTED = ['.xlsx', '.csv']

function useFilePicker() {
  const { openFile } = useJob()
  const [pickError, setPickError] = useState<string | null>(null)
  const pick = async () => {
    setPickError(null)
    try {
      const path = await unwrap(api.excel.pickFile())
      if (path) await openFile(path)
    } catch (err) {
      setPickError(errorMessage(err))
    }
  }
  return { pick, pickError }
}

export function ImportScreen() {
  const { state } = useJob()
  const { pick, pickError } = useFilePicker()

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Excel import"
        description="Load employee records from an .xlsx workbook or .csv file."
        actions={
          state.phase !== 'empty' && (
            <button className="btn" onClick={pick}>
              Replace file…
            </button>
          )
        }
      />
      {pickError && (
        <div className="px-6 pt-4">
          <Banner tone="error" title="Could not open the file picker">
            {pickError}
          </Banner>
        </div>
      )}
      {state.phase === 'empty' && <DropZone onBrowse={pick} />}
      {(state.phase === 'opening' || state.phase === 'reading') && (
        <div className="grid flex-1 place-items-center">
          <p className="muted">{state.phase === 'opening' ? 'Opening workbook…' : `Reading “${state.sheetName}”…`}</p>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="p-6">
          <Banner tone="error" title="The spreadsheet could not be imported">
            {state.error}
          </Banner>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-primary" onClick={pick}>
              Choose another file…
            </button>
          </div>
          <DropZone onBrowse={pick} compact />
        </div>
      )}
      {state.phase === 'ready' && <ImportWorkspace />}
    </div>
  )
}

function DropZone({ onBrowse, compact = false }: { onBrowse: () => void; compact?: boolean }) {
  const { openFile } = useJob()
  const [over, setOver] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = Array.from(e.dataTransfer.files)
    const file = files[0]
    if (!file) return
    if (files.length > 1) {
      setRejected('Drop one file at a time.')
      return
    }
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ACCEPTED.includes(ext)) {
      setRejected(`“${file.name}” is not supported. Use an .xlsx or .csv file. Older .xls files must be re-saved as .xlsx in Excel.`)
      return
    }
    setRejected(null)
    void openFile(api.excel.pathForFile(file))
  }

  return (
    <div className={compact ? 'mt-6' : 'flex flex-1 p-6'}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition-colors ${
          compact ? 'py-10' : 'flex-1'
        } ${over ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40' : 'border-stone-300 dark:border-stone-700'}`}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-stone-400" aria-hidden>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h6M12 10v10" />
        </svg>
        <p className="mt-3 text-[15px] font-medium">Drop an Excel or CSV file here</p>
        <p className="muted mt-1">.xlsx or .csv, up to 50 MB</p>
        <button className="btn btn-primary mt-4" onClick={onBrowse}>
          Browse…
        </button>
        {rejected && <p className="mt-4 max-w-md text-red-700 dark:text-red-400">{rejected}</p>}
      </div>
    </div>
  )
}

type Tab = 'records' | 'columns' | 'issues'

function ImportWorkspace() {
  const { state, dataset, validation, selectSheet, setHeaderRow } = useJob()
  const [tab, setTab] = useState<Tab>('records')
  if (!state.workbook || !state.grid || !dataset || !validation) return null

  const issueCount = validation.issues.length
  const headerOptions = state.grid.slice(0, 20).map((row, i) => ({
    index: i,
    preview: row.filter((c) => c.trim()).slice(0, 4).join(' · ') || '(blank row)'
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-stone-200 px-6 py-3 dark:border-stone-800">
        <div className="min-w-0">
          <p className="eyebrow">File</p>
          <p className="truncate font-medium" title={state.workbook.filePath}>
            {state.workbook.fileName} <span className="muted font-normal">· {formatBytes(state.workbook.sizeBytes)}</span>
          </p>
        </div>
        {state.workbook.format === 'xlsx' && (
          <label>
            <span className="eyebrow block">Worksheet</span>
            <select className="input mt-0.5" value={state.sheetName ?? ''} onChange={(e) => void selectSheet(e.target.value)}>
              {state.workbook.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.rowCount} rows)
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="eyebrow block">Header row</span>
          <select className="input mt-0.5 max-w-xs" value={state.headerRowIndex} onChange={(e) => setHeaderRow(Number(e.target.value))}>
            {headerOptions.map((o) => (
              <option key={o.index} value={o.index}>
                Row {o.index + 1}: {o.preview.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3 px-6 py-4">
        <Stat label="Records" value={validation.totalRecords} />
        <Stat label="Ready" value={validation.validRecords - validation.recordsWithWarnings} tone="ok" />
        <Stat label="Warnings" value={validation.recordsWithWarnings} tone={validation.recordsWithWarnings ? 'warn' : 'neutral'} />
        <Stat label="Errors" value={validation.recordsWithErrors} tone={validation.recordsWithErrors ? 'error' : 'neutral'} />
        <Stat label="Duplicate groups" value={validation.duplicateGroups} tone={validation.duplicateGroups ? 'warn' : 'neutral'} />
        <Stat label="Blank rows skipped" value={dataset.skippedEmptyRows.length} />
      </div>

      <div className="space-y-2 px-6 empty:hidden">
        {state.truncated && (
          <Banner tone="warn" title="This sheet was cut off">
            Only the first 20,000 rows and 200 columns were imported. Split the file into smaller batches.
          </Banner>
        )}
        {validation.issues
          .filter((i) => i.rowNumber === undefined)
          .map((i) => (
            <Banner key={i.code} tone="error" title={i.message} />
          ))}
      </div>

      <div className="mt-2 flex gap-1 border-b border-stone-200 px-6 dark:border-stone-800" role="tablist">
        <TabButton active={tab === 'records'} onClick={() => setTab('records')}>
          Records
        </TabButton>
        <TabButton active={tab === 'columns'} onClick={() => setTab('columns')}>
          Columns <span className="muted">{dataset.columns.filter((c) => c.include).length}/{dataset.columns.length}</span>
        </TabButton>
        <TabButton active={tab === 'issues'} onClick={() => setTab('issues')}>
          Issues {issueCount > 0 && <Badge tone={validation.recordsWithErrors ? 'error' : 'warn'}>{issueCount}</Badge>}
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'records' && <RecordsTable dataset={dataset} validation={validation} />}
        {tab === 'columns' && <ColumnsTable dataset={dataset} />}
        {tab === 'issues' && <IssuesList dataset={dataset} validation={validation} />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 ${
        active ? 'border-teal-700 font-medium dark:border-teal-400' : 'border-transparent text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
      }`}
    >
      {children}
    </button>
  )
}

type RecordFilter = 'all' | 'issues' | 'errors' | 'warnings'
const PAGE_SIZE = 100

function RecordsTable({ dataset, validation }: { dataset: Dataset; validation: ValidationResult }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RecordFilter>('all')
  const [page, setPage] = useState(0)
  const columns = dataset.columns.filter((c) => c.include)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dataset.records.filter((r) => {
      const issues = validation.byRow.get(r.rowNumber) ?? []
      if (filter === 'issues' && issues.length === 0) return false
      if (filter === 'errors' && !issues.some((i) => i.severity === 'error')) return false
      if (filter === 'warnings' && !issues.some((i) => i.severity === 'warning')) return false
      return q === '' || Object.values(r.values).some((v) => v.toLowerCase().includes(q))
    })
  }, [dataset, validation, query, filter])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <input
          className="input w-72"
          type="search"
          placeholder="Search name, email, any value…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
        />
        <select
          className="input"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as RecordFilter)
            setPage(0)
          }}
        >
          <option value="all">All records</option>
          <option value="issues">With any issue</option>
          <option value="errors">With errors</option>
          <option value="warnings">With warnings</option>
        </select>
        <span className="muted ml-auto tabular-nums">
          {rows.length} of {dataset.records.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-head w-14">Row</th>
              <th className="table-head w-8" aria-label="Status" />
              {columns.map((c) => (
                <th key={c.key} className="table-head whitespace-nowrap">
                  {c.label}
                  {c.required && <span className="text-red-600"> *</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((record) => {
              const issues = validation.byRow.get(record.rowNumber) ?? []
              const hasError = issues.some((i) => i.severity === 'error')
              return (
                <tr key={record.rowNumber} className="hover:bg-stone-50 dark:hover:bg-stone-900">
                  <td className="table-cell muted tabular-nums">{record.rowNumber}</td>
                  <td className="table-cell" title={issues.map((i) => i.message).join('\n')}>
                    {issues.length > 0 && <Badge tone={hasError ? 'error' : 'warn'}>{issues.length}</Badge>}
                  </td>
                  {columns.map((c) => {
                    const cellIssues = issues.filter((i) => i.columnKey === c.key)
                    const tone = cellIssues.some((i) => i.severity === 'error')
                      ? 'bg-red-50 dark:bg-red-950/50'
                      : cellIssues.length
                        ? 'bg-amber-50 dark:bg-amber-950/40'
                        : ''
                    return (
                      <td key={c.key} className={`table-cell ${c.kind === 'multiline' ? 'min-w-48 whitespace-pre-line' : 'whitespace-nowrap'} ${tone}`} title={cellIssues.map((i) => i.message).join('\n') || undefined}>
                        {record.values[c.key] || (c.required ? <span className="italic text-red-700 dark:text-red-400">missing</span> : '')}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="muted py-10 text-center">No records match.</p>}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-stone-200 px-6 py-2 dark:border-stone-800">
          <button className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span className="muted tabular-nums">
            Page {current + 1} of {pageCount}
          </span>
          <button className="btn" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

const KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  multiline: 'Multi-line text',
  email: 'Email',
  phone: 'Phone'
}

function ColumnsTable({ dataset }: { dataset: Dataset }) {
  const { state, updateColumn } = useJob()
  const grid = state.grid ?? []

  const sample = (c: ColumnConfig) => {
    for (let i = state.headerRowIndex + 1; i < grid.length; i++) {
      const v = grid[i]?.[c.index]?.trim()
      if (v) return v
    }
    return ''
  }
  const emptyCount = (c: ColumnConfig) => dataset.records.filter((r) => !r.values[c.key]).length

  return (
    <div className="h-full overflow-auto px-6 py-3">
      <p className="muted mb-3 max-w-3xl">
        Choose which columns to import and how each is checked. These columns are matched to the template’s text objects in Template setup.
      </p>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="table-head w-16">Include</th>
            <th className="table-head w-12">Col</th>
            <th className="table-head">Header</th>
            <th className="table-head">Sample value</th>
            <th className="table-head w-40">Type</th>
            <th className="table-head w-20">Required</th>
            <th className="table-head w-28" title="Records with the same values in all marked columns are flagged as duplicates">
              Duplicate key
            </th>
            <th className="table-head w-16 text-right">Empty</th>
          </tr>
        </thead>
        <tbody>
          {dataset.columns.map((c) => (
            <tr key={c.key} className={c.include ? '' : 'opacity-60'}>
              <td className="table-cell">
                <input type="checkbox" aria-label={`Include ${c.label}`} checked={c.include} onChange={(e) => updateColumn(c.key, { include: e.target.checked })} />
              </td>
              <td className="table-cell muted font-mono text-xs">{columnLetter(c.index)}</td>
              <td className="table-cell font-medium">{c.label}</td>
              <td className="table-cell muted max-w-xs truncate">{sample(c)}</td>
              <td className="table-cell">
                <select className="input h-7 w-full" disabled={!c.include} value={c.kind} onChange={(e) => updateColumn(c.key, { kind: e.target.value as FieldKind })}>
                  {(Object.keys(KIND_LABELS) as FieldKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="table-cell">
                <input type="checkbox" aria-label={`${c.label} required`} disabled={!c.include} checked={c.required} onChange={(e) => updateColumn(c.key, { required: e.target.checked })} />
              </td>
              <td className="table-cell">
                <input
                  type="checkbox"
                  aria-label={`${c.label} is part of duplicate key`}
                  disabled={!c.include}
                  checked={c.duplicateKey}
                  onChange={(e) => updateColumn(c.key, { duplicateKey: e.target.checked })}
                />
              </td>
              <td className="table-cell text-right tabular-nums">{c.include ? emptyCount(c) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IssuesList({ dataset, validation }: { dataset: Dataset; validation: ValidationResult }) {
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning'>('all')
  const labels = new Map(dataset.columns.map((c) => [c.key, c.label]))
  const issues = validation.issues.filter((i) => severity === 'all' || i.severity === severity)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-6 py-3">
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
          <option value="all">All issues</option>
          <option value="error">Errors only</option>
          <option value="warning">Warnings only</option>
        </select>
        <p className="muted">Errors block a record from generation. Warnings should be reviewed but do not block it.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-4">
        {issues.length === 0 ? (
          <p className="muted py-10 text-center">No issues found.</p>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="table-head w-24">Severity</th>
                <th className="table-head w-16">Row</th>
                <th className="table-head w-48">Column</th>
                <th className="table-head">Problem</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue: ValidationIssue, i) => (
                <tr key={i}>
                  <td className="table-cell">
                    <Badge tone={issue.severity === 'error' ? 'error' : 'warn'}>{issue.severity}</Badge>
                  </td>
                  <td className="table-cell tabular-nums">{issue.rowNumber ?? '–'}</td>
                  <td className="table-cell">{issue.columnKey ? labels.get(issue.columnKey) : '–'}</td>
                  <td className="table-cell">{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
