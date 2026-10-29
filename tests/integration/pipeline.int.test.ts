import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GenerationService } from '../../src/main/services/generation/GenerationService'
import { JobHistory } from '../../src/main/services/generation/JobHistory'
import { PreviewService } from '../../src/main/services/preview/PreviewService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { TemplateStore } from '../../src/main/services/templates/TemplateStore'
import type { GenerationRecordInput, JobProgress } from '../../src/shared/template/types'
import { FIXTURE, TMP, corelProgId, createAdapter } from './corelEnv'

const progId = await corelProgId()
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

function records(n: number): GenerationRecordInput[] {
  const names = ['Ana Cruz', 'José Peña-Ñuñez', 'Benjamin Santos', "Liam O'Brien", 'Maria Concepcion Josefina Dela Cruz-Villanueva', '王小明']
  return Array.from({ length: n }, (_, i) => {
    const name = names[i % names.length]! + (i >= names.length ? ` ${i}` : '')
    return {
      rowNumber: i + 2,
      values: { FullName: name, JobTitle: 'Engineer', Email: `p${i}@acme.example`, Company: 'ACME Holdings', Telephone: '' },
      fields: { 'Full Name': name }
    }
  })
}

describe.skipIf(!progId)(`Template → preview → generation pipeline (${progId ?? 'CorelDRAW not installed'})`, () => {
  const root = join(TMP, `pipeline-${randomUUID().slice(0, 8)}`)
  const source = join(root, 'client-template.cdr')
  let adapter: PowerShellCorelAdapter
  let store: TemplateStore
  let templateId: string
  let sourceHash: string

  beforeAll(async () => {
    mkdirSync(root, { recursive: true })
    copyFileSync(FIXTURE, source)
    sourceHash = sha(source)
    adapter = createAdapter(progId!)
    store = new TemplateStore(join(root, 'library'), join(root, 'work'), async () => adapter)
  })
  afterAll(async () => {
    await adapter?.dispose()
  })

  it('imports a template into the library without modifying the original', async () => {
    const record = await store.import(source)
    templateId = record.id
    expect(record.objectCount).toBe(8)
    expect(record.pages).toHaveLength(2)
    expect(record.corelVersion).toMatch(/^Version \d+/)
    expect((await store.pageImages(templateId)).map((p) => p.pageIndex)).toEqual([1, 2])
    expect(sha(source)).toBe(sourceHash)
    expect(readdirSync(join(root, 'work'))).toEqual([])
  })

  it('renders front and back previews with CorelDRAW and reports overflow', async () => {
    const preview = new PreviewService(store, async () => adapter, join(root, 'preview'), () => 3)
    const ok = await preview.render({ templateId, values: { FullName: 'Ana Cruz', Company: 'ACME' }, dpi: 200, pages: [1, 2] })
    expect(ok.pages.map((p) => [p.pageIndex, p.widthPx, p.heightPx])).toEqual([
      [1, 709, 394],
      [2, 709, 394]
    ])
    expect(ok.objects.every((o) => !o.overflow)).toBe(true)
    const started = Date.now()
    const long = await preview.render({ templateId, values: { FullName: 'Maria Concepcion Josefina Dela Cruz-Villanueva Santos' }, dpi: 96, pages: [1] })
    console.log(`Single-page preview render: ${Date.now() - started} ms`)
    expect(long.objects.find((o) => o.name === 'FullName')!.overflow).toBe(true)
    await preview.close(adapter)
  })

  it('generates editable CDR files (X7 format), verifies their content, and protects the template', async () => {
    const out = join(root, 'out')
    const progress: JobProgress[] = []
    const history = new JobHistory(join(root, 'jobs.json'))
    const service = new GenerationService({ store, getAdapter: async () => adapter, history, safeMarginMm: () => 3, onProgress: (p) => progress.push(p) })
    const batch = records(12)

    const started = Date.now()
    await service.start({ templateId, outputDirectory: out, fileNamePattern: '{row} - {col:Full Name}', overwrite: 'suffix', records: batch })
    const summary = (await service.waitForIdle())!
    const ms = Date.now() - started
    console.log('Per-record ms:', progress.filter((p) => p.entry).map((p) => p.entry!.durationMs).join(', '))
    console.log(`Generated ${summary.succeeded} cards in ${ms} ms (${Math.round(ms / summary.total)} ms/card) on ${summary.corelVersion}`)

    expect(summary).toMatchObject({ status: 'completed', total: 12, succeeded: 12, failed: 0 })
    const cdrs = readdirSync(out).filter((f) => f.endsWith('.cdr'))
    expect(cdrs).toHaveLength(12)
    expect(readdirSync(out).some((f) => f.includes('.tmp'))).toBe(false)
    expect(progress.filter((p) => p.entry?.overflow.length).map((p) => p.entry!.rowNumber)).toContain(6) // the long name

    // Reopen two outputs and check the text really is in the CDR.
    // Index 8 comes after the CJK record (index 5): it must still use the template font.
    for (const i of [1, 5, 8]) {
      const file = summary.files[i]!
      const handle = await adapter.openDocument(file)
      try {
        const byName = new Map((await adapter.inspect(handle)).objects.map((o) => [o.name, o.text]))
        expect(byName.get('FullName')).toBe(batch[i]!.values['FullName'])
        expect(byName.get('Company')).toBe('ACME Holdings')
        expect(byName.get('Telephone')).toBe('')
        expect(byName.get('Tagline')).toBe('Bold Regular') // unmapped: untouched
        if (i === 8) expect((await adapter.inspect(handle)).objects.find((o) => o.name === 'FullName')!.font).toBe('Arial')
      } finally {
        await adapter.closeDocument(handle)
      }
    }
    expect(sha(source)).toBe(sourceHash)
    expect(readdirSync(join(root, 'work'))).toEqual([])
  })

  it('repeats a job with suffixes, skips existing files, and records a failed save', async () => {
    const out = join(root, 'out2')
    mkdirSync(join(out, '3 - José Peña-Ñuñez.cdr'), { recursive: true }) // a folder blocks this file name
    const history = new JobHistory(join(root, 'jobs.json'))
    const service = new GenerationService({ store, getAdapter: async () => adapter, history, safeMarginMm: () => 3, onProgress: () => {} })
    const batch = records(3)

    await service.start({ templateId, outputDirectory: out, fileNamePattern: '{row} - {col:Full Name}', overwrite: 'overwrite', records: batch })
    expect((await service.waitForIdle())!).toMatchObject({ succeeded: 2, failed: 1 })

    writeFileSync(join(out, 'marker.txt'), 'x')
    await service.start({ templateId, outputDirectory: out, fileNamePattern: '{row} - {col:Full Name}', overwrite: 'skip', records: batch })
    expect((await service.waitForIdle())!).toMatchObject({ succeeded: 0, skipped: 3 })

    await service.start({ templateId, outputDirectory: out, fileNamePattern: '{row} - {col:Full Name}', overwrite: 'suffix', records: batch })
    expect((await service.waitForIdle())!).toMatchObject({ succeeded: 3 })
    expect(readdirSync(out).filter((f) => f.includes('(2).cdr'))).toHaveLength(3)
  })

  it('cancels a running job between records', async () => {
    const out = join(root, 'out3')
    const history = new JobHistory(join(root, 'jobs.json'))
    let jobId = ''
    const service = new GenerationService({
      store,
      getAdapter: async () => adapter,
      history,
      safeMarginMm: () => 3,
      onProgress: (p) => {
        if (p.succeeded === 2) service.cancel(jobId)
      }
    })
    jobId = (await service.start({ templateId, outputDirectory: out, fileNamePattern: '{row}', overwrite: 'suffix', records: records(10) })).jobId
    const summary = (await service.waitForIdle())!
    expect(summary.status).toBe('cancelled')
    // Cancellation takes effect between records; the record in progress (already saved) is kept.
    expect(summary.succeeded).toBeGreaterThanOrEqual(2)
    expect(summary.succeeded).toBeLessThan(10)
    expect(readdirSync(out).filter((f) => f.endsWith('.cdr'))).toHaveLength(summary.succeeded)
    expect(readdirSync(out).some((f) => f.includes('.tmp'))).toBe(false)
  })
})
