import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'

export type Tone = 'neutral' | 'ok' | 'warn' | 'error' | 'info'

const SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted border-line',
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  error: 'bg-err-soft text-err border-err/30',
  info: 'bg-accent-soft text-accent border-accent/30'
}

const SOLID: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  ok: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-err',
  info: 'bg-accent'
}

export const TONE_TEXT: Record<Tone, string> = { neutral: 'text-fg-muted', ok: 'text-ok', warn: 'text-warn', error: 'text-err', info: 'text-accent' }

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 text-2xs font-semibold leading-4 ${SOFT[tone]}`}>{children}</span>
}

/** Status dot. Always paired with text elsewhere; `label` gives it an accessible name when it stands alone. */
export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${SOLID[tone]}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

const BANNER_ICON: Record<Tone, 'info' | 'alert' | 'check'> = { neutral: 'info', info: 'info', ok: 'check', warn: 'alert', error: 'alert' }

export function Banner({ tone, title, children, actions }: { tone: Tone; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded border px-2.5 py-1.5 ${SOFT[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICON[tone]} className="mt-0.5" size={14} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="break-words text-fg opacity-90">{children}</div>}
      </div>
      {actions}
    </div>
  )
}

/** One 44px row: title, optional one-line context, contextual actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-header shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <h1 className="shrink-0 text-base">{title}</h1>
      {description && <p className="muted min-w-0 flex-1 truncate compact:hidden">{description}</p>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Titled group inside a scrolling page: a hairline-ruled heading, no box. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 border-b border-line pb-1">
        <h2 className="label">{title}</h2>
        {aside && <div className="ml-auto text-xs text-fg-muted">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-10 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="muted mt-1">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'danger-solid' | 'ghost'
  loading?: boolean
}

const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: '',
  primary: 'btn-primary',
  danger: 'btn-danger',
  'danger-solid': 'btn-danger-solid',
  ghost: 'btn-ghost'
}

/** Loading keeps the label (stable width), shows a spinner, and ignores clicks without becoming un-focusable. */
export function Button({ variant = 'default', loading = false, className = '', children, onClick, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={`btn ${VARIANT[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

export function IconButton({ label, icon, pressed, tip = true, ...rest }: { label: string; icon: Parameters<typeof Icon>[0]['name']; pressed?: boolean; tip?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const button = (
    <button type="button" {...rest} aria-label={label} aria-pressed={pressed} className={`btn btn-icon btn-ghost ${pressed ? 'btn-pressed' : ''} ${rest.className ?? ''}`}>
      <Icon name={icon} />
    </button>
  )
  return tip ? <Tooltip text={label}>{button}</Tooltip> : button
}

/** Hover/focus tooltip that is also announced (aria-describedby) and never intercepts the pointer. */
export function Tooltip({ text, children, side = 'bottom' }: { text: string; children: ReactElement<{ 'aria-describedby'?: string }>; side?: 'bottom' | 'top' | 'right' }) {
  const id = useId()
  const pos = side === 'top' ? 'bottom-full mb-1 left-1/2 -translate-x-1/2' : side === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2' : 'top-full mt-1 left-1/2 -translate-x-1/2'
  return (
    <span className="group relative inline-flex">
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded bg-fg px-1.5 py-0.5 text-2xs font-medium text-bg opacity-0 shadow-pop transition-opacity delay-300 group-focus-within:opacity-100 group-hover:opacity-100 ${pos}`}
      >
        {text}
      </span>
    </span>
  )
}

export function Progress({ value, max, label, tone = 'info' }: { value: number; max: number; label: string; tone?: Tone }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 overflow-hidden rounded-sm bg-line">
      <div className={`h-full transition-[width] duration-200 ${SOLID[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Mutually exclusive choice rendered as a joined button group (radiogroup semantics, arrow-key navigation). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string }) {
  const onKey = (e: ReactKeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value)
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = options[(i + delta + options.length) % options.length]!
    onChange(next.value)
    ;(e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className="inline-flex h-control rounded border border-line-strong bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          data-value={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1 rounded-sm px-2.5 text-sm ${value === o.value ? 'bg-surface font-semibold text-fg shadow-card' : 'text-fg-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function tabId(prefix: string, key: string, part: 'tab' | 'panel'): string {
  return `${prefix}-${part}-${key}`
}

/** WAI-ARIA tabs (automatic activation): Left/Right/Home/End move and select. Pair each with a `role="tabpanel"` using tabId(). */
export function Tabs<T extends string>({ tabs, value, onChange, idPrefix, label }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void; idPrefix: string; label: string }) {
  const onKey = (e: ReactKeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === value)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next]!.key)
    document.getElementById(tabId(idPrefix, tabs[next]!.key, 'tab'))?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-0.5 border-b border-line px-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(idPrefix, t.key, 'tab')}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          aria-controls={tabId(idPrefix, t.key, 'panel')}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={`-mb-px flex h-control-lg items-center gap-1.5 border-b-2 px-3 ${value === t.key ? 'border-accent font-semibold text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog: focus moves in (to [data-autofocus] or the first control), Tab is trapped, Esc and the backdrop close it,
 * focus returns to the opener, and it never grows past the window (the body scrolls instead).
 */
export function Dialog({ title, onClose, children, footer, width = 440, dismissible = true }: { title: string; onClose: () => void; children?: ReactNode; footer: ReactNode; width?: number; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current!
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root
    target.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onCloseRef.current()
      }
      if (e.key !== 'Tab') return
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return e.preventDefault()
      const first = items[0]!
      const last = items[items.length - 1]!
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [dismissible])

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)` }}
        className="flex max-h-full flex-col rounded-lg bg-surface text-fg shadow-pop outline-none"
      >
        <h2 id={titleId} className="shrink-0 border-b border-line px-4 py-2.5 text-base">
          {title}
        </h2>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>}
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-surface-2 px-4 py-2.5">{footer}</div>
      </div>
    </div>,
    document.body
  )
}

interface ToastItem {
  id: number
  tone: Tone
  message: string
}

const ToastContext = createContext<{ push(tone: Tone, message: string): void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = next.current++
      setItems((l) => [...l.slice(-3), { id, tone, message }])
      setTimeout(() => dismiss(id), tone === 'error' ? 10000 : 5000)
    },
    [dismiss]
  )
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-8 right-3 z-50 flex w-[min(360px,calc(100vw-24px))] flex-col gap-1.5" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start gap-2 rounded border bg-surface px-2.5 py-2 shadow-pop ${SOFT[t.tone]}`}>
            <p className="min-w-0 flex-1 break-words text-fg">{t.message}</p>
            <button type="button" aria-label="Dismiss notification" className="shrink-0 text-fg-muted hover:text-fg" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

/** Observed content-box size of an element, in CSS px. Returns a callback ref so it also works for conditionally mounted elements. */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}

/** `/` or a shortcut hint rendered as a key cap. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-line-strong bg-surface-2 px-1 font-sans text-2xs text-fg-muted">{children}</kbd>
}
