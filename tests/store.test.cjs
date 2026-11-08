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
