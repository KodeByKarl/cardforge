// Shared layout probe: returns a list of layout problems for the screen currently shown.
/** Horizontal overflow of the shell and interactive controls that sit outside the window (excluding horizontally scrollable tables). */
export const OVERFLOW_PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight
  const issues = []
  const doc = document.documentElement
  if (doc.scrollWidth > vw + 1) issues.push('document scrolls horizontally: ' + doc.scrollWidth + ' > ' + vw)
  if (doc.scrollHeight > vh + 1) issues.push('document scrolls vertically: ' + doc.scrollHeight + ' > ' + vh)
  const scrollsX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true } return false }
  const scrollsY = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') return true } return false }
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=tab], [role=radio]')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
    const label = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30)
    if ((r.left < -1 || r.right > vw + 1) && !scrollsX(el)) issues.push('control outside window horizontally: ' + label)
    if (!scrollsY(el) && (r.top < -1 || r.bottom > vh + 1)) issues.push('control outside window vertically: ' + label)
  }
  // Text clipped inside fixed-size controls (buttons whose label is wider than the button).
  for (const el of document.querySelectorAll('button.btn, .btn')) {
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') issues.push('button label clipped: ' + el.textContent.trim().slice(0, 30))
  }
  // Overlapping controls inside the same toolbar / header.
  for (const bar of document.querySelectorAll('[role=toolbar], header')) {
    const items = [...bar.querySelectorAll('button, input, select')].filter((e) => e.offsetWidth && e.offsetHeight).map((e) => [e, e.getBoundingClientRect()])
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i][1], b = items[j][1]
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ox > 2 && oy > 2 && !items[i][0].contains(items[j][0]) && !items[j][0].contains(items[i][0])) issues.push('overlapping controls in toolbar')
    }
  }
  return issues
})()`
