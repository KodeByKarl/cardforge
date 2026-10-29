import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { X7_FILE_VERSION } from '../../src/main/services/corel/CorelAdapter'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { FIXTURE, TMP, corelProgId, createAdapter, workingCopy } from './corelEnv'

const progId = await corelProgId()
const fixtureHash = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex')

export function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe.skipIf(!progId)(`CorelDRAW bridge (${progId ?? 'CorelDRAW not installed'})`, () => {
  let adapter: PowerShellCorelAdapter

  beforeAll(async () => {
    adapter = createAdapter(progId!)
    const conn = await adapter.connect()
    console.log(`Connected to ${conn.progId}: ${conn.version}`)
  })
  afterAll(async () => {
    await adapter?.dispose()
    // The fixture itself is never opened, so it must be byte-identical afterwards.
    expect(createHash('sha256').update(readFileSync(FIXTURE)).digest('hex')).toBe(fixtureHash)
  })

  it('inspects pages, nested groups, paragraph text and mixed formatting', async () => {
    const handle = await adapter.openDocument(workingCopy())
    try {
      const info = await adapter.inspect(handle)
      expect(info.pages.map((p) => [p.index, p.widthMm, p.heightMm])).toEqual([
        [1, 90, 50],
        [2, 90, 50]
      ])
      const byName = new Map(info.objects.map((o) => [o.name, o]))
      expect([...byName.keys()].sort()).toEqual(['Address', 'Company', 'Email', 'FullName', 'JobTitle', 'Mobile', 'Tagline', 'Telephone'])
      expect(byName.get('Telephone')!.path).toEqual(['ContactGroup', 'PhoneGroup'])
      expect(byName.get('Email')!.path).toEqual(['ContactGroup'])
      expect(byName.get('Company')!.pageIndex).toBe(2)
      expect(byName.get('Address')!.isParagraph).toBe(true)
      expect(byName.get('FullName')!.isParagraph).toBe(false)
      expect(byName.get('FullName')).toMatchObject({ font: 'Arial', sizePt: 14, text: 'Employee Name', mixedFormatting: false })
      expect(byName.get('Tagline')!.mixedFormatting).toBe(true)
      expect(info.unnamedTextCount).toBe(1) // the static "ACME" logo text
      const b = byName.get('FullName')!.bounds
      expect(b.left).toBeGreaterThan(9)
      expect(b.left).toBeLessThan(11)
    } finally {
      await adapter.closeDocument(handle)
    }
  })

  it('applies Unicode text, detects overflow, exports exact page images, saves and reopens', async () => {
    const handle = await adapter.openDocument(workingCopy())
    const out = join(TMP, `bridge-out-${Date.now()}.cdr`)
    const name = 'José Peña-Ñuñez 王小明'
    const record = {
      FullName: name,
      Telephone: '(02) 8123 4567',
      Address: 'Unit 5, Ayala Tower\n' + '6750 Ayala Avenue, Makati City, Metro Manila 1226, Philippines. '.repeat(4),
      JobTitle: '',
      Nope: 'x'
    }
    try {
      const result = await adapter.applyText(handle, record, 3)
      expect(result.notFound).toEqual(['Nope'])
      const metric = new Map(result.objects.map((o) => [o.name, o]))
      expect(metric.get('FullName')!.overflow).toBe(false)
      expect(metric.get('Address')!.overflow).toBe(true)
      expect(metric.get('JobTitle')!.overflow).toBe(false)

      const long = await adapter.applyText(handle, { FullName: 'Maria Concepcion Josefina Dela Cruz-Villanueva Santos' }, 3)
      expect(long.objects[0]!.overflow).toBe(true)
      // Each apply is a whole record starting from the template, so re-apply the full record before saving.
      await adapter.applyText(handle, record, 3)

      const pages = await adapter.exportPages(handle, { dir: TMP, prefix: `p-${Date.now()}`, dpi: 150, pages: [1, 2] })
      expect(pages.map((p) => [p.pageIndex, p.widthPx, p.heightPx])).toEqual([
        [1, 531, 295],
        [2, 531, 295]
      ])
      for (const p of pages) expect(pngSize(p.path)).toEqual({ width: 531, height: 295 })

      await adapter.saveAs(handle, out, X7_FILE_VERSION)
      expect(statSync(out).size).toBeGreaterThan(1000)
    } finally {
      await adapter.closeDocument(handle)
    }

    const reopened = await adapter.openDocument(out)
    try {
      const byName = new Map((await adapter.inspect(reopened)).objects.map((o) => [o.name, o]))
      expect(byName.get('FullName')!.text).toBe(name)
      expect(byName.get('FullName')!.font).toBe('Arial')
      expect(byName.get('JobTitle')!.text).toBe('')
      expect(byName.get('Address')!.text.split('\n')[0]).toBe('Unit 5, Ayala Tower')
      expect(byName.get('Company')!.text).toBe('Company Name') // not in values: kept
    } finally {
      await adapter.closeDocument(reopened)
    }
  })

  it('starts every record from the template formatting (no font drift after CJK text)', async () => {
    const handle = await adapter.openDocument(workingCopy())
    const out = join(TMP, `drift-${Date.now()}.cdr`)
    try {
      const cjk = await adapter.applyText(handle, { FullName: '王小明', JobTitle: 'Engineer' }, 3)
      expect(cjk.revertMode).toBe('undo')
      // A record that doesn't set JobTitle must get the template text back, not the previous record's.
      await adapter.applyText(handle, { FullName: 'Ben Santos' }, 3)
      await adapter.saveAs(handle, out, X7_FILE_VERSION)
    } finally {
      await adapter.closeDocument(handle)
    }
    const reopened = await adapter.openDocument(out)
    try {
      const byName = new Map((await adapter.inspect(reopened)).objects.map((o) => [o.name, o]))
      expect(byName.get('FullName')).toMatchObject({ text: 'Ben Santos', font: 'Arial', sizePt: 14 })
      expect(byName.get('JobTitle')!.text).toBe('Job Title')
    } finally {
      await adapter.closeDocument(reopened)
    }
  })

  it('reports missing files and unknown documents without breaking the bridge', async () => {
    await expect(adapter.openDocument(join(TMP, 'does-not-exist.cdr'))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    const handle = await adapter.openDocument(workingCopy())
    const [gen] = handle.split(':')
    await expect(adapter.inspect(`${gen}:d999`)).rejects.toMatchObject({ code: 'UNKNOWN_DOCUMENT' })
    expect((await adapter.inspect(handle)).pages).toHaveLength(2)
    await adapter.closeDocument(handle)
  })
})
