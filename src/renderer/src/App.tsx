import { useState } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { StatusDot } from './components/ui'
import { DashboardScreen } from './screens/DashboardScreen'
import { ImportScreen } from './screens/ImportScreen'
import { PlannedScreen } from './screens/PlannedScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { JobProvider, useJob } from './state/job'

export type ScreenKey = 'dashboard' | 'import' | 'template' | 'preview' | 'generate' | 'settings'

interface NavItem {
  key: ScreenKey
  label: string
  step?: number
  planned?: boolean
}

const WORKFLOW: NavItem[] = [
  { key: 'import', label: 'Excel import', step: 1 },
  { key: 'template', label: 'Template setup', step: 2, planned: true },
  { key: 'preview', label: 'Card preview', step: 3, planned: true },
  { key: 'generate', label: 'Generate', step: 4, planned: true }
]

export function App() {
  return (
    <JobProvider>
      <Shell />
    </JobProvider>
  )
}

function Shell() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  const { state, validation } = useJob()

  const importTone = state.phase === 'error' ? 'error' : !validation ? 'neutral' : validation.recordsWithErrors > 0 ? 'warn' : 'ok'

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
              {item.key === 'import' && <StatusDot tone={importTone} />}
              {item.planned && <span className="text-[10px] font-semibold uppercase text-stone-400">Planned</span>}
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
          {(screen === 'template' || screen === 'preview' || screen === 'generate') && <PlannedScreen screen={screen} />}
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
