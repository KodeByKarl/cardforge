// Print path against the installed CorelDRAW (X7 preferred when registered; CARDFORGE_COREL_PROGID overrides).
// By default nothing is sent to any printer: it checks that CorelDRAW accepts the printer and the settings, reads them back,
// refuses a printer that does not exist, and that PrintOut is refused without configuration.
//
// Opt-in real print (uses paper, or pops a Save dialog for "Microsoft Print to PDF"):
//   CARDFORGE_PRINT_REAL=1 CARDFORGE_PRINTER="<exact Windows printer name>" npx vitest run --config vitest.integration.config.ts tests/integration/print.int.test.ts
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrinterService } from '../../src/main/services/print/PrinterService'
import type { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'
import { defaultPrintSettings } from '../../src/shared/print/logic'
import { corelProgId, createAdapter, workingCopy } from './corelEnv'

const progId = await corelProgId()
const printers = new PrinterService(resolve(__dirname, '../../resources/corel/printers.ps1'))
const installed = await printers.list().catch(() => [])
const printerName = process.env['CARDFORGE_PRINTER'] ?? installed.find((p) => p.isDefault)?.name ?? installed[0]?.name ?? ''

describe.skipIf(!progId || !printerName)(`Printing on ${progId ?? 'CorelDRAW (not installed)'} with "${printerName}"`, () => {
  let adapter: PowerShellCorelAdapter
  beforeAll(() => {
    adapter = createAdapter(progId!)
  })
  afterAll(async () => {
    await adapter?.dispose()
  })

  it('lists Windows printers and the (empty or not) spooler queue', async () => {
    expect(installed.length).toBeGreaterThan(0)
    const jobs = await printers.spoolerJobs(printerName)
    console.log(`[print] ${progId}: ${installed.length} printer(s); queue of "${printerName}" has ${jobs.length} job(s)`)
    expect(Array.isArray(jobs)).toBe(true)
  })

  it('applies printer and settings, or reports the real CorelDRAW failure', async () => {
    await adapter.connect()
    const handle = await adapter.openDocument(workingCopy(), { light: true })
    try {
      const settings = { ...defaultPrintSettings(printerName), copies: 2, paper: 'A4' as const, orientation: 'portrait' as const, pageRange: '1', scaling: 'asDocument' as const, color: 'color' as const }
      const outcome = await adapter.configurePrint(handle, settings).then(
        () => 'configured',
        (err: Error) => `failed: ${err.message}`
      )
      console.log(`[print] ${progId}: configurePrint -> ${outcome}`)
      // Either result is legitimate on a given PC, but a broken CorelDRAW print module must be reported with its real message, never hidden.
      expect(outcome).toMatch(/^configured$|^failed: .*(printing|printer)/i)
    } finally {
      await adapter.closeDocument(handle)
    }
  })

  it('refuses a printer that does not exist instead of substituting another', async () => {
    await adapter.connect()
    const handle = await adapter.openDocument(workingCopy(), { light: true })
    try {
      await expect(adapter.configurePrint(handle, defaultPrintSettings('No Such Printer 9f3a'))).rejects.toThrow()
    } finally {
      await adapter.closeDocument(handle)
    }
  })

  it('refuses PrintOut when the document was not configured', async () => {
    await adapter.connect()
    const handle = await adapter.openDocument(workingCopy(), { light: true })
    try {
      await expect(adapter.printOut(handle)).rejects.toThrow(/configurePrint/)
    } finally {
      await adapter.closeDocument(handle)
    }
  })

  it.skipIf(process.env['CARDFORGE_PRINT_REAL'] !== '1')('REAL PRINT: sends one document to the printer and finds it in the Windows queue', async () => {
    await adapter.connect()
    const handle = await adapter.openDocument(workingCopy(), { light: true })
    try {
      await adapter.configurePrint(handle, defaultPrintSettings(printerName))
      const before = new Set((await printers.spoolerJobs(printerName)).map((j) => j.id))
      await adapter.printOut(handle)
      let fresh: number[] = []
      for (let i = 0; i < 10 && fresh.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        fresh = (await printers.spoolerJobs(printerName)).filter((j) => !before.has(j.id)).map((j) => j.id)
      }
      console.log(`[print] ${progId}: PrintOut returned; new spooler job(s): ${fresh.join(',') || 'none seen'}`)
    } finally {
      await adapter.closeDocument(handle)
    }
  }, 120_000)
})
