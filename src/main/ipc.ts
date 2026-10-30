import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC, IPC_EVENTS } from '../shared/ipc'
import type { IpcResult } from '../shared/types'
import { AppError } from './errors'
import { getLogDirectory, log } from './logger'
import type { CorelService } from './services/corel/CorelService'
import { runCompatibilityCheck } from './services/corel/CompatibilityCheck'
import { detectCorelDraw } from './services/corel/detect'
import { openWorkbook, readSheet } from './services/excel/excelReader'
import type { GenerationService } from './services/generation/GenerationService'
import type { SheetGenerationService } from './services/generation/SheetGenerationService'
import type { JobHistory } from './services/generation/JobHistory'
import type { PresetStore } from './services/print/PresetStore'
import type { PrintService } from './services/print/PrintService'
import type { PrinterApi } from './services/print/PrinterService'
import type { PreviewService } from './services/preview/PreviewService'
import type { TemplateStore } from './services/templates/TemplateStore'
import type { SettingsStore } from './settings'
import { parseId } from './validation'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

export interface Services {
  settings: SettingsStore
  corel: CorelService
  templates: TemplateStore
  preview: PreviewService
  generation: GenerationService
  sheetGeneration: SheetGenerationService
  history: JobHistory
  print: PrintService
  printers: PrinterApi
  presets: PresetStore
}

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

async function pickPath(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function openPath(path: string): Promise<void> {
  const error = await shell.openPath(path)
  if (error) throw new AppError('OPEN_FAILED', error)
}

export function registerIpc(services: Services): void {
  const { settings, corel, templates, preview, generation, sheetGeneration, history, print, printers, presets } = services
  const assertIdle = () => {
    if (generation.activeJobId || sheetGeneration.activeJobId) throw new AppError('JOB_RUNNING', 'A generation job is already running. Wait for it to finish or cancel it.')
  }
  // readSheet only accepts files the user explicitly opened in this session.
  const openedSpreadsheets = new Set<string>()

  handle(IPC.excelPickFile, (event) =>
    pickPath(event, { title: 'Select employee spreadsheet', properties: ['openFile'], filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'csv'] }] })
  )

  handle(IPC.excelOpen, async (_event, filePath) => {
    const info = await openWorkbook(filePath)
    openedSpreadsheets.add(info.filePath)
    log.info('excel.opened', { file: info.fileName, format: info.format, sheets: info.sheets.length, bytes: info.sizeBytes })
    return info
  })

  handle(IPC.excelReadSheet, async (event, filePath, sheetName) => {
    if (typeof filePath !== 'string' || !openedSpreadsheets.has(filePath)) {
      throw new AppError('NOT_OPENED', 'Open the spreadsheet before reading its worksheets.')
    }
    const data = await readSheet(filePath, sheetName, (phase, done, total) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.excelProgress, { phase, done, total })
    })
    log.info('excel.sheet_read', { sheet: data.sheetName, rows: data.rows.length, truncated: data.truncated })
    return data
  })

  handle(IPC.settingsGet, async () => settings.get())
  handle(IPC.settingsUpdate, async (_event, patch) => settings.update(patch))
  handle(IPC.settingsPickOutputDir, async (event) => {
    const dir = await pickPath(event, { title: 'Select default output folder', properties: ['openDirectory', 'createDirectory'] })
    if (dir) await settings.update({ outputDirectory: dir })
    return dir
  })

  handle(IPC.corelDetect, async () => {
    const detection = await detectCorelDraw()
    log.info('corel.detect', { ...detection })
    return detection
  })
  handle(IPC.corelStatus, () => corel.status())
  handle(IPC.corelCompat, async () => {
    assertIdle()
    await preview.close(await corel.getAdapter())
    const sample = app.isPackaged ? join(process.resourcesPath, 'samples', 'compat-sheet.cdr') : join(app.getAppPath(), 'resources', 'samples', 'compat-sheet.cdr')
    const report = await runCompatibilityCheck(await corel.getAdapter(), sample, join(app.getPath('temp'), 'CardForge', 'compat'), join(app.getPath('userData'), 'reports'))
    log.info('corel.compat', { passed: report.passed, version: report.version, failed: report.steps.filter((s) => !s.ok).map((s) => s.name) })
    return report
  })

  handle(IPC.templatesList, () => templates.list())
  handle(IPC.templatesGet, (_event, id) => templates.get(parseId(id)))
  handle(IPC.templatesPickAndImport, async (event) => {
    const path = await pickPath(event, { title: 'Select CorelDRAW template', properties: ['openFile'], filters: [{ name: 'CorelDRAW', extensions: ['cdr'] }] })
    return path ? templates.import(path) : null
  })
  handle(IPC.templatesImport, (_event, path) => templates.import(path))
  handle(IPC.templatesReinspect, async (_event, id) => {
    const record = await templates.reinspect(parseId(id))
    await preview.invalidate(record.id, await corel.getAdapter())
    return record
  })
  handle(IPC.templatesRemove, async (_event, id) => {
    await preview.invalidate(parseId(id))
    await templates.remove(parseId(id))
  })
  handle(IPC.templatesRename, (_event, id, name) => templates.rename(parseId(id), name))
  handle(IPC.templatesSaveMapping, (_event, id, mapping) => templates.saveMapping(parseId(id), mapping))
  handle(IPC.templatesAnalyzeSheet, (_event, id, options) => templates.analyzeSheet(parseId(id), options))
  handle(IPC.templatesPrepareSheet, async (_event, id, options) => {
    await preview.invalidate(parseId(id), await corel.getAdapter())
    const record = await templates.prepareSheet(parseId(id), options)
    await preview.invalidate(record.id)
    return record
  })
  handle(IPC.templatesRevertSheet, async (_event, id) => {
    await preview.invalidate(parseId(id), await corel.getAdapter())
    const record = await templates.revertSheet(parseId(id))
    await preview.invalidate(record.id)
    return record
  })
  handle(IPC.templatesSaveSheetMapping, (_event, id, mapping) => templates.saveSheetMapping(parseId(id), mapping))
  handle(IPC.templatesMissingFonts, (_event, id) => templates.missingFonts(parseId(id)))
  handle(IPC.templatesSourceStatus, (_event, id) => templates.sourceStatus(parseId(id)))
  handle(IPC.templatesPageImages, (_event, id) => templates.pageImages(parseId(id)))

  handle(IPC.previewRender, (_event, request) => preview.render(request))

  handle(IPC.generationPickOutputDir, (event) =>
    pickPath(event, { title: 'Select output folder', properties: ['openDirectory', 'createDirectory'], defaultPath: settings.get().outputDirectory ?? undefined })
  )
  handle(IPC.generationPlan, (_event, request) => generation.plan(request))
  handle(IPC.generationStart, async (_event, request) => {
    assertIdle()
    return generation.start(request)
  })
  handle(IPC.generationCancel, async (_event, jobId) => generation.cancel(jobId) || sheetGeneration.cancel(jobId))
  handle(IPC.sheetsPlan, (_event, request) => sheetGeneration.plan(request))
  handle(IPC.sheetsStart, async (_event, request) => {
    assertIdle()
    return sheetGeneration.start(request)
  })
  handle(IPC.generationHistory, () => history.list())
  // Only folders/files recorded by a finished job can be opened — never arbitrary paths from the renderer.
  handle(IPC.generationOpenFolder, async (_event, jobId) => {
    const job = await history.get(parseId(jobId, 'job id'))
    if (!job) throw new AppError('JOB_NOT_FOUND', 'That job is not in the history.')
    await openPath(job.outputDirectory)
  })
  handle(IPC.generationOpenFile, async (_event, jobId, index) => {
    const job = await history.get(parseId(jobId, 'job id'))
    const file = typeof index === 'number' && Number.isInteger(index) ? job?.files[index] : undefined
    if (!file) throw new AppError('FILE_NOT_FOUND', 'That generated file is not in the job history.')
    await openPath(file)
  })

  handle(IPC.printPrinters, () => printers.list())
  handle(IPC.printSource, (_event, id) => print.source(parseId(id, 'job id')))
  handle(IPC.printPlan, (_event, request) => print.plan(request))
  handle(IPC.printStart, async (_event, request) => {
    const job = await print.start(request)
    log.info('print.started', { jobId: job.id, printer: job.settings.printer, sheets: job.sheets.length, copies: job.settings.copies, pages: job.estimatedPages })
    return job
  })
  handle(IPC.printCancel, (_event, id) => print.cancel(id))
  handle(IPC.printRetry, (_event, id) => print.retryFailed(id))
  handle(IPC.printHistory, () => print.history())
  handle(IPC.printPreview, (_event, id, index) => print.preview(parseId(id, 'job id'), index))
  handle(IPC.printPresets, () => presets.list())
  handle(IPC.printSavePreset, (_event, name, settings) => presets.saveAs(name, settings))
  handle(IPC.printRemovePreset, (_event, id) => presets.remove(id))
  handle(IPC.printRemember, (_event, settings) => presets.remember(settings))

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
    await openPath(dir)
  })
}
