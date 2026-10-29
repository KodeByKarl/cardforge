<#
  CardForge CorelDRAW bridge. Long-lived worker started by the Electron main process.

  Protocol (one request in flight at a time):
    stdin : one line per request  = Base64( UTF-8 JSON {"id":n,"cmd":"...","args":{...}} )
    stdout: one line per response = "CFB1 " + Base64( UTF-8 JSON {"id":n,"ok":true,"data":...}
                                                      or {"id":n,"ok":false,"error":{"code":"..","message":".."}} )
  Base64 keeps names like "Nunez" with accents intact regardless of the console code page.
  Startup sends {"id":0,"ok":true,"data":{"ready":true}}.

  Rules:
    * This file must stay ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).
    * Only documents opened through this bridge are ever touched or closed. CorelDRAW is quit only if this
      bridge started it AND no other documents are open.
    * The CorelDRAW calls below were verified on CorelDRAW v27.2. X7 (v17) compatibility is pending validation.
    * Optional COM struct arguments are always passed explicitly (PowerShell's COM binder fails otherwise).
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# Constants read from the CorelDRAW type library.
$cdrTextShape = 6
$cdrGroupShape = 7
$cdrMillimeter = 3
$cdrPNG = 802
$cdrCurrentPage = 1
$cdrRGBColorImage = 4
$cdrNormalAntiAliasing = 1
$cdrParagraphText = 1

$script:app = $null
$script:progId = $null
$script:startedApp = $false
$script:docs = @{}
$script:nextHandle = 1
# 'undo' when command groups + Undo work; 'restore' (explicit reset of text and base formatting) otherwise.
$script:revertMode = 'undo'

function Send($obj) {
  $json = ConvertTo-Json -InputObject $obj -Depth 12 -Compress
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.WriteLine('CFB1 ' + $b64)
  [Console]::Out.Flush()
}

function Fail([string]$code, [string]$message) {
  $e = New-Object System.Exception($message)
  $e.Data['code'] = $code
  throw $e
}

function Round3([double]$v) {
  if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return 0 }
  return [math]::Round($v, 3)
}

function Require-App {
  if (-not $script:app) { Fail 'COREL_NOT_CONNECTED' 'connect must be called first.' }
}

function Get-Doc([string]$handle) {
  if (-not $script:docs.ContainsKey($handle)) { Fail 'UNKNOWN_DOCUMENT' "Unknown document handle '$handle'." }
  return $script:docs[$handle]
}

# Always pass StructSaveAsOptions: with one argument PowerShell treats SaveAs as a property setter.
function Save-Cdr($doc, [string]$path, [int]$version) {
  $opts = $script:app.CreateStructSaveAsOptions()
  $opts.Version = $version
  $doc.SaveAs($path, $opts)
}

# ---- Shape index: every named text object on every page, including inside groups and PowerClips ----

function Add-Shapes($shapes, [int]$pageIndex, [string[]]$path, $entries, $counter) {
  for ($i = 1; $i -le $shapes.Count; $i++) {
    $s = $shapes.Item($i)
    $type = $s.Type
    if ($type -eq $cdrTextShape) {
      if ($s.Name) {
        # Original text and base formatting, used to reset the object if Undo is unavailable.
        $story = $s.Text.Story
        $c1 = $story.Characters.Item(1)
        $base = @{ text = $story.Text; font = $c1.Font; size = $c1.Size; bold = $c1.Bold; italic = $c1.Italic }
        [void]$entries.Add(@{ name = $s.Name; shape = $s; pageIndex = $pageIndex; path = $path; base = $base })
      }
      else { $counter.unnamed++ }
    } elseif ($type -eq $cdrGroupShape) {
      $label = if ($s.Name) { $s.Name } else { 'Group' }
      Add-Shapes $s.Shapes $pageIndex ($path + $label) $entries $counter
    }
    $clip = $null
    try { $clip = $s.PowerClip } catch { $clip = $null }
    if ($clip) {
      $label = if ($s.Name) { "PowerClip:$($s.Name)" } else { 'PowerClip' }
      Add-Shapes $clip.Shapes $pageIndex ($path + $label) $entries $counter
    }
  }
}

function Build-Index($doc) {
  $entries = New-Object System.Collections.ArrayList
  $counter = @{ unnamed = 0 }
  for ($p = 1; $p -le $doc.Pages.Count; $p++) {
    Add-Shapes $doc.Pages.Item($p).Shapes $p @() $entries $counter
  }
  return @{ entries = $entries; unnamed = $counter.unnamed }
}

# Replacing Story.Text flattens mixed formatting, so detect it up front.
function Test-MixedFormatting($story) {
  $n = $story.Characters.Count
  if ($n -le 1) { return $false }
  if ($story.Size -lt 0.01) { return $true } # CorelDRAW reports FLT_MIN for mixed sizes
  $first = $story.Characters.Item(1)
  $font = $first.Font; $bold = $first.Bold; $italic = $first.Italic
  $limit = [math]::Min($n, 200)
  for ($i = 2; $i -le $limit; $i++) {
    $c = $story.Characters.Item($i)
    if ($c.Font -ne $font -or $c.Bold -ne $bold -or $c.Italic -ne $italic) { return $true }
  }
  return $false
}

function Get-PageBox($doc, [int]$pageIndex) {
  $page = $doc.Pages.Item($pageIndex)
  return @{ left = $page.LeftX; bottom = $page.BottomY; width = $page.SizeWidth; height = $page.SizeHeight }
}

function Get-Bounds($shape, $box) {
  return @{
    left = Round3 ($shape.LeftX - $box.left)
    bottom = Round3 ($shape.BottomY - $box.bottom)
    right = Round3 ($shape.RightX - $box.left)
    top = Round3 ($shape.TopY - $box.bottom)
  }
}

function Test-Overflow($entry, $box, [double]$safeMarginMm) {
  $s = $entry.shape
  $text = $s.Text
  if ($text.Type -eq $cdrParagraphText) {
    $over = $false
    try { $over = [bool]$text.Overflow } catch {
      # Fallback for versions without Text.Overflow: fewer characters in the frame than in the story.
      $over = $text.Frame.Range.Characters.Count -lt $text.Story.Characters.Count
    }
    if ($over) { return 'Text does not fit its paragraph frame.' }
    # Frames set to grow with their text never report overflow, so fall through to the card-edge check.
  }
  $b = Get-Bounds $s $box
  $m = $safeMarginMm
  if ($b.left -lt $m -or $b.bottom -lt $m -or $b.right -gt ($box.width - $m) -or $b.top -gt ($box.height - $m)) {
    return ("Text extends into the {0} mm safety margin or past the card edge." -f $m)
  }
  return $null
}

# ---- Commands ----

function Cmd-Connect($a) {
  if ($script:app) { return @{ version = "$($script:app.Version)"; progId = $script:progId; attached = (-not $script:startedApp) } }
  $progId = [string]$a.progId
  if ($progId -notmatch '^CorelDRAW\.Application\.\d+$') { Fail 'INVALID_ARGS' "Invalid ProgID '$progId'." }
  try {
    $script:app = [Runtime.InteropServices.Marshal]::GetActiveObject($progId)
    $script:startedApp = $false
  } catch {
    try { $script:app = New-Object -ComObject $progId } catch { Fail 'COREL_UNAVAILABLE' "CorelDRAW could not be started ($progId): $($_.Exception.Message)" }
    $script:startedApp = $true
  }
  $script:progId = $progId
  return @{ version = "$($script:app.Version)"; progId = $progId; attached = (-not $script:startedApp) }
}

function Cmd-OpenDoc($a) {
  Require-App
  $path = [string]$a.path
  if (-not (Test-Path -LiteralPath $path)) { Fail 'FILE_NOT_FOUND' "File not found: $path" }
  $doc = $script:app.OpenDocument($path)
  $doc.Unit = $cdrMillimeter
  $handle = "d$($script:nextHandle)"
  $script:nextHandle++
  $script:docs[$handle] = @{ doc = $doc; index = (Build-Index $doc); applied = $false }
  return @{ handle = $handle }
}

function Cmd-CloseDoc($a) {
  $h = [string]$a.handle
  if ($script:docs.ContainsKey($h)) {
    $doc = $script:docs[$h].doc
    $script:docs.Remove($h)
    try { $doc.Dirty = $false; $doc.Close() } catch {}
  }
  return @{ closed = $true }
}

function Cmd-Inspect($a) {
  $d = Get-Doc ([string]$a.handle)
  Revert-Record $d
  $doc = $d.doc
  $pages = New-Object System.Collections.ArrayList
  for ($p = 1; $p -le $doc.Pages.Count; $p++) {
    $page = $doc.Pages.Item($p)
    [void]$pages.Add(@{ index = $p; name = "$($page.Name)"; widthMm = Round3 $page.SizeWidth; heightMm = Round3 $page.SizeHeight })
  }
  $objects = New-Object System.Collections.ArrayList
  foreach ($e in $d.index.entries) {
    $s = $e.shape
    $story = $s.Text.Story
    $box = Get-PageBox $doc $e.pageIndex
    $first = $story.Characters.Item(1)
    [void]$objects.Add(@{
      name = $e.name
      pageIndex = $e.pageIndex
      path = [object[]]$e.path
      text = ($story.Text -replace "`r", "`n")
      font = "$($first.Font)"
      sizePt = Round3 $first.Size
      bold = [bool]$first.Bold
      italic = [bool]$first.Italic
      alignment = [int]$story.Alignment
      isParagraph = ($s.Text.Type -eq $cdrParagraphText)
      mixedFormatting = (Test-MixedFormatting $story)
      bounds = (Get-Bounds $s $box)
    })
  }
  return @{ pages = [object[]]$pages; objects = [object[]]$objects; unnamedTextCount = $d.index.unnamed; corelVersion = "$($script:app.Version)" }
}

# Returns the document to the template state before the next record. Replacing text keeps the CURRENT
# formatting, and CorelDRAW switches fonts automatically for some scripts (e.g. CJK -> SimSun), so without this
# every card after such a record would inherit the substituted font.
function Revert-Record($d) {
  if (-not $d.applied) { return }
  if ($script:revertMode -eq 'undo') {
    try { $d.doc.Undo(1); $d.applied = $false; return } catch { $script:revertMode = 'restore' }
  }
  foreach ($e in $d.index.entries) {
    $story = $e.shape.Text.Story
    $story.Text = $e.base.text
    $story.Font = $e.base.font
    $story.Size = $e.base.size
    $story.Bold = $e.base.bold
    $story.Italic = $e.base.italic
  }
  $d.applied = $false
}

function Cmd-Apply($a) {
  $d = Get-Doc ([string]$a.handle)
  Revert-Record $d
  $grouped = $false
  if ($script:revertMode -eq 'undo') {
    try { $d.doc.BeginCommandGroup('CardForge record'); $grouped = $true } catch { $script:revertMode = 'restore' }
  }
  try {
    $result = Apply-Values $d $a
  } finally {
    if ($grouped) { $d.doc.EndCommandGroup() }
    $d.applied = $true
  }
  return $result
}

function Apply-Values($d, $a) {
  $safe = [double]$a.safeMarginMm
  $results = New-Object System.Collections.ArrayList
  $notFound = New-Object System.Collections.ArrayList
  foreach ($prop in $a.values.PSObject.Properties) {
    $name = $prop.Name
    $value = ([string]$prop.Value) -replace "`r`n", "`r" -replace "`n", "`r"
    # Not "$matches": that is PowerShell's automatic regex variable.
    $hits = @($d.index.entries | Where-Object { $_.name -eq $name })
    if ($hits.Count -eq 0) { [void]$notFound.Add($name); continue }
    foreach ($e in $hits) {
      $e.shape.Text.Story.Text = $value
      $box = Get-PageBox $d.doc $e.pageIndex
      $reason = $null
      if ($value.Length -gt 0) { $reason = Test-Overflow $e $box $safe }
      [void]$results.Add(@{ name = $name; pageIndex = $e.pageIndex; overflow = ($null -ne $reason); reason = $reason; bounds = (Get-Bounds $e.shape $box) })
    }
  }
  return @{ objects = [object[]]$results; notFound = [object[]]$notFound; revertMode = $script:revertMode }
}

function Cmd-ExportPages($a) {
  $d = Get-Doc ([string]$a.handle)
  $doc = $d.doc
  $dpi = [int]$a.dpi
  $dir = [string]$a.dir
  $files = New-Object System.Collections.ArrayList
  $active = $doc.ActivePage.Index
  try {
    foreach ($p in $a.pages) {
      $pi = [int]$p
      if ($pi -lt 1 -or $pi -gt $doc.Pages.Count) { Fail 'INVALID_ARGS' "Page $pi does not exist." }
      $page = $doc.Pages.Item($pi)
      $page.Activate()
      $w = [int][math]::Round($page.SizeWidth / 25.4 * $dpi)
      $h = [int][math]::Round($page.SizeHeight / 25.4 * $dpi)
      $opts = $script:app.CreateStructExportOptions()
      $opts.ResolutionX = $dpi
      $opts.ResolutionY = $dpi
      $opts.SizeX = $w
      $opts.SizeY = $h
      $opts.ImageType = $cdrRGBColorImage
      $opts.AntiAliasingType = $cdrNormalAntiAliasing
      $opts.MaintainAspect = $true
      $opts.Overwrite = $true
      # Without an explicit area, "current page" export crops to the drawing's content.
      $opts.ExportArea = $script:app.CreateRect($page.LeftX, $page.BottomY, $page.SizeWidth, $page.SizeHeight)
      $file = Join-Path $dir ("{0}-p{1}.png" -f [string]$a.prefix, $pi)
      $doc.Export($file, $cdrPNG, $cdrCurrentPage, $opts, $script:app.CreateStructPaletteOptions())
      [void]$files.Add(@{ pageIndex = $pi; path = $file; widthPx = $w; heightPx = $h })
    }
  } finally {
    try { $doc.Pages.Item($active).Activate() } catch {}
  }
  return @{ files = [object[]]$files }
}

function Cmd-SaveAs($a) {
  $d = Get-Doc ([string]$a.handle)
  $version = [int]$a.version
  Save-Cdr $d.doc ([string]$a.path) $version
  return @{ path = [string]$a.path }
}

function Cleanup {
  foreach ($h in @($script:docs.Keys)) { Cmd-CloseDoc @{ handle = $h } | Out-Null }
  if ($script:app -and $script:startedApp) {
    try { if ($script:app.Documents.Count -eq 0) { $script:app.Quit() } } catch {}
  }
  $script:app = $null
}

function Invoke-Request([string]$cmd, $a) {
  switch ($cmd) {
    'ping' { return @{ pong = $true } }
    'connect' { return Cmd-Connect $a }
    'openDoc' { return Cmd-OpenDoc $a }
    'closeDoc' { return Cmd-CloseDoc $a }
    'inspect' { return Cmd-Inspect $a }
    'apply' { return Cmd-Apply $a }
    'exportPages' { return Cmd-ExportPages $a }
    'saveAs' { return Cmd-SaveAs $a }
    'shutdown' { Cleanup; return @{ bye = $true } }
    default { Fail 'UNKNOWN_COMMAND' "Unknown command '$cmd'." }
  }
}

function Error-Code($ex) {
  if ($ex.Data.Contains('code')) { return [string]$ex.Data['code'] }
  $inner = $ex
  while ($inner) {
    if ($inner -is [System.Runtime.InteropServices.COMException]) {
      switch ([uint32]$inner.ErrorCode) {
        0x8001010A { return 'COREL_BUSY' }        # RPC_E_SERVERCALL_RETRYLATER: modal dialog or busy
        0x800706BA { return 'COREL_GONE' }        # RPC_S_SERVER_UNAVAILABLE: CorelDRAW exited/crashed
        0x80010108 { return 'COREL_GONE' }        # RPC_E_DISCONNECTED
      }
    }
    $inner = $inner.InnerException
  }
  return 'COREL_ERROR'
}

Send @{ id = 0; ok = $true; data = @{ ready = $true; psVersion = "$($PSVersionTable.PSVersion)" } }
try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    $id = -1
    $cmd = ''
    try {
      $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
      $id = [int]$req.id
      $cmd = [string]$req.cmd
      $data = Invoke-Request $cmd $req.args
      Send @{ id = $id; ok = $true; data = $data }
    } catch {
      $ex = $_.Exception
      $msg = $ex.Message
      if ($ex.InnerException -and $ex.InnerException.Message -ne $msg) { $msg += ' | ' + $ex.InnerException.Message }
      $code = Error-Code $ex
      if ($code -eq 'COREL_GONE') { $script:app = $null; $script:docs = @{} }
      Send @{ id = $id; ok = $false; error = @{ code = $code; message = $msg } }
    }
    if ($cmd -eq 'shutdown') { break }
  }
} finally {
  Cleanup
}
