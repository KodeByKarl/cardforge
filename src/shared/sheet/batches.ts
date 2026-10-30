import { planSheets, verifyPlan } from './compose'
import type { SheetBatchPlanItem, SheetPlan } from './types'

/** One output document: a run of consecutive sheets. */
export interface BatchPlanItem {
  /** 1-based batch number. */
  index: number
  firstSheet: number
  lastSheet: number
  sheetCount: number
  /** Index of the first record in the eligible-record list, and how many records the batch holds. */
  firstRecord: number
  recordCount: number
}

export interface BatchPlan {
  sheetPlan: SheetPlan
  sheetsPerFile: number
  batches: BatchPlanItem[]
}

export const MAX_SHEETS_PER_FILE = 500
/** Default sheets per output file; chosen from CorelDRAW benchmarks (see LARGE_BATCH_TEST_REPORT.md). */
export const DEFAULT_SHEETS_PER_FILE = 25

/** Groups the sheets of a job into output files of `sheetsPerFile` sheets (the last file may be smaller). */
export function planBatches(total: number, cardsPerSheet: number, sheetsPerFile: number): BatchPlan {
  if (!Number.isInteger(sheetsPerFile) || sheetsPerFile < 1 || sheetsPerFile > MAX_SHEETS_PER_FILE) throw new RangeError(`Sheets per file must be 1–${MAX_SHEETS_PER_FILE}.`)
  const sheetPlan = planSheets(total, cardsPerSheet)
  const batches: BatchPlanItem[] = []
  for (let i = 0; i < sheetPlan.sheets.length; i += sheetsPerFile) {
    const group: SheetBatchPlanItem[] = sheetPlan.sheets.slice(i, i + sheetsPerFile)
    const first = group[0]!
    const last = group.at(-1)!
    batches.push({
      index: batches.length + 1,
      firstSheet: first.number,
      lastSheet: last.number,
      sheetCount: group.length,
      firstRecord: first.first,
      recordCount: group.reduce((n, g) => n + g.count, 0)
    })
  }
  return { sheetPlan, sheetsPerFile, batches }
}

/** Proves the batches tile the whole job: every record and sheet appears exactly once, in order. */
export function verifyBatches(plan: BatchPlan): string[] {
  const problems = verifyPlan(plan.sheetPlan)
  let nextSheet = 1
  let nextRecord = 0
  for (const b of plan.batches) {
    if (b.firstSheet !== nextSheet) problems.push(`Batch ${b.index} starts at sheet ${b.firstSheet}, expected ${nextSheet}.`)
    if (b.firstRecord !== nextRecord) problems.push(`Batch ${b.index} starts at record ${b.firstRecord}, expected ${nextRecord}.`)
    if (b.sheetCount !== b.lastSheet - b.firstSheet + 1) problems.push(`Batch ${b.index} has inconsistent sheet numbers.`)
    nextSheet = b.lastSheet + 1
    nextRecord = b.firstRecord + b.recordCount
  }
  if (nextSheet - 1 !== plan.sheetPlan.sheets.length) problems.push(`${nextSheet - 1} of ${plan.sheetPlan.sheets.length} sheets are in a batch.`)
  if (nextRecord !== plan.sheetPlan.total) problems.push(`${nextRecord} of ${plan.sheetPlan.total} records are in a batch.`)
  return problems
}

/** "Name sheets 00001-00025.cdr": zero-padded to the job's width so files sort in sheet order. */
export function batchFileName(prefix: string, batch: BatchPlanItem, totalSheets: number, extension = 'cdr'): string {
  const width = Math.max(5, String(totalSheets).length)
  const a = String(batch.firstSheet).padStart(width, '0')
  const b = String(batch.lastSheet).padStart(width, '0')
  return `${prefix} sheets ${a}-${b}.${extension}`
}
