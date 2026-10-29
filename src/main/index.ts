import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { IPC_EVENTS } from '../shared/ipc'
import { registerIpc } from './ipc'
import { initLogger, log } from './logger'
import { CorelService } from './services/corel/CorelService'
import { GenerationService } from './services/generation/GenerationService'
import { JobHistory } from './services/generation/JobHistory'
import { PreviewService } from './services/preview/PreviewService'
import { TemplateStore } from './services/templates/TemplateStore'
import { SettingsStore } from './settings'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'CardForge',
    autoHideMenuBar: true,
    backgroundColor: '#f6f6f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // The renderer is a single-page app: never navigate away or open in-app windows.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/** The bridge script must live outside app.asar: powershell.exe cannot read files inside the archive. */
function bridgeScriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'corel', 'corel-bridge.ps1') : join(app.getAppPath(), 'resources', 'corel', 'corel-bridge.ps1')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  let services: { corel: CorelService; preview: PreviewService; generation: GenerationService } | null = null

  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    initLogger(join(userData, 'logs'))
    log.info('app.start', { version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged })

    const settings = new SettingsStore(join(userData, 'settings.json'))
    await settings.load()
    const corel = new CorelService(bridgeScriptPath())
    const getAdapter = () => corel.getAdapter()
    const templates = new TemplateStore(join(userData, 'templates'), join(app.getPath('temp'), 'CardForge', 'work'), getAdapter)
    const preview = new PreviewService(templates, getAdapter, join(app.getPath('temp'), 'CardForge', 'preview'), () => settings.get().safeMarginMm)
    const history = new JobHistory(join(userData, 'jobs.json'))
    const generation = new GenerationService({
      store: templates,
      getAdapter,
      history,
      safeMarginMm: () => settings.get().safeMarginMm,
      onProgress: (progress) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC_EVENTS.generationProgress, progress)
      }
    })
    services = { corel, preview, generation }
    registerIpc({ settings, corel, templates, preview, generation, history })
    createWindow()
  })

  // Close our CorelDRAW documents (and CorelDRAW itself, if we started it and nothing else is open) before exit.
  let shuttingDown = false
  app.on('will-quit', (event) => {
    if (shuttingDown || !services) return
    event.preventDefault()
    shuttingDown = true
    const s = services
    const finish = async () => {
      const running = s.generation.activeJobId
      if (running) s.generation.cancel(running)
      await s.generation.waitForIdle()
      await s.preview.close()
      await s.corel.dispose()
    }
    void Promise.race([finish(), new Promise((r) => setTimeout(r, 20_000))])
      .catch((err) => log.error('app.shutdown_failed', { error: err }))
      .finally(() => app.exit(0))
  })

  app.on('window-all-closed', () => app.quit())

  process.on('uncaughtException', (err) => log.error('process.uncaught_exception', { error: err }))
  process.on('unhandledRejection', (reason) => log.error('process.unhandled_rejection', { error: reason }))
}
