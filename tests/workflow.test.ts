import { describe, expect, it } from 'vitest'
import { chooseLayout } from '../src/shared/preview/navigation'
import { groupIssues, nextAction, stepsDone, type WorkflowFlags } from '../src/shared/workflow'

const base: WorkflowFlags = { hasRecords: true, hasTemplate: true, mappingBlocked: false, mappingSaved: true, running: false }

describe('nextAction', () => {
  it('walks the workflow in order', () => {
    expect(nextAction('dashboard', { ...base, hasRecords: false })?.to).toBe('import')
    expect(nextAction('import', { ...base, hasTemplate: false })?.to).toBe('template')
    expect(nextAction('import', { ...base, mappingSaved: false })?.label).toBe('Finish field mapping')
    expect(nextAction('template', base)?.to).toBe('preview')
    expect(nextAction('preview', base)?.to).toBe('generate')
    expect(nextAction('generate', base)).toBeNull()
  })
  it('does not point at the current screen and surfaces a running job', () => {
    expect(nextAction('import', { ...base, hasRecords: false })).toBeNull()
    expect(nextAction('preview', { ...base, running: true })?.to).toBe('generate')
    expect(nextAction('generate', { ...base, running: true })).toBeNull()
  })
})

describe('stepsDone / groupIssues', () => {
  it('marks import and template complete only when usable', () => {
    expect(stepsDone(base)).toMatchObject({ import: true, template: true })
    expect(stepsDone({ ...base, mappingBlocked: true }).template).toBe(false)
  })
  it('puts errors first and drops empty groups', () => {
    const g = groupIssues([{ severity: 'warning' as const }, { severity: 'error' as const }, { severity: 'warning' as const }])
    expect(g.map((x) => [x.severity, x.items.length])).toEqual([['error', 1], ['warning', 2]])
    expect(groupIssues([{ severity: 'warning' as const }]).map((x) => x.severity)).toEqual(['warning'])
  })
})

describe('chooseLayout', () => {
  const card = { widthMm: 90, heightMm: 50 }
  it('stacks front/back in a tall narrow canvas and places them side by side in a wide one', () => {
    expect(chooseLayout([card, card], 6, 500, 900).layout).toBe('column')
    expect(chooseLayout([card, card], 6, 1600, 500).layout).toBe('row')
  })
  it('never exceeds the box', () => {
    const { zoom } = chooseLayout([card, card], 6, 800, 600, { x: 28, y: 48 })
    expect(zoom).toBeGreaterThan(0)
  })
})
