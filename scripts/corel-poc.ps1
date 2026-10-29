<#
.SYNOPSIS
  CorelDRAW automation proof of concept for CardForge (Phase 1).

.DESCRIPTION
  Proves, on the computer where it runs, that CorelDRAW can be driven over COM to:
    1. open a real CDR template (a private working copy; the original is never written),
    2. locate a named text object (Object Manager name, searched inside groups too),
    3. replace its text while keeping font, size and position,
    4. save a new editable CDR file (in X7 / version 17 file format by default),
    5. reopen the generated file and verify the new text.
  Prints a step-by-step report and writes a JSON result next to the output.

  Run with Windows PowerShell 5.1 (preinstalled on Windows 10/11):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\corel-poc.ps1 -Template "C:\Cards\template.cdr" -ShapeName FullName

  Without -Template, use -CreateTestTemplate to have CorelDRAW build a simple 90x50 mm test card first.

.PARAMETER ProgIdVersion
  CorelDRAW COM version: 17 = X7 (client's version). Use 'auto' to take whatever version is registered.
.PARAMETER SaveAsVersion
  CDR file format version to save as. 17 = X7. Keep 17 so X7 can open files produced on newer versions.
#>
[CmdletBinding()]
param(
  [string]$Template,
  [string]$ShapeName = 'FullName',
  # Default exercises accented characters. Built from char codes because this file must stay ASCII:
  # Windows PowerShell 5.1 reads BOM-less scripts as ANSI.
  [string]$NewText = ('Jos{0} Pe{1}a-{2}u{1}ez' -f [char]0xE9, [char]0xF1, [char]0xD1),
  [string]$OutputDir = (Join-Path $env:TEMP 'cardforge-poc'),
  [string]$ProgIdVersion = '17',
  [int]$SaveAsVersion = 17,
  [switch]$CreateTestTemplate,
  [switch]$QuitWhenDone
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# CorelDRAW type-library constants used below (documented values from the CorelDRAW VBA object model).
$cdrMillimeter = 3
$cdrTextShape = 6
$cdrGroupShape = 7

$results = New-Object System.Collections.ArrayList
function Step([string]$name, [scriptblock]$body) {
  $started = Get-Date
  try {
    $detail = & $body
    [void]$results.Add([pscustomobject]@{ step = $name; ok = $true; detail = "$detail"; ms = [int]((Get-Date) - $started).TotalMilliseconds })
    Write-Host ("[PASS] {0} - {1}" -f $name, $detail) -ForegroundColor Green
  } catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg += ' | ' + $_.Exception.InnerException.Message }
    [void]$results.Add([pscustomobject]@{ step = $name; ok = $false; detail = $msg; ms = [int]((Get-Date) - $started).TotalMilliseconds })
    Write-Host ("[FAIL] {0} - {1}" -f $name, $msg) -ForegroundColor Red
    throw
  }
}

# Depth-first search of every page and group for a shape with the given Object Manager name.
function Find-NamedShape($doc, [string]$name) {
  foreach ($page in $doc.Pages) {
    $found = Find-InShapes $page.Shapes $name
    if ($found) { return $found }
  }
  return $null
}
function Find-InShapes($shapes, [string]$name) {
  for ($i = 1; $i -le $shapes.Count; $i++) {
    $s = $shapes.Item($i)
    if ($s.Name -eq $name) { return $s }
    if ($s.Type -eq $cdrGroupShape) {
      $inner = Find-InShapes $s.Shapes $name
      if ($inner) { return $inner }
    }
  }
  return $null
}

# Always pass StructSaveAsOptions: with a single argument PowerShell's COM binder treats SaveAs as a
# parameterized property and fails with "Cannot convert ... string to type string".
function Save-Cdr($doc, [string]$path, [int]$version) {
  $opts = $app.CreateStructSaveAsOptions()
  $opts.Version = $version
  $doc.SaveAs($path, $opts)
}

function Describe-Text($shape) {
  $story = $shape.Text.Story
  [pscustomobject]@{
    text = $story.Text
    font = $story.Font
    size = [math]::Round($story.Size, 2)
    x = [math]::Round($shape.PositionX, 3)
    y = [math]::Round($shape.PositionY, 3)
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $OutputDir "poc-output-$stamp.cdr"
$app = $null; $ownsApp = $false; $doc = $null
$overall = $false

try {
  Step 'Connect to CorelDRAW' {
    $progId = if ($ProgIdVersion -eq 'auto') { 'CorelDRAW.Application' } else { "CorelDRAW.Application.$ProgIdVersion" }
    try {
      $script:app = [Runtime.InteropServices.Marshal]::GetActiveObject($progId)
      $how = 'attached to running instance'
    } catch {
      $script:app = New-Object -ComObject $progId
      $script:ownsApp = $true
      $how = 'started new instance'
    }
    "$progId $how; Application.Version = $($script:app.Version)"
  }

  if ($CreateTestTemplate) {
    Step 'Create test template' {
      $script:Template = Join-Path $OutputDir "poc-template-$stamp.cdr"
      $d = $app.CreateDocument()
      # Always close the document this step created, even if a later call fails (otherwise it stays
      # open, unsaved and invisible, inside the automation instance of CorelDRAW).
      try {
      $d.Unit = $cdrMillimeter
      $d.ActivePage.SetSize(90, 50)
      $name = $d.ActiveLayer.CreateArtisticText(8, 30, 'Employee Name')
      $name.Name = $ShapeName
      $name.Text.Story.Font = 'Arial'
      $name.Text.Story.Size = 14
      $title = $d.ActiveLayer.CreateArtisticText(8, 24, 'Job Title')
      $title.Name = 'JobTitle'
      $title.Text.Story.Size = 9
      # A grouped object proves the search descends into groups.
      $email = $d.ActiveLayer.CreateArtisticText(8, 10, 'name@example.com')
      $email.Name = 'Email'
      $rule = $d.ActiveLayer.CreateRectangle(8, 8.5, 82, 8.2)
      # CreateShapeRangeFromArray takes a ParamArray, which PowerShell's COM binder cannot dispatch.
      $range = $app.CreateShapeRange()
      [void]$range.Add($email)
      [void]$range.Add($rule)
      $group = $range.Group()
      $group.Name = 'ContactGroup'
      Save-Cdr $d $script:Template $SaveAsVersion
      } finally {
        $d.Dirty = $false
        $d.Close()
      }
      "saved $($script:Template)"
    }
  }
  if (-not $Template) { throw 'Pass -Template <path.cdr> or -CreateTestTemplate.' }
  if (-not (Test-Path -LiteralPath $Template)) { throw "Template not found: $Template" }

  $originalHash = (Get-FileHash -LiteralPath $Template -Algorithm SHA256).Hash
  $workingCopy = Join-Path $OutputDir "poc-working-$stamp.cdr"

  Step '1. Open template (working copy)' {
    Copy-Item -LiteralPath $Template -Destination $workingCopy
    $script:doc = $app.OpenDocument($workingCopy)
    $script:doc.Unit = $cdrMillimeter
    "pages=$($script:doc.Pages.Count) size=$([math]::Round($script:doc.ActivePage.SizeWidth,2))x$([math]::Round($script:doc.ActivePage.SizeHeight,2)) mm"
  }

  $before = $null
  Step "2. Locate text object '$ShapeName'" {
    $shape = Find-NamedShape $doc $ShapeName
    if (-not $shape) { throw "No object named '$ShapeName'. Name it in Window > Object Manager (or Objects docker)." }
    if ($shape.Type -ne $cdrTextShape) { throw "'$ShapeName' exists but is not a text object (Type=$($shape.Type))." }
    $script:before = Describe-Text $shape
    "text='$($script:before.text)' font=$($script:before.font) size=$($script:before.size)pt, bbox top-left ($($script:before.x), $($script:before.y)) mm"
  }

  Step '3. Replace text, keep formatting' {
    $shape = Find-NamedShape $doc $ShapeName
    $shape.Text.Story.Text = $NewText
    $after = Describe-Text $shape
    $problems = @()
    if ($after.text -ne $NewText) { $problems += "text is '$($after.text)'" }
    if ($after.font -ne $before.font) { $problems += "font changed $($before.font) -> $($after.font)" }
    if ($after.size -ne $before.size) { $problems += "size changed $($before.size) -> $($after.size)" }
    if ($problems.Count) { throw ($problems -join '; ') }
    "text='$($after.text)' font=$($after.font) size=$($after.size)pt, bbox top-left ($($after.x), $($after.y)) mm (bbox follows glyph shapes; the text anchor is what must stay fixed)"
  }

  Step "4. Save editable CDR (format v$SaveAsVersion)" {
    Save-Cdr $doc $outputPath $SaveAsVersion
    $doc.Close()
    $script:doc = $null
    "$outputPath ($([math]::Round((Get-Item -LiteralPath $outputPath).Length / 1KB, 1)) KB)"
  }

  Step '5. Reopen output and verify' {
    $script:doc = $app.OpenDocument($outputPath)
    $shape = Find-NamedShape $script:doc $ShapeName
    if (-not $shape) { throw "Object '$ShapeName' missing after reopen." }
    $check = $shape.Text.Story.Text
    $script:doc.Close()
    $script:doc = $null
    if ($check -ne $NewText) { throw "Reopened text is '$check', expected '$NewText'." }
    "reopened text='$check'"
  }

  Step 'Original template unchanged' {
    $now = (Get-FileHash -LiteralPath $Template -Algorithm SHA256).Hash
    if ($now -ne $originalHash) { throw 'Template file hash changed!' }
    Remove-Item -LiteralPath $workingCopy -ErrorAction SilentlyContinue
    "SHA256 $($originalHash.Substring(0, 16))... matches"
  }
  $overall = $true
} catch {
  if ($results.Count -eq 0 -or $results[$results.Count - 1].ok) {
    [void]$results.Add([pscustomobject]@{ step = 'Setup'; ok = $false; detail = $_.Exception.Message; ms = 0 })
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  }
} finally {
  if ($doc) { try { $doc.Close() } catch {} }
  if ($app -and $ownsApp -and $QuitWhenDone) { try { $app.Quit() } catch {} }
  $version = $null
  if ($app) { try { $version = $app.Version } catch {} }
  $report = [pscustomobject]@{
    passed = $overall
    corelVersion = $version
    progIdVersion = $ProgIdVersion
    saveAsVersion = $SaveAsVersion
    template = $Template
    output = $outputPath
    machine = $env:COMPUTERNAME
    ranAt = (Get-Date).ToString('o')
    steps = $results
  }
  $reportPath = Join-Path $OutputDir "poc-report-$stamp.json"
  $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Host ''
  if ($overall) { Write-Host "RESULT: PASS  (report: $reportPath)" -ForegroundColor Green }
  else { Write-Host "RESULT: FAIL  (report: $reportPath)" -ForegroundColor Red }
}
if (-not $overall) { exit 1 }
