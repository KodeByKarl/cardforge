<#
.SYNOPSIS
  Builds tests/fixtures/test-card-front-back.cdr with CorelDRAW (any version with COM automation).

.DESCRIPTION
  A deliberately awkward two-page (front/back) 90 x 50 mm card used by the integration tests:
    Front: FullName, JobTitle (artistic text), ContactGroup > { Email, Mobile, PhoneGroup > { Telephone } },
           Address (paragraph text in a small frame), Tagline (mixed bold/regular formatting),
           plus unnamed static artwork (a rectangle and the text "ACME").
    Back:  Company (centred artistic text) on a filled background rectangle.
  Saved in CorelDRAW X7 (v17) format. Only the document created here is touched.

  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-test-template.ps1 [-ProgIdVersion 27]
#>
param(
  [string]$ProgIdVersion = '17',
  [string]$Output = (Join-Path $PSScriptRoot '..\tests\fixtures\test-card-front-back.cdr')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$app = New-Object -ComObject "CorelDRAW.Application.$ProgIdVersion"
$preexisting = $app.Documents.Count
$d = $app.CreateDocument()
try {
  $d.Unit = 3 # cdrMillimeter
  $d.ActivePage.SetSize(90, 50)
  $layer = $d.ActiveLayer

  $band = $layer.CreateRectangle(0, 50, 6, 0)
  $band.Fill.UniformColor.RGBAssign(0, 92, 98)
  $band.Outline.Width = 0
  $logo = $layer.CreateArtisticText(70, 42, 'ACME')
  $logo.Text.Story.Size = 10
  $logo.Text.Story.Bold = $true

  $name = $layer.CreateArtisticText(10, 34, 'Employee Name')
  $name.Name = 'FullName'
  $name.Text.Story.Font = 'Arial'
  $name.Text.Story.Size = 14
  $title = $layer.CreateArtisticText(10, 29, 'Job Title')
  $title.Name = 'JobTitle'
  $title.Text.Story.Font = 'Arial'
  $title.Text.Story.Size = 8

  $email = $layer.CreateArtisticText(10, 16, 'name@example.com')
  $email.Name = 'Email'
  $email.Text.Story.Size = 7
  $mobile = $layer.CreateArtisticText(10, 12, '0900 000 0000')
  $mobile.Name = 'Mobile'
  $mobile.Text.Story.Size = 7
  $tel = $layer.CreateArtisticText(10, 8, '(00) 0000 0000')
  $tel.Name = 'Telephone'
  $tel.Text.Story.Size = 7
  $inner = $app.CreateShapeRange()
  [void]$inner.Add($tel)
  [void]$inner.Add($layer.CreateRectangle(9, 7.5, 9.5, 7))
  $phoneGroup = $inner.Group()
  $phoneGroup.Name = 'PhoneGroup'
  $outer = $app.CreateShapeRange()
  [void]$outer.Add($email)
  [void]$outer.Add($mobile)
  [void]$outer.Add($phoneGroup)
  $contact = $outer.Group()
  $contact.Name = 'ContactGroup'

  $address = $layer.CreateParagraphText(50, 18, 86, 6, 'Street address, City')
  $address.Name = 'Address'
  $address.Text.Story.Size = 6.5

  $tagline = $layer.CreateArtisticText(10, 22, 'Bold Regular')
  $tagline.Name = 'Tagline'
  $tagline.Text.Story.Size = 7
  $tagline.Text.Range(0, 4).Bold = $true

  # Back page, same size as the front.
  [void]$d.AddPagesEx(1, 90, 50)
  $d.Pages.Item(2).Activate()
  $bg = $d.ActiveLayer.CreateRectangle(0, 50, 90, 0)
  $bg.Fill.UniformColor.RGBAssign(0, 92, 98)
  $bg.Outline.Width = 0
  $company = $d.ActiveLayer.CreateArtisticText(45, 23, 'Company Name')
  $company.Name = 'Company'
  $company.Text.Story.Size = 16
  $company.Text.Story.Alignment = 3 # cdrCenterAlignment
  $company.Text.Story.Fill.UniformColor.RGBAssign(255, 255, 255)
  $company.CenterX = 45
  $d.Pages.Item(1).Activate()

  $opts = $app.CreateStructSaveAsOptions()
  $opts.Version = 17 # cdrVersion17 (X7)
  $full = [IO.Path]::GetFullPath($Output)
  $d.SaveAs($full, $opts)
  Write-Host "Saved $full"
} finally {
  $d.Dirty = $false
  $d.Close()
  if ($preexisting -eq 0 -and $app.Documents.Count -eq 0) { $app.Quit() }
}
