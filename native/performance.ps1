function Initialize-HeroPerformance {
  if(-not ('HeroBoost.Performance' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'Performance.cs') | Out-Null}
}
function Assert-PerformanceTarget($p){
  if($p.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId -or $p.Id -eq $PID){throw 'Processo de outra sessão ou do próprio Hero.'}
  if($p.Path -match '\\(Windows|Adobe|steamapps\\common|XboxGames|Games)\\|Windows Defender|EasyAntiCheat|BattlEye|Vanguard|FACEIT|ESET|Kaspersky|Bitdefender|CrowdStrike|Sophos|SentinelOne|Norton|McAfee|Avast|AVG\\' -or $p.ProcessName -match '^(system|registry|smss|csrss|wininit|services|lsass|svchost|winlogon|dwm|audiodg|explorer|hero boost|electron|powershell|msmpeng|photoshop|illustrator|afterfx|aerender|afterfx_render_engine|adobe premiere pro|adobe media encoder|dynamiclinkmanager|dynamiclinkmediaserver|coresync|ccxprocess|indesign|lightroom|blender|resolve|obs64|cs2|csgo|valorant.*|fortnite.*|dota2|r5apex|rocketleague|league of legends|gta5|overwatch|eldenring|minecraft|javaw)$'){throw 'Windows, Adobe, jogos e proteções não podem ter a RAM recolhida.'}
}
function Get-HeroPerformance {
  Initialize-HeroPerformance
  $memory=[HeroBoost.Performance]::Read();$windows=[HeroBoost.Performance]::Windows();$currentSession=[Diagnostics.Process]::GetCurrentProcess().SessionId
  $items=@(Get-Process | ForEach-Object {try{if($_.Path -and $_.SessionId -eq $currentSession){$window=$null;if($windows.ContainsKey($_.Id)){$window=$windows[$_.Id]};@{id=$_.Id;name=$_.ProcessName;path=$_.Path;started=$_.StartTime.ToUniversalTime().ToString('o');creation=$_.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();workingSet=[double]$_.WorkingSet64;privateBytes=[double]$_.PrivateMemorySize64;cpuMs=$_.TotalProcessorTime.TotalMilliseconds;ioBytes=[HeroBoost.Performance]::IoBytes($_.Id);minimized=($window -and $window.minimized);visible=($window -and $window.visible)}}}catch{}})
  $paging=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue
  $systemDrive=New-Object IO.DriveInfo($env:SystemDrive+'\')
  return @{date=[DateTime]::UtcNow.ToString('o');at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();total=$memory.total;available=$memory.available;commit=if($paging){[double]$paging.CommittedBytes}else{$memory.commit};commitLimit=if($paging){[double]$paging.CommitLimit}else{$memory.commitLimit};usedPercent=$memory.usedPercent;cpu=$memory.cpu;idleMs=$memory.idleMs;foreground=$memory.foreground;pagesInput=if($paging){[double]$paging.PagesInputPersec}else{$null};diskFree=[double]$systemDrive.AvailableFreeSpace;diskSize=[double]$systemDrive.TotalSize;processes=$items}
}
function Invoke-HeroPerformance($operation,$d){
  switch($operation){
    'snapshot' {return Get-HeroPerformance}
    'foreground' {Initialize-HeroPerformance;return [HeroBoost.Performance]::Foreground()}
    'unlocked' {Initialize-HeroPerformance;return [HeroBoost.Performance]::Unlocked([string]$d.path)}
    'trim' {
      Initialize-HeroPerformance
      $p=Get-Process -Id ([int]$d.id) -ErrorAction Stop;Assert-PerformanceTarget $p
      if($p.Path -ine $d.path -or $p.StartTime.ToUniversalTime().ToString('o') -ne $d.started){throw 'O processo mudou. Operação cancelada.'}
      $group=@(Get-Process | Where-Object {try{$_.Path -ieq $p.Path}catch{$false}});$windows=[HeroBoost.Performance]::Windows();$minimized=$false
      foreach($item in $group){if($windows.ContainsKey($item.Id)){if($windows[$item.Id].visible){throw 'Uma janela do aplicativo está em uso; minimize todas as janelas.'};if($windows[$item.Id].minimized){$minimized=$true}}}
      if(-not $minimized){throw 'Só é permitido recolher RAM de aplicativos escolhidos com janelas minimizadas.'}
      $firstCpu=$p.TotalProcessorTime.TotalMilliseconds;$firstIo=[HeroBoost.Performance]::IoBytes($p.Id);Start-Sleep -Milliseconds 300;$p.Refresh()
      if(($p.TotalProcessorTime.TotalMilliseconds-$firstCpu) -gt 5 -or $firstIo -lt 0 -or [HeroBoost.Performance]::IoBytes($p.Id) -ne $firstIo){throw 'O aplicativo apresentou atividade; sua RAM foi preservada.'}
      $before=[HeroBoost.Performance]::Read();$result=[HeroBoost.Performance]::Trim($p.Id,$p.Path,[long]$d.creation);$after=[HeroBoost.Performance]::Read()
      return @{before=[double]$result[0];after=[double]$result[1];privateBytes=[double]$result[2];availableBefore=$before.available;availableAfter=$after.available}
    }
    default {throw 'Operação de desempenho não permitida.'}
  }
}
