<#
.SYNOPSIS
  Builds a SYNTHETIC 10-up A4 sheet template (2 columns x 5 rows) with CorelDRAW. No client data is used.

.DESCRIPTION
  Variant 'layout': per card an unnamed artistic name text and ONE unnamed composite text holding the address and the
  control number on separate lines, padded with leading spaces to line up with static label curves (mirrors the client's
  structure). Variant 'guide': per card unnamed name, address, precinct and control texts plus a grouped static label text.
  Every text object is left UNNAMED on purpose. Saved in CorelDRAW X7 (v17) format. ASCII only.

  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-sheet-template.ps1 -Variant layout|guide [-ProgIdVersion 27] [-Output path]
#>
param(
  [ValidateSet('layout', 'guide')][string]$Variant = 'layout',
  [string]$ProgIdVersion = '17',
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if (-not $Output) { $Output = Join-Path $PSScriptRoot ("..\tests\fixtures\sheet-10up-{0}.cdr" -f $Variant) }

$app = New-Object -ComObject "CorelDRAW.Application.$ProgIdVersion"
$d = $app.CreateDocument()
try {
  $d.Unit = 3
  $d.ActivePage.SetSize(210, 297)
  $layer = $d.ActiveLayer
  $colX = @(15, 118)           # left edge of the two columns (mm)
  $rowTop = @(55, 111, 168, 224, 281)  # top edge of the five rows (mm, y up)
  for ($r = 0; $r -lt 5; $r++) {
    for ($c = 0; $c -lt 2; $c++) {
      $x = $colX[$c]; $top = $rowTop[$r]
      $frame = $layer.CreateRectangle($x - 4, $top + 4, $x + 85, $top - 46)
      $frame.Fill.ApplyNoFill()
      $frame.Outline.Width = 0.1
      $name = $layer.CreateArtisticText($x, $top - 2, 'SAMPLE NAME, GIVEN')
      $name.Text.Story.Font = 'Arial'
      $name.Text.Story.Size = 9
      if ($Variant -eq 'layout') {
        $label1 = $layer.CreateArtisticText($x, $top - 20, 'ADDRESS:')
        $label1.Text.Story.Size = 7; $label1.Text.Story.Bold = $true
        $label1.ConvertToCurves() | Out-Null
        $label2 = $layer.CreateArtisticText($x, $top - 25, 'CONTROL NO.:')
        $label2.Text.Story.Size = 7; $label2.Text.Story.Bold = $true
        $label2.ConvertToCurves() | Out-Null
        $val = $layer.CreateArtisticText($x + 16, $top - 20, ("  SAMPLE ADDRESS,TOWN,PROVINCE`r" + "          " + "`r" + "         XX 000001"))
        $val.Text.Story.Font = 'Segoe Print'
        $val.Text.Story.Size = 9
      } else {
        $lab = $layer.CreateArtisticText($x, $top - 14, ("ADDRESS:`r" + "PRECINCT NO:`r" + "CONTROL NO.:"))
        $lab.Text.Story.Font = 'Arial'; $lab.Text.Story.Size = 7
        $rng = $app.CreateShapeRange()
        [void]$rng.Add($lab)
        [void]$rng.Add($layer.CreateRectangle($x, $top - 13, $x + 0.5, $top - 13.5))
        $grp = $rng.Group()
        $addr = $layer.CreateArtisticText($x + 20, $top - 14, 'SAMPLE ADDRESS, TOWN, PROV')
        $addr.Text.Story.Size = 7
        $prec = $layer.CreateArtisticText($x + 20, $top - 18, '0000A')
        $prec.Text.Story.Size = 7
        $ctrl = $layer.CreateArtisticText($x + 20, $top - 22, '00000')
        $ctrl.Text.Story.Size = 7
      }
    }
  }
  $opts = $app.CreateStructSaveAsOptions()
  $opts.Version = 17
  $d.SaveAs($Output, $opts)
  Write-Output "Wrote $Output"
} finally {
  $d.Dirty = $false
  $d.Close()
}
