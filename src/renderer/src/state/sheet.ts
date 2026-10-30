import { useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '../api'
import { columnSamples } from '../../../shared/sheet/samples'
import type { ImportRecord } from '../../../shared/types'
import { useJob } from './job'
import { useTemplates } from './templates'
import { hasBlockingSheetIssues, sheetMappingIssues } from '../../../shared/sheet/compose'
import type { SheetMappingIssue } from '../../../shared/sheet/types'

/**
 * Data the sheet workflow needs from the import: records without errors (the ones that can be printed), the rows left
 * out, and a few values per column used to match template samples to columns and to check the control-number prefix.
 */
export function useSheetData() {
  const { dataset, validation } = useJob()
  return useMemo(() => {
    const eligible: ImportRecord[] = []
    const excludedRows: number[] = []
    if (dataset && validation) {
      for (const r of dataset.records) {
        if (validation.byRow.get(r.rowNumber)?.some((i) => i.severity === 'error')) excludedRows.push(r.rowNumber)
        else eligible.push(r)
      }
    }
    return { dataset, eligible, excludedRows, samples: columnSamples(dataset) }
  }, [dataset, validation])
}

/** Problems of the selected template's sheet mapping against the loaded spreadsheet (errors block preview/generation). */
export function useSheetIssues(): { issues: SheetMappingIssue[]; blocking: boolean } {
  const { selected } = useTemplates()
  const { dataset, samples } = useSheetData()
  return useMemo(() => {
    if (!selected?.sheet?.preparedAt || !dataset) return { issues: [], blocking: false }
    const issues = sheetMappingIssues(selected.sheet, selected.sheetMapping ?? null, dataset.columns, samples)
    return { issues, blocking: hasBlockingSheetIssues(issues) }
  }, [selected, dataset, samples])
}

/** Template fonts that are not installed on this PC. null while unknown; CorelDRAW would substitute them silently. */
export function useMissingFonts(templateId: string | undefined): string[] | null {
  const [missing, setMissing] = useState<string[] | null>(null)
  useEffect(() => {
    setMissing(null)
    if (!templateId) return
    let stale = false
    unwrap(api.templates.missingFonts(templateId)).then(
      (m) => !stale && setMissing(m),
      () => !stale && setMissing([])
    )
    return () => {
      stale = true
    }
  }, [templateId])
  return missing
}
