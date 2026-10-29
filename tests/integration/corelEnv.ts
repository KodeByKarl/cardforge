import { copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { detectCorelDraw } from '../../src/main/services/corel/detect'
import { PowerShellCorelAdapter } from '../../src/main/services/corel/PowerShellCorelAdapter'

export const FIXTURE = resolve(__dirname, '../fixtures/test-card-front-back.cdr')
export const BRIDGE_SCRIPT = resolve(__dirname, '../../resources/corel/corel-bridge.ps1')
export const TMP = resolve(__dirname, '../.tmp/integration')

/** Picks X7 when registered, otherwise the newest installed CorelDRAW. Override with CARDFORGE_COREL_PROGID. */
export async function corelProgId(): Promise<string | null> {
  if (process.env['CARDFORGE_COREL_PROGID']) return process.env['CARDFORGE_COREL_PROGID']
  const detection = await detectCorelDraw()
  if (!detection.installed) return null
  return detection.x7Registered ? 'CorelDRAW.Application.17' : (detection.progIds.at(-1) ?? null)
}

export function createAdapter(progId: string): PowerShellCorelAdapter {
  return new PowerShellCorelAdapter(progId, BRIDGE_SCRIPT)
}

/** A fresh copy of the fixture: tests never open the fixture itself. */
export function workingCopy(): string {
  mkdirSync(TMP, { recursive: true })
  const path = join(TMP, `work-${randomUUID()}.cdr`)
  copyFileSync(FIXTURE, path)
  return path
}
