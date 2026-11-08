'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');
const {CS2,buildConfig,modes}=require('../electron/cs2.cjs');const {Engine}=require('../electron/engine.cjs');const {settings}=require('../electron/catalog.cjs');
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(process.cwd(),'.qa-cs2-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),process.cwd());return fs.rm(directory,{recursive:true,force:true});});
  const executable=path.join(directory,'cs2.exe');await fs.writeFile(executable,'MZfixture, never executed');
  const values=Object.fromEntries(settings.map(s=>[s.id,{exists:false,value:null,kind:null}]));
  const store={data:{journal:[],focusApps:[],focusEnabled:false,cs2:{path:executable,session:null}},save:async()=>{}};
  const bridge={call:async(action,p)=>{if(action==='settings')return structuredClone(values);if(action==='writeSetting'){values[p.id]=structuredClone(p.snapshot);return values[p.id];}if(action==='processes')return [];throw new Error(action);}};
  const engine=new Engine(store,bridge),cs2=new CS2(engine,store,bridge);engine.revertAdvanced=entry=>cs2.revertConfig(entry);
  return {directory,executable,store,engine,cs2,values};
}
test('CS2 configuration accepts bounded numeric options and rejects command injection',()=>{
  const cfg=buildConfig({fps:180,maxPing:65,buffer:1});assert.match(cfg,/fps_max 180\r\n/);assert.match(cfg,/cl_net_buffer_ticks 1/);
  for(const options of [{fps:'240;quit'},{fps:0},{maxPing:201},{maxPing:NaN},{buffer:3},{buffer:'1'}])assert.throws(()=>buildConfig(options));
  assert.equal(new Set(modes.map(m=>m.id)).size,3);for(const mode of modes)assert.ok(mode.settings.every(id=>settings.some(s=>s.id===id)));
});
test('CS2 sessions own only new changes and preserve a preexisting focus entry',async t=>{
  const f=await fixture(t);await f.engine.applyIds(['capture']);const existing=f.store.data.journal[0].id;
  f.store.data.focusApps.push({id:'existing',path:f.executable,name:'My CS2'});f.store.data.focusEnabled=true;
  const result=await f.cs2.activate('competitive');assert.equal(result.skipped,1);assert.equal(f.store.data.focusApps.length,1);
  assert.ok(f.store.data.journal.slice(1).every(j=>j.ownerSession===f.store.data.cs2.session.id));
  await assert.rejects(()=>f.cs2.activate('stable'),/Desfaça/);
  const reverted=await f.cs2.deactivate();assert.deepEqual(reverted.errors,[]);assert.equal(f.store.data.focusEnabled,true);assert.equal(f.store.data.focusApps[0].id,'existing');
  assert.equal(f.store.data.journal.find(j=>j.id===existing).status,'applied');assert.equal(f.values.capture.value,0);assert.equal(f.values['game-mode'].exists,false);
});
test('CS2 creates and removes its own focus entry without launching any game',async t=>{
  const f=await fixture(t);await f.cs2.activate('stable');assert.equal(f.store.data.focusApps.length,1);assert.equal(f.store.data.focusEnabled,true);
  await f.cs2.deactivate();assert.equal(f.store.data.focusApps.length,0);assert.equal(f.store.data.focusEnabled,false);
});

test('global restoration can close a CS2 session while keeping focus disabled',async t=>{
  const f=await fixture(t);f.store.data.focusEnabled=true;await f.cs2.activate('stable');
  const result=await f.cs2.deactivate({restoreFocus:false});assert.equal(result.errors.length,0);assert.equal(f.store.data.focusEnabled,false);assert.equal(f.store.data.cs2.session.active,false);
});
test('CFG export and undo restore exact prior bytes and preserve external edits',async t=>{
  const f=await fixture(t),destination=path.join(f.directory,'hero_boost_cs2.cfg'),original=Buffer.from([0xef,0xbb,0xbf,47,47,32,65]);await fs.writeFile(destination,original);
  await f.cs2.exportConfig(destination,{fps:144});const entry=f.store.data.journal.at(-1);assert.match(await fs.readFile(destination,'utf8'),/fps_max 144/);
  await fs.writeFile(destination,'external');await assert.rejects(()=>f.engine.revert(entry.id),/alterado fora/);assert.equal(await fs.readFile(destination,'utf8'),'external');
  await fs.writeFile(destination,buildConfig({fps:144}));await f.engine.revert(entry.id);assert.deepEqual(await fs.readFile(destination),original);
});
test('new CFG is removed on undo; personal autoexec names are refused',async t=>{
  const f=await fixture(t),destination=path.join(f.directory,'hero_boost_cs2.cfg');
  await assert.rejects(()=>f.cs2.exportConfig(path.join(f.directory,'autoexec.cfg'),{}),/Mantenha o nome/);
  await f.cs2.exportConfig(destination,{});await f.engine.revert(f.store.data.journal.at(-1).id);await assert.rejects(fs.access(destination),{code:'ENOENT'});
  await fs.writeFile(f.executable,'plain text');await assert.rejects(()=>f.cs2.select(f.executable),/executável Windows/);
});
