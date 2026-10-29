import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, AppSettings, CorelDetection, OverwritePolicy } from '../../../shared/types'
import { api, errorMessage, unwrap } from '../api'
import { Badge, Banner, PageHeader } from '../components/ui'

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

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-4 p-6">
        {error && <Banner tone="error" title="Settings error">{error}</Banner>}

        <Section title="CorelDRAW">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Installation</span>
                {corel && (corel.x7Registered ? <Badge tone="ok">X7 registered</Badge> : corel.installed ? <Badge tone="warn">Other version</Badge> : <Badge tone="error">Not found</Badge>)}
              </div>
              <p className="muted mt-1">{corel ? corel.detail : 'Checking…'}</p>
              {corel && corel.progIds.length > 0 && <p className="mt-1 font-mono text-xs">{corel.progIds.join(', ')}</p>}
              <p className="muted mt-2 text-xs">
                Registration only shows that CorelDRAW is installed. Automation is confirmed by running the integration check on this computer.
              </p>
            </div>
            <button className="btn" onClick={scan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
        </Section>

        <Section title="Output">
          <Field label="Default output folder">
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs" readOnly value={settings?.outputDirectory ?? ''} placeholder="Not set" />
              <button className="btn" onClick={pickFolder}>
                Choose…
              </button>
            </div>
          </Field>
          <Field label="When a file already exists">
            <div className="flex flex-wrap gap-4">
              {(Object.keys(OVERWRITE_LABELS) as OverwritePolicy[]).map((p) => (
                <label key={p} className="flex items-center gap-1.5">
                  <input type="radio" name="overwrite" checked={settings?.overwritePolicy === p} onChange={() => update({ overwritePolicy: p })} />
                  {OVERWRITE_LABELS[p]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="File name pattern" hint="Tokens: {row} for the spreadsheet row, {col:Header Name} for any column. Unsafe characters are replaced.">
            <input
              className="input w-full font-mono text-xs"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onBlur={() => pattern !== settings?.fileNamePattern && update({ fileNamePattern: pattern })}
            />
          </Field>
          <Field label="Safety margin" hint="Text closer than this to the card edge is flagged as possible overflow in previews and generation reports.">
            <div className="flex items-center gap-2">
              <input
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
          </Field>
          <Field label="Export preferences">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={settings?.exportPdf ?? false} onChange={(e) => update({ exportPdf: e.target.checked })} />
              Also export a PDF next to each CDR <Badge>Optional · not built yet</Badge>
            </label>
          </Field>
          <p className="muted text-xs">Generated files are editable CDR in CorelDRAW X7 (v17) format.</p>
        </Section>

        <Section title="Application">
          {info ? (
            <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-1">
              <dt className="muted">Version</dt>
              <dd>{info.appVersion}</dd>
              <dt className="muted">Electron / Chromium</dt>
              <dd>
                {info.electronVersion} / {info.chromeVersion}
              </dd>
              <dt className="muted">Platform</dt>
              <dd>{info.platform}</dd>
              <dt className="muted">Data folder</dt>
              <dd className="break-all font-mono text-xs">{info.userDataPath}</dd>
            </dl>
          ) : (
            <p className="muted">Loading…</p>
          )}
          <button className="btn mt-3" onClick={() => unwrap(api.app.openLogs()).catch((err) => setError(errorMessage(err)))}>
            Open log folder
          </button>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="eyebrow border-b border-stone-100 px-4 py-2.5 dark:border-stone-800">{title}</h2>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-medium">{label}</p>
      {children}
      {hint && <p className="muted mt-1 text-xs">{hint}</p>}
    </div>
  )
}
