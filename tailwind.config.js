/** @type {import('tailwindcss').Config} */
// All colors come from the CSS variables in src/renderer/src/index.css (the single source of truth for both themes).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    // Compact desktop type scale: 11 / 12 / 13 (body) / 14 / 16 / 20.
    fontSize: {
      '2xs': ['11px', '16px'],
      xs: ['12px', '16px'],
      sm: ['13px', '18px'],
      base: ['14px', '20px'],
      lg: ['16px', '22px'],
      xl: ['20px', '26px']
    },
    // Small, sharp radii: this is a tool, not a marketing page.
    borderRadius: { none: '0', sm: '2px', DEFAULT: '3px', md: '4px', lg: '6px', full: '9999px' },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      black: '#000',
      white: '#fff',
      bg: token('bg'),
      surface: token('surface'),
      'surface-2': token('surface-2'),
      rail: token('rail'),
      canvas: token('canvas'),
      overlay: token('overlay'),
      hover: token('hover'),
      line: token('line'),
      'line-strong': token('line-strong'),
      fg: token('fg'),
      'fg-muted': token('fg-muted'),
      'fg-subtle': token('fg-subtle'),
      accent: token('accent'),
      'accent-hover': token('accent-hover'),
      'accent-fg': token('accent-fg'),
      'accent-soft': token('accent-soft'),
      ok: token('ok'),
      'ok-soft': token('ok-soft'),
      warn: token('warn'),
      'warn-soft': token('warn-soft'),
      err: token('err'),
      'err-soft': token('err-soft')
    },
    extend: {
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'monospace']
      },
      // Fixed component dimensions.
      spacing: { control: '28px', 'control-lg': '36px', header: '44px', status: '24px', rail: '208px', 'rail-compact': '48px' },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(0 0 0 / 0.08)',
        pop: '0 8px 24px rgb(0 0 0 / 0.22), 0 0 0 1px rgb(var(--line-strong))'
      },
      screens: {
        // Desktop breakpoints on the CSS viewport (window width / display scaling), not device classes.
        compact: { raw: '(max-width: 1099px)' },
        wide: '1280px',
        short: { raw: '(max-height: 679px)' }
      }
    }
  },
  plugins: []
}
