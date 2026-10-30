import { describe, expect, it } from 'vitest'
import { detectNamedSheet } from '../src/shared/sheet/namedCards'
import type { TemplateObject } from '../src/shared/template/types'

const FIELDS = ['FullName', 'Role', 'MemberID']
function sheet(cols: number, rows: number): TemplateObject[] {
  const out: TemplateObject[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const n = r * cols + c + 1
      FIELDS.forEach((f, i) => {
        const left = 10 + c * 95
        const top = 287 - r * 55 - i * 10
        out.push({ name: `card${String(n).padStart(2, '0')}_${f}`, pageIndex: 1, path: [], text: `SAMPLE ${f}`, font: 'Arial', sizePt: 9, bold: false, italic: false, alignment: 1, isParagraph: false, mixedFormatting: false, bounds: { left, right: left + 60, top, bottom: top - 6 } })
      })
    }
  return out
}

describe('detectNamedSheet', () => {
  it('turns cardNN_Field names into a 2 x 5 sheet whose cell n is card n', () => {
    const cfg = detectNamedSheet(sheet(2, 5), { widthMm: 210, heightMm: 297 })!
    expect(cfg.cells).toHaveLength(10)
    expect([cfg.columns, cfg.rows]).toEqual([2, 5])
    expect(cfg.roles.map((r) => r.label.split(' ')[0])).toEqual(['FullName', 'Role', 'MemberID'])
    expect(cfg.cells[0]!.objects['f1']).toBe('card01_FullName')
    expect(cfg.cells[9]!.objects['f3']).toBe('card10_MemberID')
    expect(cfg.cells[1]).toMatchObject({ col: 2, row: 1 })
    expect(cfg.warnings).toEqual([])
  })
  it('is not triggered by ordinary single-card names', () => {
    expect(detectNamedSheet(sheet(1, 1))).toBeNull()
    expect(detectNamedSheet([{ ...sheet(1, 1)[0]!, name: 'FullName' }])).toBeNull()
  })
})
