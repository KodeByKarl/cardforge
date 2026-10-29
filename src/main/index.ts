import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { registerIpc } from './ipc'
import { initLogger, log } from './logger'
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

  void app.whenReady().then(async () => {
    initLogger(join(app.getPath('userData'), 'logs'))
    log.info('app.start', { version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged })

    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    await settings.load()
    registerIpc(settings)
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())

  process.on('uncaughtException', (err) => log.error('process.uncaught_exception', { error: err }))
  process.on('unhandledRejection', (reason) => log.error('process.unhandled_rejection', { error: reason }))
}
