'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Engine}=require('../electron/engine.cjs');const {Advanced,array}=require('../electron/advanced.cjs');
test('missing optional resources are omitted, not exposed as null rows',()=>{assert.deepEqual(array([null,{id:'WSearch'},undefined]),[{id:'WSearch'}]);assert.deepEqual(array(null),[]);});
function fixture(){
  const model={service:{start:'Auto',state:'Running',delayed:true},task:{enabled:true},network:{AutoTuningLevelLocal:'Restricted'},timer:false,processes:[]};
  const store={data:{journal:[],focusApps:[],backgroundApps:[],focusEnabled:false,restorePoint:{attempted:true}},save:async()=>{persisted=structuredClone(store.data);}};let persisted=structuredClone(store.data);
  const bridge={call:async(action,data={})=>{
    if(action==='processes')return structuredClone(model.processes);
    if(action==='priority'){const p=model.processes.find(p=>p.id===data.id&&p.started===data.started&&p.path===data.path);if(!p)throw new Error('Different process');p.priority=data.priority;return p.priority;}
    if(action!=='advanced')throw new Error('Unexpected operation: '+action);
    const {operation,payload:p}=data;
    if(operation==='service')return structuredClone(model.service);
    if(operation==='setService'){assert.ok(persisted.journal.some(j=>j.type==='service'));model.service=structuredClone(p.snapshot);return structuredClone(model.service);}
    if(operation==='task')return structuredClone(model.task);
    if(operation==='setTask'){model.task.enabled=p.enabled;return {...model.task};}
    if(operation==='network')return {...model.network};
    if(operation==='setNetwork'){model.network[p.name]=p.value;return {...model.network};}
    if(operation==='setTimer'){model.timer=p.enabled;return {active:model.timer};}
    throw new Error('Unexpected advanced operation: '+operation);
  }};
  const engine=new Engine(store,bridge);engine.systemInfo={admin:true,laptop:false,media:[{media:'SSD'}]};const advanced=new Advanced(engine,store,bridge);
  return {model,store,engine,advanced};
}
test('service changes preserve delayed automatic start and running state',async()=>{
  const f=fixture();await f.advanced.change('service','WSearch','Search',{start:'Disabled',state:'Stopped',delayed:false});
  assert.equal(f.model.service.start,'Disabled');await f.engine.revert(f.store.data.journal[0].id);assert.deepEqual(f.model.service,{start:'Auto',state:'Running',delayed:true});
});
test('service restoration refuses externally changed state',async()=>{
  const f=fixture();await f.advanced.change('service','WSearch','Search',{start:'Disabled',state:'Stopped',delayed:false});f.model.service.start='Manual';
  await assert.rejects(()=>f.engine.revert(f.store.data.journal[0].id),/fora do Hero/);assert.equal(f.model.service.start,'Manual');
});
test('does not mutate services when original recovery record cannot be saved',async()=>{
  const f=fixture();f.store.save=async()=>{throw new Error('Disk full');};await assert.rejects(()=>f.advanced.change('service','WSearch','Search',{start:'Disabled',state:'Stopped',delayed:false}));assert.equal(f.model.service.state,'Running');
});
test('task and TCP values return to exact originals',async()=>{
  const f=fixture();await f.advanced.change('task','task','Task',{enabled:false});await f.advanced.change('network','AutoTuningLevelLocal','TCP','Normal');
  const r=await f.engine.revertAll();assert.equal(r.errors.length,0);assert.equal(f.model.task.enabled,true);assert.equal(f.model.network.AutoTuningLevelLocal,'Restricted');
});

test('successive TCP choices can be applied and unwound in reverse order',async()=>{
  const f=fixture();await f.advanced.change('network','AutoTuningLevelLocal','TCP','Normal');
  await f.advanced.change('network','AutoTuningLevelLocal','TCP','Disabled');
  const result=await f.engine.revertAll();assert.equal(result.errors.length,0);assert.equal(result.restored,2);assert.equal(f.model.network.AutoTuningLevelLocal,'Restricted');
});
test('admin resources are blocked before applying in a normal session',async()=>{
  const f=fixture();f.engine.systemInfo.admin=false;await assert.rejects(()=>f.advanced.change('service','WSearch','Search',{start:'Disabled',state:'Stopped',delayed:false}),/administrador/);assert.equal(f.store.data.journal.length,0);
});
test('focus lowers only selected background apps, protects security and restores when target closes',async()=>{
  const f=fixture();f.store.data.focusApps=[{path:'C:\\Games\\game.exe'}];f.store.data.backgroundApps=[{path:'C:\\Apps\\browser.exe'},{path:'C:\\Windows\\System32\\important.exe'},{path:'C:\\Program Files\\Windows Defender\\MsMpEng.exe'}];
  f.model.processes=[{id:10,name:'game',path:'C:\\Games\\game.exe',priority:'Normal',started:'a'},{id:11,name:'browser',path:'C:\\Apps\\browser.exe',priority:'Normal',started:'b'},{id:12,name:'important',path:'C:\\Windows\\System32\\important.exe',priority:'Normal',started:'c'},{id:13,name:'antivirus',path:'C:\\Program Files\\Windows Defender\\MsMpEng.exe',priority:'Normal',started:'d'}];
  await f.engine.setFocus(true);assert.equal(f.model.processes[0].priority,'AboveNormal');assert.equal(f.model.processes[1].priority,'BelowNormal');assert.equal(f.model.processes[2].priority,'Normal');assert.equal(f.model.processes[3].priority,'Normal');
  f.model.processes.shift();await f.engine.focusTick();assert.equal(f.model.processes[0].priority,'Normal');assert.equal(f.model.timer,false);
});
test('focus timer and paused services restore together when session ends',async()=>{
  const f=fixture();f.store.data.focusOptions={priority:'AboveNormal',pauseServices:true,timer:true};f.store.data.focusApps=[{path:'C:\\Games\\game.exe'}];f.model.processes=[{id:10,name:'game',path:'C:\\Games\\game.exe',priority:'Normal',started:'a'}];
  await f.engine.setFocus(true);assert.equal(f.model.timer,true);assert.equal(f.model.service.state,'Stopped');
  await f.engine.setFocus(false);assert.equal(f.model.timer,false);assert.equal(f.model.service.state,'Running');
});
test('paused or otherwise unsupported service states never get an irreversible change',async()=>{
  const f=fixture();f.model.service.state='Paused';await assert.rejects(()=>f.advanced.change('service','WSearch','Search',{start:'Disabled',state:'Stopped',delayed:false}),/não suportado/);assert.equal(f.store.data.journal.length,0);
});
test('partially applied service failure can restore original startup and running state',async()=>{
  const f=fixture();const original=f.advanced.write.bind(f.advanced);let fail=true;
  f.advanced.write=async(kind,id,value,details)=>{if(fail&&kind==='service'){fail=false;f.model.service.start='Disabled';throw new Error('Stop denied');}return original(kind,id,value,details);};
  await assert.rejects(()=>f.advanced.change('service','WSearch','Search',{start:'Disabled',state:'Stopped',delayed:false}),/Stop denied/);
  assert.equal(f.store.data.journal[0].status,'pending');await f.engine.revert(f.store.data.journal[0].id);assert.deepEqual(f.model.service,{start:'Auto',state:'Running',delayed:true});
});
