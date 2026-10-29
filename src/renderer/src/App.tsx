import { useState } from 'react'
import { hasBlockingMappingIssues } from '../../shared/template/mapping'
import { ErrorBoundary } from './components/ErrorBoundary'
import { StatusDot } from './components/ui'
import { DashboardScreen } from './screens/DashboardScreen'
import { GenerateScreen } from './screens/GenerateScreen'
import { ImportScreen } from './screens/ImportScreen'
import { PreviewScreen } from './screens/PreviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TemplateScreen } from './screens/TemplateScreen'
import { GenerationProvider, useGeneration } from './state/generation'
import { JobProvider, useJob } from './state/job'
import { TemplatesProvider, useTemplates } from './state/templates'

export type ScreenKey = 'dashboard' | 'import' | 'template' | 'preview' | 'generate' | 'settings'

type Tone = 'neutral' | 'ok' | 'warn' | 'error' | 'info'

const WORKFLOW: { key: ScreenKey; label: string; step: number }[] = [
  { key: 'import', label: 'Excel import', step: 1 },
  { key: 'template', label: 'Template setup', step: 2 },
  { key: 'preview', label: 'Card preview', step: 3 },
  { key: 'generate', label: 'Generate', step: 4 }
]

export function App() {
  return (
    <JobProvider>
      <TemplatesProvider>
        <GenerationProvider>
          <Shell />
        </GenerationProvider>
      </TemplatesProvider>
    </JobProvider>
  )
}

function Shell() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  const { state, validation } = useJob()
  const { selected, issues } = useTemplates()
  const { running } = useGeneration()

  const tones: Partial<Record<ScreenKey, Tone>> = {
    import: state.phase === 'error' ? 'error' : !validation ? 'neutral' : validation.recordsWithErrors > 0 ? 'warn' : 'ok',
    template: !selected ? 'neutral' : hasBlockingMappingIssues(issues) ? 'error' : issues.length ? 'warn' : 'ok',
    generate: running ? 'info' : 'neutral'
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/60">
        <div className="px-4 pb-3 pt-4">
          <p className="text-[15px] font-semibold tracking-tight">CardForge</p>
          <p className="muted text-xs">Calling cards for CorelDRAW</p>
        </div>
        <div className="px-2">
          <NavButton active={screen === 'dashboard'} onClick={() => setScreen('dashboard')}>
            Dashboard
          </NavButton>
        </div>
        <p className="eyebrow px-4 pb-1 pt-4">Workflow</p>
        <div className="space-y-0.5 px-2">
          {WORKFLOW.map((item) => (
            <NavButton key={item.key} active={screen === item.key} onClick={() => setScreen(item.key)}>
              <span className="w-4 text-xs tabular-nums text-stone-400">{item.step}</span>
              <span className="flex-1">{item.label}</span>
              {tones[item.key] && tones[item.key] !== 'neutral' && <StatusDot tone={tones[item.key]!} />}
              {item.key === 'generate' && running && <span className="text-[10px] font-semibold uppercase text-teal-700 dark:text-teal-400">Running</span>}
            </NavButton>
          ))}
        </div>
        <div className="mt-auto px-2 pb-3">
          <NavButton active={screen === 'settings'} onClick={() => setScreen('settings')}>
            Settings
          </NavButton>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-hidden">
        <ErrorBoundary area={screen} key={screen}>
          {screen === 'dashboard' && <DashboardScreen navigate={setScreen} />}
          {screen === 'import' && <ImportScreen />}
          {screen === 'template' && <TemplateScreen navigate={setScreen} />}
          {screen === 'preview' && <PreviewScreen navigate={setScreen} />}
          {screen === 'generate' && <GenerateScreen navigate={setScreen} />}
          {screen === 'settings' && <SettingsScreen />}
        </ErrorBoundary>
      </main>
    </div>
  )
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left ${
        active
          ? 'bg-white font-medium shadow-sm ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700'
          : 'text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/60'
      }`}
    >
      {children}
    </button>
  )
}
