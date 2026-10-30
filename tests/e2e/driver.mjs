// Minimal Chrome-DevTools-Protocol driver for the real Electron app (no extra dependencies).
// Used by the e2e suite and by the visual audit script.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FIXTURES = join(ROOT, 'tests', 'fixtures')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ port = 9333, scale = 1, width = 1366, height = 768, userData } = {}) {
  const dir = userData ?? mkdtempSync(join(tmpdir(), 'cardforge-e2e-'))
  const env = { ...process.env, CARDFORGE_USER_DATA: dir }
  delete env.ELECTRON_RUN_AS_NODE // inherited as 1 from VS Code, which would make Electron behave as plain Node
  // CARDFORGE_EXE runs the packaged application (release/<version>/win-unpacked/CardForge.exe or an installed copy).
  const packaged = process.env.CARDFORGE_EXE
  const exe = packaged ?? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const proc = spawn(exe, [...(packaged ? [] : [ROOT]), `--remote-debugging-port=${port}`, `--force-device-scale-factor=${scale}`], { env, stdio: 'ignore' })
  let version
  for (let i = 0; i < 100; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      break
    } catch {
      await sleep(200)
    }
  }
  if (!version) throw new Error('Electron did not expose the debugging port')
  let target
  for (let i = 0; i < 50 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    target = list.find((t) => t.type === 'page')
    if (!target) await sleep(200)
  }
  const listeners = []
  const connect = async (url) => {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })
    let id = 0
    const pending = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(`${msg.error.message}`)) : res(msg.result)
      } else if (msg.method) listeners.forEach((l) => l(msg))
    }
    return (method, params = {}) =>
      new Promise((res, rej) => {
        const myId = ++id
        pending.set(myId, { res, rej })
        ws.send(JSON.stringify({ id: myId, method, params }))
      })
  }
  const send = await connect(target.webSocketDebuggerUrl)

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')
  const consoleErrors = []
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  })

  const app = {
    proc,
    dir,
    consoleErrors,
    send,
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    /** Electron does not implement Browser.setWindowBounds, so the layout viewport is emulated at the requested size. */
    async setWindow(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: false })
      await sleep(350)
    },
    /** Viewport size in CSS px as the page sees it. */
    viewport: () => app.eval('({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})'),
    async screenshot(file) {
      mkdirSync(dirname(file), { recursive: true })
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(file, Buffer.from(data, 'base64'))
    },
    async click(selector) {
      const ok = await app.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true })()`)
      if (!ok) throw new Error(`click: no element for ${selector}`)
      await sleep(120)
    },
    /** Clicks the first element whose text matches (role-scoped when given). */
    async clickText(text, scope = 'button, [role=tab], [role=menuitem], a') {
      const ok = await app.eval(`(() => {
        const e = [...document.querySelectorAll(${JSON.stringify(scope)})].find((n) => n.textContent.trim().includes(${JSON.stringify(text)}) && !n.disabled)
        if (!e) return false; e.click(); return true })()`)
      if (!ok) throw new Error(`clickText: nothing matching "${text}"`)
      await sleep(150)
    },
    async key(key, { ctrl = false, shift = false } = {}) {
      const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0)
      const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, ' ': 32 }
      const vk = codes[key] ?? key.toUpperCase().charCodeAt(0)
      const text = key.length === 1 ? key : key === 'Enter' ? '\r' : ''
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: vk, modifiers, text })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: vk, modifiers })
      await sleep(120)
    },
    async waitFor(predicateExpr, timeout = 15000, label = predicateExpr) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        try {
          if (await app.eval(predicateExpr)) return
        } catch {
          /* page may be mid-navigation */
        }
        await sleep(150)
      }
      throw new Error(`Timed out waiting for: ${label}`)
    },
    /** Drops a real file on the element matching `selector` (the app reads its path through webUtils). */
    async dropFile(selector, filePath) {
      const r = await app.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2} })()`)
      const data = { items: [{ mimeType: 'text/plain', data: '' }], files: [filePath], dragOperationsMask: 1 }
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, x: r.x, y: r.y, data })
      await sleep(300)
    },
    async close() {
      try {
        await send('Runtime.evaluate', { expression: 'window.close()' })
      } catch {
        /* already gone */
      }
      await sleep(500)
      proc.kill()
    }
  }
  await app.setWindow(width, height)
  await app.waitFor("document.querySelector('#root')?.children.length > 0", 20000, 'app to render')
  return app
}
