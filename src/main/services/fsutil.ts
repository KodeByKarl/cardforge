import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, rename, writeFile } from 'node:fs/promises'

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** Writes JSON via a temp file + rename so a crash never leaves a half-written file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, path)
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function fileToDataUrl(path: string, mime = 'image/png'): Promise<string> {
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`
}
