import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertSafePath, sanitizeFileName } from '../src/main/paths'
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
