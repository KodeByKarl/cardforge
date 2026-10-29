import type { AppInfo, AppSettings, CorelDetection, IpcResult, SheetData, WorkbookInfo } from './types'

/** Every IPC channel the renderer may invoke. The main process registers exactly these. */
export const IPC = {
  excelPickFile: 'excel:pickFile',
  excelOpen: 'excel:open',
  excelReadSheet: 'excel:readSheet',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsPickOutputDir: 'settings:pickOutputDir',
  corelDetect: 'corel:detect',
  appInfo: 'app:info',
  appOpenLogs: 'app:openLogs'
} as const

/** API exposed on window.cardforge by the preload script. */
export interface CardForgeApi {
  excel: {
    pickFile(): Promise<IpcResult<string | null>>
    open(filePath: string): Promise<IpcResult<WorkbookInfo>>
    readSheet(filePath: string, sheetName: string): Promise<IpcResult<SheetData>>
    /** Resolves the filesystem path of a dropped File (Electron webUtils). */
    pathForFile(file: File): string
  }
  settings: {
    get(): Promise<IpcResult<AppSettings>>
    update(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
    pickOutputDirectory(): Promise<IpcResult<string | null>>
  }
  corel: {
    detect(): Promise<IpcResult<CorelDetection>>
  }
  app: {
    info(): Promise<IpcResult<AppInfo>>
    openLogs(): Promise<IpcResult<void>>
  }
}
