import type { JobSummary } from '../../../shared/template/types'
import { log } from '../../logger'
import { readJson, writeJsonAtomic } from '../fsutil'

const KEEP = 50

/** Recent generation jobs, newest first, persisted to <userData>/jobs.json. */
export class JobHistory {
  private jobs: JobSummary[] | null = null

  constructor(private readonly file: string) {}

  async list(): Promise<JobSummary[]> {
    if (!this.jobs) {
      try {
        const parsed = await readJson<unknown>(this.file)
        this.jobs = Array.isArray(parsed) ? (parsed as JobSummary[]) : []
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('jobs.load_failed', { error: err })
        this.jobs = []
      }
    }
    return [...this.jobs]
  }

  async get(id: string): Promise<JobSummary | undefined> {
    return (await this.list()).find((j) => j.id === id)
  }

  async save(job: JobSummary): Promise<void> {
    const jobs = (await this.list()).filter((j) => j.id !== job.id)
    jobs.unshift(job)
    this.jobs = jobs.slice(0, KEEP)
    await writeJsonAtomic(this.file, this.jobs)
  }
}
