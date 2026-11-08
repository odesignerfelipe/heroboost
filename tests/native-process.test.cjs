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

test('native connection probes and traceroute return real loopback readings without changing network settings',async t=>{
  if(process.platform!=='win32'){t.skip('Windows only');return;}
  const bridge=new WindowsBridge(path.join(__dirname,'..','native','bridge.ps1'));t.after(()=>bridge.close());
  const call=(operation,payload={})=>bridge.call('network',{operation,payload});
  const before=await bridge.call('advanced',{operation:'network',payload:{}});
  for(const ip of ['127.0.0.1','::1']){
    const result=await call('probe',{ip,count:2});assert.equal(result.samples.length,2);assert.ok(result.samples.every(n=>typeof n==='number'&&n>=0));
    const trace=await call('trace',{ip});assert.equal(trace[0].ttl,1);assert.equal(trace[0].status,'Success');
  }
  await assert.rejects(()=>call('probe',{ip:'127.0.0.1;whoami',count:1}),/inválido/);
  await assert.rejects(()=>call('probe',{ip:'127.0.0.1',count:100}),/inválido/);
  const interfaces=await call('connection');assert.ok(Array.isArray(interfaces.interfaces));
  assert.deepEqual(await bridge.call('advanced',{operation:'network',payload:{}}),before);
});

test('admin QoS creates, reads and removes only a disposable application policy',async t=>{
  if(process.platform!=='win32'){t.skip('Windows only');return;}
  const fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
  const bridge=new WindowsBridge(path.join(__dirname,'..','native','bridge.ps1'));t.after(()=>bridge.close());
  const status=await bridge.call('advanced',{operation:'status',payload:{}});
  if(!status.admin){t.skip('Requires an administrator; exercised by Windows CI');return;}
  const directory=await fs.mkdtemp(path.join(process.cwd(),'.qa-qos-'));
  const executable=path.join(directory,'disposable-fixture.exe');await fs.writeFile(executable,'MZfixture, never executed');
  const id='HeroBoost-Upload-'+randomUUID(),call=(operation,payload={})=>bridge.call('network',{operation,payload});
  try{
    assert.deepEqual(await call('qos',{id}),{exists:false});
    const actual=await call('setQos',{id,snapshot:{exists:true,path:executable,protocol:'Both',dscp:-1,rate:2000000}});
    assert.equal(actual.exists,true);assert.equal(actual.path.toLowerCase(),executable.toLowerCase());assert.equal(actual.rate,2000000);assert.equal(actual.dscp,-1);assert.equal(actual.protocol,'Both');
    await assert.rejects(()=>call('setQos',{id,snapshot:{exists:true,path:executable,protocol:'Both',rate:1000000}}),/Já existe/);
  }finally{
    await call('setQos',{id,snapshot:{exists:false}});
    assert.equal((await call('qos',{id})).exists,false);
    assert.equal(path.dirname(path.resolve(directory)),process.cwd());await fs.rm(directory,{recursive:true,force:true});
  }
});
