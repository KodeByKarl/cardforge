import { writeFile } from 'node:fs/promises'
import { AppError } from '../../errors'
import type { CorelAdapter, GenerateItem, TemplateInfo } from './CorelAdapter'

/**
 * DEVELOPMENT/TEST ONLY. Simulates CorelDRAW so the workflow can be built without the application.
 * It writes JSON files with a ".mock.json" suffix — never .cdr — so its output can't be mistaken for real output.
 */
export class MockCorelAdapter implements CorelAdapter {
  readonly kind = 'mock' as const
  private batchTemplate: string | null = null
  failOn: ((item: GenerateItem) => boolean) | null = null

  constructor(private readonly template: TemplateInfo) {}

  async connect(): Promise<void> {}

  async inspectTemplate(templatePath: string): Promise<TemplateInfo> {
    return { ...this.template, templatePath }
  }

  async beginBatch(templatePath: string): Promise<void> {
    if (this.batchTemplate) throw new AppError('BATCH_IN_PROGRESS', 'A batch is already running.')
    this.batchTemplate = templatePath
  }

  async generateOne(item: GenerateItem): Promise<void> {
    if (!this.batchTemplate) throw new AppError('NO_BATCH', 'beginBatch must be called first.')
    if (this.failOn?.(item)) throw new AppError('COREL_SAVE_FAILED', 'Simulated CorelDRAW failure.')
    const known = new Set(this.template.textObjects.map((o) => o.name))
    const unknown = Object.keys(item.values).filter((name) => !known.has(name))
    if (unknown.length > 0) throw new AppError('SHAPE_NOT_FOUND', `Template has no text object named ${unknown.join(', ')}.`)
    const body = { mock: true, template: this.batchTemplate, values: item.values }
    await writeFile(`${item.outputPath}.mock.json`, JSON.stringify(body, null, 2), { encoding: 'utf8', flag: 'wx' })
  }

  async endBatch(): Promise<void> {
    this.batchTemplate = null
  }

  async dispose(): Promise<void> {
    this.batchTemplate = null
  }
}
