'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {discoverCreative,addFocusPreset,activeWorkloads,workProtected}=require('../electron/workloads.cjs');
test('Creative Cloud helpers stay protected without blocking idle maintenance forever',()=>{
  const helper={path:'C:\\Adobe\\CoreSync.exe'};assert.equal(workProtected(helper),true);assert.deepEqual(activeWorkloads([helper]),[]);assert.deepEqual(activeWorkloads([helper],[helper]),[helper]);
  for(const file of ['C:\\Adobe\\Photoshop.exe','D:\\Games\\Example\\game.exe','C:\\Work\\aerender.exe'])assert.equal(activeWorkloads([{path:file}]).length,1);
});
test('creative detection finds validated standard executables without searching projects',async t=>{
  const base=await fs.mkdtemp(path.join(process.cwd(),'.qa-creative-'));t.after(()=>{assert.equal(path.dirname(path.resolve(base)),process.cwd());return fs.rm(base,{recursive:true,force:true});});
  const adobe=path.join(base,'Adobe'),dir=path.join(adobe,'Adobe Photoshop 2026');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'Photoshop.exe');await fs.writeFile(file,'MZ fixture, never launched');
  await fs.mkdir(path.join(adobe,'Adobe After Effects 2026','Support Files'),{recursive:true});await fs.writeFile(path.join(adobe,'Adobe After Effects 2026','Support Files','AfterFX.exe'),'not executable');
  const found=await discoverCreative([{path:file}],[base]);assert.equal(found.length,1);assert.equal(found[0].path.toLowerCase(),file.toLowerCase());
  const existing={id:'existing',name:'My Photoshop',path:file},store={data:{focusApps:[existing],focusOptions:{timer:true,pauseServices:false,priority:'High'},focusEnabled:true},save:async()=>{}};const calls=[];
  const engine={setFocus:async enabled=>{calls.push(enabled);store.data.focusEnabled=enabled;}};
  const result=await addFocusPreset(engine,store,found,true);assert.equal(result.added,0);assert.deepEqual(store.data.focusApps,[existing]);assert.deepEqual(calls,[false,true]);assert.equal(store.data.focusOptions.priority,'AboveNormal');assert.equal(store.data.focusOptions.foregroundOnly,true);assert.equal(store.data.focusOptions.timer,false);
  const prior=structuredClone(store.data);store.save=async()=>{throw new Error('Disk full');};await assert.rejects(()=>addFocusPreset(engine,store,found,false),/Disk full/);assert.deepEqual(store.data.focusApps,prior.focusApps);assert.deepEqual(store.data.focusOptions,prior.focusOptions);
});
