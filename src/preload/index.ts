import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, IPC_EVENTS, type CardForgeApi } from '../shared/ipc'
import type { PrintJobRecord } from '../shared/print/types'
import type { JobProgress } from '../shared/template/types'
import type { ImportProgress } from '../shared/types'

// The renderer gets only these named operations — no raw ipcRenderer, fs, or shell access.
const api: CardForgeApi = {
  excel: {
    pickFile: () => ipcRenderer.invoke(IPC.excelPickFile),
    open: (filePath) => ipcRenderer.invoke(IPC.excelOpen, filePath),
    readSheet: (filePath, sheetName) => ipcRenderer.invoke(IPC.excelReadSheet, filePath, sheetName),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => listener(progress)
      ipcRenderer.on(IPC_EVENTS.excelProgress, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.excelProgress, handler)
    },
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    pickOutputDirectory: () => ipcRenderer.invoke(IPC.settingsPickOutputDir)
  },
  corel: {
    detect: () => ipcRenderer.invoke(IPC.corelDetect),
    status: () => ipcRenderer.invoke(IPC.corelStatus),
    compatibilityCheck: () => ipcRenderer.invoke(IPC.corelCompat)
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC.templatesList),
    get: (id) => ipcRenderer.invoke(IPC.templatesGet, id),
    pickAndImport: () => ipcRenderer.invoke(IPC.templatesPickAndImport),
    import: (path) => ipcRenderer.invoke(IPC.templatesImport, path),
    reinspect: (id) => ipcRenderer.invoke(IPC.templatesReinspect, id),
    remove: (id) => ipcRenderer.invoke(IPC.templatesRemove, id),
    rename: (id, name) => ipcRenderer.invoke(IPC.templatesRename, id, name),
    saveMapping: (id, mapping) => ipcRenderer.invoke(IPC.templatesSaveMapping, id, mapping),
    analyzeSheet: (id, options) => ipcRenderer.invoke(IPC.templatesAnalyzeSheet, id, options),
    prepareSheet: (id, options) => ipcRenderer.invoke(IPC.templatesPrepareSheet, id, options),
    revertSheet: (id) => ipcRenderer.invoke(IPC.templatesRevertSheet, id),
    saveSheetMapping: (id, mapping) => ipcRenderer.invoke(IPC.templatesSaveSheetMapping, id, mapping),
    missingFonts: (id) => ipcRenderer.invoke(IPC.templatesMissingFonts, id),
    sourceStatus: (id) => ipcRenderer.invoke(IPC.templatesSourceStatus, id),
    pageImages: (id) => ipcRenderer.invoke(IPC.templatesPageImages, id)
  },
  preview: {
    render: (request) => ipcRenderer.invoke(IPC.previewRender, request)
  },
  generation: {
    pickOutputDirectory: () => ipcRenderer.invoke(IPC.generationPickOutputDir),
    plan: (request) => ipcRenderer.invoke(IPC.generationPlan, request),
    start: (request) => ipcRenderer.invoke(IPC.generationStart, request),
    cancel: (jobId) => ipcRenderer.invoke(IPC.generationCancel, jobId),
    history: () => ipcRenderer.invoke(IPC.generationHistory),
    openFolder: (jobId) => ipcRenderer.invoke(IPC.generationOpenFolder, jobId),
    openFile: (jobId, index) => ipcRenderer.invoke(IPC.generationOpenFile, jobId, index),
    onProgress: (listener) => {
      // Pass only the payload; the IpcRendererEvent (with sender access) never reaches the page.
      const handler = (_event: Electron.IpcRendererEvent, progress: JobProgress) => listener(progress)
      ipcRenderer.on(IPC_EVENTS.generationProgress, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.generationProgress, handler)
    }
  },
  sheets: {
    plan: (request) => ipcRenderer.invoke(IPC.sheetsPlan, request),
    start: (request) => ipcRenderer.invoke(IPC.sheetsStart, request)
  },
  print: {
    printers: () => ipcRenderer.invoke(IPC.printPrinters),
    source: (sourceJobId) => ipcRenderer.invoke(IPC.printSource, sourceJobId),
    plan: (request) => ipcRenderer.invoke(IPC.printPlan, request),
    start: (request) => ipcRenderer.invoke(IPC.printStart, request),
    cancel: (jobId) => ipcRenderer.invoke(IPC.printCancel, jobId),
    retryFailed: (jobId) => ipcRenderer.invoke(IPC.printRetry, jobId),
    history: () => ipcRenderer.invoke(IPC.printHistory),
    preview: (sourceJobId, fileIndex) => ipcRenderer.invoke(IPC.printPreview, sourceJobId, fileIndex),
    presets: () => ipcRenderer.invoke(IPC.printPresets),
    savePreset: (name, settings) => ipcRenderer.invoke(IPC.printSavePreset, name, settings),
    removePreset: (id) => ipcRenderer.invoke(IPC.printRemovePreset, id),
    remember: (settings) => ipcRenderer.invoke(IPC.printRemember, settings),
    onProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, job: PrintJobRecord) => listener(job)
      ipcRenderer.on(IPC_EVENTS.printProgress, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.printProgress, handler)
    }
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs)
  }
}

contextBridge.exposeInMainWorld('cardforge', api)
