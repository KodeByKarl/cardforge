import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
const KEY = 'cardforge.theme'

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (query().matches ? 'dark' : 'light') : pref
}

/** Applied once before first render so the window never flashes the wrong theme. */
export function applyStoredTheme(): void {
  document.documentElement.dataset['theme'] = resolveTheme(readPreference())
}

interface ThemeContextValue {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference(p: ThemePreference): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readPreference)
  const [resolved, setResolved] = useState(() => resolveTheme(preference))

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(preference)
      document.documentElement.dataset['theme'] = next
      setResolved(next)
    }
    apply()
    const mq = query()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [preference])

  const setPreference = (p: ThemePreference) => {
    setPref(p)
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      // Storage unavailable: the choice applies for this session only.
    }
  }

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
