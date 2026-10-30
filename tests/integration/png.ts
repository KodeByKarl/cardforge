import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export interface Raster {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array
}

const ADAM7 = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 }
]

/** Minimal PNG decoder (8-bit grey/RGB/RGBA, interlaced or not): enough for CorelDRAW's page exports. */
export function decodePng(path: string): Raster {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8) throw new Error('Only 8-bit PNG is supported')
      colorType = body[9]!
      interlace = body[12]!
    } else if (type === 'IDAT') idat.push(body)
    pos += 12 + len
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const out = new Uint8Array(width * height * 4)
  let p = 0

  const readPass = (pw: number, ph: number, place: (x: number, y: number, px: Uint8Array, o: number) => void) => {
    if (pw === 0 || ph === 0) return
    const stride = pw * channels
    let prev = new Uint8Array(stride)
    for (let y = 0; y < ph; y++) {
      const filter = raw[p++]!
      const line = new Uint8Array(stride)
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? line[x - channels]! : 0
        const b = prev[x]!
        const c = x >= channels ? prev[x - channels]! : 0
        const v = raw[p++]!
        let add = 0
        if (filter === 1) add = a
        else if (filter === 2) add = b
        else if (filter === 3) add = (a + b) >> 1
        else if (filter === 4) {
          const pa = Math.abs(b - c)
          const pb = Math.abs(a - c)
          const pc = Math.abs(a + b - 2 * c)
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        }
        line[x] = (v + add) & 255
      }
      for (let x = 0; x < pw; x++) place(x, y, line, x * channels)
      prev = line
    }
  }
  const put = (X: number, Y: number, line: Uint8Array, o: number) => {
    const d = (Y * width + X) * 4
    if (channels >= 3) {
      out[d] = line[o]!
      out[d + 1] = line[o + 1]!
      out[d + 2] = line[o + 2]!
      out[d + 3] = channels === 4 ? line[o + 3]! : 255
    } else {
      out[d] = out[d + 1] = out[d + 2] = line[o]!
      out[d + 3] = channels === 2 ? line[o + 1]! : 255
    }
  }
  if (interlace === 0) readPass(width, height, (x, y, line, o) => put(x, y, line, o))
  else {
    for (const s of ADAM7) {
      const pw = Math.ceil((width - s.x0) / s.dx)
      const ph = Math.ceil((height - s.y0) / s.dy)
      readPass(Math.max(0, pw), Math.max(0, ph), (x, y, line, o) => put(s.x0 + x * s.dx, s.y0 + y * s.dy, line, o))
    }
  }
  return { width, height, data: out }
}

export interface DiffResult {
  sameSize: boolean
  differing: number
  total: number
  /** Bounding box (pixels) of all differing pixels, or null. */
  box: { left: number; top: number; right: number; bottom: number } | null
}

/** Pixel comparison; `ignore(x, y)` excludes areas (e.g. text regions). A channel difference above `tolerance` counts as different. */
export function diffRasters(a: Raster, b: Raster, tolerance = 0, ignore?: (x: number, y: number) => boolean): DiffResult {
  if (a.width !== b.width || a.height !== b.height) return { sameSize: false, differing: -1, total: a.width * a.height, box: null }
  let differing = 0
  let box: DiffResult['box'] = null
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (ignore?.(x, y)) continue
      const o = (y * a.width + x) * 4
      if (Math.abs(a.data[o]! - b.data[o]!) > tolerance || Math.abs(a.data[o + 1]! - b.data[o + 1]!) > tolerance || Math.abs(a.data[o + 2]! - b.data[o + 2]!) > tolerance) {
        differing++
        box = box ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) } : { left: x, top: y, right: x, bottom: y }
      }
    }
  }
  return { sameSize: true, differing, total: a.width * a.height, box }
}
