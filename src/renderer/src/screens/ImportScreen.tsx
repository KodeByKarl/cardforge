import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { columnLetter } from '../../../shared/import/headers'
import type { ColumnConfig, Dataset, FieldKind, ValidationIssue, ValidationResult } from '../../../shared/types'
import { groupIssues } from '../../../shared/workflow'
import { api, errorMessage, formatBytes, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, EmptyState, PageHeader, Progress, Spinner, Tabs, tabId } from '../components/ui'
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
  const { state, importProgress } = useJob()
  const { pick, pickError } = useFilePicker()

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Excel import"
        description="Load employee records from an .xlsx workbook or .csv file."
        actions={
          state.phase !== 'empty' && (
            <Button onClick={pick} disabled={state.phase === 'opening' || state.phase === 'reading'}>
              Replace file…
            </Button>
          )
        }
      />
      {pickError && (
        <div className="px-4 pt-3">
          <Banner tone="error" title="Could not open the file picker">
            {pickError}
          </Banner>
        </div>
      )}
      {state.phase === 'empty' && <DropZone onBrowse={pick} />}
      {(state.phase === 'opening' || state.phase === 'reading') && (
        <div className="grid flex-1 place-items-center" role="status">
          <div className="w-72">
            <p className="muted flex items-center gap-2">
              <Spinner />
              {state.phase === 'opening'
                ? 'Opening workbook…'
                : importProgress && importProgress.phase === 'reading' && importProgress.total > 0
                  ? `Reading rows… ${importProgress.done.toLocaleString()} of ${importProgress.total.toLocaleString()}`
                  : `Reading “${state.sheetName}”…`}
            </p>
            {state.phase === 'reading' && importProgress && importProgress.total > 0 && (
              <div className="mt-2">
                <Progress value={importProgress.done} max={importProgress.total} label="Import progress" />
              </div>
            )}
          </div>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Banner tone="error" title="The spreadsheet could not be imported">
            {state.error}
          </Banner>
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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onBrowse()
    }
  }

  return (
    <div className={compact ? 'mt-4' : 'flex min-h-0 flex-1 p-4'}>
      <div
        data-testid="import-drop"
        role="button"
        tabIndex={0}
        aria-label="Choose an Excel or CSV file, or drop one here"
        onClick={onBrowse}
        onKeyDown={onKey}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 text-center transition-colors ${compact ? 'py-8' : 'flex-1'} ${
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-surface-2'
        }`}
      >
        <Icon name="import" size={28} className="text-fg-muted" />
        <p className="mt-3 text-base font-semibold">Drop an Excel or CSV file here</p>
        <p className="muted mt-1">
          or <span className="text-accent underline">browse for a file</span> · .xlsx or .csv, up to 50 MB
        </p>
        <p className="muted mt-4 max-w-md text-xs">One row per employee, with a header row naming each column (for example Full name, Job title, Email, Mobile).</p>
        {rejected && (
          <p className="mt-3 max-w-md text-err" role="alert">
            {rejected}
          </p>
        )}
      </div>
    </div>
  )
}

type Tab = 'records' | 'columns' | 'issues'

function ImportWorkspace() {
  const { state, dataset, validation, selectSheet, setHeaderRow } = useJob()
  const [tab, setTab] = useState<Tab>('records')
  const [focusRow, setFocusRow] = useState<{ row: number; n: number } | null>(null)
  if (!state.workbook || !state.grid || !dataset || !validation) return null

  const issueCount = validation.issues.length
  const headerOptions = state.grid.slice(0, 20).map((row, i) => ({
    index: i,
    preview: row.filter((c) => c.trim()).slice(0, 4).join(' · ') || '(blank row)'
  }))
  const showRow = (row: number) => {
    setFocusRow({ row, n: Date.now() })
    setTab('records')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 border-b border-line bg-surface px-4 py-2">
        <div className="min-w-0 max-w-[32ch]">
          <p className="label">File</p>
          <p className="truncate font-medium leading-7" title={state.workbook.filePath}>
            {state.workbook.fileName} <span className="muted font-normal">· {formatBytes(state.workbook.sizeBytes)}</span>
          </p>
        </div>
        {state.workbook.format === 'xlsx' && (
          <label>
            <span className="label block">Worksheet</span>
            <select className="input max-w-[26ch]" value={state.sheetName ?? ''} onChange={(e) => void selectSheet(e.target.value)}>
              {state.workbook.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.rowCount} rows)
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="min-w-0">
          <span className="label block">Header row</span>
          <select className="input max-w-[34ch]" value={state.headerRowIndex} onChange={(e) => setHeaderRow(Number(e.target.value))}>
            {headerOptions.map((o) => (
              <option key={o.index} value={o.index}>
                Row {o.index + 1}: {o.preview.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <SummaryStrip validation={validation} dataset={dataset} onIssues={() => setTab('issues')} />
      </div>

      {(state.truncated || validation.issues.some((i) => i.rowNumber === undefined)) && (
        <div className="space-y-1.5 px-4 pt-2">
          {state.truncated && (
            <Banner tone="warn" title="This sheet was cut off">
              The worksheet is larger than the supported size (1,048,576 rows × 200 columns). Everything beyond that was not imported.
            </Banner>
          )}
          {validation.issues
            .filter((i) => i.rowNumber === undefined)
            .map((i) => (
              <Banner key={i.code} tone="error" title={i.message} />
            ))}
        </div>
      )}

      <div className="mt-2">
        <Tabs
          idPrefix="import"
          label="Import views"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'records', label: 'Records' },
            { key: 'columns', label: <>Columns <span className="muted">{dataset.columns.filter((c) => c.include).length}/{dataset.columns.length}</span></> },
            {
              key: 'issues',
              label: (
                <>
                  Issues {issueCount > 0 && <Badge tone={validation.recordsWithErrors ? 'error' : 'warn'}>{issueCount}</Badge>}
                </>
              )
            }
          ]}
        />
      </div>

      <div role="tabpanel" id={tabId('import', tab, 'panel')} aria-labelledby={tabId('import', tab, 'tab')} className="min-h-0 flex-1 overflow-hidden bg-surface">
        {tab === 'records' && <RecordsTable dataset={dataset} validation={validation} focusRow={focusRow} />}
        {tab === 'columns' && <ColumnsTable dataset={dataset} />}
        {tab === 'issues' && <IssuesList dataset={dataset} validation={validation} onShowRow={showRow} />}
      </div>
    </div>
  )
}

/** One-line validation summary; the counts that need action are buttons that jump to the issue list. */
function SummaryStrip({ validation, dataset, onIssues }: { validation: ValidationResult; dataset: Dataset; onIssues: () => void }) {
  const ready = validation.validRecords - validation.recordsWithWarnings
  const Count = ({ n, label, tone, action }: { n: number; label: string; tone: string; action?: boolean }) => {
    const body = (
      <>
        <span className={`font-semibold tabular-nums ${n > 0 ? tone : 'text-fg'}`}>{n.toLocaleString()}</span> <span className="text-fg-muted">{label}</span>
      </>
    )
    return action && n > 0 ? (
      <button type="button" className="rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-hover" onClick={onIssues}>
        {body}
      </button>
    ) : (
      <span className="px-1">{body}</span>
    )
  }
  return (
    <p className="ml-auto flex flex-wrap items-center gap-x-1 pb-1 leading-7" aria-label="Validation summary">
      <Count n={validation.totalRecords} label={validation.totalRecords === 1 ? 'record' : 'records'} tone="" />
      <Count n={ready} label="ready" tone="text-ok" />
      <Count n={validation.recordsWithWarnings} label={validation.recordsWithWarnings === 1 ? 'warning' : 'warnings'} tone="text-warn" action />
      <Count n={validation.recordsWithErrors} label={validation.recordsWithErrors === 1 ? 'error' : 'errors'} tone="text-err" action />
      {validation.duplicateGroups > 0 && <Count n={validation.duplicateGroups} label={validation.duplicateGroups === 1 ? 'duplicate group' : 'duplicate groups'} tone="text-warn" action />}
      {dataset.skippedEmptyRows.length > 0 && <Count n={dataset.skippedEmptyRows.length} label="blank rows skipped" tone="" />}
    </p>
  )
}

type RecordFilter = 'all' | 'issues' | 'errors' | 'warnings'
const PAGE_SIZE = 100

function RecordsTable({ dataset, validation, focusRow }: { dataset: Dataset; validation: ValidationResult; focusRow: { row: number; n: number } | null }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RecordFilter>('all')
  const [page, setPage] = useState(0)
  const [flash, setFlash] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
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

  // "Show row" from the issue list: clear filters, open the page that holds the row, then scroll to and flash it.
  useEffect(() => {
    if (!focusRow) return
    setQuery('')
    setFilter('all')
    const index = dataset.records.findIndex((r) => r.rowNumber === focusRow.row)
    if (index < 0) return
    setPage(Math.floor(index / PAGE_SIZE))
    setFlash(focusRow.row)
    const t = setTimeout(() => {
      scroller.current?.querySelector(`[data-row="${focusRow.row}"]`)?.scrollIntoView({ block: 'center' })
    }, 30)
    const off = setTimeout(() => setFlash(null), 2500)
    return () => {
      clearTimeout(t)
      clearTimeout(off)
    }
  }, [focusRow, dataset.records])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2 top-1.5 text-fg-subtle" />
          <input
            className="input w-64 pl-7"
            type="search"
            aria-label="Search records"
            placeholder="Search name, email, any value…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
          />
        </div>
        <select
          className="input"
          aria-label="Filter records"
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
          {rows.length.toLocaleString()} of {dataset.records.length.toLocaleString()}
        </span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-head sticky left-0 z-20 w-14">Row</th>
              <th className="table-head w-10">
                <span className="sr-only">Issues</span>
              </th>
              {columns.map((c) => (
                <th key={c.key} className="table-head">
                  {c.label}
                  {c.required && (
                    <span className="text-err" title="Required">
                      {' '}
                      *
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((record) => {
              const issues = validation.byRow.get(record.rowNumber) ?? []
              const hasError = issues.some((i) => i.severity === 'error')
              const flashing = flash === record.rowNumber
              return (
                <tr key={record.rowNumber} data-row={record.rowNumber} className={`group ${flashing ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
                  <td className={`table-cell sticky left-0 tabular-nums text-fg-muted ${flashing ? 'bg-accent-soft' : 'bg-surface group-hover:bg-surface-2'}`}>{record.rowNumber}</td>
                  <td className="table-cell" title={issues.map((i) => i.message).join('\n')}>
                    {issues.length > 0 && <Badge tone={hasError ? 'error' : 'warn'}>{issues.length}</Badge>}
                  </td>
                  {columns.map((c) => {
                    const cellIssues = issues.filter((i) => i.columnKey === c.key)
                    const tone = cellIssues.some((i) => i.severity === 'error') ? 'bg-err-soft' : cellIssues.length ? 'bg-warn-soft' : ''
                    return (
                      <td key={c.key} className={`table-cell ${c.kind === 'multiline' ? 'min-w-48 whitespace-pre-line' : 'whitespace-nowrap'} ${tone}`} title={cellIssues.map((i) => i.message).join('\n') || undefined}>
                        {record.values[c.key] || (c.required ? <span className="italic text-err">missing</span> : '')}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && <EmptyState title="No records match">Change the search or filter to see more rows.</EmptyState>}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-1.5">
          <Button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </Button>
          <span className="muted tabular-nums">
            Page {current + 1} of {pageCount}
          </span>
          <Button disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            Next
          </Button>
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
    <div className="h-full overflow-auto">
      <p className="muted max-w-3xl px-4 py-2">Choose which columns to import and how each is checked. Included columns are matched to the template’s text objects in Template setup.</p>
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
            <th className="table-head w-24" title="Identifier such as a control number: repeated values are flagged">
              Unique ID
            </th>
            <th className="table-head w-16 text-right">Empty</th>
          </tr>
        </thead>
        <tbody>
          {dataset.columns.map((c) => (
            <tr key={c.key} className={c.include ? '' : 'opacity-60'}>
              <td className="table-cell">
                <input type="checkbox" className="check" aria-label={`Include ${c.label}`} checked={c.include} onChange={(e) => updateColumn(c.key, { include: e.target.checked })} />
              </td>
              <td className="table-cell font-mono text-xs text-fg-muted">{columnLetter(c.index)}</td>
              <td className="table-cell font-medium">{c.label}</td>
              <td className="table-cell max-w-xs truncate text-fg-muted">{sample(c)}</td>
              <td className="table-cell">
                <select className="input h-6 w-full" aria-label={`${c.label} type`} disabled={!c.include} value={c.kind} onChange={(e) => updateColumn(c.key, { kind: e.target.value as FieldKind })}>
                  {(Object.keys(KIND_LABELS) as FieldKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="table-cell">
                <input type="checkbox" className="check" aria-label={`${c.label} required`} disabled={!c.include} checked={c.required} onChange={(e) => updateColumn(c.key, { required: e.target.checked })} />
              </td>
              <td className="table-cell">
                <input type="checkbox" className="check" aria-label={`${c.label} is part of duplicate key`} disabled={!c.include} checked={c.duplicateKey} onChange={(e) => updateColumn(c.key, { duplicateKey: e.target.checked })} />
              </td>
              <td className="table-cell">
                <input type="checkbox" className="check" aria-label={`${c.label} is a unique identifier`} disabled={!c.include} checked={!!c.unique} onChange={(e) => updateColumn(c.key, { unique: e.target.checked })} />
              </td>
              <td className="table-cell text-right tabular-nums">{c.include ? emptyCount(c) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const GROUP_PAGE = 200

/** Issues grouped by severity, errors first; each issue can jump to its row in the Records tab. */
function IssuesList({ dataset, validation, onShowRow }: { dataset: Dataset; validation: ValidationResult; onShowRow: (row: number) => void }) {
  const labels = new Map(dataset.columns.map((c) => [c.key, c.label]))
  const groups = groupIssues(validation.issues)
  const [shown, setShown] = useState<Record<string, number>>({})

  if (groups.length === 0) {
    return (
      <EmptyState title="No issues found">
        <Badge tone="ok">All {validation.totalRecords} records passed validation</Badge>
      </EmptyState>
    )
  }
  return (
    <div className="h-full overflow-auto pb-4">
      {groups.map((g) => {
        const limit = shown[g.severity] ?? GROUP_PAGE
        return (
          <section key={g.severity} aria-labelledby={`issues-${g.severity}`}>
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-1.5">
              <h3 id={`issues-${g.severity}`} className="flex items-center gap-2 text-sm">
                <Badge tone={g.severity === 'error' ? 'error' : 'warn'}>{g.severity === 'error' ? 'Errors' : 'Warnings'}</Badge>
                <span className="tabular-nums">{g.items.length}</span>
              </h3>
              <p className="muted text-xs">{g.severity === 'error' ? 'These records are excluded from generation until fixed in the spreadsheet.' : 'Review these; they do not block generation.'}</p>
            </div>
            <table className="w-full border-separate border-spacing-0">
              <tbody>
                {g.items.slice(0, limit).map((issue: ValidationIssue, i) => (
                  <tr key={i} className="hover:bg-surface-2">
                    <td className="table-cell w-20 tabular-nums text-fg-muted">{issue.rowNumber !== undefined ? `Row ${issue.rowNumber}` : 'Sheet'}</td>
                    <td className="table-cell w-44 text-fg-muted">{issue.columnKey ? labels.get(issue.columnKey) : '–'}</td>
                    <td className="table-cell">{issue.message}</td>
                    <td className="table-cell w-24 text-right">
                      {issue.rowNumber !== undefined && (
                        <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => onShowRow(issue.rowNumber!)} aria-label={`Show row ${issue.rowNumber} in Records`}>
                          Show row
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.items.length > limit && (
              <div className="px-4 py-2">
                <Button onClick={() => setShown({ ...shown, [g.severity]: limit + GROUP_PAGE })}>
                  Show {Math.min(GROUP_PAGE, g.items.length - limit)} more ({g.items.length - limit} hidden)
                </Button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
