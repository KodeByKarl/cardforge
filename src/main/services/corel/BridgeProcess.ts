import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { AppError } from '../../errors'
import { log } from '../../logger'

const RESPONSE_PREFIX = 'CFB1 '

interface Pending {
  id: number
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

interface Response {
  id: number
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}

export interface BridgeOptions {
  command: string
  args: string[]
  startupTimeoutMs?: number
}

/**
 * Client for the line protocol spoken by corel-bridge.ps1 (see its header).
 * Calls are serialised: the bridge handles one request at a time, and a call's timeout only starts
 * when it is actually sent. A timeout kills the process (its state is unknown); the next call restarts it.
 */
export class BridgeProcess {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 1
  private stderrTail = ''
  /** Increments on every (re)start so callers can detect that per-process state (doc handles) was lost. */
  generation = 0

  constructor(private readonly options: BridgeOptions) {}

  call<T>(cmd: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const run = this.queue.then(() => this.send<T>(cmd, args, timeoutMs))
    this.queue = run.catch(() => undefined)
    return run
  }

  get running(): boolean {
    return this.proc !== null
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.generation++
    const proc = spawn(this.options.command, this.options.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    this.stderrTail = ''

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AppError('BRIDGE_START_FAILED', 'The CorelDRAW bridge did not start in time.'))
        this.kill()
      }, this.options.startupTimeoutMs ?? 30_000)

      proc.once('error', (err) => {
        clearTimeout(timer)
        this.handleExit(proc, `could not be started: ${err.message}`)
        reject(new AppError('BRIDGE_START_FAILED', `The CorelDRAW bridge could not be started: ${err.message}`, err))
      })

      createInterface({ input: proc.stdout }).on('line', (line) => {
        if (!line.startsWith(RESPONSE_PREFIX)) {
          if (line.trim()) log.debug('bridge.stdout_noise', { line: line.slice(0, 300) })
          return
        }
        let response: Response
        try {
          response = JSON.parse(Buffer.from(line.slice(RESPONSE_PREFIX.length), 'base64').toString('utf8')) as Response
        } catch (err) {
          log.error('bridge.bad_response', { error: err })
          return
        }
        if (this.proc !== proc) return // a late line from a process we already replaced
        if (response.id === 0) {
          clearTimeout(timer)
          resolve()
          return
        }
        const p = this.pending
        if (!p || p.id !== response.id) {
          log.warn('bridge.unexpected_response', { id: response.id })
          return
        }
        this.pending = null
        clearTimeout(p.timer)
        if (response.ok) p.resolve(response.data)
        else p.reject(new AppError(response.error?.code ?? 'COREL_ERROR', response.error?.message ?? 'CorelDRAW reported an error.'))
      })

      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-2000)
      })

      proc.once('exit', (code) => {
        clearTimeout(timer)
        reject(new AppError('BRIDGE_EXITED', `The CorelDRAW bridge exited during startup (code ${code}). ${this.stderrTail}`.trim()))
        this.handleExit(proc, `exited with code ${code}`)
      })
    })
    return this.ready
  }

  /** Ignores events from a process that has already been replaced by a restart. */
  private handleExit(proc: ChildProcessWithoutNullStreams, reason: string): void {
    if (this.proc !== proc) return
    log.warn('bridge.exit', { reason, stderr: this.stderrTail.slice(-500) })
    this.proc = null
    this.ready = null
    const p = this.pending
    this.pending = null
    if (p) {
      clearTimeout(p.timer)
      p.reject(new AppError('BRIDGE_EXITED', `The CorelDRAW bridge stopped unexpectedly (${reason}).`))
    }
  }

  private async send<T>(cmd: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
    await this.start()
    const proc = this.proc
    if (!proc) throw new AppError('BRIDGE_EXITED', 'The CorelDRAW bridge is not running.')
    const id = this.nextId++
    const line = Buffer.from(JSON.stringify({ id, cmd, args }), 'utf8').toString('base64')
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return
        this.pending = null
        log.error('bridge.timeout', { cmd, timeoutMs })
        this.kill()
        reject(new AppError('BRIDGE_TIMEOUT', `CorelDRAW did not respond within ${Math.round(timeoutMs / 1000)} s (${cmd}). It may be showing a dialog.`))
      }, timeoutMs)
      this.pending = { id, resolve: resolve as (d: unknown) => void, reject, timer }
      proc.stdin.write(line + '\n')
    })
  }

  /** Asks the bridge to close its documents and exit; kills it if it doesn't within the timeout. */
  async shutdown(timeoutMs = 15_000): Promise<void> {
    if (!this.proc) return
    try {
      await this.call('shutdown', {}, timeoutMs)
    } catch {
      // Already gone or unresponsive.
    }
    this.kill()
  }

  kill(): void {
    const proc = this.proc
    if (!proc) return
    this.handleExit(proc, 'killed')
    proc.stdin.destroy()
    proc.kill()
  }
}
