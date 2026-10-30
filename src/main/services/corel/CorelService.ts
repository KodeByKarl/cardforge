import type { CorelStatus } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { log } from '../../logger'
import type { CorelAdapter, CorelConnection } from './CorelAdapter'
import { X7_VERSION, detectCorelDraw } from './detect'
import { PowerShellCorelAdapter } from './PowerShellCorelAdapter'

/** Chooses X7 when registered, otherwise the newest installed CorelDRAW (development/testing on newer versions). */
export function chooseProgId(progIds: string[], override = process.env['CARDFORGE_COREL_PROGID']): string | null {
  // CARDFORGE_COREL_PROGID (e.g. CorelDRAW.Application.27) forces one installed version, for testing on a PC that has several.
  if (override && /^CorelDRAW\.Application\.\d+$/.test(override) && progIds.includes(override)) return override
  const x7 = `CorelDRAW.Application.${X7_VERSION}`
  if (progIds.includes(x7)) return x7
  const sorted = [...progIds].sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()))
  return sorted.at(-1) ?? null
}

/** Owns the single CorelDRAW adapter for the app. Started lazily on first use. */
export class CorelService {
  private adapter: CorelAdapter | null = null
  private connection: CorelConnection | null = null
  private starting: Promise<CorelAdapter> | null = null

  constructor(
    private readonly scriptPath: string,
    private readonly createAdapter: (progId: string, scriptPath: string) => CorelAdapter = (p, s) => new PowerShellCorelAdapter(p, s)
  ) {}

  async status(): Promise<CorelStatus> {
    const detection = await detectCorelDraw()
    const progId = chooseProgId(detection.progIds)
    return {
      available: progId !== null,
      progId,
      isX7: progId === `CorelDRAW.Application.${X7_VERSION}`,
      version: this.connection?.version ?? null,
      detail: detection.detail
    }
  }

  getAdapter(): Promise<CorelAdapter> {
    if (this.adapter) {
      // Reconnects transparently if the bridge restarted.
      return this.adapter.connect().then((c) => {
        this.connection = c
        return this.adapter!
      })
    }
    this.starting ??= this.start().finally(() => (this.starting = null))
    return this.starting
  }

  private async start(): Promise<CorelAdapter> {
    const detection = await detectCorelDraw()
    const progId = chooseProgId(detection.progIds)
    if (!progId) throw new AppError('COREL_NOT_INSTALLED', 'CorelDRAW was not found on this computer. Template inspection, preview and generation need CorelDRAW.')
    const adapter = this.createAdapter(progId, this.scriptPath)
    this.connection = await adapter.connect()
    this.adapter = adapter
    log.info('corel.connected', { progId, version: this.connection.version, x7: progId.endsWith(`.${X7_VERSION}`) })
    return adapter
  }

  get version(): string | null {
    return this.connection?.version ?? null
  }

  async dispose(): Promise<void> {
    const adapter = this.adapter
    this.adapter = null
    this.connection = null
    await adapter?.dispose()
  }
}
