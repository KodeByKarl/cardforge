import type { ReactNode } from 'react'

type Tone = 'neutral' | 'ok' | 'warn' | 'error' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  error: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300',
  info: 'bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300'
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>{children}</span>
}

const DOTS: Record<Tone, string> = {
  neutral: 'bg-stone-400',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-teal-500'
}

export function StatusDot({ tone }: { tone: Tone }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOTS[tone]}`} aria-hidden />
}

export function Banner({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  return (
    <div className={`rounded-md px-3 py-2 ${TONES[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-0.5 opacity-90">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 px-6 pb-4 pt-5 dark:border-stone-800">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="muted mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Stat({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: Tone }) {
  const color =
    tone === 'error'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'ok'
          ? 'text-emerald-700 dark:text-emerald-400'
          : ''
  return (
    <div className="min-w-[96px]">
      <p className="eyebrow">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}
