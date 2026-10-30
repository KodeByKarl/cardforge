import type { SheetMode } from '../../../shared/sheet/types'

const OPTIONS: { value: SheetMode; title: (n: number) => string; text: (n: number) => string }[] = [
  { value: 'unique', title: (n) => `${n} different records per sheet`, text: (n) => `Every card position gets the next record. ${n} people per A4 sheet; each record is printed once.` },
  { value: 'copies', title: (n) => `${n} copies of the same record per sheet`, text: (n) => `Each record gets its own A4 sheet and fills all ${n} card positions with identical cards.` }
]

/** Explicit production-mode choice. There is no default: nothing is generated or previewed until one is picked. */
export function SheetModePicker({ value, onChange, cards, disabled }: { value: SheetMode | null; onChange: (m: SheetMode) => void; cards: number; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} data-testid="mode-picker">
      <legend className="mb-1 font-medium">Production mode</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`flex cursor-pointer gap-2 rounded border p-2 ${value === o.value ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-surface-2'}`}>
            <input type="radio" className="check mt-0.5" name="sheet-mode" data-testid={`mode-${o.value}`} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>
              <span className="block font-semibold">{o.title(cards)}</span>
              <span className="muted block text-xs">{o.text(cards)}</span>
            </span>
          </label>
        ))}
      </div>
      {value === null && <p className="mt-1 text-xs text-warn">Choose a mode. This system never assumes one.</p>}
    </fieldset>
  )
}
