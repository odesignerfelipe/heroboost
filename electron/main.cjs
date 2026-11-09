'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,powerMonitor} = require('electron');
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
const {CS2,modes:cs2Modes}=require('./cs2.cjs');
const {Connection}=require('./connection.cjs');
const {Maintenance}=require('./maintenance.cjs');
const {discoverCreative,addFocusPreset,workProtected}=require('./workloads.cjs');
const {settings,profiles,support} = require('./catalog.cjs');
app.setName('Hero Boost');
const inspectQA=process.argv.includes('--inspect-qa');
const smoke=process.argv.includes('--smoke-test')||inspectQA;
const testRegistryRoot=smoke?'Software\\HeroBoost-Tests-'+require('node:crypto').randomUUID().replaceAll('-',''):null;
const qaRoot=path.join(app.isPackaged?(process.env.PORTABLE_EXECUTABLE_DIR||path.dirname(app.getPath('exe'))):path.join(__dirname,'..'),'.qa');
if(smoke)app.setPath('userData',path.join(qaRoot,inspectQA?'inspection-user-data':'smoke-user-data'));
if(!app.requestSingleInstanceLock())app.quit();
const index=path.join(__dirname,'..','ui','index.html');
const localURL=pathToFileURL(index).href;
let win,store,bridge,engine,cleanup,info,advanced,updates,cs2,connection,maintenance,maintenanceBridge,creativeCandidates=[],hardwareTimer,hardwareBusy=false,focusInterval,quitting=false,queueTick=false;
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
  return {testing:smoke,maintenance:{...maintenance.view(),sources:await maintenance.disk.available()},driverBackup:store.data.driverBackup?{count:store.data.driverBackup.count,date:store.data.driverBackup.date}:null,cs2:{...store.data.cs2,modes:cs2Modes},connection:store.data.connection,info,settings:settings.map(s=>({...s,unavailable:support(s,info),current:current[s.id],applied:current[s.id]?.exists&&current[s.id]?.kind===s.kind&&current[s.id]?.value===s.target})),profiles,profile:store.data.profile,focusApps:store.data.focusApps,backgroundApps:store.data.backgroundApps,focusOptions:store.data.focusOptions,restorePoint:store.data.restorePoint,updates:updates.state,focusEnabled:store.data.focusEnabled,focus:engine.lastFocus,journal,cleanupSources:await cleanup.available(),cleanupStats:{lastIsolation:store.data.cleanup.filter(f=>['isolated','restored','deleted'].includes(f.status)).at(-1)?.date||null,deletedBytes:store.data.cleanup.filter(f=>f.status==='deleted').reduce((sum,f)=>sum+f.size,0),restoredFiles:store.data.cleanup.filter(f=>f.status==='restored').length},cleanup:store.data.cleanup.filter(f=>['pending','isolated'].includes(f.status)).map(f=>({size:f.size,date:f.date})),hardware:advanced.metrics,telemetry:{...telemetry(),hardware:advanced.metrics},version:app.getVersion()};
}
function validateSender(event) {
  if(event.sender!==win?.webContents || event.senderFrame!==win.webContents.mainFrame || event.senderFrame.url!==localURL)throw new Error('Origem não autorizada.');
}
function object(data) {if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Dados inválidos.');return data;}
const actions={
  state:()=>getState(),
  telemetry:()=>({...telemetry(),focus:engine.lastFocus,hardware:advanced.metrics,updates:updates.state,maintenanceState:maintenance.state}),
  refresh:async()=>{info=await bridge.call('info');engine.systemInfo=info;return getState();},
  apply:({ids})=>engine.serialize(async()=>{if(!smoke)await advanced.prepare();return engine.applyIds(ids);}),
  profile:({id})=>engine.serialize(async()=>{if(!smoke)await advanced.prepare();return engine.profile(id);}),
  revert:({id})=>engine.serialize(()=>engine.revert(id)),
  revertAll:()=>engine.serialize(async()=>{const focus=await engine.setFocus(false);const session=await cs2.deactivate({restoreFocus:false});const result=await engine.revertAll();return {restored:session.restored+result.restored,errors:[...focus.errors,...session.errors,...result.errors]};}),
  startup:()=>engine.startup(),
  disableStartup:({id})=>engine.serialize(()=>engine.disableStartup(id)),
  power:()=>bridge.call('power'),
  setPower:({id})=>engine.serialize(()=>engine.setPower(id)),
  createHeroPower:({kind})=>engine.serialize(async()=>{if(!['laptop','desktop'].includes(kind))throw new Error('Plano inválido.');if(store.data.journal.some(j=>j.type==='power'&&j.status==='pending'))throw new Error('Resolva a troca de energia pendente pelo histórico.');const before=await bridge.call('power');const id=require('node:crypto').randomUUID();const entry=await engine.record('power','Plano Hero '+kind,before.active,id,{createdPlan:id});const actual=await advanced.call('createPower',{kind,id});if(actual.active!==id)throw new Error('Plano não confirmado.');entry.status='applied';await store.save();info=await bridge.call('info');engine.systemInfo=info;return true;}),
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
  cs2Discover:()=>engine.serialize(()=>cs2.discover()),
  cs2Select:async()=>{const target=await dialog.showOpenDialog(win,{title:'Escolha o cs2.exe',properties:['openFile'],filters:[{name:'Counter-Strike 2',extensions:['exe']}]});if(target.canceled)return null;return engine.serialize(()=>cs2.select(target.filePaths[0]));},
  cs2Activate:({mode})=>engine.serialize(async()=>{if(!smoke)await advanced.prepare();return cs2.activate(mode);}),
  cs2Deactivate:()=>engine.serialize(()=>cs2.deactivate()),
  cs2Resume:()=>engine.serialize(async()=>{if(!store.data.cs2.session?.active)throw new Error('Ative primeiro um modo CS2.');await cs2.validate(store.data.cs2.path);await engine.setFocus(true);return true;}),
  cs2Launch:()=>shell.openExternal('steam://rungameid/730'),
  cs2Config:async({options})=>{const target=await dialog.showSaveDialog(win,{title:'Salvar configuração opcional do CS2',defaultPath:cs2.configPath()||'hero_boost_cs2.cfg',filters:[{name:'Configuração CS2',extensions:['cfg']}]});if(target.canceled)return null;return engine.serialize(()=>cs2.exportConfig(target.filePath,options));},
  connectionRun:({target,trace})=>{if(smoke&&target!=='127.0.0.1')throw new Error('A verificação de conexão usa apenas loopback.');return connection.run(target,trace!==false);},
  connectionExport:async()=>{const report=store.data.connection.reports.at(-1);if(!report)throw new Error('Faça um diagnóstico primeiro.');const target=await dialog.showSaveDialog(win,{title:'Exportar diagnóstico de conexão (inclui IPs)',defaultPath:'Hero-Boost-conexao.json',filters:[{name:'Diagnóstico JSON',extensions:['json']}]});if(target.canceled)return false;await fs.writeFile(target.filePath,JSON.stringify(report,null,2),'utf8');return true;},
  cs2Qos:()=>engine.serialize(async()=>{advanced.admin();const executable=await cs2.validate(store.data.cs2.path);return advanced.change('qos','HeroBoost-CS2','QoS UDP do CS2',{exists:true,path:executable.toLowerCase(),protocol:'UDP',dscp:46,rate:0});}),
  limitUpload:async({mbps})=>{advanced.admin();if(typeof mbps!=='number'||mbps<.1||mbps>1000)throw new Error('Informe limite entre 0,1 e 1000 Mbps.');const target=await dialog.showOpenDialog(win,{title:'Aplicativo cujo upload será limitado',properties:['openFile'],filters:[{name:'Executável',extensions:['exe']}]});if(target.canceled)return null;const executable=await fs.realpath(target.filePaths[0]);if(require('./engine.cjs').isProtectedProcess({path:executable}))throw new Error('Não é permitido limitar componentes do Windows ou de segurança.');const id='HeroBoost-Upload-'+require('node:crypto').randomUUID();return engine.serialize(()=>advanced.change('qos',id,'Limite de upload: '+path.basename(executable),{exists:true,path:executable.toLowerCase(),protocol:'Both',dscp:-1,rate:Math.round(mbps*1000000)}));},
  recycle:({confirmation})=>engine.serialize(()=>advanced.call('recycle',{confirmation})),
  focusOptions:({options})=>engine.serialize(()=>advanced.configureFocus(options)),
  maintenanceInspect:()=>maintenance.inspect(),
  maintenanceConfigure:({config,confirmation})=>engine.serialize(()=>maintenance.configure(config,confirmation)),
  maintenanceTrim:()=>engine.serialize(()=>maintenance.trim(false)),
  maintenanceCache:({ids,remove,confirmation})=>engine.serialize(()=>maintenance.cacheRun({ids,remove:remove===true,confirmation})),
  memoryAddApp:async()=>{const selected=await dialog.showOpenDialog(win,{title:'Aplicativo de segundo plano permitido para RAM ociosa',properties:['openFile'],filters:[{name:'Aplicativo',extensions:['exe']}]});if(selected.canceled)return null;return engine.serialize(()=>maintenance.addMemoryApp(selected.filePaths[0]));},
  memoryRemoveApp:({path})=>engine.serialize(()=>maintenance.removeMemoryApp(path)),
  creativeDiscover:async()=>{creativeCandidates=await discoverCreative(await bridge.call('processes'),[process.env.ProgramFiles,process.env['ProgramFiles(x86)']]);return creativeCandidates;},
  creativeActivate:({paths,foregroundOnly})=>engine.serialize(async()=>{if(!Array.isArray(paths)||!paths.length||paths.some(p=>!creativeCandidates.some(c=>c.path===p)))throw new Error('Detecte e selecione os aplicativos primeiro.');return addFocusPreset(engine,store,creativeCandidates.filter(p=>paths.includes(p.path)),foregroundOnly===true);}),
  addBackground:async()=>{
    const target=await dialog.showOpenDialog(win,{title:'Programa a reduzir durante o foco',properties:['openFile'],filters:[{name:'Executável',extensions:['exe']}]});if(target.canceled)return null;
    const selected=target.filePaths[0];if(workProtected({path:selected})||path.extname(selected).toLowerCase()!=='.exe'||!(await fs.lstat(selected)).isFile())throw new Error('Escolha um aplicativo de segundo plano. Windows, criação e jogos são protegidos.');
    return engine.serialize(async()=>{if(store.data.backgroundApps.length>=20)throw new Error('Limite de programas atingido.');if(store.data.backgroundApps.some(a=>a.path.toLowerCase()===selected.toLowerCase()))throw new Error('Programa já está na lista.');const item={id:require('node:crypto').randomUUID(),path:selected,name:path.basename(selected,'.exe')};store.data.backgroundApps.push(item);await store.save();return item;});
  },
  removeBackground:({id})=>engine.serialize(async()=>{store.data.backgroundApps=store.data.backgroundApps.filter(a=>a.id!==id);await store.save();await advanced.syncFocus();return true;}),
  checkUpdates:()=>updates.check(),downloadUpdate:()=>updates.download(),
  installUpdate:()=>engine.serialize(async()=>{await engine.setFocus(false);return updates.install();}),
  elevate:()=>engine.serialize(async()=>{
    if(info.admin)return false;await engine.setFocus(false);
    const {execFile}=require('node:child_process');const executable=process.execPath.replace(/'/g,"''");const args=app.isPackaged?'':` -ArgumentList '${path.join(__dirname,'..').replace(/'/g,"''")}'`;
    app.releaseSingleInstanceLock();
    try{await new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath '${executable}'${args} -Verb RunAs -ErrorAction Stop`],{windowsHide:true},error=>error?reject(new Error('Elevação cancelada ou recusada pelo Windows.')):resolve()));quitting=true;clearInterval(focusInterval);clearInterval(hardwareTimer);updates.stop();maintenance.stop();maintenanceBridge.close();bridge.close();app.quit();return true;}
    catch(e){app.requestSingleInstanceLock();throw e;}
  }),
  windowsApps:()=>shell.openExternal('ms-settings:appsfeatures'),
  windowsStorage:()=>shell.openExternal('ms-settings:storagesense'),
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
      for(const page of ['profiles','adjustments','focus','performance','cleanup','startup','energy','debloat','mouse','timer','drivers','resources','history','cs2','connection','maintenance','settings','dashboard']){
        document.querySelector('[data-page="'+page+'"]').click();
        await new Promise(r=>setTimeout(r,250));
        results.push({page,visible:document.querySelector('main').innerText.length>80,title:document.querySelector('h1')?.textContent,breadcrumb:document.querySelector('#breadcrumb').textContent,controls:[...document.querySelectorAll('[data-action]')].every(el=>typeof handlers[el.dataset.action]==='function')});
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
    if(results.some(r=>r.visible===false||r.controls===false)||!results.find(r=>r.dialog)||!results.find(r=>r.sandbox)||!results.find(r=>r.search)||new Set(results.filter(r=>r.page).map(r=>r.title)).size!==18)throw new Error('Teste de interface falhou.');
    const workspaceFlow=await win.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));const until=async fn=>{for(let i=0;i<160;i++){if(fn())return;await pause(100);}throw new Error('Workspace flow timeout');};
      const savedFavorites=[...favorites],savedCleanup=[...cleanupSelection];favorites.clear();filter='Todos';search='';catalogStatus='all';catalogView='cards';await navigate('adjustments');
      document.querySelector('[data-action="favoriteSetting"][data-id="game-mode"]').click();
      if(!favorites.has('game-mode')||!JSON.parse(localStorage.getItem('hero-favorites')).includes('game-mode'))throw new Error('Favorite did not persist');
      const status=document.querySelector('#catalog-status');status.value='favorites';status.dispatchEvent(new Event('change',{bubbles:true}));
      if(document.querySelectorAll('.setting-row').length!==1)throw new Error('Favorite filter failed');
      document.querySelector('[data-action="catalogView"][data-id="list"]').click();if(!document.querySelector('#settings-list').classList.contains('catalog-list'))throw new Error('List view failed');
      document.querySelector('[data-action="applyOne"][data-id="game-mode"]').click();await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&document.querySelector('.setting-row [data-action="revert"]'));
      if(!document.querySelector('.setting-row').classList.contains('is-configured'))throw new Error('Applied card state missing');
      document.querySelector('.setting-row [data-action="revert"]').click();await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&!!document.querySelector('[data-action="applyOne"]'));
      favorites=new Set(savedFavorites);localStorage.setItem('hero-favorites',JSON.stringify(savedFavorites));catalogStatus='all';search='';catalogView='cards';localStorage.setItem('hero-catalog-view',JSON.stringify('cards'));render();
      const originallyCollapsed=document.body.classList.contains('sidebar-compact');document.querySelector('#sidebar-collapse').click();
      if(document.body.classList.contains('sidebar-compact')===originallyCollapsed)throw new Error('Sidebar did not change');
      await navigate('cleanup');while(document.querySelector('[data-clean-source]:checked'))document.querySelector('[data-clean-source]:checked').click();
      if(!document.querySelector('[data-action="scan"]').disabled||!document.querySelector('[data-action="clean"]').disabled)throw new Error('Cleanup actions enabled without selection');
      const first=document.querySelector('[data-clean-source]:not(:disabled)');if(first){first.click();if(document.querySelector('[data-action="scan"]').disabled)throw new Error('Cleanup selection failed');}
      cleanupSelection=new Set(savedCleanup);render();document.querySelector('#sidebar-collapse').click();
      await navigate('history');document.querySelector('[data-action="historyFilter"][data-id="reverted"]').click();
      if(!document.querySelector('.recovery-row')||document.querySelector('.recovery-row [data-action="revert"]'))throw new Error('Restored history filter failed');
      document.querySelector('[data-action="historyFilter"][data-id="all"]').click();await navigate('dashboard');
      if(document.documentElement.scrollWidth>window.innerWidth+1)throw new Error('Horizontal layout overflow');
      return {favorites:true,filters:true,listView:true,individualApply:true,individualUndo:true,sidebar:true,cleanupSelection:true,recoveryFilter:true};
    })()`);
    const maintenanceFlow=await win.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await pause(100);}throw new Error('Maintenance UI timeout: '+document.querySelector('#toast')?.textContent+' '+JSON.stringify(state.maintenance.state));};
      await navigate('maintenance');document.querySelector('[data-action="maintenanceInspect"]').click();
      await until(()=>!document.querySelector('.busy-overlay')&&state.maintenance.memory?.total>0);
      if(state.maintenance.config.cache.enabled||state.maintenance.config.memory.enabled)throw new Error('Automation should start disabled');
      document.querySelector('[data-action="maintenanceSave"]').click();await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();await until(()=>!document.querySelector('.busy-overlay')&&!document.querySelector('dialog').open&&document.querySelector('#toast').textContent.includes('Regras salvas'));
      manualCacheIds=new Set(['chrome']);render();document.querySelector('[data-action="maintenanceCacheDelete"]').click();await until(()=>document.querySelector('dialog').open);
      const typed=document.querySelector('#purge-confirmation');if(!typed||!document.querySelector('#dialog-confirm').disabled)throw new Error('Permanent cache cleanup requires typed consent');typed.value='EXCLUIR';typed.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&state.maintenance.state.lastCache?.deleted.count===1);
      if(!document.querySelector('#maintenance-results').textContent.includes('1 arquivo(s) excluído(s)'))throw new Error('Actual cache result not visible');
      return {memoryRead:true,automationInitiallyOff:true,configSaved:true,typedConsent:true,cacheDeleted:true,fixtureOnly:true,liveAppsTrimmed:false};
    })()`);
    if(await fs.readFile(path.join(qaRoot,'maintenance-fixtures','Google','Chrome','User Data','Default','Cache','Cache_Data','keep.psd'),'utf8')!=='protected fixture')throw new Error('Protected cache fixture was modified.');
    const checklist=await win.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await pause(100);}throw new Error('UI action timeout');};
      document.querySelector('[data-page="adjustments"]').click();await pause(400);
      const search=document.querySelector('#setting-search');search.value='Modo de Jogo do Windows';search.dispatchEvent(new Event('input',{bubbles:true}));
      const check=document.querySelector('[data-setting="game-mode"]');if(!check||check.disabled||check.checked)throw new Error('Isolated fixture not available');
      check.click();if(document.querySelector('#selection-count').textContent!=='1')throw new Error('Selection count not synchronized');
      document.querySelector('[data-action="applySelected"]').click();await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&document.querySelector('[data-setting="game-mode"]')?.checked&&document.querySelector('[data-setting="game-mode"]')?.disabled&&document.querySelector('.setting-row [data-action="revert"]'));
      const applied=document.querySelector('[data-setting="game-mode"]');if(!applied.disabled)throw new Error('Applied setting state not reflected');
      const undo=document.querySelector('.setting-row [data-action="revert"]');if(!undo)throw new Error('Per-item undo missing');undo.click();
      await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&!document.querySelector('[data-setting="game-mode"]')?.checked);
      if(document.querySelector('[data-setting="game-mode"]').disabled)throw new Error('Restored setting is not selectable');
      document.querySelector('[data-page="dashboard"]').click();await pause(300);
      return {selected:true,applied:true,undo:true,registry:'isolated-test-key'};
    })()`);
    const cs2Flow=await win.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await pause(100);}throw new Error('CS2 UI action timeout');};
      document.querySelector('[data-page="cs2"]').click();await pause(250);
      document.querySelector('[data-action="cs2Activate"][data-id="stable"]').click();await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&document.querySelector('[data-action="cs2Deactivate"]'));
      if(!state.focusEnabled||!state.focusApps.some(a=>a.name==='Counter-Strike 2'))throw new Error('CS2 focus not enabled');
      document.querySelector('[data-action="cs2Deactivate"]').click();await until(()=>document.querySelector('dialog').open);document.querySelector('#dialog-confirm').click();
      await until(()=>!document.querySelector('.busy-overlay')&&!document.querySelector('[data-action="cs2Deactivate"]'));
      if(state.focusEnabled||state.focusApps.length)throw new Error('CS2 session not restored');
      return {activated:true,focus:true,undo:true,gameLaunched:false};
    })()`);
    const connectionFlow=await win.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      document.querySelector('[data-page="connection"]').click();await pause(200);
      document.querySelector('#connection-target').value='127.0.0.1';document.querySelector('[data-action="connectionRun"]').click();
      for(let i=0;i<600;i++){if(!document.querySelector('.busy-overlay')&&state.connection.reports.length)break;await pause(100);}
      const report=state.connection.reports.at(-1);if(!report||report.destination.summary.received!==20||report.hops[0]?.status!=='Success')throw new Error('Connection UI measurement failed');
      return {target:report.target,received:report.destination.summary.received,trace:true,exportEnabled:!document.querySelector('[data-action="connectionExport"]').disabled};
    })()`);
    const realUpdateState=updates.state;
    updates.state={...updates.state,status:'available',version:'99.0.0 (teste isolado)'};
    const updateNotice=await win.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async fn=>{for(let i=0;i<40;i++){if(fn())return;await pause(100);}throw new Error('Update confirmation timeout');};
      clearInterval(refreshTimer);
      await reload();const notice=document.querySelector('#global-update-notice');
      if(notice.hidden||!document.querySelector('#global-update-action').textContent.includes('Atualizar para'))throw new Error('Update button missing');
      document.querySelector('#global-update-action').click();await until(()=>document.querySelector('dialog').open);
      document.querySelector('[data-cancel]').click();await until(()=>!document.querySelector('dialog').open);
      await navigate('profiles');if(notice.hidden)throw new Error('Update notice lost during navigation');
      window.scrollTo(0,1000);await pause(100);if(notice.getBoundingClientRect().top<0)throw new Error('Update notice not sticky');window.scrollTo(0,0);
      state.telemetry.updates={status:'downloading',version:'99.0.0',progress:42};updateMetrics();
      if(!document.querySelector('#global-update-action').disabled||!notice.textContent.includes('42%'))throw new Error('Download progress missing');
      state.telemetry.updates={status:'downloaded',version:'99.0.0'};updateMetrics();document.querySelector('#global-update-action').click();await until(()=>document.querySelector('dialog').open);
      if(!document.querySelector('#dialog-title').textContent.includes('Instalar'))throw new Error('Install confirmation missing');document.querySelector('[data-cancel]').click();await until(()=>!document.querySelector('dialog').open);
      state.telemetry.updates={status:'error',version:'99.0.0',error:'Offline test'};updateMetrics();if(document.querySelector('#global-update-action').dataset.action!=='checkUpdates')throw new Error('Retry unavailable');
      state.telemetry.updates={status:'current',version:null};updateMetrics();if(!notice.hidden)throw new Error('Current version shows false update');
      state.telemetry.updates={status:'available',version:'99.0.0 (teste isolado)'};updateMetrics();if(notice.hidden||!document.querySelector('#global-update-action'))throw new Error('Notice did not recover');
      return {available:true,navigation:true,sticky:true,progress:true,downloadConfirmation:true,installConfirmation:true,retry:true,simulatedRelease:true};
    })()`);
    await fs.writeFile(path.join(qaRoot,'update-notice.png'),(await win.webContents.capturePage()).toPNG());
    updates.state=realUpdateState;
    await win.webContents.executeJavaScript("(async()=>{await reload();await navigate('connection');})()");
    const drivers=await advanced.call('drivers');const packages=array(await advanced.call('packages'));const timer=await advanced.call('timer');const hid=await logitech.list();
    const services=array(await advanced.call('services')),tasks=array(await advanced.call('tasks')),network=await advanced.call('network'),boot=await advanced.call('boot');
    if(!network.AutoTuningLevelLocal||services.some(s=>!s.start||typeof s.delayed!=='boolean'))throw new Error('Inventário nativo incompleto.');
    // Automated checks render offscreen; never take control of the user's desktop.
    await new Promise(r=>setTimeout(r,600));
    await fs.mkdir(qaRoot,{recursive:true});
    await fs.writeFile(path.join(qaRoot,'connection.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-page=\"cs2\"]').click()");
    await new Promise(r=>setTimeout(r,250));
    await fs.writeFile(path.join(qaRoot,'cs2.png'),(await win.webContents.capturePage()).toPNG());
    for(const [page,file] of [['adjustments','catalog.png'],['cleanup','cleanup.png'],['history','recovery.png'],['maintenance','maintenance.png']]){
      await win.webContents.executeJavaScript(`(async()=>{search='';filter='Todos';catalogStatus='all';await navigate('${page}');})()`);
      await new Promise(r=>setTimeout(r,200));
      await fs.writeFile(path.join(qaRoot,file),(await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript("document.querySelector('[data-page=\"dashboard\"]').click()");
    await new Promise(r=>setTimeout(r,250));
    await fs.writeFile(path.join(qaRoot,'dashboard.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-page=\"settings\"]').click()");
    await new Promise(r=>setTimeout(r,250));
    await win.webContents.executeJavaScript("document.querySelector('[data-action=\"theme\"]').click()");
    await new Promise(r=>setTimeout(r,250));
    await fs.writeFile(path.join(qaRoot,'light-theme.png'),(await win.webContents.capturePage()).toPNG());
    const light=await win.webContents.executeJavaScript("document.body.dataset.theme==='light'");
    for(const [page,file] of [['dashboard','dashboard-light.png'],['adjustments','catalog-light.png'],['cleanup','cleanup-light.png']]){
      await win.webContents.executeJavaScript(`navigate('${page}')`);await new Promise(r=>setTimeout(r,150));
      await fs.writeFile(path.join(qaRoot,file),(await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript("navigate('settings')");
    await win.webContents.executeJavaScript("if(document.body.dataset.theme==='light')document.querySelector('[data-action=\"theme\"]').click()");
    if(!light)throw new Error('Tema claro não ativou.');
    win.setSize(1040,740);await new Promise(r=>setTimeout(r,200));
    const responsive=await win.webContents.executeJavaScript(`(async()=>{
      const results=[];const original=document.body.classList.contains('sidebar-compact');
      for(const compact of [false,true]){
        document.body.classList.toggle('sidebar-compact',compact);
        for(const id of ['dashboard','adjustments','cleanup','history','maintenance']){
          await navigate(id);const overflow=document.documentElement.scrollWidth>innerWidth+1;
          if(overflow)throw new Error('Layout overflow at '+id+' with compact='+compact);
          const settings=document.querySelector('.sidebar-bottom').getBoundingClientRect();if(settings.bottom>innerHeight+1)throw new Error('Settings inaccessible');
          results.push({page:id,compact,width:innerWidth,overflow:false});
        }
      }
      await navigate('adjustments');document.body.classList.toggle('sidebar-compact',original);return results;
    })()`);
    await fs.writeFile(path.join(qaRoot,'catalog-small.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(1440,1060);
    const report={ok:true,maintenance:maintenanceFlow,workspace:workspaceFlow,responsive,checklist,cs2:cs2Flow,connection:connectionFlow,updateNotice,packaged:app.isPackaged,os:state.info.os,settings:state.settings.length,profiles:state.profiles.length,startup:startup.length,drivers:drivers.items.length,optionalApps:packages.length,services:services.length,tasks:tasks.length,network,bootLogAvailable:boot.available,timerMs:timer.currentMs,logitechDevices:hid.length,hardware:advanced.metrics,lightTheme:light,changes:store.data.journal.filter(j=>['applied','pending'].includes(j.status)).length,results};
    await fs.writeFile(path.join(qaRoot,'smoke.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));app.quit();
  }catch(e){console.error(e);try{await bridge.call('cleanupTestRegistry');}catch{}app.exit(1);}
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  if(process.platform!=='win32')throw new Error('O Hero Boost requer Windows 10 ou 11.');
  store=new Store(app.getPath('userData'));await store.load();if(smoke){store.data.journal=[];store.data.focusApps=[];store.data.backgroundApps=[];store.data.cleanup=[];await fs.mkdir(qaRoot,{recursive:true});const executable=path.join(qaRoot,'cs2.exe');await fs.writeFile(executable,'MZ disposable fixture, never launched');store.data.cs2={path:executable,session:null};store.data.connection={reports:[]};}
  bridge=new WindowsBridge(app.isPackaged?path.join(process.resourcesPath,'native','bridge.ps1'):path.join(__dirname,'..','native','bridge.ps1'),{testRegistryRoot});
  engine=new Engine(store,bridge);
  cleanup=new DiskTools(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),path.join(app.getPath('userData'),'quarantine'),store,bridge);
  advanced=new Advanced(engine,store,bridge);updates=new Updates(app,store);
  maintenanceBridge=new WindowsBridge(bridge.script);
  const maintenanceLocal=smoke?path.join(qaRoot,'maintenance-fixtures'):process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
  if(smoke){store.data.maintenance=null;await fs.mkdir(path.join(maintenanceLocal,'Temp'),{recursive:true});const cache=path.join(maintenanceLocal,'Google','Chrome','User Data','Default','Cache','Cache_Data');await fs.mkdir(cache,{recursive:true});await fs.writeFile(path.join(cache,'hero-fixture_0'),'disposable cache fixture');await fs.writeFile(path.join(cache,'keep.psd'),'protected fixture');}
  maintenance=new Maintenance(engine,store,maintenanceBridge,maintenanceLocal,path.join(app.getPath('userData'),'quarantine'),()=>powerMonitor.getSystemIdleTime());
  if(smoke){maintenance.disk.bridge={call:async action=>{if(action==='processes')return [];throw new Error('Fixture bridge only inventories an empty application set.');}};for(const cleaner of maintenance.disk.cleaners.values())cleaner.clock=()=>Date.now()+8*86400000;}
  cs2=new CS2(engine,store,bridge);connection=new Connection(bridge.script,store,bridge);
  const nativeSnapshot=advanced.snapshot.bind(advanced),nativeWrite=advanced.write.bind(advanced);
  advanced.snapshot=async(kind,id)=>{if(kind==='qos')return connection.qosSnapshot(id);if(kind!=='mouseDpi')return nativeSnapshot(kind,id);const [device,index]=id.split(':');await logitech.list();return (await logitech.inspect(device,Number(index))).dpi;};
  advanced.write=async(kind,id,value,details)=>{if(kind==='qos')return connection.qosWrite(id,value);if(kind!=='mouseDpi')return nativeWrite(kind,id,value,details);const [device,index]=id.split(':');return logitech.setDpi(device,Number(index),value);};
  engine.revertAdvanced=entry=>entry.type==='cs2Config'?cs2.revertConfig(entry):advanced.revert(entry);
  await cleanup.recoverPending();
  // Focus never silently resumes on startup. Recover only temporary priorities that we own.
  store.data.focusEnabled=false;await store.save();
  const recovery=await engine.revertAll('priority');engine.lastFocus.errors=recovery.errors;
  info=await bridge.call('info');
  engine.systemInfo=info;
  const focusRecovery=await advanced.restoreFocus();engine.lastFocus.errors.push(...focusRecovery.errors);
  try{advanced.metrics=await advanced.call('metrics');}catch(e){advanced.metrics={error:e.message};}
  ipcMain.handle('hero:request',async(event,action,data={})=>{
    try{validateSender(event);if(typeof action!=='string'||!Object.hasOwn(actions,action))throw new Error('Operação não permitida.');object(data);if(smoke&&!['state','telemetry','refresh','apply','profile','revert','revertAll','startup','power','drivers','packages','resources','timer','mouseStart','mouseRead','mouseStop','logitechDevices','logitechInfo','boot','maintenanceInspect','maintenanceConfigure','maintenanceCache','cs2Activate','cs2Deactivate','cs2Resume','connectionRun'].includes(action))throw new Error('Modo de verificação: esta ação real está bloqueada.');return {ok:true,result:await actions[action](data)};}
    catch(e){if(smoke)console.error('SMOKE ACTION ERROR:',action,e.message);return {ok:false,error:e.message};}
  });
  win=new BrowserWindow({width:1440,height:smoke?1060:960,minWidth:1040,minHeight:740,backgroundColor:'#0c0f14',title:inspectQA?'Hero Boost — Verificação isolada':'Hero Boost',icon:path.join(__dirname,'..','ui','assets','icon.png'),autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:!smoke,offscreen:smoke&&!inspectQA,devTools:!app.isPackaged}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  if(smoke)win.webContents.on('console-message',event=>console.log('RENDERER:',event.message));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==localURL)event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file://')}));
  win.once('ready-to-show',()=>{if(!smoke||inspectQA)win.show();});
  await win.loadFile(index);
  hardwareTimer=setInterval(async()=>{if(hardwareBusy)return;hardwareBusy=true;try{advanced.metrics=await advanced.call('metrics');}catch(e){advanced.metrics={error:e.message};}finally{hardwareBusy=false;}},5000);
  if(!smoke){updates.start();maintenance.start();win.on('focus',()=>updates.checkIfDue().catch(()=>{}));}
  focusInterval=setInterval(()=>{
    if(queueTick||!store.data.focusEnabled)return;queueTick=true;
    engine.serialize(()=>engine.focusTick()).catch(e=>{engine.lastFocus.errors=[e.message];}).finally(()=>{queueTick=false;});
  },4000);
  if(smoke&&!inspectQA)await runSmoke();
}).catch(error=>{dialog.showErrorBox('Hero Boost — inicialização',error.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;clearInterval(focusInterval);clearInterval(hardwareTimer);updates?.stop();maintenance?.stop();
  const timeout=setTimeout(()=>{bridge?.close();maintenanceBridge?.close();app.exit(0);},12000);
  (engine?engine.serialize(()=>engine.setFocus(false)):Promise.resolve()).then(async()=>{if(smoke)await bridge.call('cleanupTestRegistry');}).catch(()=>{}).finally(()=>{clearTimeout(timeout);bridge?.close();maintenanceBridge?.close();app.quit();});
});
