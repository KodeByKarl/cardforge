import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BridgeProcess } from '../src/main/services/corel/BridgeProcess'

const FAKE = resolve(__dirname, 'fixtures/fake-bridge.mjs')
let bridge: BridgeProcess | null = null

function fake(...extra: string[]): BridgeProcess {
  bridge = new BridgeProcess({ command: process.execPath, args: [FAKE, ...extra], startupTimeoutMs: 5000 })
  return bridge
}

afterEach(() => {
  bridge?.kill()
  bridge = null
})

describe('BridgeProcess', () => {
  it('round-trips Unicode payloads through the base64 line protocol', async () => {
    const b = fake()
    const payload = { name: 'José Peña-Ñuñez 王小明', address: 'Line 1\nLine 2', emoji: '📇' }
    expect(await b.call('echo', payload, 5000)).toEqual(payload)
  })

  it('ignores non-protocol output lines', async () => {
    const b = fake()
    expect(await b.call<{ pid: number }>('noise', {}, 5000)).toHaveProperty('pid')
  })

  it('propagates bridge errors with their code and keeps working', async () => {
    const b = fake()
    await expect(b.call('fail', {}, 5000)).rejects.toMatchObject({ code: 'COREL_ERROR', message: 'Simulated failure' })
    expect(await b.call('echo', { ok: 1 }, 5000)).toEqual({ ok: 1 })
  })

  it('serialises concurrent calls in order', async () => {
    const b = fake()
    const results = await Promise.all([b.call('sleep', { ms: 60 }, 5000), b.call('echo', { n: 2 }, 5000), b.call('sleep', { ms: 10 }, 5000)])
    expect(results).toEqual([{ slept: 60 }, { n: 2 }, { slept: 10 }])
  })

  it('times out, kills the process, and restarts it on the next call', async () => {
    const b = fake()
    const { pid: before } = await b.call<{ pid: number }>('pid', {}, 5000)
    const gen = b.generation
    await expect(b.call('sleep', { ms: 2000 }, 100)).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' })
    expect(b.running).toBe(false)
    const { pid: after } = await b.call<{ pid: number }>('pid', {}, 5000)
    expect(after).not.toBe(before)
    expect(b.generation).toBe(gen + 1)
  })

  it('rejects the pending call when the process crashes, then recovers', async () => {
    const b = fake()
    await b.call('echo', {}, 5000)
    await expect(b.call('crash', {}, 5000)).rejects.toMatchObject({ code: 'BRIDGE_EXITED' })
    expect(await b.call('echo', { again: true }, 5000)).toEqual({ again: true })
  })

  it('fails clearly when the bridge never becomes ready or cannot start', async () => {
    const slow = new BridgeProcess({ command: process.execPath, args: [FAKE, '--never-ready'], startupTimeoutMs: 300 })
    bridge = slow
    await expect(slow.call('echo', {}, 5000)).rejects.toMatchObject({ code: 'BRIDGE_START_FAILED' })
    const missing = new BridgeProcess({ command: 'definitely-not-a-real-program-xyz.exe', args: [] })
    await expect(missing.call('echo', {}, 5000)).rejects.toMatchObject({ code: 'BRIDGE_START_FAILED' })
  })

  it('shuts down gracefully', async () => {
    const b = fake()
    await b.call('echo', {}, 5000)
    await b.shutdown(2000)
    expect(b.running).toBe(false)
  })
})
