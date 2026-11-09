'use strict';
const {randomUUID}=require('node:crypto');const path=require('node:path');
const {DiskTools}=require('./disk.cjs');const {MemoryManager}=require('./memory.cjs');const {activeWorkloads,workProtected,executable}=require('./workloads.cjs');
const CACHE_IDS=['temp','chrome','edge','brave'];
const protectedContent=/\.(psd|psb|ai|aep|aepx|prproj|indd|blend|drp|png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|mp[34]|mov|wav|aiff?|otf|ttf|zip|7z|exe|msi)$/i;
function cacheFileAllowed(file,id){return !protectedContent.test(file)&&!/(photoshop\s*temp|adobe|after.?effects|auto.?save|recovery|scratch|unsaved)/i.test(file)&&(id!=='temp'||/\.(tmp|temp|log|old)$/i.test(file));}
function automaticCacheReason(snapshot,focusApps,idleSeconds){
  if(idleSeconds<120)return 'Aguardando pelo menos dois minutos sem interação.';
  if(activeWorkloads(snapshot.processes,focusApps).length)return 'Aguardando os aplicativos Adobe, jogos e programas prioritários fecharem.';
  if(snapshot.cpu===null||snapshot.cpu>20)return 'Aguardando menor uso de CPU.';
  if(typeof snapshot.pagesInput!=='number'||snapshot.usedPercent>=85||snapshot.pagesInput>100)return 'Manutenção de cache pausada durante pressão de memória/paginação ou leitura indisponível.';
  return null;
}
function validateConfig(value,current,confirmation){
  if(!value||typeof value.cache?.enabled!=='boolean'||typeof value.memory?.enabled!=='boolean'||![6,24,168].includes(value.cache.intervalHours)||![80,85,90].includes(value.memory.threshold)||!Array.isArray(value.cache.sources)||!value.cache.sources.length||value.cache.sources.some(id=>!CACHE_IDS.includes(id))||new Set(value.cache.sources).size!==value.cache.sources.length)throw new Error('Configuração de manutenção inválida.');
  if(value.cache.enabled&&(!current.cache.enabled||JSON.stringify(current.cache.sources)!==JSON.stringify(value.cache.sources))&&confirmation!=='EXCLUIR_CACHE_AUTOMATICAMENTE')throw new Error('Confirme a exclusão automática dos caches selecionados.');
  if(value.memory.enabled&&!current.memory.apps.length)throw new Error('Adicione um aplicativo permitido antes de habilitar RAM automática.');
  return {cache:{enabled:value.cache.enabled,intervalHours:value.cache.intervalHours,sources:[...value.cache.sources]},memory:{enabled:value.memory.enabled,threshold:value.memory.threshold,apps:[...current.memory.apps]}};
}
class Maintenance {
  constructor(engine,store,bridge,local,quarantine,idleSeconds=()=>0){
    this.engine=engine;this.store=store;this.bridge=bridge;this.disk=new DiskTools(local,quarantine,store,bridge);this.memory=new MemoryManager(store,bridge);this.idleSeconds=idleSeconds;this.tickBusy=false;this.cacheBusy=false;this.lastCacheAttempt=0;this.pressureTicks=0;this.state={status:'idle',message:'Automações desligadas até você configurar.',lastMemory:null,lastCache:null,error:null};
    store.data.maintenance ||= {cache:{enabled:false,intervalHours:24,sources:['chrome','edge','brave']},memory:{enabled:false,threshold:85,apps:[]},history:[],lastCacheRun:0};
    this.state.message=store.data.maintenance.cache.enabled||store.data.maintenance.memory.enabled?'Monitoramento aguardando próxima amostra.':this.state.message;
  }
  async configure(value,confirmation){const prior=structuredClone(this.store.data.maintenance),next=validateConfig(value,prior,confirmation);Object.assign(this.store.data.maintenance,next);try{await this.store.save();}catch(error){this.store.data.maintenance=prior;throw error;}return next;}
  async addMemoryApp(file){const canonical=await executable(file);if(workProtected({path:canonical})||this.store.data.focusApps.some(p=>p.path.toLowerCase()===canonical.toLowerCase()))throw new Error('Adobe, jogos, Windows e programas prioritários são protegidos da recuperação de RAM.');const apps=this.store.data.maintenance.memory.apps;if(apps.length>=12)throw new Error('Limite de 12 aplicativos de segundo plano.');if(!apps.some(p=>p.toLowerCase()===canonical.toLowerCase())){apps.push(canonical);try{await this.store.save();}catch(error){apps.pop();throw error;}}return canonical;}
  async removeMemoryApp(file){const memory=this.store.data.maintenance.memory,prior=structuredClone(memory);memory.apps=memory.apps.filter(p=>p.toLowerCase()!==String(file).toLowerCase());if(!memory.apps.length)memory.enabled=false;try{await this.store.save();}catch(error){this.store.data.maintenance.memory=prior;throw error;}}
  async log(entry){this.store.data.maintenance.history.unshift({id:randomUUID(),date:new Date().toISOString(),...entry});this.store.data.maintenance.history=this.store.data.maintenance.history.slice(0,30);await this.store.save();}
  async inspect(){const result=await this.memory.inspect();this.state.error=null;return result;}
  async trim(automatic=false){const result=await this.memory.trim(automatic);this.state.lastMemory=result;await this.log({kind:'memory',...result});return result;}
  async cacheRun({ids,remove=false,confirmation=null,automatic=false}={}){
    if(this.cacheBusy)throw new Error('Já há uma manutenção de cache em andamento.');
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>!CACHE_IDS.includes(id)))throw new Error('Escolha apenas fontes permitidas de cache.');
    if(remove&&confirmation!=='EXCLUIR'&&!(automatic&&this.store.data.maintenance.cache.enabled))throw new Error('Confirme a exclusão definitiva do lote de cache.');
    this.cacheBusy=true;
    try{
      const before=await this.memory.sample();
      if(automatic){const reason=automaticCacheReason(before,this.store.data.focusApps,this.idleSeconds());if(reason)return {skipped:reason};}
      const deadline=Date.now()+(automatic?15000:45000);
      const canContinue=()=>Date.now()<deadline&&(!automatic||this.idleSeconds()>=120);
      const scan=await this.disk.scan(ids,{shouldContinue:canContinue,timeLimitMs:automatic?3000:10000});
      for(const id of this.disk.selection){const cleaner=this.disk.cleaners.get(id);cleaner.candidates=new Map([...cleaner.candidates].filter(([,item])=>cacheFileAllowed(item.source,id)));}
      const batch=randomUUID(),isolated=this.disk.selection.length?await this.disk.isolate({batch,maxFiles:automatic?200:1000,maxBytes:512*1024**2,shouldContinue:canContinue,allowFile:file=>this.bridge.call('performance',{operation:'unlocked',payload:{path:file}})}):{count:0,bytes:0,skipped:0};
      const deleted=remove?await this.disk.purge('EXCLUIR',{batch,shouldContinue:canContinue}):{count:0,bytes:0,skipped:0};
      const after=await this.memory.sample();const result={date:new Date().toISOString(),batch,automatic,scanCount:scan.count,isolated,deleted,blocked:scan.sources.filter(s=>s.blocked).map(s=>({name:s.name,reason:s.blocked})),partial:scan.truncated||!canContinue(),diskFreeBefore:before.diskFree,diskFreeAfter:after.diskFree};
      this.state.lastCache=result;if(automatic)this.store.data.maintenance.lastCacheRun=Date.now();await this.log({kind:'cache',...result});return result;
    }finally{this.cacheBusy=false;}
  }
  async tick(){
    if(this.tickBusy)return;const config=this.store.data.maintenance;if(!config.cache.enabled&&!config.memory.enabled)return;
    this.tickBusy=true;
    try{
      await this.memory.sample();const snapshot=this.memory.latest;
      this.pressureTicks=snapshot.usedPercent>=config.memory.threshold?this.pressureTicks+1:0;
      if(config.memory.enabled&&config.memory.apps.length&&this.pressureTicks>=2&&typeof snapshot.pagesInput==='number'&&snapshot.pagesInput<100){this.state.status='memory';await this.engine.serialize(()=>this.trim(true));this.pressureTicks=0;}
      const due=Date.now()-config.lastCacheRun>=config.cache.intervalHours*3600000&&Date.now()-this.lastCacheAttempt>=5*60000;
      if(config.cache.enabled&&due){
        const reason=automaticCacheReason(snapshot,this.store.data.focusApps,this.idleSeconds());this.state.message=reason||'Manutenção automática de caches em andamento.';
        if(!reason){this.lastCacheAttempt=Date.now();this.state.status='cache';const result=await this.engine.serialize(()=>this.cacheRun({ids:config.cache.sources,remove:true,automatic:true}));this.state.message=result.skipped||'Rodada de cache concluída. Confira o resultado abaixo; aguardando o próximo intervalo.';}
      }
      this.state.status='waiting';if(!this.state.message||!config.cache.enabled)this.state.message=config.memory.enabled?'Monitorando pressão de RAM; nenhum programa ativo é encerrado.':'Aguardando o próximo intervalo de cache.';
    }catch(error){this.state.status='error';this.state.error=error.message;}finally{this.tickBusy=false;}
  }
  start(){if(!this.timer)this.timer=setInterval(()=>this.tick(),30000);this.timer?.unref?.();}
  stop(){clearInterval(this.timer);this.timer=null;}
  view(){return {config:this.store.data.maintenance,state:this.state,memory:this.memory.view()};}
}
module.exports={Maintenance,CACHE_IDS,cacheFileAllowed,automaticCacheReason,validateConfig};
