function Initialize-HeroHardware {
  if(-not ('HeroBoost.RawMouse' -as [type])){
    Add-Type -Path (Join-Path $PSScriptRoot 'Hardware.cs') -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' | Out-Null
  }
}
function Assert-HeroAdmin {
  $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Este recurso exige abrir o Hero Boost como administrador.'}
}
$heroServices=@('SysMain','WSearch','MapsBroker','Fax','WMPNetworkSvc')
$heroTasks=@('\Microsoft\Windows\Maps\MapsUpdateTask','\Microsoft\Windows\Maps\MapsToastTask','\Microsoft\Windows\Customer Experience Improvement Program\Consolidator','\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip','\Microsoft\Windows\Feedback\Siuf\DmClient','\Microsoft\Windows\Feedback\Siuf\DmClientOnScenarioDownload')
$heroPackages=@('Microsoft.BingNews','Microsoft.BingWeather','Microsoft.GetHelp','Microsoft.Getstarted','Microsoft.MicrosoftSolitaireCollection','Microsoft.People','Microsoft.WindowsFeedbackHub','Microsoft.YourPhone','Microsoft.ZuneMusic','Microsoft.ZuneVideo','Microsoft.MicrosoftOfficeHub','Microsoft.Todos','Microsoft.PowerAutomateDesktop','Clipchamp.Clipchamp','Microsoft.WindowsMaps','Microsoft.Copilot')
function Get-HeroService($name){
  if($name -notin $heroServices){throw 'Serviço fora da lista permitida.'}
  $svc=Get-Service -Name $name -ErrorAction SilentlyContinue
  if(-not $svc){return $null}
  $config=Get-CimInstance Win32_Service -Filter "Name='$name'"
  $delayed=Get-RegValue "SYSTEM\CurrentControlSet\Services\$name" 'DelayedAutoStart' 'HKLM'
  return @{id=$name;name=$svc.DisplayName;state=$svc.Status.ToString();start=$config.StartMode;delayed=($delayed.exists -and [bool]$delayed.value)}
}
function Get-HeroTask($id){
  if($id -notin $heroTasks){throw 'Tarefa fora da lista permitida.'}
  $split=$id.LastIndexOf('\');try{$task=Get-ScheduledTask -TaskPath $id.Substring(0,$split+1) -TaskName $id.Substring($split+1) -ErrorAction SilentlyContinue}catch{return $null}
  if(-not $task){return $null};return @{id=$id;name=$task.TaskName;enabled=[bool]$task.Settings.Enabled}
}
function Invoke-HeroAdvanced($operation,$d){
  switch($operation){
    'status' {
      $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
      $win=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
      $media=@(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {@{name=$_.FriendlyName;media=$_.MediaType.ToString();health=$_.HealthStatus.ToString()}})
      return @{admin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);edition=$win.EditionID;revision=$win.UBR;media=$media}
    }
    'metrics' {
      $disk=Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -ErrorAction SilentlyContinue
      $network=@(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction SilentlyContinue | Where-Object {$_.Name -notmatch 'Loopback|isatap|Teredo'})
      $gpu=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue)
      $gpuValue=$null
      if($gpu.Count){$groups=$gpu | Group-Object {$_.Name -replace '^pid_\d+_',''};$max=0;foreach($g in $groups){$v=($g.Group | Measure-Object UtilizationPercentage -Sum).Sum;if($v -gt $max){$max=$v}};$gpuValue=[math]::Min(100,$max)}
      return @{gpu=$gpuValue;disk=if($disk){[math]::Min(100,$disk.PercentDiskTime)}else{$null};diskRead=if($disk){[double]$disk.DiskReadBytesPersec}else{$null};diskWrite=if($disk){[double]$disk.DiskWriteBytesPersec}else{$null};received=[double](($network | Measure-Object BytesReceivedPersec -Sum).Sum);sent=[double](($network | Measure-Object BytesSentPersec -Sum).Sum);interfaces=$network.Count;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
    }
    'drivers' {
      $problem=@(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' -ErrorAction SilentlyContinue | ForEach-Object {@{name=$_.Name;id=$_.PNPDeviceID;code=$_.ConfigManagerErrorCode}})
      $drivers=@(Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object {$_.DeviceName} | ForEach-Object {@{name=$_.DeviceName;provider=$_.DriverProviderName;version=$_.DriverVersion;inf=$_.InfName;signed=$_.IsSigned;date=if($_.DriverDate){$_.DriverDate.ToString('yyyy-MM-dd')}else{''}}})
      return @{items=$drivers;problems=$problem}
    }
    'backupDrivers' {
      Assert-HeroAdmin
      $dir=Get-Item -LiteralPath $d.directory
      if(-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Pasta de backup inválida.'}
      $output=@(& "$env:SystemRoot\System32\pnputil.exe" /export-driver '*' $dir.FullName 2>&1);$code=$LASTEXITCODE
      if($code -ne 0){throw (($output -join "`n")+' Código: '+$code)}
      return @{directory=$dir.FullName;log=($output -join "`n");count=@(Get-ChildItem -LiteralPath $dir.FullName -Filter '*.inf' -Recurse -File).Count}
    }
    'restoreDriver' {
      Assert-HeroAdmin
      $file=Get-Item -LiteralPath $d.file
      if($file.PSIsContainer -or $file.Extension -ine '.inf' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Pacote INF inválido.'}
      $output=@(& "$env:SystemRoot\System32\pnputil.exe" /add-driver $file.FullName /install 2>&1);$code=$LASTEXITCODE
      if($code -notin @(0,3010)){throw (($output -join "`n")+' Código: '+$code)}
      return @{log=($output -join "`n");reboot=($code -eq 3010)}
    }
    'services' {return @($heroServices | ForEach-Object {Get-HeroService $_})}
    'service' {return Get-HeroService $d.id}
    'setService' {
      Assert-HeroAdmin;$current=Get-HeroService $d.id;if(-not $current){throw 'Serviço não instalado.'}
      if($d.snapshot.start -notin @('Auto','Manual','Disabled') -or $d.snapshot.state -notin @('Running','Stopped')){throw 'Estado de serviço inválido.'}
      $startup=switch($d.snapshot.start){'Auto'{if($d.snapshot.delayed){'AutomaticDelayedStart'}else{'Automatic'}}'Manual'{'Manual'}'Disabled'{'Disabled'}}
      if($startup -eq 'AutomaticDelayedStart'){Set-Service -Name $d.id -StartupType Automatic; & "$env:SystemRoot\System32\sc.exe" config $d.id 'start=' 'delayed-auto' | Out-Null;if($LASTEXITCODE -ne 0){throw 'Falha ao restaurar início atrasado.'}}
      else{Set-Service -Name $d.id -StartupType $startup}
      if($d.snapshot.state -eq 'Stopped'){Stop-Service -Name $d.id -ErrorAction Stop}else{Start-Service -Name $d.id -ErrorAction Stop}
      return Get-HeroService $d.id
    }
    'tasks' {return @($heroTasks | ForEach-Object {Get-HeroTask $_})}
    'task' {return Get-HeroTask $d.id}
    'setTask' {
      Assert-HeroAdmin;$task=Get-HeroTask $d.id;if(-not $task){throw 'Tarefa indisponível.'}
      $split=$d.id.LastIndexOf('\');$p=$d.id.Substring(0,$split+1);$n=$d.id.Substring($split+1)
      if($d.enabled){Enable-ScheduledTask -TaskPath $p -TaskName $n | Out-Null}else{Disable-ScheduledTask -TaskPath $p -TaskName $n | Out-Null}
      return Get-HeroTask $d.id
    }
    'packages' {
      return @(Get-AppxPackage | Where-Object {$_.Name -in $heroPackages -and -not $_.IsFramework -and -not $_.NonRemovable} | ForEach-Object {@{id=$_.PackageFullName;name=$_.Name;family=$_.PackageFamilyName;version=$_.Version.ToString();install=$_.InstallLocation;manifest=(Join-Path $_.InstallLocation 'AppxManifest.xml')}})
    }
    'removePackage' {
      $pkg=Get-AppxPackage | Where-Object {$_.PackageFullName -eq $d.id -and $_.Name -in $heroPackages -and -not $_.IsFramework -and -not $_.NonRemovable} | Select-Object -First 1
      if(-not $pkg){throw 'Pacote não permitido ou já removido.'}
      # Registration is reversible only while Windows retains the package files. UI states this limit.
      Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
      return @{removed=$true;manifest=(Join-Path $pkg.InstallLocation 'AppxManifest.xml')}
    }
    'restorePackage' {
      if($d.name -notin $heroPackages){throw 'Pacote não permitido.'}
      $root=Join-Path $env:ProgramFiles 'WindowsApps';$full=[IO.Path]::GetFullPath($d.manifest)
      if(-not $full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -ne 'AppxManifest.xml'){throw 'Manifesto de recuperação inválido.'}
      if(-not (Test-Path -LiteralPath $full -PathType Leaf)){throw 'O Windows removeu os arquivos deste app. Reinstale-o pela Microsoft Store.'}
      Add-AppxPackage -Register $full -DisableDevelopmentMode -ErrorAction Stop;return $true
    }
    'restorePoint' {Assert-HeroAdmin;Checkpoint-Computer -Description 'Hero Boost - antes dos ajustes' -RestorePointType MODIFY_SETTINGS;return $true}
    'restoreStatus' {try{return @(Get-ComputerRestorePoint -ErrorAction Stop | Select-Object -Last 5 | ForEach-Object {@{description=$_.Description;sequence=$_.SequenceNumber}})}catch{return @()}}
    'network' { $tcp=Get-NetTCPSetting -SettingName Internet;return @{AutoTuningLevelLocal=$tcp.AutoTuningLevelLocal.ToString();EcnCapability=$tcp.EcnCapability.ToString();Timestamps=$tcp.Timestamps.ToString()} }
    'createPower' {
      $plan=[string]$d.id;if($plan -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or $d.kind -notin @('desktop','laptop')){throw 'Plano Hero inválido.'}
      $computer=Get-CimInstance Win32_ComputerSystem;$battery=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
      if($d.kind -eq 'desktop' -and ($battery.Count -gt 0 -or $computer.PCSystemType -eq 2)){throw 'Use o plano Notebook neste equipamento.'}
      $plans=Get-Plans;if(@($plans.plans | Where-Object {$_.id -eq $plan}).Count){throw 'Plano já existe.'}
      $base=if(@($plans.plans | Where-Object {$_.id -eq '381b4222-f694-41f0-9685-ff5bb260df2e'}).Count){'381b4222-f694-41f0-9685-ff5bb260df2e'}else{$plans.active}
      & "$env:SystemRoot\System32\powercfg.exe" /duplicatescheme $base $plan | Out-Null;if($LASTEXITCODE -ne 0){throw 'O Windows não permitiu duplicar o plano.'}
      try{
        $name=if($d.kind -eq 'laptop'){'HeroBoost Notebook'}else{'HeroBoost Desktop'}
        & "$env:SystemRoot\System32\powercfg.exe" /changename $plan $name | Out-Null;if($LASTEXITCODE -ne 0){throw 'Falha ao nomear plano.'}
        foreach($mode in @('/setacvalueindex','/setdcvalueindex')){
          $max=if($d.kind -eq 'laptop' -and $mode -eq '/setdcvalueindex'){'85'}else{'100'}
          & "$env:SystemRoot\System32\powercfg.exe" $mode $plan SUB_PROCESSOR PROCTHROTTLEMIN 5 | Out-Null;if($LASTEXITCODE -ne 0){throw 'CPU mínima não configurada.'}
          & "$env:SystemRoot\System32\powercfg.exe" $mode $plan SUB_PROCESSOR PROCTHROTTLEMAX $max | Out-Null;if($LASTEXITCODE -ne 0){throw 'CPU máxima não configurada.'}
        }
        & "$env:SystemRoot\System32\powercfg.exe" /setactive $plan | Out-Null;if($LASTEXITCODE -ne 0){throw 'Não foi possível ativar o plano.'}
      }catch{& "$env:SystemRoot\System32\powercfg.exe" /setactive $plans.active | Out-Null;& "$env:SystemRoot\System32\powercfg.exe" /delete $plan | Out-Null;throw}
      return Get-Plans
    }
    'deletePower' {
      $plans=Get-Plans;$p=$plans.plans | Where-Object {$_.id -eq $d.id -and $_.name -like 'HeroBoost *'}
      if(-not $p){return $true};if($plans.active -eq $d.id){throw 'Não é possível remover o plano em uso.'}
      & "$env:SystemRoot\System32\powercfg.exe" /delete $d.id | Out-Null;if($LASTEXITCODE -ne 0){throw 'Não foi possível remover o plano Hero.'};return $true
    }
    'setNetwork' {
      Assert-HeroAdmin
      if($d.name -eq 'AutoTuningLevelLocal' -and $d.value -in @('Disabled','HighlyRestricted','Restricted','Normal','Experimental')){Set-NetTCPSetting -SettingName Internet -AutoTuningLevelLocal $d.value}
      elseif($d.name -eq 'EcnCapability' -and $d.value -in @('Disabled','Enabled','AppDecide')){Set-NetTCPSetting -SettingName Internet -EcnCapability $d.value}
      elseif($d.name -eq 'Timestamps' -and $d.value -in @('Disabled','Enabled','Allowed')){Set-NetTCPSetting -SettingName Internet -Timestamps $d.value}
      else{throw 'Ajuste de rede não permitido.'};return Invoke-HeroAdvanced 'network' @{}
    }
    'timer' {Initialize-HeroHardware;$t=[HeroBoost.TimerResolution]::Read();return @{minimumMs=$t[0];maximumMs=$t[1];currentMs=$t[2];active=[HeroBoost.TimerResolution]::Active;requestedMs=1}}
    'setTimer' {Initialize-HeroHardware;[HeroBoost.TimerResolution]::Set([bool]$d.enabled);return Invoke-HeroAdvanced 'timer' @{}}
    'mouseStart' {Initialize-HeroHardware;[HeroBoost.RawMouse]::Start();return $true}
    'mouseRead' {Initialize-HeroHardware;return [HeroBoost.RawMouse]::Read()}
    'mouseStop' {Initialize-HeroHardware;return [HeroBoost.RawMouse]::Stop()}
    'boot' {
      try{$events=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Diagnostics-Performance/Operational';Id=100,101} -MaxEvents 100 -ErrorAction SilentlyContinue)}catch{return @{boot=$null;entries=@();available=$false;error=$_.Exception.Message}}
      $entries=@();$lastBoot=$null
      foreach($ev in $events){$xml=[xml]$ev.ToXml();$values=@{};foreach($v in $xml.Event.EventData.Data){$values[$v.Name]=$v.'#text'}
        if($ev.Id -eq 100 -and -not $lastBoot){$lastBoot=@{date=$ev.TimeCreated.ToString('o');durationMs=$values['BootTime']}}
        if($ev.Id -eq 101){$entries+=@{name=$values['Name'];path=$values['Path'];durationMs=$values['TotalTime'];degradationMs=$values['DegradationTime'];date=$ev.TimeCreated.ToString('o')}}
      };return @{boot=$lastBoot;entries=$entries;available=($events.Count -gt 0)}
    }
    'recycle' {
      if($d.confirmation -ne 'ESVAZIAR'){throw 'Confirmação necessária.'}
      Clear-RecycleBin -Force -ErrorAction Stop;return $true
    }
    default {throw 'Operação avançada não permitida.'}
  }
}
