// Resizes the REAL window (no viewport emulation) and checks the layout follows. Windows only.
import { execFileSync } from 'node:child_process'
import { launch, sleep } from './driver.mjs'

const app = await launch({ port: 9444 })
await app.send('Emulation.clearDeviceMetricsOverride')
const ps = (w, h) => `Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int w, int hh, uint f);'
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'CardForge' } | Select-Object -First 1
[N.W]::SetWindowPos($p.MainWindowHandle, [System.IntPtr]::Zero, 20, 20, ${w}, ${h}, 0x4) | Out-Null`
let bad = 0
for (const [w, h] of [[1000, 640], [1500, 900], [900, 600], [1800, 1000]]) {
  execFileSync('powershell', ['-NoProfile', '-Command', ps(w, h)])
  await sleep(600)
  const v = await app.eval('({iw: innerWidth, ih: innerHeight, rw: document.getElementById("root").getBoundingClientRect().width, rh: document.getElementById("root").getBoundingClientRect().height})')
  const ok = Math.abs(v.rw - v.iw) < 2 && Math.abs(v.rh - v.ih) < 2 && v.iw > w * 0.9 / 1
  console.log(w, h, JSON.stringify(v), ok ? 'ok' : 'MISMATCH')
  if (!ok) bad++
}
await app.close()
process.exit(bad ? 1 : 0)
