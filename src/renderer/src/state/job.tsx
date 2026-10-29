import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { buildDataset } from '../../../shared/import/dataset'
import { buildColumns, detectHeaderRow } from '../../../shared/import/headers'
import { validateDataset } from '../../../shared/import/validate'
import type { CellGrid, ColumnConfig, Dataset, SheetData, ValidationResult, WorkbookInfo } from '../../../shared/types'
import { api, errorMessage, unwrap } from '../api'

export type ImportPhase = 'empty' | 'opening' | 'reading' | 'ready' | 'error'

interface ImportState {
  phase: ImportPhase
  error: string | null
  workbook: WorkbookInfo | null
  sheetName: string | null
  grid: CellGrid | null
  truncated: boolean
  headerRowIndex: number
  columns: ColumnConfig[]
}

type Action =
  | { type: 'openStart' }
  | { type: 'openDone'; workbook: WorkbookInfo }
  | { type: 'readStart'; sheetName: string }
  | { type: 'readDone'; sheet: SheetData }
  | { type: 'fail'; error: string }
  | { type: 'setHeaderRow'; index: number }
  | { type: 'updateColumn'; key: string; patch: Partial<ColumnConfig> }
  | { type: 'reset' }

const INITIAL: ImportState = {
  phase: 'empty',
  error: null,
  workbook: null,
  sheetName: null,
  grid: null,
  truncated: false,
  headerRowIndex: -1,
  columns: []
}

function reducer(state: ImportState, action: Action): ImportState {
  switch (action.type) {
    case 'openStart':
      return { ...INITIAL, phase: 'opening' }
    case 'openDone':
      return { ...state, workbook: action.workbook }
    case 'readStart':
      return { ...state, phase: 'reading', sheetName: action.sheetName, error: null }
    case 'readDone': {
      const headerRowIndex = detectHeaderRow(action.sheet.rows)
      return {
        ...state,
        phase: 'ready',
        grid: action.sheet.rows,
        truncated: action.sheet.truncated,
        headerRowIndex,
        columns: buildColumns(action.sheet.rows, headerRowIndex)
      }
    }
    case 'fail':
      return { ...state, phase: 'error', error: action.error }
    case 'setHeaderRow':
      if (!state.grid) return state
      // Changing the header row redefines the columns, so column settings are rebuilt.
      return { ...state, headerRowIndex: action.index, columns: buildColumns(state.grid, action.index) }
    case 'updateColumn':
      return { ...state, columns: state.columns.map((c) => (c.key === action.key ? { ...c, ...action.patch } : c)) }
    case 'reset':
      return INITIAL
  }
}

interface JobContextValue {
  state: ImportState
  dataset: Dataset | null
  validation: ValidationResult | null
  openFile(path: string): Promise<void>
  selectSheet(name: string): Promise<void>
  setHeaderRow(index: number): void
  updateColumn(key: string, patch: Partial<ColumnConfig>): void
  reset(): void
}

const JobContext = createContext<JobContextValue | null>(null)

export function JobProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  // Each request gets a ticket; responses for superseded requests (e.g. a second file dropped) are ignored.
  const ticket = useRef(0)

  const readSheet = useCallback(async (workbook: WorkbookInfo, sheetName: string, myTicket: number) => {
    dispatch({ type: 'readStart', sheetName })
    try {
      const sheet = await unwrap(api.excel.readSheet(workbook.filePath, sheetName))
      if (ticket.current === myTicket) dispatch({ type: 'readDone', sheet })
    } catch (err) {
      if (ticket.current === myTicket) dispatch({ type: 'fail', error: errorMessage(err) })
    }
  }, [])

  const openFile = useCallback(
    async (path: string) => {
      const myTicket = ++ticket.current
      dispatch({ type: 'openStart' })
      try {
        const workbook = await unwrap(api.excel.open(path))
        if (ticket.current !== myTicket) return
        dispatch({ type: 'openDone', workbook })
        const first = workbook.sheets.find((s) => s.rowCount > 0) ?? workbook.sheets[0]
        if (first) await readSheet(workbook, first.name, myTicket)
      } catch (err) {
        if (ticket.current === myTicket) dispatch({ type: 'fail', error: errorMessage(err) })
      }
    },
    [readSheet]
  )

  const selectSheet = useCallback(
    async (name: string) => {
      if (!state.workbook) return
      await readSheet(state.workbook, name, ++ticket.current)
    },
    [readSheet, state.workbook]
  )

  const dataset = useMemo(
    () => (state.grid ? buildDataset(state.grid, state.headerRowIndex, state.columns) : null),
    [state.grid, state.headerRowIndex, state.columns]
  )
  const validation = useMemo(() => (dataset ? validateDataset(dataset) : null), [dataset])

  const value: JobContextValue = {
    state,
    dataset,
    validation,
    openFile,
    selectSheet,
    setHeaderRow: (index) => dispatch({ type: 'setHeaderRow', index }),
    updateColumn: (key, patch) => dispatch({ type: 'updateColumn', key, patch }),
    reset: () => {
      ticket.current++
      dispatch({ type: 'reset' })
    }
  }

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>
}

export function useJob(): JobContextValue {
  const ctx = useContext(JobContext)
  if (!ctx) throw new Error('useJob must be used inside JobProvider')
  return ctx
}
