import type { DetectionOptions, DetectionResult, SheetGenerationPlan, SheetGenerationRequest, SheetMapping } from './sheet/types'
import type {
  CorelStatus,
  GenerationPlan,
  GenerationRequest,
  JobProgress,
  JobSummary,
  PreviewRequest,
  PreviewResult,
  SavedMapping,
  TemplateRecord,
  TemplateSourceStatus,
  TemplateSummary
} from './template/types'
import type { AppInfo, AppSettings, CorelDetection, ImportProgress, IpcResult, SheetData, WorkbookInfo } from './types'

/** Every IPC channel the renderer may invoke. The main process registers exactly these. */
export const IPC = {
  excelPickFile: 'excel:pickFile',
  excelOpen: 'excel:open',
  excelReadSheet: 'excel:readSheet',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsPickOutputDir: 'settings:pickOutputDir',
  corelDetect: 'corel:detect',
  corelStatus: 'corel:status',
  templatesList: 'templates:list',
  templatesGet: 'templates:get',
  templatesPickAndImport: 'templates:pickAndImport',
  templatesImport: 'templates:import',
  templatesReinspect: 'templates:reinspect',
  templatesRemove: 'templates:remove',
  templatesRename: 'templates:rename',
  templatesSaveMapping: 'templates:saveMapping',
  templatesAnalyzeSheet: 'templates:analyzeSheet',
  templatesPrepareSheet: 'templates:prepareSheet',
  templatesRevertSheet: 'templates:revertSheet',
  templatesSaveSheetMapping: 'templates:saveSheetMapping',
  templatesSourceStatus: 'templates:sourceStatus',
  templatesPageImages: 'templates:pageImages',
  previewRender: 'preview:render',
  generationPickOutputDir: 'generation:pickOutputDir',
  sheetsPlan: 'sheets:plan',
  sheetsStart: 'sheets:start',
  generationPlan: 'generation:plan',
  generationStart: 'generation:start',
  generationCancel: 'generation:cancel',
  generationHistory: 'generation:history',
  generationOpenFolder: 'generation:openFolder',
  generationOpenFile: 'generation:openFile',
  appInfo: 'app:info',
  appOpenLogs: 'app:openLogs'
} as const

/** Main → renderer push events. */
export const IPC_EVENTS = {
  generationProgress: 'generation:progress',
  excelProgress: 'excel:progress'
} as const

/** API exposed on window.cardforge by the preload script. */
export interface CardForgeApi {
  excel: {
    pickFile(): Promise<IpcResult<string | null>>
    open(filePath: string): Promise<IpcResult<WorkbookInfo>>
    readSheet(filePath: string, sheetName: string): Promise<IpcResult<SheetData>>
    /** Subscribes to worksheet read progress; returns an unsubscribe function. */
    onProgress(listener: (progress: ImportProgress) => void): () => void
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
    status(): Promise<IpcResult<CorelStatus>>
  }
  templates: {
    list(): Promise<IpcResult<TemplateSummary[]>>
    get(id: string): Promise<IpcResult<TemplateRecord>>
    pickAndImport(): Promise<IpcResult<TemplateRecord | null>>
    import(path: string): Promise<IpcResult<TemplateRecord>>
    reinspect(id: string): Promise<IpcResult<TemplateRecord>>
    remove(id: string): Promise<IpcResult<void>>
    rename(id: string, name: string): Promise<IpcResult<TemplateRecord>>
    saveMapping(id: string, mapping: SavedMapping): Promise<IpcResult<TemplateRecord>>
    /** Proposes the card grid of a multi-card sheet template (no changes). */
    analyzeSheet(id: string, options?: DetectionOptions): Promise<IpcResult<DetectionResult>>
    /** Names the repeated objects in the private library copy and stores the layout. */
    prepareSheet(id: string, options?: DetectionOptions): Promise<IpcResult<TemplateRecord>>
    revertSheet(id: string): Promise<IpcResult<TemplateRecord>>
    saveSheetMapping(id: string, mapping: SheetMapping): Promise<IpcResult<TemplateRecord>>
    sourceStatus(id: string): Promise<IpcResult<TemplateSourceStatus>>
    pageImages(id: string): Promise<IpcResult<{ pageIndex: number; dataUrl: string }[]>>
  }
  preview: {
    render(request: PreviewRequest): Promise<IpcResult<PreviewResult>>
  }
  generation: {
    pickOutputDirectory(): Promise<IpcResult<string | null>>
    plan(request: GenerationRequest): Promise<IpcResult<GenerationPlan>>
    start(request: GenerationRequest): Promise<IpcResult<{ jobId: string }>>
    cancel(jobId: string): Promise<IpcResult<boolean>>
    history(): Promise<IpcResult<JobSummary[]>>
    openFolder(jobId: string): Promise<IpcResult<void>>
    openFile(jobId: string, index: number): Promise<IpcResult<void>>
    /** Subscribes to progress events; returns an unsubscribe function. */
    onProgress(listener: (progress: JobProgress) => void): () => void
  }
  /** Bulk production of multi-card A4 sheets (progress arrives through generation.onProgress). */
  sheets: {
    plan(request: SheetGenerationRequest): Promise<IpcResult<SheetGenerationPlan>>
    start(request: SheetGenerationRequest): Promise<IpcResult<{ jobId: string }>>
  }
  app: {
    info(): Promise<IpcResult<AppInfo>>
    openLogs(): Promise<IpcResult<void>>
  }
}
