/** Pure workflow logic for the shell: which step comes next and how the issue list is grouped. */

export type StepKey = 'import' | 'template' | 'preview' | 'generate'
export type ScreenId = 'dashboard' | StepKey | 'settings'

export const STEP_ORDER: StepKey[] = ['import', 'template', 'preview', 'generate']

export interface WorkflowFlags {
  hasRecords: boolean
  hasTemplate: boolean
  mappingBlocked: boolean
  mappingSaved: boolean
  running: boolean
}

export interface NextAction {
  to: StepKey
  label: string
}

/** The one thing the operator most likely wants to do next, or null when they are already there / nothing applies. */
export function nextAction(current: ScreenId, f: WorkflowFlags): NextAction | null {
  if (f.running && current !== 'generate') return { to: 'generate', label: 'View progress' }
  let next: NextAction
  if (!f.hasRecords) next = { to: 'import', label: 'Import Excel data' }
  else if (!f.hasTemplate) next = { to: 'template', label: 'Choose a template' }
  else if (f.mappingBlocked || !f.mappingSaved) next = { to: 'template', label: 'Finish field mapping' }
  else if (current === 'preview') next = { to: 'generate', label: 'Continue to Generate' }
  else if (current === 'generate') return null
  else next = { to: 'preview', label: 'Review cards' }
  return next.to === current ? null : next
}

/** Step to show as complete in the rail (a check mark); preview has no completion state of its own. */
export function stepsDone(f: WorkflowFlags): Record<StepKey, boolean> {
  const mapped = f.hasTemplate && !f.mappingBlocked && f.mappingSaved
  return { import: f.hasRecords, template: mapped, preview: false, generate: false }
}

export interface IssueLike {
  severity: 'error' | 'warning'
}

export interface IssueGroup<T extends IssueLike> {
  severity: 'error' | 'warning'
  items: T[]
}

/** Errors first, then warnings; empty groups are dropped so the UI never shows an empty heading. */
export function groupIssues<T extends IssueLike>(issues: T[]): IssueGroup<T>[] {
  const groups: IssueGroup<T>[] = [
    { severity: 'error', items: issues.filter((i) => i.severity === 'error') },
    { severity: 'warning', items: issues.filter((i) => i.severity === 'warning') }
  ]
  return groups.filter((g) => g.items.length > 0)
}
