import { execFile } from 'node:child_process'
import { PAPER_SIZES, type PrinterInfo, type PrinterStatus, type SpoolerJob } from '../../../shared/print/types'
import { AppError } from '../../errors'

const QUERY_TIMEOUT_MS = 20_000
const RESPONSE_PREFIX = 'CFB1 '
const STATUSES: readonly PrinterStatus[] = ['ready', 'busy', 'paused', 'offline', 'error', 'unknown']

/** Windows printers and spooler queue. An interface so print tests run without a spooler. */
export interface PrinterApi {
  list(): Promise<PrinterInfo[]>
  /** Jobs currently in the printer's Windows queue. Throws when the queue cannot be read. */
  spoolerJobs(printer: string): Promise<SpoolerJob[]>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parsePrinters(data: unknown): PrinterInfo[] {
  const list = isRecord(data) ? data['printers'] : null
  if (!Array.isArray(list)) throw new AppError('PRINTERS_FAILED', 'Windows returned an unreadable printer list.')
  const out: PrinterInfo[] = []
  for (const p of list) {
    if (!isRecord(p) || typeof p['name'] !== 'string') continue
    const status = STATUSES.includes(p['status'] as PrinterStatus) ? (p['status'] as PrinterStatus) : 'unknown'
    const papers = Array.isArray(p['paperSizes']) ? p['paperSizes'].filter((x): x is string => typeof x === 'string') : []
    out.push({
      name: p['name'],
      isDefault: p['isDefault'] === true,
      status,
      statusDetail: typeof p['statusDetail'] === 'string' ? p['statusDetail'] : '',
      port: typeof p['port'] === 'string' ? p['port'] : '',
      supportsColor: typeof p['supportsColor'] === 'boolean' ? p['supportsColor'] : null,
      // Only the sizes the app can request from CorelDRAW are offered.
      paperSizes: papers.filter((n) => (PAPER_SIZES as readonly string[]).includes(n.trim()))
    })
  }
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
}

export function parseSpoolerJobs(data: unknown): SpoolerJob[] {
  const list = isRecord(data) ? data['jobs'] : null
  if (!Array.isArray(list)) throw new AppError('SPOOLER_FAILED', 'Windows returned an unreadable print queue.')
  const out: SpoolerJob[] = []
  for (const j of list) {
    if (isRecord(j) && typeof j['id'] === 'number') out.push({ id: j['id'], documentName: typeof j['documentName'] === 'string' ? j['documentName'] : '', status: typeof j['status'] === 'string' ? j['status'] : '' })
  }
  return out
}

/** Queries Windows through printers.ps1. The printer name travels Base64-encoded as one argument, never through a shell. */
export class PrinterService implements PrinterApi {
  constructor(private readonly scriptPath: string) {}

  private run(mode: 'list' | 'jobs', printer?: string): Promise<unknown> {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, '-Mode', mode]
    if (printer !== undefined) args.push('-PrinterB64', Buffer.from(printer, 'utf8').toString('base64'))
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', args, { windowsHide: true, timeout: QUERY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const line = stdout.split(/\r?\n/).find((l) => l.startsWith(RESPONSE_PREFIX))
        let payload: unknown = null
        if (line) {
          try {
            payload = JSON.parse(Buffer.from(line.slice(RESPONSE_PREFIX.length), 'base64').toString('utf8'))
          } catch {
            payload = null
          }
        }
        if (isRecord(payload) && typeof payload['error'] === 'string') return reject(new AppError(mode === 'list' ? 'PRINTERS_FAILED' : 'SPOOLER_FAILED', payload['error']))
        if (err || payload === null) return reject(new AppError(mode === 'list' ? 'PRINTERS_FAILED' : 'SPOOLER_FAILED', `Windows did not answer the ${mode === 'list' ? 'printer' : 'print queue'} query. ${(err?.message ?? stderr).slice(0, 200)}`.trim()))
        resolve(payload)
      })
    })
  }

  async list(): Promise<PrinterInfo[]> {
    return parsePrinters(await this.run('list'))
  }

  async spoolerJobs(printer: string): Promise<SpoolerJob[]> {
    return parseSpoolerJobs(await this.run('jobs', printer))
  }
}
