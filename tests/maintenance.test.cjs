'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {memoryCandidates,MemoryManager}=require('../electron/memory.cjs');const {Maintenance,CACHE_IDS,cacheFileAllowed,automaticCacheReason,validateConfig}=require('../electron/maintenance.cjs');
const {workProtected}=require('../electron/workloads.cjs');
const app={id:101,path:'C:\\Apps\\browser.exe',name:'browser',started:'a',workingSet:128*1024**2,privateBytes:200*1024**2,cpuMs:20,ioBytes:0,minimized:true,visible:false};
function samples(p={}){return [{at:100000,foreground:999,processes:[{...app,...p}]},{at:98000,foreground:999,processes:[{...app}]}];}
test('RAM recovery requires explicit selection, minimized windows and no observed activity',()=>{
  const [a,b]=samples();assert.equal(memoryCandidates(a,b,[app.path])[0].eligible,true);
  assert.equal(memoryCandidates(a,b,[])[0].eligible,false);
  for(const delta of [{visible:true},{minimized:false},{cpuMs:70},{ioBytes:1},{started:'reused'}]){const [current,old]=samples(delta);assert.equal(memoryCandidates(current,old,[app.path])[0].eligible,false);}
  a.foreground=app.id;assert.equal(memoryCandidates(a,b,[app.path])[0].eligible,false);
});
test('Adobe, games, Windows, foreground app groups and focus apps cannot have RAM recovered',()=>{
  for(const file of ['C:\\Adobe\\Photoshop.exe','C:\\Work\\AfterFX.exe','D:\\Steam\\steamapps\\common\\Game\\unknown.exe','C:\\Windows\\System32\\svchost.exe','C:\\Apps\\cs2.exe'])assert.equal(workProtected({path:file}),true);
  const [a,b]=samples();assert.equal(memoryCandidates(a,b,[app.path],[{path:app.path}])[0].eligible,false);
  a.processes.push({...app,id:102,visible:true});assert.ok(memoryCandidates(a,b,[app.path]).every(p=>!p.eligible));
  const [c,d]=samples();assert.equal(memoryCandidates(c,d,[app.path],[],{'101:a':Date.now()})[0].eligible,false);
});
test('automatic cache work waits for idle, low load and no protected workflows',()=>{
  const base={processes:[],cpu:5,usedPercent:40,pagesInput:0};assert.equal(automaticCacheReason(base,[],180),null);
  assert.ok(automaticCacheReason(base,[],0));assert.ok(automaticCacheReason({...base,cpu:70},[],180));assert.ok(automaticCacheReason({...base,usedPercent:90},[],180));
  assert.ok(automaticCacheReason({...base,pagesInput:null},[],180));
  assert.ok(automaticCacheReason({...base,processes:[{path:'C:\\Adobe\\Photoshop.exe'}]},[],180));assert.ok(automaticCacheReason({...base,processes:[app]},[{path:app.path}],180));
});
test('cache policy excludes projects, recovery, shaders and unknown temporary file types',()=>{
  for(const file of ['project.psd','work.ai','shot.aep','image.png','Photoshop Temp123.tmp','Recovery.tmp','app.exe'])assert.equal(cacheFileAllowed('C:\\Temp\\'+file,'temp'),false);
  assert.equal(cacheFileAllowed('C:\\Temp\\old.tmp','temp'),true);assert.equal(cacheFileAllowed('C:\\Temp\\database.db','temp'),false);assert.equal(cacheFileAllowed('C:\\Cache\\a1b2_0','chrome'),true);
  assert.ok(!CACHE_IDS.includes('shader'));assert.ok(!CACHE_IDS.includes('nvidia'));
});
test('automatic deletion requires consent and RAM automation requires an allowlist',()=>{
  const current={cache:{enabled:false,sources:['chrome']},memory:{apps:[]}};const config={cache:{enabled:true,intervalHours:24,sources:['chrome']},memory:{enabled:false,threshold:85}};
  assert.throws(()=>validateConfig(config,current),/Confirme/);assert.equal(validateConfig(config,current,'EXCLUIR_CACHE_AUTOMATICAMENTE').cache.enabled,true);
  assert.throws(()=>validateConfig({...config,memory:{enabled:true,threshold:85}},current,'EXCLUIR_CACHE_AUTOMATICAMENTE'),/aplicativo/);
  assert.throws(()=>validateConfig({...config,cache:{enabled:true,intervalHours:24,sources:['adobe']}},current,'EXCLUIR_CACHE_AUTOMATICAMENTE'),/inválida/);
});
async function fixture(t){
  const base=await fs.mkdtemp(path.join(process.cwd(),'.qa-maintenance-'));t.after(()=>{assert.equal(path.dirname(path.resolve(base)),process.cwd());return fs.rm(base,{recursive:true,force:true});});
  const local=path.join(base,'local'),root=path.join(local,'Temp');await fs.mkdir(root,{recursive:true});
  const store={data:{cleanup:[],journal:[],focusApps:[]},save:async()=>{}};let locked=false;
  const bridge={call:async(action,p)=>{if(action==='processes')return [];if(p.operation==='snapshot')return {date:new Date().toISOString(),at:Date.now(),processes:[],cpu:5,usedPercent:40,pagesInput:0,diskFree:1234};if(p.operation==='unlocked')return !locked;throw new Error(action);}};
  const engine={serialize:fn=>fn()},manager=new Maintenance(engine,store,bridge,local,path.join(base,'quarantine'),()=>180);
  for(const cleaner of manager.disk.cleaners.values())cleaner.clock=()=>Date.now()+8*86400000;
  return {manager,store,root,setLocked:v=>locked=v};
}
test('manual cache deletion removes only its verified batch and preserves project files',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'old.tmp'),'cache');await fs.writeFile(path.join(f.root,'work.psd'),'project');await fs.writeFile(path.join(f.root,'Photoshop Temp77.tmp'),'recover');
  await f.manager.disk.scan(['temp']);for(const cleaner of f.manager.disk.cleaners.values())cleaner.candidates=new Map([...cleaner.candidates].filter(([,p])=>p.source.endsWith('work.psd')));
  await f.manager.disk.isolate(); // Existing manual quarantine is deliberately outside this maintenance batch.
  const original=f.store.data.cleanup[0];const result=await f.manager.cacheRun({ids:['temp'],remove:true,confirmation:'EXCLUIR'});
  assert.equal(result.deleted.count,1);assert.equal(result.deleted.bytes,5);assert.equal(original.status,'isolated');assert.equal(await fs.readFile(original.destination,'utf8'),'project');
  assert.equal(await fs.readFile(path.join(f.root,'Photoshop Temp77.tmp'),'utf8'),'recover');await assert.rejects(fs.access(path.join(f.root,'old.tmp')),{code:'ENOENT'});
});
test('locked cache files remain in place and configuration save failures keep automation off',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'old.tmp'),'locked');f.setLocked(true);
  const result=await f.manager.cacheRun({ids:['temp'],remove:true,confirmation:'EXCLUIR'});assert.equal(result.deleted.count,0);assert.equal(await fs.readFile(path.join(f.root,'old.tmp'),'utf8'),'locked');
  f.store.save=async()=>{throw new Error('Disk full');};await assert.rejects(()=>f.manager.configure({cache:{enabled:true,intervalHours:6,sources:['temp']},memory:{enabled:false,threshold:85}},'EXCLUIR_CACHE_AUTOMATICAMENTE'));
  assert.equal(f.store.data.maintenance.cache.enabled,false);
});
test('returning to the PC during the exclusive-file probe stops a cache batch before any move',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'old.tmp'),'keep');let idle=180;f.manager.idleSeconds=()=>idle;
  const original=f.manager.bridge.call;f.manager.bridge.call=async(action,p)=>{if(p?.operation==='unlocked')idle=0;return original(action,p);};
  f.store.data.maintenance.cache.enabled=true;
  const result=await f.manager.cacheRun({ids:['temp'],remove:true,automatic:true});assert.equal(result.isolated.count,0);assert.equal(result.deleted.count,0);assert.equal(result.partial,true);assert.equal(await fs.readFile(path.join(f.root,'old.tmp'),'utf8'),'keep');
});
test('automatic cache obeys its 200-file batch bound and protects active creation workloads',async t=>{
  const f=await fixture(t);await Promise.all(Array.from({length:205},(_,i)=>fs.writeFile(path.join(f.root,i+'.tmp'),'x')));
  f.store.data.maintenance.cache.enabled=true;const result=await f.manager.cacheRun({ids:['temp'],remove:true,automatic:true});assert.equal(result.deleted.count,200);assert.equal((await fs.readdir(f.root)).length,5);
  const original=f.manager.bridge.call;f.manager.bridge.call=async(action,p)=>p?.operation==='snapshot'?{...await original(action,p),processes:[{path:'C:\\Adobe\\AfterFX.exe'}]}:original(action,p);
  const next=await f.manager.cacheRun({ids:['temp'],remove:true,automatic:true});assert.match(next.skipped,/aplicativos Adobe/);assert.equal((await fs.readdir(f.root)).length,5);
});
test('automatic RAM defers under unknown paging, healthy memory or active Adobe work',async()=>{
  const store={data:{maintenance:{memory:{threshold:85,apps:[app.path]}},focusApps:[]}},manager=new MemoryManager(store,{call:()=>{throw new Error('Must not trim');}});
  for(const extra of [{usedPercent:50},{usedPercent:90,pagesInput:null},{usedPercent:90,pagesInput:0,processes:[{path:'C:\\Adobe\\Photoshop.exe'}]}]){
    manager.inspect=async()=>{manager.latest={processes:[],pagesInput:0,...extra};manager.previous={usedPercent:90};};const result=await manager.trim(true);assert.ok(result.skipped);assert.equal(result.residentReduced,0);
  }
});
test('automatic completion leaves a waiting message and removing the last RAM app disables automation',async t=>{
  const f=await fixture(t);f.store.data.maintenance.cache.enabled=true;f.manager.cacheRun=async()=>({deleted:{count:0}});await f.manager.tick();assert.equal(f.manager.state.status,'waiting');assert.match(f.manager.state.message,/concluída/);
  f.store.data.maintenance.memory={enabled:true,threshold:85,apps:[app.path]};await f.manager.removeMemoryApp(app.path);assert.equal(f.store.data.maintenance.memory.enabled,false);
  f.store.data.maintenance.memory={enabled:true,threshold:85,apps:[app.path]};f.store.save=async()=>{throw new Error('Disk full');};await assert.rejects(()=>f.manager.removeMemoryApp(app.path));assert.deepEqual(f.store.data.maintenance.memory.apps,[app.path]);assert.equal(f.store.data.maintenance.memory.enabled,true);
});
