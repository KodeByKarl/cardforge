import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

export const TMP_DIR = join(__dirname, '..', '.tmp')

export interface SyntheticOptions {
  records: number
  /** 1-based row of the header; rows above it hold a title and blanks, like the client's sheet. */
  headerRow?: number
  /** Row offsets (0-based among records) whose control number repeats the previous record's. */
  duplicateIdAt?: number[]
  /** Record offsets with an empty FULL NAME / empty ADDRESS. */
  missingNameAt?: number[]
  blankAddressAt?: number[]
  /** Fully blank rows inserted after these record offsets. */
  blankRowAfter?: number[]
}

/** Fake, non-personal data: generated names like "SURNAME00001,GIVEN00001 MIDDLE". Never derived from client files. */
export function syntheticRow(i: number, prefix = 'PL'): string[] {
  const n = String(i + 1).padStart(6, '0')
  return [`${prefix} ${n}`, `SURNAME${n},GIVEN${n} MIDDLE`, '', `BARANGAY ${(i % 40) + 1}, SAMPLE CITY, PROVINCE`]
}

export async function writeSyntheticWorkbook(file: string, opts: SyntheticOptions): Promise<{ file: string; expectedRecords: number; firstRecordRow: number }> {
  mkdirSync(TMP_DIR, { recursive: true })
  const headerRow = opts.headerRow ?? 3
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('sample list')
  ws.getCell(1, 1).value = 'SYNTHETIC SAMPLE LIST'
  ws.getRow(headerRow).values = ['CONTROL NO.', 'FULL NAME', 'BIRTHDATE', 'ADDRESS']
  const dupes = new Set(opts.duplicateIdAt ?? [])
  const noName = new Set(opts.missingNameAt ?? [])
  const noAddr = new Set(opts.blankAddressAt ?? [])
  const blankAfter = new Set(opts.blankRowAfter ?? [])
  let row = headerRow + 1
  for (let i = 0; i < opts.records; i++) {
    const r = syntheticRow(i)
    if (dupes.has(i) && i > 0) r[0] = syntheticRow(i - 1)[0]!
    if (noName.has(i)) r[1] = ''
    if (noAddr.has(i)) r[3] = ''
    ws.getRow(row).values = r
    row++
    if (blankAfter.has(i)) row++
  }
  await wb.xlsx.writeFile(file)
  return { file, expectedRecords: opts.records, firstRecordRow: headerRow + 1 }
}
