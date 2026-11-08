$ErrorActionPreference = 'Stop'
# Execute only the two registry helper definitions against an isolated test key.
$source = Join-Path $PSScriptRoot '..\native\bridge.ps1'
$tokens=$null; $parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'PowerShell source could not be parsed.'}
$definitions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Get-RegValue','Set-RegValue')},$true)
foreach($definition in $definitions){Invoke-Expression $definition.Extent.Text}
$testKey='Software\HeroBoost-Tests-'+[guid]::NewGuid().ToString('N')
try {
  foreach($case in @(
    @{kind='DWord';value=1},
    @{kind='String';value='original value'},
    @{kind='ExpandString';value='%LOCALAPPDATA%\test.exe'},
    @{kind='Binary';value=[byte[]]@(1,2,3)},
    @{kind='MultiString';value=[string[]]@('first','second')}
  )) {
    $snapshot=@{exists=$true;kind=$case.kind;value=$case.value}
    Set-RegValue $testKey 'Fixture' $snapshot
    $read=Get-RegValue $testKey 'Fixture'
    if(-not $read.exists -or $read.kind -ne $case.kind -or (ConvertTo-Json -Compress -InputObject $read.value) -ne (ConvertTo-Json -Compress -InputObject $case.value)){throw "Native roundtrip failed for $($case.kind)"}
    Set-RegValue $testKey 'Fixture' @{exists=$false;kind=$null;value=$null}
    if((Get-RegValue $testKey 'Fixture').exists){throw 'Original absence was not restored.'}
  }
  Write-Output 'Native helpers: five registry types and absence roundtripped in an isolated test key. No Windows preferences changed.'
} finally {
  if($testKey -notmatch '^Software\\HeroBoost-Tests-[0-9a-f]{32}$'){throw 'Invalid cleanup target.'}
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($testKey,$false)
}
