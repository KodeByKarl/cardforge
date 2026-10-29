import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type CardForgeApi } from '../shared/ipc'

// The renderer gets only these named operations — no raw ipcRenderer, fs, or shell access.
const api: CardForgeApi = {
  excel: {
    pickFile: () => ipcRenderer.invoke(IPC.excelPickFile),
    open: (filePath) => ipcRenderer.invoke(IPC.excelOpen, filePath),
    readSheet: (filePath, sheetName) => ipcRenderer.invoke(IPC.excelReadSheet, filePath, sheetName),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    pickOutputDirectory: () => ipcRenderer.invoke(IPC.settingsPickOutputDir)
  },
  corel: {
    detect: () => ipcRenderer.invoke(IPC.corelDetect)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs)
  }
}

contextBridge.exposeInMainWorld('cardforge', api)
