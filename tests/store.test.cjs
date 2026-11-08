'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Store}=require('../electron/store.cjs');
test('stores and reloads original restore values atomically',async t=>{
  const directory=await fs.mkdtemp(path.join(process.cwd(),'.qa-store-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),process.cwd());return fs.rm(directory,{recursive:true,force:true});});
  const a=new Store(directory);await a.load();a.data.journal.push({id:'a',before:{exists:false},status:'pending'});await a.save();
  const b=new Store(directory);await b.load();assert.deepEqual(b.data.journal,a.data.journal);
});
test('preserves corrupt history instead of silently replacing it',async t=>{
  const directory=await fs.mkdtemp(path.join(process.cwd(),'.qa-store-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),process.cwd());return fs.rm(directory,{recursive:true,force:true});});
  const file=path.join(directory,'state.json');await fs.writeFile(file,'corrupt');
  await assert.rejects(()=>new Store(directory).load(),/preservados/);assert.equal(await fs.readFile(file,'utf8'),'corrupt');
});

test('concurrent callers persist ordered snapshots without racing on the temporary file',async t=>{
  const directory=await fs.mkdtemp(path.join(process.cwd(),'.qa-store-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),process.cwd());return fs.rm(directory,{recursive:true,force:true});});
  const store=new Store(directory);await store.load();const writes=[];
  for(let i=0;i<25;i++){store.data.journal.push({id:String(i),status:'pending'});writes.push(store.save());}
  await Promise.all(writes);const loaded=new Store(directory);await loaded.load();assert.equal(loaded.data.journal.length,25);
  await assert.rejects(fs.access(store.file+'.tmp'),{code:'ENOENT'});
});
