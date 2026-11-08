'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {Store} = require('./store.cjs');
const {WindowsBridge} = require('./bridge.cjs');
const {Engine,PROTECTED} = require('./engine.cjs');
const {DiskTools,analyzeDirectory} = require('./disk.cjs');
const {Advanced,array} = require('./advanced.cjs');
const {Logitech}=require('./logitech.cjs');
const {Updates}=require('./updates.cjs');
const {settings,profiles,support} = require('./catalog.cjs');
app.setName('Hero Boost');
const smoke=process.argv.includes('--smoke-test');
const qaRoot=path.join(app.isPackaged?(process.env.PORTABLE_EXECUTABLE_DIR||path.dirname(app.getPath('exe'))):path.join(__dirname,'..'),'.qa');
if(smoke)app.setPath('userData',path.join(qaRoot,'user-data'));
if(!app.requestSingleInstanceLock())app.quit();
const index=path.join(__dirname,'..','ui','index.html');
const localURL=pathToFileURL(index).href;
let win,store,bridge,engine,cleanup,info,advanced,updates,hardwareTimer,hardwareBusy=false,focusInterval,quitting=false,queueTick=false;
const logitech=new Logitech();
let previousCPU=os.cpus();
function telemetry() {
  const cpus=os.cpus();let total=0,idle=0;
  cpus.forEach((cpu,i)=>{const before=previousCPU[i]||cpu;for(const k of Object.keys(cpu.times)){const delta=cpu.times[k]-before.times[k];total+=delta;if(k==='idle')idle+=delta;}});
  previousCPU=cpus;
  return {cpu:total?Math.round(100*(1-idle/total)):0,ram:Math.round(100*(1-os.freemem()/os.totalmem())),ramUsed:os.totalmem()-os.freemem(),ramTotal:os.totalmem(),uptime:os.uptime(),sampledAt:Date.now()};
}
async function getState() {
  const current=await bridge.call('settings');
  const journal=[...store.data.journal].reverse().filter((entry,index)=>index<500||['pending','applied'].includes(entry.status));
  return {testing:smoke,info,settings:settings.map(s=>({...s,unavailable:support(s,info),current:current[s.id],applied:current[s.id]?.exists&&current[s.id]?.kind===s.kind&&current[s.id]?.value===s.target})),profiles,profile:store.data.profile,focusApps:store.data.focusApps,backgroundApps:store.data.backgroundApps,focusOptions:store.data.focusOptions,restorePoint:store.data.restorePoint,updates:updates.state,focusEnabled:store.data.focusEnabled,focus:engine.lastFocus,journal,cleanupSources:await cleanup.available(),cleanupStats:{deletedBytes:store.data.cleanup.filter(f=>f.status==='deleted').reduce((sum,f)=>sum+f.size,0),restoredFiles:store.data.cleanup.filter(f=>f.status==='restored').length},cleanup:store.data.cleanup.filter(f=>['pending','isolated'].includes(f.status)).map(f=>({size:f.size,date:f.date})),hardware:advanced.metrics,telemetry:{...telemetry(),hardware:advanced.metrics},version:app.getVersion()};
}
function validateSender(event) {
  if(event.sender!==win?.webContents || event.senderFrame!==win.webContents.mainFrame || event.senderFrame.url!==localURL)throw new Error('Origem não autorizada.');
}
function object(data) {if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Dados inválidos.');return data;}
const actions={
  state:()=>getState(),
  telemetry:()=>({...telemetry(),focus:engine.lastFocus,hardware:advanced.metrics,updates:updates.state}),
  refresh:async()=>{info=await bridge.call('info');engine.systemInfo=info;return getState();},
  apply:({ids})=>engine.serialize(async()=>{await advanced.prepare();return engine.applyIds(ids);}),
  profile:({id})=>engine.serialize(async()=>{await advanced.prepare();return engine.profile(id);}),
  revert:({id})=>engine.serialize(()=>engine.revert(id)),
  revertAll:()=>engine.serialize(()=>engine.revertAll()),
  startup:()=>engine.startup(),
  disableStartup:({id})=>engine.serialize(()=>engine.disableStartup(id)),
  power:()=>bridge.call('power'),
  setPower:({id})=>engine.serialize(()=>engine.setPower(id)),
  createHeroPower:({kind})=>engine.serialize(async()=>{if(!['laptop','desktop'].includes(kind))throw new Error('Plano inválido.');if(store.data.journal.some(j=>j.type==='power'&&['applied','pending'].includes(j.status)))throw new Error('Restaure a troca de energia anterior pelo histórico.');const before=await bridge.call('power');const id=require('node:crypto').randomUUID();const entry=await engine.record('power','Plano Hero '+kind,before.active,id,{createdPlan:id});const actual=await advanced.call('createPower',{kind,id});if(actual.active!==id)throw new Error('Plano não confirmado.');entry.status='applied';await store.save();info=await bridge.call('info');engine.systemInfo=info;return true;}),
  focus:({enabled})=>engine.serialize(()=>engine.setFocus(enabled)),
  addApp:async()=>{
    const selected=await dialog.showOpenDialog(win,{title:'Escolha um jogo ou programa',properties:['openFile'],filters:[{name:'Aplicativo Windows',extensions:['exe']}]});
    if(selected.canceled)return null;
    const executable=selected.filePaths[0];const stat=await fs.lstat(executable);
    if(!stat.isFile()||stat.isSymbolicLink()||path.extname(executable).toLowerCase()!=='.exe'||require('./engine.cjs').isProtectedProcess({path:executable}))throw new Error('Escolha um jogo ou programa de usuário válido.');
    return engine.serialize(async()=>{
      if(store.data.focusApps.length>=30)throw new Error('Limite de 30 programas atingido.');
      if(store.data.focusApps.some(a=>a.path.toLowerCase()===executable.toLowerCase()))throw new Error('Este programa já está na lista.');
      const entry={id:require('node:crypto').randomUUID(),name:path.basename(executable,'.exe'),path:executable};
      store.data.focusApps.push(entry);await store.save();return entry;
    });
  },
  removeApp:({id})=>engine.serialize(async()=>{store.data.focusApps=store.data.focusApps.filter(a=>a.id!==id);await store.save();await engine.focusTick();return true;}),
  scan:({ids})=>engine.serialize(()=>cleanup.scan(ids)),
  clean:()=>engine.serialize(()=>cleanup.isolate()),
  restoreFiles:()=>engine.serialize(()=>cleanup.restore()),
  purge:({confirmation})=>engine.serialize(()=>cleanup.purge(confirmation)),
  analyzeDisk:async()=>{const target=await dialog.showOpenDialog(win,{title:'Analisar pasta sem modificar arquivos',properties:['openDirectory']});if(target.canceled)return null;return analyzeDirectory(target.filePaths[0]);},
  drivers:()=>advanced.call('drivers'),
  backupDrivers:async()=>{advanced.admin();const target=await dialog.showOpenDialog(win,{title:'Pasta para o backup de drivers',properties:['openDirectory','createDirectory']});if(target.canceled)return null;const directory=path.join(target.filePaths[0],'HeroBoost-Drivers-'+Date.now());await fs.mkdir(directory);return engine.serialize(async()=>{const result=await advanced.call('backupDrivers',{directory});store.data.driverBackup={...result,date:new Date().toISOString()};await store.save();return result;});},
  restoreDriver:async()=>{advanced.admin();if(!store.data.driverBackup?.count)throw new Error('Faça primeiro um backup completo dos drivers atuais pelo Hero Boost.');const target=await dialog.showOpenDialog(win,{title:'Restaurar driver de backup local (.inf)',properties:['openFile'],filters:[{name:'Driver INF',extensions:['inf']}]});if(target.canceled)return null;return engine.serialize(()=>advanced.call('restoreDriver',{file:target.filePaths[0]}));},
  packages:async()=>array(await advanced.call('packages')),
  removePackage:({id})=>engine.serialize(()=>advanced.removePackage(id)),
  resources:async()=>({services:array(await advanced.call('services')),tasks:array(await advanced.call('tasks')),network:await advanced.call('network')}),
  resource:({kind,id,after})=>engine.serialize(async()=>{if(!['service','task','network'].includes(kind))throw new Error('Recurso inválido.');await advanced.prepare();return advanced.change(kind,id,id,after);}),
  restorePoint:()=>engine.serialize(async()=>{advanced.admin();await advanced.call('restorePoint');store.data.restorePoint={attempted:true,created:true,error:null};await store.save();return true;}),
  timer:()=>advanced.call('timer'),
  mouseStart:()=>advanced.call('mouseStart'),
  mouseRead:()=>advanced.call('mouseRead'),
  mouseStop:()=>advanced.call('mouseStop'),
  logitechDevices:()=>logitech.list(),
  logitechInfo:({id,index})=>engine.serialize(()=>logitech.inspect(id,index)),
  logitechDpi:({id,index,dpi})=>engine.serialize(()=>advanced.change('mouseDpi',id+':'+index,'DPI do mouse Logitech',dpi)),
  boot:()=>advanced.call('boot'),
  recycle:({confirmation})=>engine.serialize(()=>advanced.call('recycle',{confirmation})),
  focusOptions:({options})=>engine.serialize(()=>advanced.configureFocus(options)),
  addBackground:async()=>{
    const target=await dialog.showOpenDialog(win,{title:'Programa a reduzir durante o foco',properties:['openFile'],filters:[{name:'Executável',extensions:['exe']}]});if(target.canceled)return null;
    const selected=target.filePaths[0];const {isProtectedProcess}=require('./engine.cjs');if(isProtectedProcess({path:selected})||path.extname(selected).toLowerCase()!=='.exe'||!(await fs.lstat(selected)).isFile())throw new Error('Escolha um aplicativo de usuário. Proteções e processos do Windows são excluídos.');
    return engine.serialize(async()=>{if(store.data.backgroundApps.length>=20)throw new Error('Limite de programas atingido.');if(store.data.backgroundApps.some(a=>a.path.toLowerCase()===selected.toLowerCase()))throw new Error('Programa já está na lista.');const item={id:require('node:crypto').randomUUID(),path:selected,name:path.basename(selected,'.exe')};store.data.backgroundApps.push(item);await store.save();return item;});
  },
  removeBackground:({id})=>engine.serialize(async()=>{store.data.backgroundApps=store.data.backgroundApps.filter(a=>a.id!==id);await store.save();await advanced.syncFocus();return true;}),
  checkUpdates:()=>updates.check(),downloadUpdate:()=>updates.download(),
  installUpdate:()=>engine.serialize(async()=>{await engine.setFocus(false);return updates.install();}),
  elevate:()=>engine.serialize(async()=>{
    if(info.admin)return false;await engine.setFocus(false);
    const {execFile}=require('node:child_process');const executable=process.execPath.replace(/'/g,"''");const args=app.isPackaged?'':` -ArgumentList '${path.join(__dirname,'..').replace(/'/g,"''")}'`;
    app.releaseSingleInstanceLock();
    try{await new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath '${executable}'${args} -Verb RunAs -ErrorAction Stop`],{windowsHide:true},error=>error?reject(new Error('Elevação cancelada ou recusada pelo Windows.')):resolve()));quitting=true;clearInterval(focusInterval);clearInterval(hardwareTimer);bridge.close();app.quit();return true;}
    catch(e){app.requestSingleInstanceLock();throw e;}
  }),
  windowsApps:()=>shell.openExternal('ms-settings:appsfeatures'),
  startupSettings:()=>shell.openExternal('ms-settings:startupapps'),
  export:async()=>{
    const target=await dialog.showSaveDialog(win,{title:'Exportar relatório local',defaultPath:'Hero-Boost-relatorio.json',filters:[{name:'Relatório JSON',extensions:['json']}]});
    if(target.canceled)return false;
    // Report deliberately excludes startup command lines, full paths and restore snapshots.
    await fs.writeFile(target.filePath,JSON.stringify({app:'Hero Boost',version:app.getVersion(),date:new Date().toISOString(),hardware:{os:info.os,cpu:info.cpu,ram:os.totalmem(),gpu:info.gpu},changes:store.data.journal.map(j=>({name:j.name,type:j.type,status:j.status,date:j.date})),cleanup:{isolated:store.data.cleanup.filter(f=>f.status==='isolated').length}},null,2),'utf8');return true;
  }
};
async function runSmoke() {
  try {
    await win.webContents.executeJavaScript('window.heroReady');
    const state=await getState();
    const startup=await engine.startup();
    const results=await win.webContents.executeJavaScript(`(async()=>{
      const results=[];
      for(const page of ['profiles','adjustments','focus','performance','cleanup','startup','energy','debloat','mouse','timer','drivers','resources','history','settings','dashboard']){
        document.querySelector('[data-page="'+page+'"]').click();
        await new Promise(r=>setTimeout(r,250));
        results.push({page,visible:document.querySelector('main').innerText.length>80,title:document.querySelector('h1')?.textContent,breadcrumb:document.querySelector('#breadcrumb').textContent});
      }
      document.querySelector('[data-action="boost"]').click();
      await new Promise(r=>setTimeout(r,100));
      results.push({dialog:document.querySelector('dialog').open});
      document.querySelector('[data-cancel]').click();
      results.push({sandbox:typeof window.require==='undefined'&&typeof window.process==='undefined'});
      document.querySelector('[data-page="adjustments"]').click();
      await new Promise(r=>setTimeout(r,150));
      const search=document.querySelector('#setting-search');search.value='Publicidade';search.dispatchEvent(new Event('input',{bubbles:true}));
      results.push({search:document.querySelectorAll('.setting-row').length===1});
      document.querySelector('[data-page="dashboard"]').click();
      await new Promise(r=>setTimeout(r,150));
      return results;
    })()`);
    if(results.some(r=>r.visible===false)||!results.find(r=>r.dialog)||!results.find(r=>r.sandbox)||!results.find(r=>r.search)||new Set(results.filter(r=>r.page).map(r=>r.title)).size!==15)throw new Error('Teste de interface falhou.');
    const drivers=await advanced.call('drivers');const packages=array(await advanced.call('packages'));const timer=await advanced.call('timer');const hid=await logitech.list();
    const services=array(await advanced.call('services')),tasks=array(await advanced.call('tasks')),network=await advanced.call('network'),boot=await advanced.call('boot');
    if(!network.AutoTuningLevelLocal||services.some(s=>!s.start||typeof s.delayed!=='boolean'))throw new Error('Inventário nativo incompleto.');
    win.showInactive();
    await new Promise(r=>setTimeout(r,600));
    await fs.mkdir(qaRoot,{recursive:true});
    await fs.writeFile(path.join(qaRoot,'dashboard.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-page=\"settings\"]').click()");
    await new Promise(r=>setTimeout(r,250));
    await win.webContents.executeJavaScript("document.querySelector('[data-action=\"theme\"]').click()");
    await new Promise(r=>setTimeout(r,250));
    await fs.writeFile(path.join(qaRoot,'light-theme.png'),(await win.webContents.capturePage()).toPNG());
    const light=await win.webContents.executeJavaScript("document.body.dataset.theme==='light'");
    await win.webContents.executeJavaScript("if(document.body.dataset.theme==='light')document.querySelector('[data-action=\"theme\"]').click()");
    if(!light)throw new Error('Tema claro não ativou.');
    const report={ok:true,packaged:app.isPackaged,os:state.info.os,settings:state.settings.length,profiles:state.profiles.length,startup:startup.length,drivers:drivers.items.length,optionalApps:packages.length,services:services.length,tasks:tasks.length,network,bootLogAvailable:boot.available,timerMs:timer.currentMs,logitechDevices:hid.length,hardware:advanced.metrics,lightTheme:light,changes:store.data.journal.length,results};
    await fs.writeFile(path.join(qaRoot,'smoke.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));app.quit();
  }catch(e){console.error(e);app.exit(1);}
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  if(process.platform!=='win32')throw new Error('O Hero Boost requer Windows 10 ou 11.');
  store=new Store(app.getPath('userData'));await store.load();
  bridge=new WindowsBridge(app.isPackaged?path.join(process.resourcesPath,'native','bridge.ps1'):path.join(__dirname,'..','native','bridge.ps1'));
  engine=new Engine(store,bridge);
  cleanup=new DiskTools(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),path.join(app.getPath('userData'),'quarantine'),store,bridge);
  advanced=new Advanced(engine,store,bridge);updates=new Updates(app,store);
  const nativeSnapshot=advanced.snapshot.bind(advanced),nativeWrite=advanced.write.bind(advanced);
  advanced.snapshot=async(kind,id)=>{if(kind!=='mouseDpi')return nativeSnapshot(kind,id);const [device,index]=id.split(':');await logitech.list();return (await logitech.inspect(device,Number(index))).dpi;};
  advanced.write=async(kind,id,value,details)=>{if(kind!=='mouseDpi')return nativeWrite(kind,id,value,details);const [device,index]=id.split(':');return logitech.setDpi(device,Number(index),value);};
  await cleanup.recoverPending();
  // Focus never silently resumes on startup. Recover only temporary priorities that we own.
  store.data.focusEnabled=false;await store.save();
  const recovery=await engine.revertAll('priority');engine.lastFocus.errors=recovery.errors;
  info=await bridge.call('info');
  engine.systemInfo=info;
  const focusRecovery=await advanced.restoreFocus();engine.lastFocus.errors.push(...focusRecovery.errors);
  try{advanced.metrics=await advanced.call('metrics');}catch(e){advanced.metrics={error:e.message};}
  ipcMain.handle('hero:request',async(event,action,data={})=>{
    try{validateSender(event);if(typeof action!=='string'||!Object.hasOwn(actions,action))throw new Error('Operação não permitida.');object(data);return {ok:true,result:await actions[action](data)};}
    catch(e){return {ok:false,error:e.message};}
  });
  win=new BrowserWindow({width:1440,height:smoke?1060:960,minWidth:1040,minHeight:740,backgroundColor:'#0c0f14',title:'Hero Boost',icon:path.join(__dirname,'..','ui','assets','icon.png'),autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:!smoke,devTools:!app.isPackaged}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  if(smoke)win.webContents.on('console-message',event=>console.log('RENDERER:',event.message));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==localURL)event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file://')}));
  win.once('ready-to-show',()=>{if(!smoke)win.show();});
  await win.loadFile(index);
  hardwareTimer=setInterval(async()=>{if(hardwareBusy)return;hardwareBusy=true;try{advanced.metrics=await advanced.call('metrics');}catch(e){advanced.metrics={error:e.message};}finally{hardwareBusy=false;}},5000);
  if(!smoke)setTimeout(()=>updates.check().catch(()=>{}),10000);
  focusInterval=setInterval(()=>{
    if(queueTick||!store.data.focusEnabled)return;queueTick=true;
    engine.serialize(()=>engine.focusTick()).catch(e=>{engine.lastFocus.errors=[e.message];}).finally(()=>{queueTick=false;});
  },4000);
  if(smoke)await runSmoke();
}).catch(error=>{dialog.showErrorBox('Hero Boost — inicialização',error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;clearInterval(focusInterval);clearInterval(hardwareTimer);
  const timeout=setTimeout(()=>{bridge?.close();app.exit(0);},12000);
  (engine?engine.serialize(()=>engine.setFocus(false)):Promise.resolve()).catch(()=>{}).finally(()=>{clearTimeout(timeout);bridge?.close();app.quit();});
});
