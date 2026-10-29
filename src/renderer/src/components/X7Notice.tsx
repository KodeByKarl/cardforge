import { corelMajor } from '../state/corel'
import { Banner } from './ui'

/** Shown wherever results come from a CorelDRAW version other than the client's X7 (v17). */
export function X7Notice({ version, compact = false }: { version: string | null | undefined; compact?: boolean }) {
  const major = corelMajor(version)
  if (major === 17) return null
  const text =
    major === null
      ? 'CorelDRAW X7 compatibility is pending validation on the client’s computer.'
      : `Rendered and generated with CorelDRAW ${major}, not X7. Verified on this version only; X7 compatibility is pending validation on the client’s computer.`
  if (compact) return <p className="text-xs text-amber-800 dark:text-amber-300">{text}</p>
  return <Banner tone="warn" title="X7 validation pending">{text}</Banner>
}
