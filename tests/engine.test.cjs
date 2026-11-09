'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../electron/engine.cjs');
const {settings}=require('../electron/catalog.cjs');
function fixture(){
  const values=Object.fromEntries(settings.map(s=>[s.id,{exists:false,value:null,kind:null}]));
  const data={journal:[],focusApps:[],focusEnabled:false,profile:'balanced'};
  let persisted=structuredClone(data),writes=0,processes=[];
  const store={data,save:async()=>{persisted=structuredClone(data);}};
  const bridge={call:async(action,p={})=>{
    if(action==='settings')return structuredClone(values);
    if(action==='writeSetting'){
      assert.ok(persisted.journal.some(j=>j.settingId===p.id&&['pending','applied'].includes(j.status)),'Original must be persisted before write');
      writes++;values[p.id]=structuredClone(p.snapshot);return structuredClone(values[p.id]);
    }
    if(action==='processes')return structuredClone(processes);
    if(action==='priority'){
      const match=processes.find(x=>x.id===p.id&&x.started===p.started&&x.path===p.path);if(!match)throw new Error('Process changed');
      assert.ok(persisted.journal.some(j=>j.type==='priority'&&j.process.id===p.id));match.priority=p.priority;return p.priority;
    }
    throw new Error('Unexpected action '+action);
  }};
  return {engine:new Engine(store,bridge),store,bridge,values,get writes(){return writes;},get persisted(){return persisted;},setProcesses:p=>processes=p,get processes(){return processes;}};
}
test('persists the exact original value, applies and restores it',async()=>{
  const f=fixture();f.values['game-mode']={exists:true,value:0,kind:'DWord'};
  assert.deepEqual(await f.engine.applyIds(['game-mode']),{applied:1,skipped:0});
  assert.equal(f.values['game-mode'].value,1);
  await f.engine.revert(f.store.data.journal[0].id);
  assert.deepEqual(f.values['game-mode'],{exists:true,value:0,kind:'DWord'});
  assert.equal(f.persisted.journal[0].status,'reverted');
});
test('restores absence instead of inventing a default',async()=>{
  const f=fixture();await f.engine.applyIds(['advertising']);await f.engine.revertAll();
  assert.equal(f.values.advertising.exists,false);
});
test('does not overwrite a preference changed outside the app',async()=>{
  const f=fixture();await f.engine.applyIds(['game-mode']);f.values['game-mode'].value=7;
  await assert.rejects(()=>f.engine.revert(f.store.data.journal[0].id),/fora do Hero/);
  assert.equal(f.values['game-mode'].value,7);assert.equal(f.writes,1);
});
test('rejects arbitrary setting IDs and duplicate selection',async()=>{
  const f=fixture();for(const ids of [['HKLM\\Security'],['game-mode','game-mode'],null,[]])await assert.rejects(()=>f.engine.applyIds(ids),/inválida/);
  assert.equal(f.writes,0);
});
test('does not change Windows if persisting the original fails',async()=>{
  const f=fixture();f.store.save=async()=>{throw new Error('Disk full');};
  await assert.rejects(()=>f.engine.applyIds(['capture']),/Disk full/);assert.equal(f.writes,0);
});
test('skips already configured settings without replacing original history',async()=>{
  const f=fixture();await f.engine.applyIds(['tips']);const original=structuredClone(f.store.data.journal);
  assert.deepEqual(await f.engine.applyIds(['tips']),{applied:0,skipped:1});assert.deepEqual(f.store.data.journal,original);
});
test('recovers a pending write after an interrupted operation',async()=>{
  const f=fixture();await f.engine.applyIds(['transparency']);f.store.data.journal[0].status='pending';
  await f.engine.revertAll();assert.equal(f.values.transparency.exists,false);
});
test('focus selects exact executable path and restores original priority',async()=>{
  const f=fixture();f.store.data.focusApps=[{path:'C:\\Games\\game.exe'}];
  f.setProcesses([{id:10,path:'C:\\Games\\game.exe',started:'start1',name:'game',priority:'Normal'},{id:11,path:'C:\\Other\\game.exe',started:'start2',name:'game',priority:'Normal'}]);
  await f.engine.setFocus(true);assert.equal(f.processes[0].priority,'AboveNormal');assert.equal(f.processes[1].priority,'Normal');
  await f.engine.setFocus(false);assert.equal(f.processes[0].priority,'Normal');assert.equal(f.store.data.journal[0].status,'reverted');
});
test('PID reuse does not restore a different process',async()=>{
  const f=fixture();f.store.data.focusApps=[{path:'C:\\Games\\game.exe'}];f.setProcesses([{id:10,path:'C:\\Games\\game.exe',started:'old',name:'game',priority:'Normal'}]);
  await f.engine.setFocus(true);f.setProcesses([{id:10,path:'C:\\Games\\game.exe',started:'new',name:'game',priority:'High'}]);
  await f.engine.setFocus(false);assert.equal(f.processes[0].priority,'High');
});

test('foreground focus follows the active chosen application and restores on switching away',async()=>{
  const f=fixture();f.store.data.focusOptions={priority:'AboveNormal',foregroundOnly:true};f.store.data.focusApps=[{path:'C:\\Apps\\Photoshop.exe'},{path:'C:\\Apps\\AfterFX.exe'}];
  const processes=[{id:1,path:'C:\\Apps\\Photoshop.exe',name:'Photoshop',started:'a',priority:'Normal',foreground:true},{id:2,path:'C:\\Apps\\AfterFX.exe',name:'AfterFX',started:'b',priority:'Normal',foreground:false}];f.setProcesses(processes);
  await f.engine.setFocus(true);assert.equal(processes[0].priority,'AboveNormal');assert.equal(processes[1].priority,'Normal');
  processes[0].foreground=false;processes[1].foreground=true;await f.engine.focusTick();assert.equal(processes[0].priority,'Normal');assert.equal(processes[1].priority,'AboveNormal');
  processes[1].foreground=false;await f.engine.focusTick();assert.equal(processes[1].priority,'Normal');assert.equal(f.engine.lastFocus.active.length,0);
});
test('serializes changes and survives a rejected operation',async()=>{
  const f=fixture();const order=[];
  const first=f.engine.serialize(async()=>{await new Promise(r=>setTimeout(r,20));order.push(1);throw new Error('failure');});
  const second=f.engine.serialize(async()=>{order.push(2);});
  await assert.rejects(first);await second;assert.deepEqual(order,[1,2]);
});

test('one rejected setting is reported without preventing independent choices',async()=>{
  const f=fixture(),original=f.bridge.call;
  f.bridge.call=async(action,p)=>{if(action==='writeSetting'&&p.id==='capture')throw new Error('Access denied');return original(action,p);};
  const result=await f.engine.applyIds(['capture','tips']);
  assert.equal(result.applied,1);assert.equal(result.failed.length,1);assert.equal(result.failed[0].id,'capture');
  assert.equal(f.store.data.journal[0].status,'failed');assert.equal(f.values.capture.exists,false);assert.equal(f.values.tips.value,0);
  assert.equal((await f.engine.revertAll()).errors.length,0);assert.equal(f.values.tips.exists,false);
});

test('an interrupted response with a confirmed write is counted as applied',async()=>{
  const f=fixture(),original=f.bridge.call;let lost=true;
  f.bridge.call=async(action,p)=>{const result=await original(action,p);if(action==='writeSetting'&&lost){lost=false;throw new Error('Response interrupted');}return result;};
  assert.deepEqual(await f.engine.applyIds(['capture']),{applied:1,skipped:0});
  assert.equal(f.store.data.journal[0].status,'applied');await f.engine.revertAll();assert.equal(f.values.capture.exists,false);
});

test('successive power choices restore in reverse order to the real original',async()=>{
  const f=fixture();let active='original';
  f.bridge.call=async(action,p)=>{
    if(action==='power')return {active,plans:['original','first','second'].map(id=>({id}))};
    if(action==='info')return {laptop:false};
    if(action==='setPower'){active=p.id;return {active};}throw new Error(action);
  };
  await f.engine.setPower('first');await f.engine.setPower('second');assert.equal(active,'second');
  const result=await f.engine.revertAll();assert.equal(result.errors.length,0);assert.equal(result.restored,2);assert.equal(active,'original');
});

test('an unconfirmed restoration stays recoverable instead of reporting success',async()=>{
  const f=fixture();await f.engine.applyIds(['tips']);const original=f.bridge.call;
  f.bridge.call=async(action,p)=>action==='writeSetting'?f.values.tips:original(action,p);
  await assert.rejects(()=>f.engine.revert(f.store.data.journal[0].id),/não confirmou/);assert.equal(f.store.data.journal[0].status,'applied');
});
