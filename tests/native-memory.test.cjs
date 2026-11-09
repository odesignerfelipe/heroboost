'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {spawn,execFile}=require('node:child_process');const {promisify}=require('node:util');const {randomUUID}=require('node:crypto');
const {WindowsBridge}=require('../electron/bridge.cjs');const run=promisify(execFile);
test('native RAM recovery touches only an idle minimized fixture and preserves its allocated data',async t=>{
  if(process.platform!=='win32'){t.skip('Windows only');return;}
  const directory=await fs.mkdtemp(path.join(process.cwd(),'.qa-memory-'));
  const executable=path.join(directory,'IdleMemoryFixture.exe'),source=path.join(directory,'Fixture.cs'),event='Local\\HeroBoostMemory'+randomUUID().replaceAll('-','');
  const report=path.join(directory,'report.txt'),ready=path.join(directory,'ready.txt');let child;
  const bridge=new WindowsBridge(path.join(__dirname,'..','native','bridge.ps1'));
  t.after(async()=>{bridge.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}assert.equal(path.dirname(path.resolve(directory)),process.cwd());await fs.rm(directory,{recursive:true,force:true});});
  await fs.writeFile(source,`using System;using System.IO;using System.Threading;using System.Windows.Forms;
class Fixture:Form{
static byte[] data;static string[] args;protected override bool ShowWithoutActivation{get{return true;}}
[STAThread]static void Main(string[] input){args=input;data=new byte[128*1024*1024];for(int i=0;i<data.Length;i+=4096)data[i]=123;
var signal=new EventWaitHandle(false,EventResetMode.ManualReset,args[0]);var worker=new Thread(()=>{signal.WaitOne();bool valid=true;for(int i=0;i<data.Length;i+=4096)valid&=data[i]==123;File.WriteAllText(args[1],valid?"preserved":"corrupt");Environment.Exit(valid?0:1);});worker.IsBackground=true;worker.Start();
Application.Run(new Fixture());}
Fixture(){ShowInTaskbar=false;WindowState=FormWindowState.Minimized;Text="Hero disposable memory fixture";Shown+=(s,e)=>File.WriteAllText(args[2],"ready");}}
`);
  const csc=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  await run(csc,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/out:'+executable,source],{windowsHide:true});
  child=spawn(executable,[event,report,ready],{windowsHide:true,stdio:'ignore'});await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});
  for(let i=0;i<100;i++){try{await fs.access(ready);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  await fs.access(ready);await new Promise(r=>setTimeout(r,1500));
  const snapshot=await bridge.call('performance',{operation:'snapshot'}),fixture=snapshot.processes.find(p=>p.id===child.pid);
  assert.ok(fixture);assert.equal(fixture.minimized,true);assert.equal(fixture.visible,false);assert.ok(fixture.workingSet>64*1024**2);
  await assert.rejects(()=>bridge.call('performance',{operation:'trim',payload:{...fixture,started:'invalid'}}),/mudou/);
  const result=await bridge.call('performance',{operation:'trim',payload:fixture});
  assert.ok(result.before>result.after,'Resident working set should decrease on the disposable fixture');assert.ok(result.privateBytes>=128*1024**2,'Allocation must remain intact');
  const foreground=(await bridge.call('performance',{operation:'snapshot'})).processes.find(p=>p.id===snapshot.foreground);
  if(foreground)await assert.rejects(()=>bridge.call('performance',{operation:'trim',payload:foreground}));
  const escaped=event.replaceAll("'","''");await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Threading.EventWaitHandle]::OpenExisting('"+escaped+"').Set() | Out-Null"],{windowsHide:true});
  if(child.exitCode===null)await new Promise(r=>child.once('exit',r));assert.equal(child.exitCode,0);assert.equal(await fs.readFile(report,'utf8'),'preserved');
});
