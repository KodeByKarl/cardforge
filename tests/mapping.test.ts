import { describe, expect, it } from 'vitest'
import { planFileNames, renderFileName } from '../src/shared/generation/naming'
import { buildDataset } from '../src/shared/import/dataset'
import { buildColumns } from '../src/shared/import/headers'
import { validateDataset } from '../src/shared/import/validate'
import {
  buildGenerationInputs,
  mappingIssues,
  mappingKey,
  missingFieldsFor,
  parseSavedMapping,
  resolveMapping,
  shapeValuesFor,
  suggestMapping
} from '../src/shared/template/mapping'
import type { SavedMapping } from '../src/shared/template/types'
import { FRONT_BACK } from './fixtures/inspection'

const GRID = [
  ['Full Name', 'Position', 'Company', 'Cell Phone', 'Tel. No.', 'E-mail', 'Office Address'],
  ['Ana Cruz', 'Manager', 'ACME', '0917 123 4567', '', 'ana@acme.ph', 'Unit 5\nMakati'],
  ['', 'Intern', 'ACME', '0918 000 0000', '', 'x@acme.ph', 'Pasig'],
  ['Ben Santos', 'Engineer', 'ACME', '0919 111 2222', '(02) 8123 4567', 'ben@acme.ph', 'Taguig']
]
const columns = buildColumns(GRID, 0)
const dataset = buildDataset(GRID, 0, columns)

describe('mappingKey', () => {
  it('ignores case, spacing, punctuation and accents', () => {
    expect(mappingKey('Full Name')).toBe(mappingKey('full_name'))
    expect(mappingKey('FullName')).toBe('fullname')
    expect(mappingKey('E-mail')).toBe('email')
    expect(mappingKey('Teléfono')).toBe('telefono')
  })
})

describe('suggestMapping', () => {
  it('matches object names to differently-worded headers via synonyms', () => {
    const m = suggestMapping(FRONT_BACK.objects, columns)
    expect(m.entries).toEqual({
      FullName: { kind: 'column', columnLabel: 'Full Name' },
      JobTitle: { kind: 'column', columnLabel: 'Position' },
      Email: { kind: 'column', columnLabel: 'E-mail' },
      Mobile: { kind: 'column', columnLabel: 'Cell Phone' },
      Telephone: { kind: 'column', columnLabel: 'Tel. No.' },
      Address: { kind: 'column', columnLabel: 'Office Address' },
      Tagline: { kind: 'keep' },
      Company: { kind: 'column', columnLabel: 'Company' }
    })
  })

  it('never suggests an excluded column', () => {
    const cols = columns.map((c) => (c.label === 'Company' ? { ...c, include: false } : c))
    expect(suggestMapping(FRONT_BACK.objects, cols).entries['Company']).toEqual({ kind: 'keep' })
  })

  it('lists an object name once even if it appears on front and back', () => {
    const objects = [...FRONT_BACK.objects, { ...FRONT_BACK.objects[0]!, pageIndex: 2 }]
    expect(Object.keys(suggestMapping(objects, columns).entries)).toHaveLength(8)
  })
})

describe('resolveMapping + issues', () => {
  const saved: SavedMapping = {
    version: 1,
    entries: {
      FullName: { kind: 'column', columnLabel: 'full name' },
      JobTitle: { kind: 'column', columnLabel: 'Position' },
      Email: { kind: 'column', columnLabel: 'Email Address' },
      Telephone: { kind: 'blank' },
      Tagline: { kind: 'column', columnLabel: 'Company' },
      Removed: { kind: 'keep' }
    }
  }

  it('resolves labels case-insensitively and reports columns missing from a new sheet', () => {
    const r = resolveMapping(saved, FRONT_BACK.objects, columns)
    expect(r.get('FullName')).toMatchObject({ kind: 'column', column: { label: 'Full Name' } })
    expect(r.get('Email')).toEqual({ kind: 'missing', columnLabel: 'Email Address' })
    expect(r.get('Telephone')).toEqual({ kind: 'blank' })
    expect(r.get('Mobile')).toEqual({ kind: 'keep' })
  })

  it('reports unmapped, missing, mixed-format and stale entries', () => {
    const issues = mappingIssues(FRONT_BACK.objects, saved, columns)
    const by = (name: string) => issues.filter((i) => i.objectName === name).map((i) => i.severity)
    expect(by('Email')).toEqual(['error'])
    expect(by('Mobile')).toEqual(['warning']) // not mapped: template text would print
    expect(by('Tagline')).toEqual(['warning']) // mixed formatting
    expect(by('Removed')).toEqual(['warning']) // stale
    expect(by('FullName')).toEqual([])
    expect(issues.find((i) => i.objectName === 'Mobile')!.message).toContain('0900 000 0000')
  })

  it('errors when a template has no named objects', () => {
    expect(mappingIssues([], null, columns)).toEqual([expect.objectContaining({ severity: 'error', objectName: null })])
  })
})

describe('record values', () => {
  const mapping = suggestMapping(FRONT_BACK.objects, columns)
  mapping.entries['Telephone'] = { kind: 'blank' }
  const resolved = resolveMapping(mapping, FRONT_BACK.objects, columns)

  it('produces values for mapped objects only; "keep" objects are left untouched', () => {
    const values = shapeValuesFor(dataset.records[0]!, resolved)
    expect(values).toEqual({
      FullName: 'Ana Cruz',
      JobTitle: 'Manager',
      Email: 'ana@acme.ph',
      Mobile: '0917 123 4567',
      Telephone: '',
      Address: 'Unit 5\nMakati',
      Company: 'ACME'
    })
    expect('Tagline' in values).toBe(false)
  })

  it('lists mapped fields that are empty for a record', () => {
    expect(missingFieldsFor(dataset.records[1]!, resolved)).toEqual([{ objectName: 'FullName', columnLabel: 'Full Name' }])
  })

  it('excludes records with validation errors from generation and explains why', () => {
    const { records, excluded } = buildGenerationInputs(dataset, validateDataset(dataset), resolved)
    expect(records.map((r) => r.rowNumber)).toEqual([2, 4])
    expect(excluded).toEqual([{ rowNumber: 3, reason: expect.stringContaining('Full Name') }])
    expect(records[0]!.fields['Full Name']).toBe('Ana Cruz')
  })
})

describe('parseSavedMapping', () => {
  it('accepts valid mappings and rejects malformed input', () => {
    const ok = { version: 1, entries: { A: { kind: 'keep' }, B: { kind: 'column', columnLabel: 'X' } } }
    expect(parseSavedMapping(ok)).toEqual(ok)
    expect(() => parseSavedMapping(null)).toThrow()
    expect(() => parseSavedMapping({ version: 2, entries: {} })).toThrow()
    expect(() => parseSavedMapping({ version: 1, entries: { A: { kind: 'column' } } })).toThrow()
    expect(() => parseSavedMapping({ version: 1, entries: { A: { kind: 'eval', code: 'x' } } })).toThrow()
  })
})

describe('output file naming', () => {
  const rec = (rowNumber: number, name: string) => ({ rowNumber, fields: { 'Full Name': name } })

  it('expands {row} and {col:Header} (header matched ignoring case) and sanitises', () => {
    expect(renderFileName('{row} - {col:full name}', rec(7, 'Ana: "Cruz"'))).toBe('7 - Ana_ _Cruz_')
    expect(renderFileName('{col:Missing}', rec(3, 'x'))).toBe('row 3')
    expect(renderFileName('{row} - {col:Full Name}', rec(4, ''))).toBe('4')
  })

  it('de-duplicates names within a batch', () => {
    expect(planFileNames([rec(2, 'Ana'), rec(3, 'ana'), rec(4, 'Ana')], '{col:Full Name}')).toEqual(['Ana.cdr', 'ana (2).cdr', 'Ana (3).cdr'])
  })
})
