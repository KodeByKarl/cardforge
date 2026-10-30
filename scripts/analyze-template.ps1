# Structural, REDACTED analysis of a CDR template (read-only: the document is closed without saving).
# Usage: powershell -File scripts\analyze-template.ps1 -Path <cdr> -Out <json>
# ASCII-only file (Windows PowerShell 5.1). Text content is redacted: letters -> a/A, digits -> 9; known static labels are kept.
param([string]$Path, [string]$Out)
$ErrorActionPreference = 'Stop'
$labels = @('ADDRESS:', 'CONTROL NO.:', 'CONTROL NO:', 'PRECINCT NO:', 'PRECINCT NO.:', 'NAME:', 'BIRTHDATE:')
function Redact([string]$t) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $t.ToCharArray()) {
    if ([char]::IsDigit($ch)) { [void]$sb.Append('9') }
    elseif ([char]::IsUpper($ch)) { [void]$sb.Append('A') }
    elseif ([char]::IsLetter($ch)) { [void]$sb.Append('a') }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}
$app = New-Object -ComObject CorelDRAW.Application.27
$doc = $app.OpenDocument($Path)
$doc.Unit = 3
$rows = New-Object System.Collections.ArrayList
$stat = @{ shapes = 0; types = @{} }
function Walk($shapes, [int]$pageIdx, [string]$path, $page) {
  for ($i = 1; $i -le $shapes.Count; $i++) {
    $s = $shapes.Item($i)
    $stat.shapes++
    $t = [string]$s.Type
    $stat.types[$t] = 1 + [int]$stat.types[$t]
    if ($s.Type -eq 6) {
      $story = $s.Text.Story
      $raw = [string]$story.Text
      $first = $story.Characters.Item(1)
      $mixed = $false
      $n = $story.Characters.Count
      for ($c = 2; $c -le [math]::Min($n, 200); $c++) { $ch = $story.Characters.Item($c); if ($ch.Font -ne $first.Font -or $ch.Bold -ne $first.Bold -or $ch.Italic -ne $first.Italic) { $mixed = $true; break } }
      $isLabel = $labels -contains $raw.Trim()
      [void]$rows.Add([ordered]@{
        page = $pageIdx; path = $path; staticId = $s.StaticID; name = [string]$s.Name
        kind = $(if ($s.Text.Type -eq 1) { 'paragraph' } else { 'artistic' })
        left = [math]::Round($s.LeftX - $page.LeftX, 2); bottom = [math]::Round($s.BottomY - $page.BottomY, 2)
        right = [math]::Round($s.RightX - $page.LeftX, 2); top = [math]::Round($s.TopY - $page.BottomY, 2)
        chars = $raw.Length; lines = ($raw -split "`r").Count; mixedFormatting = $mixed
        font = [string]$first.Font; sizePt = [math]::Round($first.Size, 2)
        text = $(if ($isLabel) { $raw.Trim() } else { Redact $raw })
      })
    } elseif ($s.Type -eq 7) {
      Walk $s.Shapes $pageIdx ($path + '/Group') $page
    }
    $clip = $null; try { $clip = $s.PowerClip } catch {}
    if ($clip) { Walk $clip.Shapes $pageIdx ($path + '/PowerClip') $page }
  }
}
try {
  for ($p = 1; $p -le $doc.Pages.Count; $p++) {
    $page = $doc.Pages.Item($p)
    Walk $page.Shapes $p '' $page
  }
  $result = [ordered]@{ pages = $doc.Pages.Count; widthMm = $doc.Pages.Item(1).SizeWidth; heightMm = $doc.Pages.Item(1).SizeHeight; version = [string]$app.Version; shapeCount = $stat.shapes; typeCounts = $stat.types; text = $rows }
  ($result | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Out -Encoding UTF8
} finally {
  try { $doc.Dirty = $false; $doc.Close() } catch {}
}
