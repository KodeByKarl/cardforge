import { useEffect, useState, type ReactNode } from 'react'
import { hasBlockingMappingIssues } from '../../shared/template/mapping'
import { nextAction, stepsDone, type ScreenId, type StepKey } from '../../shared/workflow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BrandMark, Icon, type IconName } from './components/icons'
import { Button, IconButton, StatusDot, ToastProvider, type Tone } from './components/ui'
import { DashboardScreen } from './screens/DashboardScreen'
import { GenerateScreen } from './screens/GenerateScreen'
import { ImportScreen } from './screens/ImportScreen'
import { PreviewScreen } from './screens/PreviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TemplateScreen } from './screens/TemplateScreen'
import { corelMajor, useCorelStatus } from './state/corel'
import { GenerationProvider, useGeneration } from './state/generation'
import { JobProvider, useJob } from './state/job'
import { TemplatesProvider, useTemplates } from './state/templates'
import { ThemeProvider, useTheme } from './state/theme'

export type ScreenKey = ScreenId

const STEPS: { key: StepKey; label: string; icon: IconName; shortcut: string }[] = [
  { key: 'import', label: 'Excel import', icon: 'import', shortcut: 'Ctrl+1' },
  { key: 'template', label: 'Template setup', icon: 'template', shortcut: 'Ctrl+2' },
  { key: 'preview', label: 'Card preview', icon: 'preview', shortcut: 'Ctrl+3' },
  { key: 'generate', label: 'Generate', icon: 'generate', shortcut: 'Ctrl+4' }
]

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <JobProvider>
          <TemplatesProvider>
            <GenerationProvider>
              <Shell />
            </GenerationProvider>
          </TemplatesProvider>
        </JobProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

function Shell() {
  const [screen, setScreen] = useState<ScreenKey>('dashboard')
  const { state, validation, dataset } = useJob()
  const { selected, issues } = useTemplates()
  const { running, progress } = useGeneration()
  const { status: corel } = useCorelStatus()

  const mappingBlocked = !!selected && hasBlockingMappingIssues(issues)
  const flags = { hasRecords: (dataset?.records.length ?? 0) > 0, hasTemplate: !!selected, mappingBlocked, mappingSaved: !!selected?.mapping, running }
  const done = stepsDone(flags)
  const next = nextAction(screen, flags)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return
      const step = STEPS.find((_, i) => e.key === String(i + 1))
      if (step) setScreen(step.key)
      else if (e.key === '0') setScreen('dashboard')
      else if (e.key === ',') setScreen('settings')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tones: Record<StepKey, Tone> = {
    import: state.phase === 'error' ? 'error' : !validation ? 'neutral' : validation.recordsWithErrors > 0 ? 'warn' : 'ok',
    template: !selected ? 'neutral' : mappingBlocked ? 'error' : issues.length ? 'warn' : 'ok',
    preview: 'neutral',
    generate: running ? 'info' : 'neutral'
  }
  const summaries: Record<StepKey, string> = {
    import: state.phase === 'error' ? 'Import failed' : validation ? `${validation.totalRecords} records${validation.recordsWithErrors ? ` · ${validation.recordsWithErrors} with errors` : ''}` : 'No file',
    template: selected ? (mappingBlocked ? 'Mapping errors' : selected.mapping ? `${selected.name}` : 'Not mapped') : 'None selected',
    preview: flags.hasRecords && selected ? 'Check each card' : 'Needs data + template',
    generate: running && progress ? `${progress.done} / ${progress.total}` : 'Create CDR files'
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] bg-bg">
      <a href="#main" className="sr-only z-50 rounded bg-surface px-2 py-1 focus:not-sr-only focus:absolute focus:left-2 focus:top-2">
        Skip to content
      </a>

      <header className="flex h-header items-center gap-3 border-b border-line bg-rail px-3">
        <div className="flex w-[calc(theme(spacing.rail)-12px)] shrink-0 items-center gap-2 compact:w-auto">
          <BrandMark />
          <span className="text-base font-semibold tracking-tight compact:sr-only">CardForge</span>
        </div>
        <ProjectStrip navigate={setScreen} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {next && (
            <Button variant="primary" onClick={() => setScreen(next.to)} data-testid="next-action">
              {next.label}
              <Icon name="chevronRight" size={14} />
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[theme(spacing.rail)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] compact:grid-cols-[theme(spacing.rail-compact)_minmax(0,1fr)]">
        <nav aria-label="Main" className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-rail py-2">
          <div className="px-1.5">
            <RailItem active={screen === 'dashboard'} onClick={() => setScreen('dashboard')} icon="dashboard" label="Dashboard" testId="nav-dashboard" shortcut="Ctrl+0" />
          </div>
          <p className="label px-3.5 pb-1 pt-4 compact:sr-only">Workflow</p>
          <ol className="relative space-y-0.5 px-1.5 compact:mt-2">
            <span className="absolute bottom-5 left-[21px] top-5 w-px bg-line-strong" aria-hidden />
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <RailItem
                  active={screen === s.key}
                  onClick={() => setScreen(s.key)}
                  icon={s.icon}
                  label={s.label}
                  summary={summaries[s.key]}
                  tone={tones[s.key]}
                  step={i + 1}
                  done={done[s.key]}
                  testId={`nav-${s.key}`}
                  shortcut={s.shortcut}
                />
              </li>
            ))}
          </ol>
          <div className="mt-auto px-1.5">
            <RailItem active={screen === 'settings'} onClick={() => setScreen('settings')} icon="settings" label="Settings" testId="nav-settings" shortcut="Ctrl+," />
          </div>
        </nav>
        <main id="main" tabIndex={-1} className="relative min-h-0 min-w-0 overflow-hidden outline-none">
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

      <footer className="flex h-status items-center gap-3 border-t border-line bg-rail px-3 text-xs text-fg-muted">
        <button type="button" className="flex min-w-0 items-center gap-1.5 hover:text-fg" onClick={() => setScreen('settings')} title="CorelDRAW status (open Settings)">
          <StatusDot tone={!corel ? 'neutral' : !corel.available ? 'error' : corel.isX7 ? 'ok' : 'warn'} />
          <span className="truncate">
            {!corel ? 'Checking CorelDRAW…' : corel.available ? `CorelDRAW ${corelMajor(corel.version) ?? ''}${corel.isX7 ? ' (X7)' : ' · X7 validation pending'}` : 'CorelDRAW not available'}
          </span>
        </button>
        {running && progress && (
          <button type="button" className="ml-auto flex items-center gap-1.5 text-accent hover:underline" onClick={() => setScreen('generate')}>
            <span className="spinner" aria-hidden />
            Generating {progress.done} of {progress.total}
          </button>
        )}
      </footer>
    </div>
  )
}

/** What is loaded right now, always visible: data → template. Each part jumps to its screen. */
function ProjectStrip({ navigate }: { navigate: (s: ScreenKey) => void }) {
  const { state, validation } = useJob()
  const { selected } = useTemplates()
  const first = selected?.inspection.pages[0]
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs" aria-label="Active project">
      <CrumbButton onClick={() => navigate('import')} icon="file" empty={!state.workbook}>
        {state.workbook ? (
          <>
            <span className="truncate font-medium text-fg">{state.workbook.fileName}</span>
            {validation && <span className="shrink-0 text-fg-muted compact:hidden">· {validation.totalRecords} records</span>}
          </>
        ) : (
          'No spreadsheet'
        )}
      </CrumbButton>
      <Icon name="chevronRight" size={12} className="text-fg-subtle" />
      <CrumbButton onClick={() => navigate('template')} icon="template" empty={!selected}>
        {selected ? (
          <>
            <span className="truncate font-medium text-fg">{selected.name}</span>
            {first && <span className="shrink-0 text-fg-muted compact:hidden">· {first.widthMm} × {first.heightMm} mm</span>}
          </>
        ) : (
          'No template'
        )}
      </CrumbButton>
    </div>
  )
}

function CrumbButton({ onClick, icon, empty, children }: { onClick: () => void; icon: IconName; empty: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-w-0 max-w-[26ch] items-center gap-1.5 rounded px-1.5 py-1 hover:bg-hover wide:max-w-[40ch] ${empty ? 'text-fg-subtle' : ''}`}>
      <Icon name={icon} size={14} className="text-fg-muted" />
      {children}
    </button>
  )
}

function ThemeToggle() {
  const { resolved, setPreference } = useTheme()
  const dark = resolved === 'dark'
  return <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} icon={dark ? 'sun' : 'moon'} onClick={() => setPreference(dark ? 'light' : 'dark')} />
}

function RailItem({
  active,
  onClick,
  icon,
  label,
  summary,
  tone = 'neutral',
  step,
  done,
  testId,
  shortcut
}: {
  active: boolean
  onClick: () => void
  icon: IconName
  label: string
  summary?: string
  tone?: Tone
  step?: number
  done?: boolean
  testId: string
  shortcut: string
}) {
  const badgeTone = tone === 'error' ? 'border-err text-err' : tone === 'warn' ? 'border-warn text-warn' : done || tone === 'ok' ? 'border-ok text-ok' : tone === 'info' ? 'border-accent text-accent' : 'border-line-strong text-fg-muted'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
      title={`${label} (${shortcut})`}
      className={`relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-left compact:justify-center compact:px-0 ${active ? 'bg-surface font-semibold shadow-card' : 'hover:bg-hover'}`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent compact:hidden" aria-hidden />}
      {step ? (
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-sm border bg-rail text-2xs font-semibold tabular-nums ${badgeTone} ${active ? 'bg-surface' : ''}`}>
          {done ? <Icon name="check" size={12} /> : step}
        </span>
      ) : (
        <Icon name={icon} className="mx-0.5 text-fg-muted" />
      )}
      <span className="min-w-0 flex-1 compact:sr-only">
        <span className="block truncate leading-4">{label}</span>
        {summary && <span className={`block truncate text-2xs font-normal leading-4 ${tone === 'error' ? 'text-err' : tone === 'warn' ? 'text-warn' : 'text-fg-muted'}`}>{summary}</span>}
      </span>
    </button>
  )
}
