import type { Dataset } from '../types'

/** A handful of non-empty values per included column: enough to classify a column and to see its prefix, cheap to compute. */
export function columnSamples(dataset: Dataset | null, perColumn = 300): Map<string, string[]> {
  const samples = new Map<string, string[]>()
  if (!dataset) return samples
  for (const c of dataset.columns) {
    if (!c.include) continue
    const values: string[] = []
    for (const r of dataset.records) {
      const v = r.values[c.key]
      if (v) values.push(v)
      if (values.length >= perColumn) break
    }
    samples.set(c.key, values)
  }
  return samples
}
