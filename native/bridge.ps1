param([string]$TestRegistryRoot='')
$ErrorActionPreference = 'Stop'
if($TestRegistryRoot -and $TestRegistryRoot -notmatch '^Software\\HeroBoost-Tests-[0-9a-f]{32}$'){throw 'Raiz de teste inválida.'}
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ProgressPreference = 'SilentlyContinue'
$runKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
$allowed = @{}
$catalog=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($item in $catalog){if($TestRegistryRoot){$item.path=$TestRegistryRoot+'\'+$item.id;$item.hive='HKCU'};$allowed[$item.id]=$item}
. (Join-Path $PSScriptRoot 'advanced.ps1')
. (Join-Path $PSScriptRoot 'network.ps1')
function Get-RegValue($subkey, $name, $hive='HKCU') {
  $base=if($hive -eq 'HKLM'){[Microsoft.Win32.Registry]::LocalMachine}else{[Microsoft.Win32.Registry]::CurrentUser}
  $key = $base.OpenSubKey($subkey)
  try {
    if ($null -eq $key -or $key.GetValueNames() -notcontains $name) { return @{exists=$false; value=$null; kind=$null} }
    return @{exists=$true; value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); kind=$key.GetValueKind($name).ToString()}
  } finally { if ($key) { $key.Dispose() } }
}
function Set-RegValue($subkey, $name, $snapshot, $hive='HKCU') {
  if($hive -eq 'HKLM'){Assert-HeroAdmin}
  $base=if($hive -eq 'HKLM'){[Microsoft.Win32.Registry]::LocalMachine}else{[Microsoft.Win32.Registry]::CurrentUser}
  $key = $base.CreateSubKey($subkey)
  try {
    if ($snapshot.exists) {
      if ($snapshot.kind -notin @('String','ExpandString','DWord','QWord','Binary','MultiString')) { throw 'Tipo de registro não permitido.' }
      $value = $snapshot.value
      if ($snapshot.kind -eq 'DWord') {$value = [int]$value}
      if ($snapshot.kind -eq 'QWord') {$value = [long]$value}
      if ($snapshot.kind -eq 'Binary') {$value = [byte[]]$value}
      if ($snapshot.kind -eq 'MultiString') {$value = [string[]]$value}
      $key.SetValue($name,$value,[Microsoft.Win32.RegistryValueKind]::$($snapshot.kind))
    } else { $key.DeleteValue($name,$false) }
  } finally { $key.Dispose() }
}
function Get-Plans {
  $active = ((& "$env:SystemRoot\System32\powercfg.exe" /getactivescheme) -join '')
  $activeId = [regex]::Match($active,'[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}').Value.ToLowerInvariant()
  $plans = @(& "$env:SystemRoot\System32\powercfg.exe" /list | ForEach-Object {
    $match = [regex]::Match($_,'([a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})\s+\((.+)\)')
    if ($match.Success) { @{id=$match.Groups[1].Value.ToLowerInvariant(); name=$match.Groups[2].Value; active=($match.Groups[1].Value.ToLowerInvariant() -eq $activeId)} }
  })
  return @{active=$activeId; plans=$plans}
}
while ($null -ne ($line = [Console]::ReadLine())) {
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $d = $req.data
    $result = $null
    switch ($req.action) {
      'info' {
        $os = Get-CimInstance Win32_OperatingSystem
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        $computer = Get-CimInstance Win32_ComputerSystem
        $batteries = @(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
        $disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{name=$_.DeviceID; size=[double]$_.Size; free=[double]$_.FreeSpace} })
        $gpu = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {$_.Name})
        $extra=Invoke-HeroAdvanced 'status' @{}
        $result = @{os=$os.Caption; build=$os.BuildNumber; cpu=$cpu.Name.Trim();cpuCores=[int]$cpu.NumberOfCores;cpuLogical=[int]$cpu.NumberOfLogicalProcessors;systemDrive=$env:SystemDrive;displayVersion=$extra.displayVersion; gpu=$gpu; model=$computer.Model; laptop=($batteries.Count -gt 0 -or $computer.PCSystemType -eq 2); disks=$disks; power=(Get-Plans);admin=$extra.admin;edition=$extra.edition;revision=$extra.revision;media=$extra.media}
      }
      'settings' {
        $result = @{}
        foreach ($id in $allowed.Keys) {$spec=$allowed[$id]; $result[$id]=Get-RegValue $spec.path $spec.value $spec.hive}
      }
      'writeSetting' {
        if (-not $allowed.ContainsKey([string]$d.id)) {throw 'Ajuste não permitido.'}
        $spec = $allowed[[string]$d.id]
        Set-RegValue $spec.path $spec.value $d.snapshot $spec.hive
        $result = Get-RegValue $spec.path $spec.value $spec.hive
      }
      'startup' {
        $result = @()
        foreach($location in @(@{id='user';hive='HKCU';path=$runKey},@{id='machine';hive='HKLM';path=$runKey},@{id='machine32';hive='HKLM';path='Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'})){
          $base=if($location.hive -eq 'HKLM'){[Microsoft.Win32.Registry]::LocalMachine}else{[Microsoft.Win32.Registry]::CurrentUser};$key=$base.OpenSubKey($location.path)
          try {if ($key) { foreach($name in $key.GetValueNames()){ $result+=@{name=$name;location=$location.id;admin=($location.hive -eq 'HKLM');protected=($name -match 'SecurityHealth|Defender|Antivirus|Antimalware|Vanguard|EasyAntiCheat|BattlEye|ESET|Kaspersky|Bitdefender|CrowdStrike|Sophos|SentinelOne|Norton|McAfee|Avast|AVG');snapshot=(Get-RegValue $location.path $name $location.hive)} } }} finally {if($key){$key.Dispose()}}
        }
      }
      'writeStartup' {
        if ([string]::IsNullOrEmpty($d.name) -or $d.name.Length -gt 512) {throw 'Entrada de inicialização inválida.'}
        if($d.name -match 'SecurityHealth|Defender|Antivirus|Antimalware|Vanguard|EasyAntiCheat|BattlEye|ESET|Kaspersky|Bitdefender|CrowdStrike|Sophos|SentinelOne|Norton|McAfee|Avast|AVG'){throw 'Esta entrada de segurança está protegida.'}
        $hive='HKCU';$keyPath=$runKey
        if($d.location -in @('machine','machine32')){$hive='HKLM';if($d.location -eq 'machine32'){$keyPath='Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'}}
        elseif($d.location -and $d.location -ne 'user'){throw 'Local de inicialização inválido.'}
        Set-RegValue $keyPath $d.name $d.snapshot $hive
        $result = Get-RegValue $keyPath $d.name $hive
      }
      'power' { $result = Get-Plans }
      'setPower' {
        $plans = Get-Plans
        if (@($plans.plans | Where-Object {$_.id -eq $d.id}).Count -ne 1) {throw 'Plano de energia indisponível.'}
        & "$env:SystemRoot\System32\powercfg.exe" /setactive ([string]$d.id) | Out-Null
        if ($LASTEXITCODE -ne 0) {throw 'O Windows recusou a troca de plano.'}
        $result = Get-Plans
      }
      'processes' {
        $result = @(Get-Process | ForEach-Object {
          try {if ($_.Path -and $_.SessionId -eq [System.Diagnostics.Process]::GetCurrentProcess().SessionId) { @{id=$_.Id; path=$_.Path; name=$_.ProcessName; started=$_.StartTime.ToUniversalTime().ToString('o'); priority=$_.PriorityClass.ToString()} }} catch {}
        })
      }
      'priority' {
        if ($d.priority -notin @('Idle','BelowNormal','Normal','AboveNormal','High')) {throw 'Prioridade não permitida.'}
        $p = Get-Process -Id ([int]$d.id)
        if ($p.Path -ine $d.path -or $p.StartTime.ToUniversalTime().ToString('o') -ne $d.started -or $p.SessionId -ne [System.Diagnostics.Process]::GetCurrentProcess().SessionId) {throw 'O processo mudou. Operação cancelada.'}
        $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::$($d.priority)
        $result = $p.PriorityClass.ToString()
      }
      'advanced' {$result=Invoke-HeroAdvanced $d.operation $d.payload}
      'network' {$result=Invoke-HeroNetwork $d.operation $d.payload}
      'cleanupTestRegistry' {if(-not $TestRegistryRoot){throw 'Esta operação exige uma raiz de teste.'};[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($TestRegistryRoot,$false);$result=$true}
      default { throw 'Operação não permitida.' }
    }
    [Console]::WriteLine((@{id=$req.id; ok=$true; result=$result} | ConvertTo-Json -Compress -Depth 12))
  } catch { [Console]::WriteLine((@{id=$req.id; ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress -Depth 5)) }
}
if('HeroBoost.TimerResolution' -as [type]){[HeroBoost.TimerResolution]::Set($false)}
if('HeroBoost.RawMouse' -as [type]){[HeroBoost.RawMouse]::Stop() | Out-Null}
