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
# Base formatting is only needed for the explicit-restore fallback; it is skipped when rebuilding the index of big documents.
$script:captureBase = $true

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

function Opt($a, [string]$name, $default) {
  if ($a -and ($a.PSObject.Properties.Name -contains $name) -and $null -ne $a.$name) { return $a.$name }
  return $default
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
        $base = $null
        if ($script:captureBase) {
          $story = $s.Text.Story
          $c1 = $story.Characters.Item(1)
          $base = @{ text = $story.Text; font = $c1.Font; size = $c1.Size; bold = $c1.Bold; italic = $c1.Italic }
        }
        [void]$entries.Add(@{ name = $s.Name; shape = $s; pageIndex = $pageIndex; path = $path; base = $base })
      }
      else {
        $counter.unnamed++
        # Ordinal in document traversal order: the same for every open of the same file; used to name the object.
        [void]$counter.list.Add(@{ uid = "u$($counter.unnamed)"; shape = $s; pageIndex = $pageIndex; path = $path })
      }
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
  $counter = @{ unnamed = 0; list = (New-Object System.Collections.ArrayList) }
  for ($p = 1; $p -le $doc.Pages.Count; $p++) {
    Add-Shapes $doc.Pages.Item($p).Shapes $p @() $entries $counter
  }
  return @{ entries = $entries; unnamed = $counter.unnamed; unnamedList = $counter.list }
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

function Test-Overflow($entry, $box, [double]$safeMarginMm, $b) {
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
  # A light open (used to verify finished output) skips indexing every text object, which is slow for big documents.
  $index = $null
  if ([bool](Opt $a 'light' $false)) { $index = @{ entries = (New-Object System.Collections.ArrayList); unnamed = 0; unnamedList = (New-Object System.Collections.ArrayList) } }
  else { $index = Build-Index $doc }
  $script:docs[$handle] = @{ doc = $doc; index = $index; applied = $false; cleared = $false }
  return @{ handle = $handle }
}

# Page count only: cheap, works on a light-opened document.
function Cmd-DocInfo($a) {
  $d = Get-Doc ([string]$a.handle)
  return @{ pages = [int]$d.doc.Pages.Count }
}

# Which of the given font names are not installed in Windows. CorelDRAW substitutes a missing font silently, so this is
# the only warning the operator gets. Names are compared case-insensitively against the installed font families.
function Cmd-CheckFonts($a) {
  Add-Type -AssemblyName System.Drawing
  $installed = @{}
  foreach ($f in (New-Object System.Drawing.Text.InstalledFontCollection).Families) { $installed[$f.Name.ToLowerInvariant()] = $true }
  $missing = New-Object System.Collections.ArrayList
  foreach ($name in $a.fonts) {
    $n = ([string]$name).ToLowerInvariant()
    if (-not $installed.ContainsKey($n)) { [void]$missing.Add([string]$name) }
  }
  return @{ missing = [object[]]$missing; installedCount = $installed.Count }
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
  $unnamed = New-Object System.Collections.ArrayList
  foreach ($u in $d.index.unnamedList) {
    if ($unnamed.Count -ge 500) { break }
    $s = $u.shape
    $story = $s.Text.Story
    $box = Get-PageBox $doc $u.pageIndex
    $first = $story.Characters.Item(1)
    [void]$unnamed.Add(@{
      uid = $u.uid
      pageIndex = $u.pageIndex
      path = [object[]]$u.path
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
  return @{ pages = [object[]]$pages; objects = [object[]]$objects; unnamedTextCount = $d.index.unnamed; unnamed = [object[]]$unnamed; corelVersion = "$($script:app.Version)" }
}

# Returns the document to the template state before the next record. Replacing text keeps the CURRENT
# formatting, and CorelDRAW switches fonts automatically for some scripts (e.g. CJK -> SimSun), so without this
# every card after such a record would inherit the substituted font.
function Revert-Record($d) {
  if (-not $d.applied) { return }
  if ($script:revertMode -eq 'undo') {
    try {
      $d.doc.Undo(1)
      $d.applied = $false
      if ($d.cleared) { $d.index = Build-Index $d.doc; $d.cleared = $false }
      return
    } catch { $script:revertMode = 'restore' }
  }
  foreach ($e in $d.index.entries) {
    if ($null -eq $e.base) { continue }
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
  $script:app.Optimization = $true
  try { return Invoke-Apply $a } finally { $script:app.Optimization = $false }
}

function Invoke-Apply($a) {
  $d = Get-Doc ([string]$a.handle)
  Revert-Record $d
  $keep = [bool](Opt $a 'keep' $false)
  if ($keep) {
    # Multi-sheet documents: every page is filled once and never reverted.
    $result = Apply-Values $d $a
    $result.cleared = (Clear-Regions $d $a $true)
    return $result
  }
  $grouped = $false
  if ($script:revertMode -eq 'undo') {
    try { $d.doc.BeginCommandGroup('CardForge record'); $grouped = $true } catch { $script:revertMode = 'restore' }
  }
  try {
    $result = Apply-Values $d $a
    $result.cleared = (Clear-Regions $d $a $false)
  } finally {
    if ($grouped) { $d.doc.EndCommandGroup() }
    $d.applied = $true
  }
  return $result
}

# Removes the static artwork of card positions that hold no record on this sheet (their text was already blanked).
# Only shapes that lie entirely inside a region are touched, so page-wide artwork is never deleted.
function Clear-Regions($d, $a, [bool]$permanent) {
  if (-not ($a.PSObject.Properties.Name -contains 'clearRegions') -or $null -eq $a.clearRegions) { return 0 }
  if (-not $permanent -and $script:revertMode -ne 'undo') { return 0 }
  $pageIndex = [int](Opt $a 'clearPage' 1)
  $page = $d.doc.Pages.Item($pageIndex)
  $box = Get-PageBox $d.doc $pageIndex
  $victims = $script:app.CreateShapeRange()
  $count = 0
  for ($i = 1; $i -le $page.Shapes.Count; $i++) {
    $s = $page.Shapes.Item($i)
    if ($s.Type -eq 9) { continue } # guidelines
    $l = $s.LeftX - $box.left; $r = $s.RightX - $box.left; $b = $s.BottomY - $box.bottom; $t = $s.TopY - $box.bottom
    foreach ($reg in $a.clearRegions) {
      if ($l -ge ($reg.left - 1) -and $r -le ($reg.right + 1) -and $b -ge ($reg.bottom - 1) -and $t -le ($reg.top + 1)) { [void]$victims.Add($s); $count++; break }
    }
  }
  if ($count -gt 0) { $victims.Delete() }
  if ($count -gt 0 -and -not $permanent) { $d.cleared = $true }
  return $count
}

function Apply-Values($d, $a) {
  $safe = [double]$a.safeMarginMm
  $pageScope = [int](Opt $a 'page' 0)
  $results = New-Object System.Collections.ArrayList
  $notFound = New-Object System.Collections.ArrayList
  $boxes = @{}
  $byName = @{}
  foreach ($e in $d.index.entries) {
    if ($pageScope -ne 0 -and $e.pageIndex -ne $pageScope) { continue }
    if (-not $byName.ContainsKey($e.name)) { $byName[$e.name] = New-Object System.Collections.ArrayList }
    [void]$byName[$e.name].Add($e)
  }
  foreach ($prop in $a.values.PSObject.Properties) {
    $name = $prop.Name
    $value = ([string]$prop.Value) -replace "`r`n", "`r" -replace "`n", "`r"
    if (-not $byName.ContainsKey($name)) { [void]$notFound.Add($name); continue }
    foreach ($e in $byName[$name]) {
      try { $e.shape.Text.Story.Text = $value }
      catch { Fail 'APPLY_FAILED' ("Could not set the text of '{0}' on page {1}: {2}" -f $name, $e.pageIndex, $_.Exception.Message) }
      if (-not $boxes.ContainsKey($e.pageIndex)) { $boxes[$e.pageIndex] = Get-PageBox $d.doc $e.pageIndex }
      $box = $boxes[$e.pageIndex]
      $bounds = Get-Bounds $e.shape $box
      $reason = $null
      if ($value.Length -gt 0) { $reason = Test-Overflow $e $box $safe $bounds }
      [void]$results.Add(@{ name = $name; pageIndex = $e.pageIndex; overflow = ($null -ne $reason); reason = $reason; bounds = $bounds })
    }
  }
  return @{ objects = [object[]]$results; notFound = [object[]]$notFound; revertMode = $script:revertMode }
}

# Gives unnamed text objects names (in the private working copy only). Items: [{uid, name}].
function Cmd-NameShapes($a) {
  $d = Get-Doc ([string]$a.handle)
  Revert-Record $d
  $byUid = @{}
  foreach ($u in $d.index.unnamedList) { $byUid[$u.uid] = $u.shape }
  $named = 0
  foreach ($item in $a.items) {
    $name = [string]$item.name
    if ($name -notmatch '^[A-Za-z][A-Za-z0-9_]{0,63}$') { Fail 'INVALID_ARGS' "Invalid object name '$name'." }
    $uid = [string]$item.uid
    if (-not $byUid.ContainsKey($uid)) { Fail 'SHAPE_NOT_FOUND' "Object $uid is no longer in the document. Re-import the template." }
    $byUid[$uid].Name = $name
    $named++
  }
  $d.index = Build-Index $d.doc
  return @{ named = $named }
}

# Appends `count` copies of a page (artwork and named objects) to the document without using the clipboard.
function Cmd-AddSheetPages($a) {
  $script:app.Optimization = $true
  try { return Invoke-AddSheetPages $a } finally { $script:app.Optimization = $false }
}

function Invoke-AddSheetPages($a) {
  $d = Get-Doc ([string]$a.handle)
  Revert-Record $d
  $doc = $d.doc
  $src = [int](Opt $a 'sourcePage' 1)
  $count = [int]$a.count
  if ($count -lt 1 -or $count -gt 500) { Fail 'INVALID_ARGS' 'Page count must be 1-500.' }
  if ($src -lt 1 -or $src -gt $doc.Pages.Count) { Fail 'INVALID_ARGS' "Page $src does not exist." }
  $page = $doc.Pages.Item($src)
  $w = $page.SizeWidth; $h = $page.SizeHeight
  $srcEntries = @($d.index.entries | Where-Object { $_.pageIndex -eq $src })
  $added = New-Object System.Collections.ArrayList
  $complete = $true
  for ($i = 1; $i -le $count; $i++) {
    [void]$doc.InsertPagesEx(1, $false, $doc.Pages.Count, $w, $h)
    $newIndex = $doc.Pages.Count
    $newPage = $doc.Pages.Item($newIndex)
    # Copy layer by layer: Page.Shapes also returns guidelines (a separate guides layer), and moving those alone
    # would leave the new page without its artwork. Guidelines are editing aids and are not copied.
    $copied = 0
    for ($l = 1; $l -le $page.Layers.Count; $l++) {
      $srcLayer = $page.Layers.Item($l)
      if ($srcLayer.IsGuidesLayer -or $srcLayer.Shapes.Count -eq 0) { continue }
      $target = $null
      for ($k = 1; $k -le $newPage.Layers.Count; $k++) { if (-not $newPage.Layers.Item($k).IsGuidesLayer -and $newPage.Layers.Item($k).Name -eq $srcLayer.Name) { $target = $newPage.Layers.Item($k); break } }
      if ($null -eq $target) { $target = $newPage.CreateLayer($srcLayer.Name) }
      # CopyToLayer keeps positions and is several times faster than Duplicate + MoveToLayer on real artwork.
      $copy = $srcLayer.Shapes.All().CopyToLayer($target)
      $copied += $copy.Count
    }
    if ($copied -eq 0) { Fail 'COPY_FAILED' 'The sheet page could not be copied.' }
    # The copies carry the same names: find them by name instead of re-reading the whole document.
    foreach ($e in $srcEntries) {
      $s2 = $null
      try { $s2 = $newPage.FindShape($e.name, 0, $true, 0) } catch { $s2 = $null }
      # Anything that is not the copied text object (nothing, a group, a shape of another page) means the quick lookup
      # cannot be trusted: fall back to indexing the whole document below.
      $ok = $false
      if ($null -ne $s2) { try { $ok = ($s2.Type -eq $cdrTextShape) -and ($null -ne $s2.Text) -and ($s2.Name -eq $e.name) } catch { $ok = $false } }
      if (-not $ok) { $complete = $false; break }
      [void]$added.Add(@{ name = $e.name; shape = $s2; pageIndex = $newIndex; path = $e.path; base = $null })
    }
  }
  if ($complete) { foreach ($x in $added) { [void]$d.index.entries.Add($x) } }
  else {
    $script:captureBase = $false
    try { $d.index = Build-Index $d.doc } finally { $script:captureBase = $true }
  }
  return @{ pages = $doc.Pages.Count; indexed = $complete }
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

# Print-ready PDF of every page of the document (CorelDRAW's default PDF settings).
function Cmd-ExportPdf($a) {
  $d = Get-Doc ([string]$a.handle)
  Revert-Record $d
  $d.doc.PublishToPDF([string]$a.path)
  return @{ path = [string]$a.path }
}

function Cmd-SaveAs($a) {
  $d = Get-Doc ([string]$a.handle)
  $version = [int]$a.version
  Save-Cdr $d.doc ([string]$a.path) $version
  return @{ path = [string]$a.path }
}

# ---- Printing ----
# Enum values come from the CorelDRAW X7 type library (CorelDRAW.tlb, Prn* enums), checked against v27.2 as well.
$prnPaperSize = @{ Letter = 1; Legal = 5; A3 = 8; A4 = 9; A5 = 11 }
$prnOrientation = @{ portrait = 1; landscape = 2 }
$prnColorMode = @{ color = 0; grayscale = 1; black = 2 }

# Runs a print-setup step. A COM failure becomes a specific error: the print module of some installs cannot be
# initialised at all (HRESULT 0x80030002 on PrintSettings), and that must not look like a generic failure.
function Invoke-PrintStep([string]$what, [scriptblock]$step) {
  try { & $step } catch {
    $ex = $_.Exception
    if ($ex.Data.Contains('code')) { throw }
    $hr = ''
    $inner = $ex
    while ($inner) { if ($inner -is [System.Runtime.InteropServices.COMException]) { $hr = ' (HRESULT 0x{0:X8})' -f [int]$inner.ErrorCode; break }; $inner = $inner.InnerException }
    Fail 'PRINT_SETUP_FAILED' ("CorelDRAW could not set up printing: $what failed$hr. " + $ex.Message)
  }
}

# Applies the printer and settings to the document. Nothing is printed here. The printer is never substituted:
# if CorelDRAW does not report the requested printer as selected afterwards, this fails.
function Cmd-ConfigurePrint($a) {
  $d = Get-Doc ([string]$a.handle)
  $s = $a.settings
  $name = [string]$s.printer
  if ($name -eq '' -or $name -match '[\x00-\x1f]') { Fail 'INVALID_ARGS' 'A printer name is required.' }
  if (-not $prnPaperSize.ContainsKey([string]$s.paper)) { Fail 'INVALID_ARGS' "Unsupported paper size '$($s.paper)'." }
  if (-not $prnOrientation.ContainsKey([string]$s.orientation)) { Fail 'INVALID_ARGS' 'Unsupported orientation.' }
  if (-not $prnColorMode.ContainsKey([string]$s.color)) { Fail 'INVALID_ARGS' 'Unsupported color mode.' }
  $copies = [int]$s.copies
  if ($copies -lt 1 -or $copies -gt 99) { Fail 'INVALID_ARGS' 'Copies must be 1 to 99.' }
  Revert-Record $d
  $ps = $null
  Invoke-PrintStep 'opening the print settings' { $script:ps = $d.doc.PrintSettings; [void]$script:ps.Copies }
  $ps = $script:ps
  Invoke-PrintStep "selecting printer '$name'" { $ps.SelectPrinter($name) }
  $selected = ''
  Invoke-PrintStep 'reading the selected printer' { $script:selected = [string]$ps.Printer.Name }
  if ($script:selected -ne $name) { Fail 'PRINTER_NOT_SELECTED' "CorelDRAW selected '$($script:selected)' instead of '$name'. Nothing was printed." }
  Invoke-PrintStep 'setting copies' { $ps.Copies = $copies; $ps.Collate = $true }
  Invoke-PrintStep 'setting paper size' { $ps.SetPaperSize([int]$prnPaperSize[[string]$s.paper], [int]$prnOrientation[[string]$s.orientation]) }
  $range = ([string]$s.pageRange).Trim()
  Invoke-PrintStep 'setting the page range' {
    if ($range -eq '') { $ps.PrintRange = 0 } else { $ps.PageRange = $range; $ps.PrintRange = 3 }
  }
  Invoke-PrintStep 'setting scaling' { $ps.Layout.Placement = $(if ([string]$s.scaling -eq 'fitToPage') { 1 } else { 0 }) }
  Invoke-PrintStep 'setting the color mode' { $ps.Options.ColorMode = [int]$prnColorMode[[string]$s.color] }
  $d.printReady = $true
  return @{ configured = $true; printer = $name; copies = [int]$ps.Copies }
}

# Sends the document to the printer. Only valid right after Cmd-ConfigurePrint on the same document.
function Cmd-PrintOut($a) {
  $d = Get-Doc ([string]$a.handle)
  if (-not $d.ContainsKey('printReady') -or -not $d.printReady) { Fail 'PRINT_NOT_CONFIGURED' 'configurePrint must succeed before printOut.' }
  $d.printReady = $false
  $d.doc.PrintOut()
  return @{ submitted = $true }
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
    'docInfo' { return Cmd-DocInfo $a }
    'checkFonts' { return Cmd-CheckFonts $a }
    'inspect' { return Cmd-Inspect $a }
    'apply' { return Cmd-Apply $a }
    'nameShapes' { return Cmd-NameShapes $a }
    'addSheetPages' { return Cmd-AddSheetPages $a }
    'exportPages' { return Cmd-ExportPages $a }
    'saveAs' { return Cmd-SaveAs $a }
    'exportPdf' { return Cmd-ExportPdf $a }
    'configurePrint' { return Cmd-ConfigurePrint $a }
    'printOut' { return Cmd-PrintOut $a }
    'shutdown' { Cleanup; return @{ bye = $true } }
    default { Fail 'UNKNOWN_COMMAND' "Unknown command '$cmd'." }
  }
}

function Error-Code($ex) {
  if ($ex.Data.Contains('code')) { return [string]$ex.Data['code'] }
  $inner = $ex
  while ($inner) {
    if ($inner -is [System.Runtime.InteropServices.COMException]) {
      # HRESULTs are negative Int32 values (e.g. E_FAIL = -2147467259); casting them to UInt32 would throw inside this handler
      # and kill the whole bridge. PowerShell parses the hex literals below as the same negative Int32 values.
      switch ([int]$inner.ErrorCode) {
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
