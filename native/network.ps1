function Get-HeroQos($name){
  Assert-HeroAdmin
  if($name -notmatch '^HeroBoost-(CS2|Upload-[a-f0-9-]{36})$'){throw 'Nome de política não permitido.'}
  $p=Get-NetQosPolicy -PolicyStore ActiveStore -ErrorAction Stop | Where-Object {$_.Name -eq $name} | Select-Object -First 1
  if(-not $p){return @{exists=$false}}
  return @{exists=$true;path=[string]$p.AppPathNameMatchCondition;protocol=$p.IPProtocolMatchCondition.ToString();dscp=[int]$p.DSCPAction;rate=[double]$p.ThrottleRateAction}
}
function Invoke-HeroNetwork($operation,$d){
  switch($operation){
    'steamPath' {return (Get-RegValue 'Software\Valve\Steam' 'SteamPath').value}
    'connection' {
      $defaultRoute=Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object @{Expression={[int]$_.RouteMetric+[int]$_.InterfaceMetric}} | Select-Object -First 1
      $connections=@(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} | ForEach-Object {@{name=$_.InterfaceAlias;index=$_.InterfaceIndex;default=($_.InterfaceIndex -eq $defaultRoute.InterfaceIndex);gateway=($_.IPv4DefaultGateway | Select-Object -First 1).NextHop;address=$_.IPv4Address.IPAddress;linkSpeed=$_.NetAdapter.LinkSpeed;description=$_.InterfaceDescription}})
      return @{interfaces=$connections}
    }
    'probe' {
      $ip=$null;if(-not [Net.IPAddress]::TryParse([string]$d.ip,[ref]$ip)){throw 'Alvo IP inválido.'}
      $count=[int]$d.count;if($count -lt 1 -or $count -gt 24){throw 'Número de amostras inválido.'}
      $ping=New-Object Net.NetworkInformation.Ping;$samples=@();$statuses=@()
      try{for($i=0;$i -lt $count;$i++){
        try{$reply=$ping.Send($ip,700);$statuses+=$reply.Status.ToString();if($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success){$samples+=[double]$reply.RoundtripTime}else{$samples+=$null}}catch{$samples+=$null;$statuses+='Error'}
        if($i -lt $count-1){Start-Sleep -Milliseconds 150}
      }}finally{$ping.Dispose()}
      return @{ip=$ip.ToString();samples=$samples;statuses=$statuses}
    }
    'trace' {
      $ip=$null;if(-not [Net.IPAddress]::TryParse([string]$d.ip,[ref]$ip)){throw 'Alvo IP inválido.'}
      $ping=New-Object Net.NetworkInformation.Ping;$hops=@()
      try{for($ttl=1;$ttl -le 20;$ttl++){
        $options=New-Object Net.NetworkInformation.PingOptions($ttl,$false)
        try{$reply=$ping.Send($ip,450,[byte[]](0..15),$options);$hops+=@{ttl=$ttl;address=if($reply.Address){$reply.Address.ToString()}else{$null};status=$reply.Status.ToString();rtt=if($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success){[double]$reply.RoundtripTime}else{$null}};if($reply.Status -eq [Net.NetworkInformation.IPStatus]::Success){break}}
        catch{$hops+=@{ttl=$ttl;address=$null;status='Unavailable';rtt=$null}}
      }}finally{$ping.Dispose()};return ,$hops
    }
    'qos' {return Get-HeroQos $d.id}
    'setQos' {
      Assert-HeroAdmin;$existing=Get-HeroQos $d.id
      if(-not $d.snapshot.exists){if($existing.exists){Remove-NetQosPolicy -Name $d.id -PolicyStore ActiveStore -Confirm:$false -ErrorAction Stop};return Get-HeroQos $d.id}
      if($existing.exists){throw 'Já existe uma política com esse nome. Desfaça antes de substituir.'}
      $file=Get-Item -LiteralPath $d.snapshot.path -ErrorAction Stop
      if($file.PSIsContainer -or $file.Extension -ine '.exe' -or $file.FullName.StartsWith($env:SystemRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Aplicativo inválido para política de rede.'}
      if($d.id -eq 'HeroBoost-CS2'){
        if($file.Name -ine 'cs2.exe' -or $d.snapshot.dscp -ne 46 -or $d.snapshot.protocol -ne 'UDP'){throw 'Política CS2 inválida.'}
        New-NetQosPolicy -Name $d.id -AppPathNameMatchCondition $file.FullName -IPProtocolMatchCondition UDP -DSCPAction 46 -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
      }else{
        $rate=[long]$d.snapshot.rate;if($rate -lt 100000 -or $rate -gt 1000000000 -or $d.snapshot.protocol -ne 'Both'){throw 'Limite de upload inválido.'}
        New-NetQosPolicy -Name $d.id -AppPathNameMatchCondition $file.FullName -IPProtocolMatchCondition Both -ThrottleRateActionBitsPerSecond $rate -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
      }
      return Get-HeroQos $d.id
    }
    default {throw 'Operação de conexão não permitida.'}
  }
}
