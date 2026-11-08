'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {WindowsBridge}=require('../electron/bridge.cjs');
test('native bridge prioritizes only its disposable fixture process and restores it',async t=>{
  if(process.platform!=='win32'){t.skip('Windows only');return;}
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const bridge=new WindowsBridge(path.join(__dirname,'..','native','bridge.ps1'));
  t.after(()=>{bridge.close();child.kill();});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  const fixture=(await bridge.call('processes')).find(p=>p.id===child.pid);
  assert.ok(fixture,'Fixture should be readable in the current session');
  try{
    assert.equal(await bridge.call('priority',{...fixture,priority:'AboveNormal'}),'AboveNormal');
    await assert.rejects(()=>bridge.call('priority',{...fixture,started:'wrong-start',priority:'Normal'}),/mudou/);
    await assert.rejects(()=>bridge.call('priority',{...fixture,priority:'RealTime'}),/não permitida/);
    await assert.rejects(()=>bridge.call('unknown-command'),/não permitida/);
  }finally{
    assert.equal(await bridge.call('priority',{...fixture,priority:fixture.priority}),fixture.priority);
  }
});
test('native optional resources can be read and owned timer requests are paired',async t=>{
  if(process.platform!=='win32'){t.skip('Windows only');return;}
  const bridge=new WindowsBridge(path.join(__dirname,'..','native','bridge.ps1'));t.after(()=>bridge.close());
  const call=(operation,payload={})=>bridge.call('advanced',{operation,payload});
  const services=await call('services');for(const s of Array.isArray(services)?services:services?[services]:[])assert.equal(typeof s.delayed,'boolean');
  const network=await call('network');assert.ok(network.AutoTuningLevelLocal);
  await assert.rejects(()=>call('service',{id:'WinDefend'}),/permitida/);
  await assert.rejects(()=>call('task',{id:'\\Microsoft\\Windows\\WindowsUpdate\\Scheduled Start'}),/permitida/);
  try{await call('setTimer',{enabled:true});assert.equal((await call('timer')).active,true);}finally{await call('setTimer',{enabled:false});}
  assert.equal((await call('timer')).active,false);
});
