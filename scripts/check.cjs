'use strict';
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
for(const dir of ['electron','ui','scripts','tests']){
  for(const file of fs.readdirSync(dir))if(/\.(cjs|js)$/.test(file))execFileSync(process.execPath,['--check',path.join(dir,file)],{stdio:'inherit'});
}
for(const file of ['native/bridge.ps1','native/advanced.ps1','scripts/test-native.ps1','scripts/create-icon.ps1']){
  if(!fs.readFileSync(file).subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])))throw new Error(file+' requires a UTF-8 BOM for Windows PowerShell 5.1.');
  if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) '${file}'),[ref]$tokens,[ref]$errors) | Out-Null; if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}`],{stdio:'inherit',windowsHide:true});
}
console.log('JavaScript e PowerShell: sintaxe validada.');
