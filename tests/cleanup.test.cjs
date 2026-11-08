'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Cleanup,inside}=require('../electron/cleanup.cjs');
async function fixture(t){
  const base=await fs.mkdtemp(path.join(process.cwd(),'.qa-cleanup-'));
  const root=path.join(base,'temp'),directory=path.join(base,'quarantine');await fs.mkdir(root);
  const store={data:{cleanup:[]},save:async()=>{}};
  // Future clock makes fixture files older than seven days without changing system time.
  const cleanup=new Cleanup(root,directory,store,()=>Date.now()+8*86400000);
  t.after(async()=>{const absolute=path.resolve(base);assert.ok(inside(process.cwd(),absolute));await fs.rm(absolute,{recursive:true,force:true});});
  return {base,root,directory,store,cleanup};
}
test('containment rejects siblings with matching prefix and traversal',()=>{
  assert.equal(inside('C:\\Temp','C:\\TempElsewhere\\secret'),false);
  assert.equal(inside('C:\\Temp','C:\\Temp\\..\\secret'),false);
  assert.equal(inside('C:\\Temp','C:\\Temp'),false);
  assert.equal(inside('C:\\Temp','C:\\Temp\\old.tmp'),true);
});
test('isolates old files and restores exact content without deletion',async t=>{
  const f=await fixture(t),source=path.join(f.root,'old.tmp');await fs.writeFile(source,'valuable fixture');
  assert.equal((await f.cleanup.scan()).count,1);assert.equal((await f.cleanup.isolate()).count,1);
  await assert.rejects(fs.access(source));assert.equal((await f.cleanup.restore()).count,1);assert.equal(await fs.readFile(source,'utf8'),'valuable fixture');
});
test('does not select fresh temporary files',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'new.tmp'),'new');f.cleanup.clock=()=>Date.now();assert.equal((await f.cleanup.scan()).count,0);
});

test('restoration recreates missing original subfolders within the verified root',async t=>{
  const f=await fixture(t),folder=path.join(f.root,'cache','sub');await fs.mkdir(folder,{recursive:true});
  const source=path.join(folder,'old.tmp');await fs.writeFile(source,'recover');await f.cleanup.scan();await f.cleanup.isolate();
  await fs.rmdir(folder);await fs.rmdir(path.dirname(folder));assert.equal((await f.cleanup.restore()).count,1);assert.equal(await fs.readFile(source,'utf8'),'recover');
});
test('skips a file modified after the scan',async t=>{
  const f=await fixture(t),source=path.join(f.root,'old.tmp');await fs.writeFile(source,'old');await f.cleanup.scan();await fs.writeFile(source,'changed content');
  const r=await f.cleanup.isolate();assert.equal(r.count,0);assert.equal(await fs.readFile(source,'utf8'),'changed content');
});
test('restoration does not overwrite a new file at the same location',async t=>{
  const f=await fixture(t),source=path.join(f.root,'old.tmp');await fs.writeFile(source,'original');await f.cleanup.scan();await f.cleanup.isolate();await fs.writeFile(source,'new');
  assert.equal((await f.cleanup.restore()).count,0);assert.equal(await fs.readFile(source,'utf8'),'new');
});
test('rejects junctions leading outside the temporary folder',async t=>{
  const f=await fixture(t),outside=path.join(f.base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret'),'keep');
  await fs.symlink(outside,path.join(f.root,'redirect'),'junction');assert.equal((await f.cleanup.scan()).count,0);
});
test('purging requires explicit confirmation and only removes quarantined files',async t=>{
  const f=await fixture(t),source=path.join(f.root,'old.tmp');await fs.writeFile(source,'remove');await f.cleanup.scan();await f.cleanup.isolate();
  await assert.rejects(()=>f.cleanup.purge('yes'),/Confirmação/);assert.equal(f.store.data.cleanup[0].status,'isolated');
  assert.equal((await f.cleanup.purge('EXCLUIR')).count,1);assert.equal(f.store.data.cleanup[0].status,'deleted');
});
test('does not move a candidate when saving its recovery record fails',async t=>{
  const f=await fixture(t),source=path.join(f.root,'old.tmp');await fs.writeFile(source,'preserve');await f.cleanup.scan();
  f.store.save=async()=>{throw new Error('Disk full');};
  await assert.rejects(()=>f.cleanup.isolate(),/Disk full/);assert.equal(await fs.readFile(source,'utf8'),'preserve');
});
test('reports persistence failure after a move and retains pending recovery details',async t=>{
  const f=await fixture(t),source=path.join(f.root,'old.tmp');await fs.writeFile(source,'recoverable');await f.cleanup.scan();
  let writes=0,durable;
  f.store.save=async()=>{if(++writes===2)throw new Error('Disk full');durable=structuredClone(f.store.data);};
  await assert.rejects(()=>f.cleanup.isolate(),/Disk full/);
  assert.equal(durable.cleanup[0].status,'pending');assert.equal(await fs.readFile(durable.cleanup[0].destination,'utf8'),'recoverable');
  f.store.data=durable;f.store.save=async()=>{};await f.cleanup.recoverPending();
  assert.equal(f.store.data.cleanup[0].status,'isolated');assert.equal((await f.cleanup.restore()).count,1);assert.equal(await fs.readFile(source,'utf8'),'recoverable');
});
