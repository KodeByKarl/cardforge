import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertSafePath, sanitizeFileName } from '../src/main/paths'
import { MockCorelAdapter } from '../src/main/services/corel/MockCorelAdapter'
import { serverExecutable } from '../src/main/services/corel/detect'
import { DEFAULT_SETTINGS, SettingsStore, sanitizeSettingsPatch } from '../src/main/settings'

const TMP = resolve(__dirname, '.tmp', 'main')
beforeAll(() => mkdirSync(TMP, { recursive: true }))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('safe paths', () => {
  it('produces Windows-safe file names', () => {
    expect(sanitizeFileName('Ana: "Cruz" / Sales?')).toBe('Ana_ _Cruz_ _ Sales_')
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('trailing dots... ')).toBe('trailing dots')
    expect(sanitizeFileName('   ')).toBe('card')
    expect(sanitizeFileName('x'.repeat(300))).toHaveLength(120)
    expect(sanitizeFileName('José Peña')).toBe('José Peña')
  })

  it('rejects device paths, NUL bytes and wrong extensions', () => {
    expect(() => assertSafePath('\\\\.\\PhysicalDrive0', ['.xlsx'])).toThrow()
    expect(() => assertSafePath('C:\\data\\a.xlsx\0.exe', ['.xlsx'])).toThrow()
    expect(() => assertSafePath('C:\\data\\a.exe', ['.xlsx'])).toThrow(/not supported/)
    expect(assertSafePath('C:\\data\\A.XLSX', ['.xlsx'])).toBe('C:\\data\\A.XLSX')
  })
})

describe('settings', () => {
  it('rejects invalid values from the renderer', () => {
    expect(() => sanitizeSettingsPatch({ overwritePolicy: 'always' })).toThrow()
    expect(() => sanitizeSettingsPatch({ outputDirectory: 'relative/dir' })).toThrow()
    expect(() => sanitizeSettingsPatch({ exportPdf: 'yes' })).toThrow()
    expect(sanitizeSettingsPatch({ exportPdf: true, unknownKey: 1 })).toEqual({ exportPdf: true })
  })

  it('persists atomically and falls back to defaults on corrupt files', async () => {
    const file = join(TMP, 'settings.json')
    const store = new SettingsStore(file)
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    await store.update({ overwritePolicy: 'suffix' })
    expect(JSON.parse(readFileSync(file, 'utf8')).overwritePolicy).toBe('suffix')
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect((await new SettingsStore(file).load()).overwritePolicy).toBe('suffix')
  })
})

describe('CorelDRAW detection', () => {
  it('extracts the server executable from LocalServer32 command lines', () => {
    expect(serverExecutable('"c:\\Program Files\\Corel\\CorelDRAW Graphics Suite X7\\Programs64\\CorelDRW.exe" /Automation')).toBe(
      'c:\\Program Files\\Corel\\CorelDRAW Graphics Suite X7\\Programs64\\CorelDRW.exe'
    )
    expect(serverExecutable('C:\\Corel\\CorelDRW.exe /Automation')).toBe('C:\\Corel\\CorelDRW.exe')
  })
})

describe('mock CorelDRAW adapter', () => {
  const template = {
    templatePath: 'C:\\t.cdr',
    pageCount: 1,
    pageWidthMm: 90,
    pageHeightMm: 50,
    textObjects: [{ name: 'FullName', pageIndex: 1, currentText: 'Name', bounds: null, fontName: null, fontSizePt: null, isParagraphText: null }]
  }

  it('never writes .cdr files and refuses to overwrite', async () => {
    const adapter = new MockCorelAdapter(template)
    await adapter.beginBatch(template.templatePath)
    const out = join(TMP, 'card1.cdr')
    await adapter.generateOne({ values: { FullName: 'Ana' }, outputPath: out })
    expect(existsSync(out)).toBe(false)
    expect(existsSync(`${out}.mock.json`)).toBe(true)
    await expect(adapter.generateOne({ values: { FullName: 'Ana' }, outputPath: out })).rejects.toThrow()
    await adapter.endBatch()
  })

  it('reports unknown template objects and simulated failures', async () => {
    const adapter = new MockCorelAdapter(template)
    await expect(adapter.generateOne({ values: {}, outputPath: join(TMP, 'x.cdr') })).rejects.toMatchObject({ code: 'NO_BATCH' })
    await adapter.beginBatch(template.templatePath)
    await expect(adapter.beginBatch(template.templatePath)).rejects.toMatchObject({ code: 'BATCH_IN_PROGRESS' })
    await expect(adapter.generateOne({ values: { Title: 'x' }, outputPath: join(TMP, 'y.cdr') })).rejects.toMatchObject({ code: 'SHAPE_NOT_FOUND' })
    adapter.failOn = () => true
    await expect(adapter.generateOne({ values: { FullName: 'x' }, outputPath: join(TMP, 'z.cdr') })).rejects.toMatchObject({ code: 'COREL_SAVE_FAILED' })
  })
})
