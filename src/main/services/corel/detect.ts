import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import type { CorelDetection } from '../../../shared/types'

/** CorelDRAW X7's internal version number; its COM ProgID is "CorelDRAW.Application.17". */
export const X7_VERSION = 17
const VERSION_RANGE = Array.from({ length: 16 }, (_, i) => X7_VERSION + i) // 17 (X7) … 32

/** Reads the (Default) value of a registry key, or null when the key doesn't exist. */
function readDefault(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    // execFile with an argument array: no shell, so the key can't be used for injection.
    execFile('reg.exe', ['query', key, '/ve'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null)
      const match = /REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(stdout)
      resolve(match?.[1]?.trim() ?? '')
    })
  })
}

/** Extracts the executable path from a LocalServer32 command line like `"C:\…\CorelDRW.exe" /Automation`. */
export function serverExecutable(commandLine: string): string {
  const quoted = /^"([^"]+)"/.exec(commandLine.trim())
  if (quoted?.[1]) return quoted[1]
  return commandLine.trim().split(/\s+\//)[0] ?? ''
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Returns the ProgID's server exe if the registration is intact and the exe exists on disk. */
async function resolveServer(progId: string): Promise<{ progId: string; exe: string; present: boolean } | null> {
  const clsid = await readDefault(`HKCR\\${progId}\\CLSID`)
  if (!clsid) return null
  const command = await readDefault(`HKCR\\CLSID\\${clsid}\\LocalServer32`)
  const exe = command ? serverExecutable(command) : ''
  return { progId, exe, present: exe !== '' && (await exists(exe)) }
}

/**
 * Detects CorelDRAW COM registrations and checks that each registered server executable exists.
 * A working registration means the COM server can be started; it does NOT prove automation works for
 * this edition/licence. That is only proven by the proof-of-concept script (see CORELDRAW_INTEGRATION.md).
 */
export async function detectCorelDraw(): Promise<CorelDetection> {
  if (process.platform !== 'win32') {
    return { installed: false, progIds: [], x7Registered: false, detail: 'CorelDRAW automation requires Windows.' }
  }
  const results = await Promise.all(VERSION_RANGE.map((v) => resolveServer(`CorelDRAW.Application.${v}`)))
  const registered = results.filter((r): r is NonNullable<typeof r> => r !== null)
  const working = registered.filter((r) => r.present)
  const stale = registered.filter((r) => !r.present)
  const progIds = working.map((r) => r.progId)
  const x7Registered = progIds.includes(`CorelDRAW.Application.${X7_VERSION}`)

  let detail: string
  if (x7Registered) detail = 'CorelDRAW X7 is installed and registered for automation. Run the integration check to confirm automation works.'
  else if (working.length > 0) detail = `CorelDRAW is installed, but not X7: found ${progIds.join(', ')}. The client's production version is X7 (17).`
  else detail = 'CorelDRAW was not found on this computer.'
  if (stale.length > 0) detail += ` Stale registrations with a missing program file: ${stale.map((s) => s.progId).join(', ')}.`

  return { installed: working.length > 0, progIds, x7Registered, detail }
}
