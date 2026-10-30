import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AppInfo, AppSettings, CorelDetection, OverwritePolicy } from '../../../shared/types'
import { api, errorMessage, unwrap } from '../api'
import { Icon } from '../components/icons'
import { Badge, Banner, Button, PageHeader, Segmented, useToast } from '../components/ui'
import { useTheme, type ThemePreference } from '../state/theme'

const OVERWRITE_LABELS: Record<OverwritePolicy, string> = {
  ask: 'Ask before overwriting',
  skip: 'Skip existing files',
  suffix: 'Add a number suffix'
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [corel, setCorel] = useState<CorelDetection | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pattern, setPattern] = useState('')
  const [margin, setMargin] = useState('')
  const { preference, setPreference } = useTheme()
  const toast = useToast()

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setCorel(await unwrap(api.corel.detect()))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([unwrap(api.settings.get()), unwrap(api.app.info())]).then(
      ([s, i]) => {
        setSettings(s)
        setPattern(s.fileNamePattern)
        setMargin(String(s.safeMarginMm))
        setInfo(i)
      },
      (err) => setError(errorMessage(err))
    )
    void scan()
  }, [scan])

  const update = async (patch: Partial<AppSettings>) => {
    setError(null)
    try {
      setSettings(await unwrap(api.settings.update(patch)))
      toast.push('ok', 'Setting saved.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pickFolder = async () => {
    try {
      const dir = await unwrap(api.settings.pickOutputDirectory())
      if (dir) setSettings(await unwrap(api.settings.get()))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const copyDiagnostics = async () => {
    const lines = [
      `CardForge ${info?.appVersion ?? '?'}`,
      `Electron ${info?.electronVersion ?? '?'} / Chromium ${info?.chromeVersion ?? '?'} / Node ${info?.nodeVersion ?? '?'}`,
      `Platform: ${info?.platform ?? '?'}`,
      `Display: ${window.innerWidth}x${window.innerHeight} CSS px at ${window.devicePixelRatio}x scaling`,
      `CorelDRAW: ${corel ? `${corel.detail} [${corel.progIds.join(', ') || 'no ProgIDs'}]` : 'not scanned'}`,
      `Data folder: ${info?.userDataPath ?? '?'}`,
      `Log folder: ${info?.logDirectory ?? '?'}`
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.push('ok', 'Diagnostics copied to the clipboard.')
    } catch {
      toast.push('error', 'The clipboard is not available.')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid items-start gap-x-10 gap-y-6 p-4 wide:grid-cols-2">
          {error && (
            <div className="wide:col-span-2">
              <Banner tone="error" title="Settings error">
                {error}
              </Banner>
            </div>
          )}

          <Group title="Appearance">
            <Row label="Theme" hint="System follows the Windows light/dark setting.">
              <Segmented<ThemePreference>
                label="Theme"
                value={preference}
                onChange={setPreference}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' }
                ]}
              />
            </Row>
          </Group>

          <Group title="CorelDRAW">
            <Row label="Installation" hint="Registration only shows that CorelDRAW is installed. Automation is confirmed by running the integration check on this computer.">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    {corel ? corel.x7Registered ? <Badge tone="ok">X7 registered</Badge> : corel.installed ? <Badge tone="warn">Other version</Badge> : <Badge tone="error">Not found</Badge> : <Badge>Checking…</Badge>}
                    <span className="muted">{corel ? corel.detail : ''}</span>
                  </p>
                  {corel && corel.progIds.length > 0 && <p className="mt-1 break-all font-mono text-xs">{corel.progIds.join(', ')}</p>}
                </div>
                <Button onClick={scan} loading={scanning}>
                  <Icon name="refresh" size={14} />
                  Rescan
                </Button>
              </div>
            </Row>
          </Group>

          <Group title="Output">
            <Row label="Default output folder" htmlFor="set-out">
              <div className="flex gap-2">
                <input id="set-out" className="input min-w-0 flex-1 font-mono text-xs" readOnly value={settings?.outputDirectory ?? ''} placeholder="Not set" />
                <Button onClick={pickFolder}>
                  <Icon name="folder" size={14} />
                  Choose…
                </Button>
              </div>
            </Row>
            <Row label="When a file exists">
              <fieldset>
                <legend className="sr-only">When a file already exists</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(Object.keys(OVERWRITE_LABELS) as OverwritePolicy[]).map((p) => (
                    <label key={p} className="flex items-center gap-1.5">
                      <input type="radio" className="check" name="overwrite" checked={settings?.overwritePolicy === p} onChange={() => update({ overwritePolicy: p })} />
                      {OVERWRITE_LABELS[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Row>
            <Row label="File name pattern" htmlFor="set-pattern" hint="Tokens: {row} for the spreadsheet row, {col:Header Name} for any column. Unsafe characters are replaced.">
              <input id="set-pattern" className="input w-full font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} onBlur={() => pattern !== settings?.fileNamePattern && update({ fileNamePattern: pattern })} />
            </Row>
            <Row label="Safety margin" htmlFor="set-margin" hint="Text closer than this to the card edge is flagged as possible overflow in previews and generation reports.">
              <div className="flex items-center gap-2">
                <input
                  id="set-margin"
                  className="input w-24"
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                  onBlur={() => {
                    const v = Number(margin)
                    if (Number.isFinite(v) && v !== settings?.safeMarginMm) void update({ safeMarginMm: v })
                  }}
                />
                <span className="muted">mm</span>
              </div>
            </Row>
            <Row label="PDF export" hint="Card-sheet jobs have their own PDF option on the Generate screen. Generated files are editable CDR in CorelDRAW X7 (v17) format.">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="check" checked={settings?.exportPdf ?? false} onChange={(e) => update({ exportPdf: e.target.checked })} />
                Also export a PDF next to each single-card CDR <Badge>Not available for single cards yet</Badge>
              </label>
            </Row>
          </Group>

          <Group title="Diagnostics">
            {info ? (
              <dl className="grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)] gap-x-4 gap-y-1">
                <dt className="muted">Version</dt>
                <dd>{info.appVersion}</dd>
                <dt className="muted">Electron / Chromium</dt>
                <dd>
                  {info.electronVersion} / {info.chromeVersion}
                </dd>
                <dt className="muted">Platform</dt>
                <dd>{info.platform}</dd>
                <dt className="muted">Display</dt>
                <dd className="tabular-nums">
                  {window.innerWidth} × {window.innerHeight} CSS px at {Math.round(window.devicePixelRatio * 100)}% scaling
                </dd>
                <dt className="muted">Data folder</dt>
                <dd className="break-all font-mono text-xs">{info.userDataPath}</dd>
              </dl>
            ) : (
              <p className="muted">Loading…</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => unwrap(api.app.openLogs()).catch((err) => toast.push('error', errorMessage(err)))}>
                <Icon name="folder" size={14} />
                Open log folder
              </Button>
              <Button onClick={copyDiagnostics} disabled={!info}>
                <Icon name="copy" size={14} />
                Copy diagnostics
              </Button>
            </div>
          </Group>
        </div>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1 border-b border-line pb-1 text-base">{title}</h2>
      <div className="divide-y divide-line/70">{children}</div>
    </section>
  )
}

/** Label above its control; groups sit in two columns on wide windows so the workspace is used. */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="py-2.5">
      <label htmlFor={htmlFor} className="mb-1 block font-medium">
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {hint && <p className="muted mt-1 text-xs">{hint}</p>}
      </div>
    </div>
  )
}
