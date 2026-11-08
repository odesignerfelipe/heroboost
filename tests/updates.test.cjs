'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {Updates}=require('../electron/updates.cjs');
function fixture(){
  const updater=new EventEmitter();let checks=0,downloads=0,installs=0,now=1000000000;const scheduled=[];
  updater.setFeedURL=feed=>{assert.equal(feed.repo,'heroboost');};
  updater.checkForUpdates=async()=>{checks++;updater.emit('checking-for-update');updater.emit('update-not-available');};
  updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:35.4});updater.emit('update-downloaded',{version:'0.3.2'});};
  updater.quitAndInstall=(silent,rerun)=>{assert.equal(silent,false);assert.equal(rerun,true);installs++;};
  const clock={setTimeout:(fn,ms)=>{const task={fn,ms,kind:'timeout'};scheduled.push(task);return task;},setInterval:(fn,ms)=>{const task={fn,ms,kind:'interval'};scheduled.push(task);return task;},clearTimeout:id=>{if(id)id.cleared=true;},clearInterval:id=>{if(id)id.cleared=true;}};
  const updates=new Updates({isPackaged:true},{},{updater,clock,now:()=>now});
  return {updates,updater,scheduled,advance:ms=>now+=ms,get checks(){return checks;},get downloads(){return downloads;},get installs(){return installs;}};
}
test('automatic checks start after opening, repeat after 30 minutes and stop on quit',async()=>{
  const f=fixture();f.updates.start();f.updates.start();assert.equal(f.scheduled.length,2);assert.equal(f.checks,0);
  assert.equal(f.scheduled[0].ms,10000);f.scheduled[0].fn();await f.updates.checkPromise;assert.equal(f.checks,1);
  await f.updates.checkIfDue();assert.equal(f.checks,1);f.advance(5*60000);await f.updates.checkIfDue();assert.equal(f.checks,2);
  f.advance(30*60000);f.scheduled[1].fn();await f.updates.checkPromise;assert.equal(f.checks,3);assert.ok(f.updates.state.checkedAt);
  f.updates.stop();assert.equal(f.scheduled[1].cleared,true);assert.equal(f.updates.pollTimer,null);
});
test('concurrent checks share the request and a discovered update never downloads silently',async()=>{
  const f=fixture();let finish;
  f.updater.checkForUpdates=()=>new Promise(resolve=>{finish=()=>{f.updater.emit('update-available',{version:'0.3.2'});resolve();};});
  const first=f.updates.check(),second=f.updates.check();assert.equal(first,second);await Promise.resolve();finish();await first;
  assert.equal(f.updates.state.status,'available');assert.equal(f.updates.state.version,'0.3.2');assert.equal(f.downloads,0);assert.equal(f.updater.autoDownload,false);assert.equal(f.updater.autoInstallOnAppQuit,false);
  assert.equal((await f.updates.checkIfDue(0)).status,'available');assert.equal(f.downloads,0);
});
test('download progress and verified package survive subsequent checks until explicit installation',async()=>{
  const f=fixture();await assert.rejects(()=>f.updates.download(),/Nenhuma/);assert.throws(()=>f.updates.install(),/Baixe/);
  f.updater.emit('update-available',{version:'0.3.2'});await f.updates.download();assert.equal(f.downloads,1);assert.equal(f.installs,0);assert.equal(f.updates.state.status,'downloaded');
  await f.updates.check();assert.equal(f.checks,0);assert.equal(f.updates.state.status,'downloaded');f.updates.install();assert.equal(f.installs,1);
});
test('network errors are visible and an automatic retry can recover',async()=>{
  const f=fixture();f.updater.checkForUpdates=async()=>{throw new Error('Offline');};
  await f.updates.check();assert.equal(f.updates.state.status,'error');assert.equal(f.updates.state.error,'Offline');
  f.advance(30*60000);f.updater.checkForUpdates=async()=>f.updater.emit('update-available',{version:'0.3.2'});
  await f.updates.checkIfDue();assert.equal(f.updates.state.status,'available');assert.equal(f.downloads,0);
});
test('failed downloads offer recovery instead of claiming a verified installer',async()=>{
  const f=fixture();f.updater.emit('update-available',{version:'0.3.2'});f.updater.downloadUpdate=async()=>{throw new Error('Checksum mismatch');};
  await assert.rejects(()=>f.updates.download(),/Checksum/);assert.equal(f.updates.state.status,'error');assert.equal(f.updates.state.version,'0.3.2');assert.throws(()=>f.updates.install(),/Baixe/);assert.equal(f.installs,0);
});
