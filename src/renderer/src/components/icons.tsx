import type { ReactNode } from 'react'

/** 16px line icons, drawn on a 16 grid with a 1.4 stroke so they match the 13px UI text. */
const PATHS = {
  dashboard: 'M2.5 2.5h4.5v6H2.5zM9 2.5h4.5v3H9zM9 7.5h4.5v6H9zM2.5 10.5H7v3H2.5z',
  import: 'M8 2v7.5M5 6.8 8 9.8l3-3M2.5 11v2.5h11V11',
  template: 'M2.5 2.5h11v11h-11zM2.5 6h11M6 6v7.5',
  preview: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  generate: 'M3.5 2.5v11l9-5.5z',
  settings: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M9.5 3v3M5.5 10v3',
  check: 'm3.5 8.5 3 3 6-7',
  alert: 'M8 2.2 14.2 13H1.8zM8 6.5v3.3M8 11.4v.1',
  x: 'm4 4 8 8M12 4l-8 8',
  chevronLeft: 'm10 3.5-4.5 4.5 4.5 4.5',
  chevronRight: 'm6 3.5 4.5 4.5L6 12.5',
  chevronDown: 'm3.5 6 4.5 4.5L12.5 6',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.4 10.4l3.3 3.3',
  zoomIn: 'M3.5 8h9M8 3.5v9',
  zoomOut: 'M3.5 8h9',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  single: 'M2.5 3.5h11v9h-11z',
  grid: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9H7v4.5H2.5zM9 9h4.5v4.5H9z',
  folder: 'M1.5 3.5h4.5l1.5 1.8h6.5v7.2h-12.5z',
  sun: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  sidebar: 'M2.5 2.5h11v11h-11zM10 2.5v11',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3',
  file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  plus: 'M8 3v10M3 8h10',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
  info: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 7.2V11M8 4.9v.1'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Brand mark: a trim rectangle with crop marks, the same motif as the preview canvas. */
export function BrandMark({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden focusable="false">
      <rect x="4.5" y="5.5" width="9" height="7" rx="0.5" className="fill-accent" />
      <path d="M1 5.5h2.5M14.5 5.5H17M1 12.5h2.5M14.5 12.5H17M4.5 1v2.5M4.5 14.5V17M13.5 1v2.5M13.5 14.5V17" className="stroke-fg-muted" strokeWidth="1" />
    </svg>
  )
}
