<#
  Windows printer queries for the print feature (separate from corel-bridge.ps1 so a busy CorelDRAW never blocks them).

  Usage: powershell -File printers.ps1 -Mode list
         powershell -File printers.ps1 -Mode jobs -PrinterB64 <Base64 UTF-8 printer name>
  Output: one line "CFB1 " + Base64(UTF-8 JSON). Errors: {"error":"..."}.
  ASCII-only file (Windows PowerShell 5.1 reads BOM-less scripts as ANSI). Read-only: nothing is changed or printed.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'jobs')][string]$Mode,
  [string]$PrinterB64 = ''
)
$ErrorActionPreference = 'Stop'

function Send($obj) {
  $json = ConvertTo-Json -InputObject $obj -Depth 6 -Compress
  [Console]::Out.WriteLine('CFB1 ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
}

try {
  if ($Mode -eq 'list') {
    Add-Type -AssemblyName System.Drawing
    $result = New-Object System.Collections.ArrayList
    foreach ($p in @(Get-CimInstance -ClassName Win32_Printer)) {
      $state = [int]$p.PrinterState
      $status = [int]$p.PrinterStatus
      $detail = ''
      $code = 'ready'
      if ($p.WorkOffline -or $status -eq 7 -or ($state -band 0x80)) { $code = 'offline'; $detail = 'Offline' }
      elseif ($state -band 0x2) { $code = 'error'; $detail = 'Error' }
      elseif ($status -eq 6) { $code = 'error'; $detail = 'Stopped printing' }
      elseif ($state -band 0x1) { $code = 'paused'; $detail = 'Paused' }
      elseif ($state -band 0x10 -or $state -band 0x4000) { $code = 'error'; $detail = 'Paper problem' }
      elseif ($status -eq 4) { $code = 'busy'; $detail = 'Printing' }
      elseif ($status -eq 2) { $code = 'unknown' }
      $color = $null
      $papers = @()
      try {
        $ps = New-Object System.Drawing.Printing.PrinterSettings
        $ps.PrinterName = [string]$p.Name
        if ($ps.IsValid) {
          $color = [bool]$ps.SupportsColor
          $papers = @($ps.PaperSizes | ForEach-Object { [string]$_.PaperName })
        }
      } catch {}
      [void]$result.Add(@{ name = [string]$p.Name; isDefault = [bool]$p.Default; status = $code; statusDetail = $detail; port = [string]$p.PortName; supportsColor = $color; paperSizes = [object[]]$papers })
    }
    Send @{ printers = [object[]]$result }
  } else {
    $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PrinterB64))
    $jobs = New-Object System.Collections.ArrayList
    foreach ($j in @(Get-PrintJob -PrinterName $name)) {
      [void]$jobs.Add(@{ id = [int]$j.Id; documentName = [string]$j.DocumentName; status = [string]$j.JobStatus })
    }
    Send @{ jobs = [object[]]$jobs }
  }
} catch {
  Send @{ error = $_.Exception.Message }
  exit 1
}
