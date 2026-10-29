import type { ApplyResult, ExportedPage, ShapeValues, TemplateInspection } from '../../../shared/template/types'
import { AppError } from '../../errors'
import { BridgeProcess } from './BridgeProcess'
import type { CorelAdapter, CorelConnection, DocHandle } from './CorelAdapter'

const CONNECT_TIMEOUT_MS = 180_000 // first CorelDRAW start can be slow
const DOC_TIMEOUT_MS = 120_000
const CALL_TIMEOUT_MS = 60_000

/**
 * Real CorelDRAW adapter: drives resources/corel/corel-bridge.ps1 in Windows PowerShell 5.1 over COM.
 * Verified against CorelDRAW v27.2. X7 (v17) compatibility is pending validation on the client's machine.
 */
export class PowerShellCorelAdapter implements CorelAdapter {
  readonly kind = 'real' as const
  private readonly bridge: BridgeProcess
  private connection: CorelConnection | null = null
  private connectedGeneration = -1

  constructor(
    private readonly progId: string,
    scriptPath: string,
    bridge?: BridgeProcess
  ) {
    this.bridge =
      bridge ??
      new BridgeProcess({
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
      })
  }

  async connect(): Promise<CorelConnection> {
    if (this.connection && this.connectedGeneration === this.bridge.generation && this.bridge.running) return this.connection
    const result = await this.bridge.call<{ version: string; progId: string }>('connect', { progId: this.progId }, CONNECT_TIMEOUT_MS)
    this.connection = { version: result.version, progId: result.progId }
    this.connectedGeneration = this.bridge.generation
    return this.connection
  }

  /** Handles carry the bridge generation so a handle from before a crash/restart is rejected clearly. */
  private unwrap(handle: DocHandle): string {
    const [gen, inner] = handle.split(':')
    if (Number(gen) !== this.bridge.generation || !this.bridge.running || !inner) {
      throw new AppError('COREL_RESTARTED', 'CorelDRAW was restarted; the document must be reopened.')
    }
    return inner
  }

  async openDocument(path: string): Promise<DocHandle> {
    await this.connect()
    const { handle } = await this.bridge.call<{ handle: string }>('openDoc', { path }, DOC_TIMEOUT_MS)
    return `${this.bridge.generation}:${handle}`
  }

  async closeDocument(handle: DocHandle): Promise<void> {
    let inner: string
    try {
      inner = this.unwrap(handle)
    } catch {
      return // the process holding it is gone
    }
    await this.bridge.call('closeDoc', { handle: inner }, CALL_TIMEOUT_MS)
  }

  async inspect(handle: DocHandle): Promise<TemplateInspection> {
    return this.bridge.call<TemplateInspection>('inspect', { handle: this.unwrap(handle) }, DOC_TIMEOUT_MS)
  }

  async applyText(handle: DocHandle, values: ShapeValues, safeMarginMm: number): Promise<ApplyResult> {
    return this.bridge.call<ApplyResult>('apply', { handle: this.unwrap(handle), values, safeMarginMm }, CALL_TIMEOUT_MS)
  }

  async exportPages(handle: DocHandle, options: { dir: string; prefix: string; dpi: number; pages: number[] }): Promise<ExportedPage[]> {
    const { files } = await this.bridge.call<{ files: ExportedPage[] }>('exportPages', { handle: this.unwrap(handle), ...options }, CALL_TIMEOUT_MS)
    return files
  }

  async saveAs(handle: DocHandle, path: string, fileVersion: number): Promise<void> {
    await this.bridge.call('saveAs', { handle: this.unwrap(handle), path, version: fileVersion }, DOC_TIMEOUT_MS)
  }

  async dispose(): Promise<void> {
    this.connection = null
    await this.bridge.shutdown()
  }
}
