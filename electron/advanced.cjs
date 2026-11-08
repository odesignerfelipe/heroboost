'use strict';
const {randomUUID}=require('node:crypto');
const {isProtectedProcess}=require('./engine.cjs');
const array=value=>Array.isArray(value)?value:value?[value]:[];
const stable=value=>JSON.stringify(value);
const serviceValue=s=>s?{start:s.start,state:s.state,delayed:s.start==='Auto'?s.delayed:false}:null;
class Advanced {
  constructor(engine,store,bridge){
    this.engine=engine;this.store=store;this.bridge=bridge;this.metrics={};
    store.data.backgroundApps ||= [];
    store.data.focusOptions={priority:'AboveNormal',pauseServices:false,timer:false,...store.data.focusOptions};
    store.data.restorePoint ||= {attempted:false,created:false,error:null};
    engine.revertAdvanced=entry=>this.revert(entry);
    const tick=engine.focusTick.bind(engine);engine.focusTick=async()=>{await tick();await this.syncFocus();};
    const set=engine.setFocus.bind(engine);engine.setFocus=async enabled=>{const result=await set(enabled);if(!enabled){const r=await this.restoreFocus();if(r.errors.length)engine.lastFocus.errors.push(...r.errors);}return result;};
  }
  call(operation,payload={}){return this.bridge.call('advanced',{operation,payload});}
  admin(){if(!this.engine.systemInfo?.admin)throw new Error('Abra o Hero Boost como administrador para usar este recurso.');}
  async prepare(){
    if(this.store.data.restorePoint.attempted||!this.engine.systemInfo?.admin)return;
    this.store.data.restorePoint.attempted=true;await this.store.save();
    try{await this.call('restorePoint');this.store.data.restorePoint.created=true;}
    catch(e){this.store.data.restorePoint.error=e.message;}
    await this.store.save();
  }
  async snapshot(kind,id){
    if(kind==='service')return serviceValue(await this.call('service',{id}));
    if(kind==='task'){const value=await this.call('task',{id});return value?{enabled:value.enabled}:null;}
    if(kind==='network')return (await this.call('network'))[id];
    if(kind==='package')return array(await this.call('packages')).some(p=>p.id===id);
    throw new Error('Recurso desconhecido.');
  }
  async write(kind,id,value,details={}){
    if(kind==='service')return serviceValue(await this.call('setService',{id,snapshot:value}));
    if(kind==='task'){const actual=await this.call('setTask',{id,enabled:value.enabled});return {enabled:actual.enabled};}
    if(kind==='network')return (await this.call('setNetwork',{name:id,value}))[id];
    if(kind==='package'){
      if(value===false)await this.call('removePackage',{id});else await this.call('restorePackage',{name:details.packageName,manifest:details.manifest});
      return this.snapshot('package',id);
    }
  }
  async change(kind,id,name,after,details={}){
    if(['service','task','network'].includes(kind))this.admin();
    if(this.store.data.journal.some(j=>j.type===kind&&j.resourceId===id&&['applied','pending'].includes(j.status)))throw new Error('Restaure a mudança anterior antes de reaplicar este recurso.');
    const before=await this.snapshot(kind,id);
    if(before===null||before===undefined)throw new Error('Recurso indisponível neste Windows.');
    if(kind==='service'&&(!['Running','Stopped'].includes(before.state)||!['Auto','Manual','Disabled'].includes(before.start)))throw new Error('Estado de serviço não suportado com restauração exata.');
    if(stable(before)===stable(after))return {unchanged:true};
    const entry=await this.engine.record(kind,name,before,after,{resourceId:id,...details});
    try{
      const actual=await this.write(kind,id,after,details);
      if(stable(actual)!==stable(after))throw new Error('O Windows não confirmou o estado solicitado.');
      entry.status='applied';await this.store.save();return {id:entry.id};
    }catch(e){entry.error=e.message;try{entry.observedAfter=await this.snapshot(kind,id);}catch{}await this.store.save();throw e;}
  }
  async revert(entry){
    const actual=await this.snapshot(entry.type,entry.resourceId);
    if(stable(actual)!==stable(entry.before)){
      // A stopped service can be restarted by Windows; don't overwrite that external change.
      const observed=entry.status==='pending'&&Object.hasOwn(entry,'observedAfter')&&stable(actual)===stable(entry.observedAfter);
      const partialService=entry.status==='pending'&&entry.type==='service'&&actual&&Object.keys(entry.before).every(key=>actual[key]===entry.before[key]||actual[key]===entry.after[key]);
      if(stable(actual)!==stable(entry.after)&&!observed&&!partialService)throw new Error('O estado mudou fora do Hero. Restauração bloqueada para preservar a mudança.');
      const restored=await this.write(entry.type,entry.resourceId,entry.before,entry);
      if(stable(restored)!==stable(entry.before))throw new Error('Restauração não confirmada pelo Windows.');
    }
    entry.status='reverted';entry.revertedAt=new Date().toISOString();await this.store.save();return true;
  }
  async removePackage(id){
    const item=array(await this.call('packages')).find(p=>p.id===id);if(!item)throw new Error('Aplicativo não encontrado.');
    return this.change('package',id,'Remover app: '+item.name,false,{packageName:item.name,manifest:item.manifest});
  }
  async configureFocus(options){
    if(!options||!['AboveNormal','High'].includes(options.priority)||typeof options.timer!=='boolean'||typeof options.pauseServices!=='boolean')throw new Error('Opções de foco inválidas.');
    if(options.pauseServices)this.admin();
    this.store.data.focusOptions={priority:options.priority,timer:options.timer,pauseServices:options.pauseServices};await this.store.save();
    await this.engine.setFocus(false);return true;
  }
  async restoreFocus(){
    const errors=[];let restored=0;
    for(const entry of [...this.store.data.journal].reverse().filter(j=>j.scope==='focus'&&['applied','pending'].includes(j.status))){
      try{await this.engine.revert(entry.id);restored++;}catch(e){errors.push(`${entry.name}: ${e.message}`);}
    }
    try{await this.call('setTimer',{enabled:false});}catch(e){errors.push(e.message);}
    return {restored,errors};
  }
  async syncFocus(){
    const active=this.store.data.focusEnabled&&this.engine.lastFocus.active.length>0;
    if(!active){await this.restoreFocus();return;}
    const processes=array(await this.bridge.call('processes'));
    const background=new Set(this.store.data.backgroundApps.map(p=>p.path.toLowerCase()));
    const targets=new Set(this.store.data.focusApps.map(p=>p.path.toLowerCase()));
    for(const entry of this.store.data.journal.filter(j=>j.scope==='focus'&&j.type==='priority'&&['applied','pending'].includes(j.status))){
      if(!background.has(entry.process.path.toLowerCase()))await this.engine.revert(entry.id);
    }
    for(const p of processes.filter(p=>background.has(p.path.toLowerCase())&&!targets.has(p.path.toLowerCase())&&!isProtectedProcess(p))){
      if(!['Normal','AboveNormal'].includes(p.priority))continue;
      if(this.store.data.journal.some(j=>j.type==='priority'&&j.process.id===p.id&&j.process.started===p.started&&['applied','pending'].includes(j.status)))continue;
      const entry=await this.engine.record('priority','Segundo plano: '+p.name,p.priority,'BelowNormal',{process:p,scope:'focus'});
      try{await this.bridge.call('priority',{...p,priority:'BelowNormal'});entry.status='applied';await this.store.save();}catch(e){entry.error=e.message;await this.store.save();this.engine.lastFocus.errors.push(e.message);}
    }
    if(this.store.data.focusOptions.pauseServices){
      for(const name of ['WSearch','SysMain']){
        if(name==='SysMain'&&!array(this.engine.systemInfo.media).some(m=>m.media==='SSD'))continue;
        if(this.store.data.journal.some(j=>j.type==='service'&&j.resourceId===name&&['applied','pending'].includes(j.status)))continue;
        const current=await this.snapshot('service',name);
        if(current?.state==='Running')try{await this.change('service',name,'Pausa temporária: '+name,{...current,state:'Stopped'},{scope:'focus'});}catch(e){this.engine.lastFocus.errors.push(e.message);}
      }
    }
    await this.call('setTimer',{enabled:!!this.store.data.focusOptions.timer&&!this.engine.systemInfo.laptop});
  }
}
module.exports={Advanced,array,serviceValue};
