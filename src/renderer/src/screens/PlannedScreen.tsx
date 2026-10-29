import { PageHeader } from '../components/ui'

const CONTENT = {
  template: {
    title: 'Template setup',
    phase: 'Phase 4',
    needs: [
      'A real CDR calling card template from the client, with each variable text object named in the Object Manager (e.g. FullName, JobTitle, Email).',
      'The CorelDRAW proof of concept passing on the production computer (scripts/corel-poc.ps1).',
      'Template inspection through the CorelDRAW bridge to list named text objects for mapping.'
    ]
  },
  preview: {
    title: 'Card preview',
    phase: 'Phase 4',
    needs: [
      'Template inspection data (page size, text object positions, fonts) from CorelDRAW.',
      'A background image exported from the template, so the preview reflects the real design instead of an HTML imitation.',
      'A verification render exported from CorelDRAW for sample records to confirm the preview matches.'
    ]
  },
  generate: {
    title: 'Generate to CorelDRAW',
    phase: 'Phase 5',
    needs: [
      'A verified CorelDRAW X7 automation bridge (COM), proven on the client’s machine.',
      'Agreement on output layout: one CDR per person, or several cards per page with imposition.',
      'Print requirements: bleed, crop marks, sheet size, and colour profile.'
    ]
  }
} as const

/** Placeholder for workflow steps that depend on CorelDRAW verification. Deliberately has no fake controls. */
export function PlannedScreen({ screen }: { screen: keyof typeof CONTENT }) {
  const content = CONTENT[screen]
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={content.title} description={`Not built yet · scheduled for ${content.phase}`} />
      <div className="max-w-2xl p-6">
        <div className="panel p-5">
          <p className="font-medium">This step depends on the CorelDRAW integration, which has not been verified yet.</p>
          <p className="muted mt-1">It will be built when these are in place:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            {content.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
