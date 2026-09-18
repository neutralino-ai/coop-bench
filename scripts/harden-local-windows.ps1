param([switch]$Apply,[switch]$Rollback)
$ErrorActionPreference='Stop'
$projectDir=Split-Path -Parent $PSScriptRoot
$output=Join-Path $projectDir 'artifacts\security-2026-09-17'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$resultFile=Join-Path $output 'windows-hardening-result.json'
try {
  if($Apply -and $Rollback){throw 'Choose Apply or Rollback.'}
  $beforeFile=Join-Path $output 'node-firewall-before.json'
  $rules=Get-Content -LiteralPath $beforeFile -Raw | ConvertFrom-Json
  if($rules.Count -ne 2){throw 'Expected the two previously reviewed Node rules.'}
  $target=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'))
  $verified=@()
  foreach($saved in $rules){
    $rule=Get-NetFirewallRule -Name $saved.Name
    $program=($rule | Get-NetFirewallApplicationFilter).Program
    if($rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or [string]$rule.Profile -ne 'Public' -or [IO.Path]::GetFullPath($program) -ine $target){throw 'Firewall rule no longer matches the reviewed target.'}
    $verified+=$rule
  }
  if($Apply){$verified | Disable-NetFirewallRule | Out-Null}
  if($Rollback){$verified | Enable-NetFirewallRule | Out-Null}
  $after=@($verified | ForEach-Object {Get-NetFirewallRule -Name $_.Name | Select-Object Name,DisplayName,Enabled,Profile})
  $mode=if($Apply){'apply'}elseif($Rollback){'rollback'}else{'preview'}
  [pscustomobject]@{ok=$true;at=(Get-Date).ToString('o');mode=$mode;rules=$after} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultFile -Encoding utf8
}catch{
  [pscustomobject]@{ok=$false;at=(Get-Date).ToString('o');error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
  throw
}
