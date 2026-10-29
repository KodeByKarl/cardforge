import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { IPC } from '../shared/ipc'
import type { IpcResult } from '../shared/types'
import { AppError } from './errors'
import { getLogDirectory, log } from './logger'
import { detectCorelDraw } from './services/corel/detect'
import { openWorkbook, readSheet } from './services/excel/excelReader'
import type { SettingsStore } from './settings'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

/** Only frames loaded from our own bundle (or the dev server) may call IPC. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl))
}

function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(event)) {
      log.warn('ipc.untrusted_sender', { channel, url: event.senderFrame?.url })
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Request rejected.' } }
    }
    try {
      return { ok: true, data: await handler(event, ...args) }
    } catch (err) {
      if (err instanceof AppError) {
        log.warn('ipc.handled_error', { channel, code: err.code, message: err.message, cause: err.cause })
        return { ok: false, error: { code: err.code, message: err.message } }
      }
      log.error('ipc.unexpected_error', { channel, error: err })
      return { ok: false, error: { code: 'UNEXPECTED', message: 'An unexpected error occurred. Details were written to the log file.' } }
    }
  })
}

export function registerIpc(settings: SettingsStore): void {
  // readSheet only accepts files the user explicitly opened in this session.
  const openedSpreadsheets = new Set<string>()

  handle(IPC.excelPickFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Select employee spreadsheet',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'csv'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.excelOpen, async (_event, filePath) => {
    const info = await openWorkbook(filePath)
    openedSpreadsheets.add(info.filePath)
    log.info('excel.opened', { file: info.fileName, format: info.format, sheets: info.sheets.length, bytes: info.sizeBytes })
    return info
  })

  handle(IPC.excelReadSheet, async (_event, filePath, sheetName) => {
    if (typeof filePath !== 'string' || !openedSpreadsheets.has(filePath)) {
      throw new AppError('NOT_OPENED', 'Open the spreadsheet before reading its worksheets.')
    }
    const data = await readSheet(filePath, sheetName)
    log.info('excel.sheet_read', { sheet: data.sheetName, rows: data.rows.length, truncated: data.truncated })
    return data
  })

  handle(IPC.settingsGet, async () => settings.get())
  handle(IPC.settingsUpdate, async (_event, patch) => settings.update(patch))

  handle(IPC.settingsPickOutputDir, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Select default output folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    await settings.update({ outputDirectory: result.filePaths[0] })
    return result.filePaths[0]
  })

  handle(IPC.corelDetect, async () => {
    const detection = await detectCorelDraw()
    log.info('corel.detect', { ...detection })
    return detection
  })

  handle(IPC.appInfo, async () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userDataPath: app.getPath('userData'),
    logDirectory: getLogDirectory() ?? ''
  }))

  handle(IPC.appOpenLogs, async () => {
    const dir = getLogDirectory()
    if (!dir) throw new AppError('NO_LOGS', 'Logging is not initialised.')
    const error = await shell.openPath(dir)
    if (error) throw new AppError('OPEN_FAILED', error)
  })
}
