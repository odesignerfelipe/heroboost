'use strict';
const {randomUUID,createHash} = require('node:crypto');
const {settings,profiles,support} = require('./catalog.cjs');
const PROTECTED = /^(system|registry|smss|csrss|wininit|services|lsass|svchost|winlogon|dwm|audiodg|explorer|hero boost|electron|powershell|msmpeng)\.exe$/i;
function isProtectedProcess(p){return PROTECTED.test(p.path.split(/[\\/]/).pop())||/[\\/]Windows[\\/]|Windows Defender|EasyAntiCheat|BattlEye|Vanguard|FACEIT|ESET|Kaspersky|Bitdefender|CrowdStrike|Sophos|SentinelOne|Norton|McAfee|Avast|AVG[\\/]/i.test(p.path);}
const equal = (a,b) => a?.exists===b?.exists && (!a?.exists || (a.kind===b.kind && JSON.stringify(a.value)===JSON.stringify(b.value)));
class Engine {
  constructor(store,bridge) {this.store=store;this.bridge=bridge;this.queue=Promise.resolve();this.lastFocus={active:[],errors:[]};}
  serialize(fn) { const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result; }
  async record(type,name,before,after,details={}) {
    const entry={id:randomUUID(),type,name,before,after,...details,status:'pending',date:new Date().toISOString()};
    this.store.data.journal.push(entry);await this.store.save();return entry;
  }
  async applyIds(ids,context={}) {
    if(!Array.isArray(ids)||!ids.length||ids.length>settings.length||new Set(ids).size!==ids.length||ids.some(id=>!settings.some(s=>s.id===id))) throw new Error('Seleção de ajustes inválida.');
    for(const id of ids){const spec=settings.find(s=>s.id===id);const reason=support(spec,this.systemInfo);if(reason)throw new Error(spec.name+': '+reason);if(spec.admin&&this.systemInfo&&!this.systemInfo.admin)throw new Error(spec.name+': requer administrador.');}
    const current=await this.bridge.call('settings');const applied=[],skipped=[],failed=[];
    for(const id of ids) {
      const spec=settings.find(s=>s.id===id);const after={exists:true,value:spec.target,kind:spec.kind};const before=current[id];
      if(equal(before,after)) {skipped.push(id);continue;}
      if(this.store.data.journal.some(j=>j.settingId===id&&['pending','applied'].includes(j.status))){failed.push({id,name:spec.name,error:'Existe um estado anterior no histórico. Desfaça esse ajuste antes de reaplicar.'});continue;}
      const entry=await this.record('setting',spec.name,before,after,{settingId:id,...context});
      try {const actual=await this.bridge.call('writeSetting',{id,snapshot:after});if(!equal(actual,after)) throw new Error('O Windows não confirmou o novo valor.');entry.status='applied';await this.store.save();applied.push(id);}
      catch(e) {
        entry.error=e.message;
        try{const actual=(await this.bridge.call('settings'))[id];if(equal(actual,before))entry.status='failed';else if(equal(actual,after)){entry.status='applied';applied.push(id);await this.store.save();continue;}}catch{}
        await this.store.save();failed.push({id,name:spec.name,error:e.message,pending:entry.status==='pending'});
        if(this.bridge.closed)break;
      }
    }
    return {applied:applied.length,skipped:skipped.length,...(failed.length?{failed}: {})};
  }
  async profile(id) {
    const profile=profiles.find(p=>p.id===id);if(!profile)throw new Error('Perfil inválido.');
    const ids=profile.settings.filter(id=>!support(settings.find(s=>s.id===id),this.systemInfo));
    const result=await this.applyIds(ids);this.store.data.profile=id;await this.store.save();return {...result,unsupported:profile.settings.length-ids.length};
  }
  async startup() {
    const entries=await this.bridge.call('startup');
    const items=(Array.isArray(entries)?entries:[]).map(s=>({...s,id:createHash('sha256').update((s.location||'user')+'\0'+s.name).digest('hex'),enabled:true}));
    for(const j of this.store.data.journal.filter(j=>j.type==='startup'&&['pending','applied'].includes(j.status))) {
      if(!items.some(s=>s.name===j.entryName&&(s.location||'user')===(j.location||'user')))items.push({id:j.startupId,name:j.entryName,location:j.location||'user',snapshot:j.before,enabled:false});
    }
    return items;
  }
  async disableStartup(id) {
    const item=(await this.startup()).find(s=>s.id===id&&s.enabled);if(!item)throw new Error('Entrada não encontrada.');
    if(item.protected)throw new Error('Entrada de segurança protegida.');if(item.admin&&!this.systemInfo?.admin)throw new Error('Esta entrada exige administrador.');
    if(!['String','ExpandString'].includes(item.snapshot.kind))throw new Error('Formato de inicialização não suportado.');
    if(this.store.data.journal.some(j=>j.type==='startup'&&j.startupId===id&&['pending','applied'].includes(j.status)))throw new Error('Restaure a alteração anterior pelo histórico.');
    const after={exists:false,value:null,kind:null};
    const entry=await this.record('startup',`Inicialização: ${item.name}`,item.snapshot,after,{entryName:item.name,startupId:id,location:item.location||'user'});
    await this.bridge.call('writeStartup',{name:item.name,location:entry.location,snapshot:after});entry.status='applied';await this.store.save();return true;
  }
  async setPower(id) {
    const power=await this.bridge.call('power');if(!power.plans.some(p=>p.id===id))throw new Error('Plano inválido.');
    if(id===power.active)return {unchanged:true};
    if(this.store.data.journal.some(j=>j.type==='power'&&j.status==='pending')) throw new Error('Resolva a troca de energia pendente no histórico antes de tentar novamente.');
    const info=await this.bridge.call('info');
    if(info.laptop&&id==='8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c') throw new Error('Alto desempenho bloqueado em notebook. Use Equilibrado ou Economia de energia.');
    const entry=await this.record('power','Plano de energia',power.active,id);
    const actual=await this.bridge.call('setPower',{id});if(actual.active!==id)throw new Error('Plano não confirmado pelo Windows.');
    entry.status='applied';await this.store.save();return true;
  }
  async revert(id) {
    const entry=this.store.data.journal.find(j=>j.id===id&&['applied','pending'].includes(j.status));if(!entry)throw new Error('Alteração não encontrada.');
    let current;
    if(entry.type==='setting') current=(await this.bridge.call('settings'))[entry.settingId];
    else if(entry.type==='startup') current=(await this.bridge.call('startup')).find(s=>s.name===entry.entryName&&(s.location||'user')===(entry.location||'user'))?.snapshot||{exists:false,value:null,kind:null};
    else if(entry.type==='power')current=(await this.bridge.call('power')).active;
    else if(entry.type==='priority') {
      const p=(await this.bridge.call('processes')).find(p=>p.id===entry.process.id&&p.started===entry.process.started&&p.path.toLowerCase()===entry.process.path.toLowerCase());
      if(!p) {entry.status='reverted';entry.note='O processo já encerrou.';await this.store.save();return true;} current=p.priority;
    } else if(this.revertAdvanced)return this.revertAdvanced(entry);
    else throw new Error('Tipo de alteração inválido.');
    const isEqual=entry.type==='setting'||entry.type==='startup'?equal:(a,b)=>a===b;
    if(isEqual(current,entry.before)) {if(entry.type==='power'&&entry.createdPlan)await this.bridge.call('advanced',{operation:'deletePower',payload:{id:entry.createdPlan}});entry.status='reverted';await this.store.save();return true;}
    if(!isEqual(current,entry.after)) throw new Error('O valor foi alterado fora do Hero Boost. A restauração foi bloqueada para preservar essa mudança.');
    if(entry.type==='setting'){const value=await this.bridge.call('writeSetting',{id:entry.settingId,snapshot:entry.before});if(!equal(value,entry.before))throw new Error('O Windows não confirmou a restauração.');}
    if(entry.type==='startup'){const value=await this.bridge.call('writeStartup',{name:entry.entryName,location:entry.location||'user',snapshot:entry.before});if(!equal(value,entry.before))throw new Error('Inicialização não restaurada pelo Windows.');}
    if(entry.type==='power'){const value=await this.bridge.call('setPower',{id:entry.before});if(value.active!==entry.before)throw new Error('Plano anterior não confirmado.');}
    if(entry.type==='power'&&entry.createdPlan)await this.bridge.call('advanced',{operation:'deletePower',payload:{id:entry.createdPlan}});
    if(entry.type==='priority'){const value=await this.bridge.call('priority',{...entry.process,priority:entry.before});if(value!==entry.before)throw new Error('Prioridade anterior não confirmada.');}
    entry.status='reverted';entry.revertedAt=new Date().toISOString();await this.store.save();return true;
  }
  async revertAll(type) {
    let restored=0;const errors=[];
    for(const entry of [...this.store.data.journal].reverse().filter(j=>['applied','pending'].includes(j.status)&&(!type||j.type===type))) {
      try {await this.revert(entry.id);restored++;}catch(e){errors.push(`${entry.name}: ${e.message}`);}
    }
    return {restored,errors};
  }
  async focusTick() {
    if(!this.store.data.focusEnabled)return;
    const processes=await this.bridge.call('processes');const targets=new Set(this.store.data.focusApps.map(a=>a.path.toLowerCase()));
    const active=processes.filter(p=>targets.has(p.path.toLowerCase()));const errors=[];
    for(const p of active) {
      if(isProtectedProcess(p))continue;
      const desired=this.store.data.focusOptions?.priority||'AboveNormal';
      if(p.priority==='RealTime'||p.priority==='High'||(p.priority==='AboveNormal'&&desired==='AboveNormal'))continue;
      if(this.store.data.journal.some(j=>j.type==='priority'&&j.process.id===p.id&&j.process.started===p.started&&['applied','pending'].includes(j.status)))continue;
      const entry=await this.record('priority',`Foco: ${p.name}`,p.priority,desired,{process:p});
      try {await this.bridge.call('priority',{...p,priority:desired});p.priority=desired;entry.status='applied';await this.store.save();}catch(e){entry.error=e.message;await this.store.save();errors.push(`${p.name}: acesso negado ou programa encerrado`);}
    }
    for(const entry of this.store.data.journal.filter(j=>j.type==='priority'&&['applied','pending'].includes(j.status))) {
      if(entry.scope==='focus')continue;
      const p=processes.find(p=>p.id===entry.process.id&&p.started===entry.process.started);
      if(!p||!targets.has(p.path.toLowerCase())) {try {await this.revert(entry.id);}catch(e){errors.push(e.message);}}
    }
    this.lastFocus={active:active.map(p=>({name:this.store.data.focusApps.find(a=>a.path.toLowerCase()===p.path.toLowerCase())?.name||p.name,processName:p.name,id:p.id,path:p.path,priority:p.priority})),errors};
  }
  async setFocus(enabled) {
    if(typeof enabled!=='boolean')throw new Error('Estado inválido.');
    this.store.data.focusEnabled=enabled;await this.store.save();
    if(!enabled){const result=await this.revertAll('priority');this.lastFocus={active:[],errors:result.errors};return result;}
    await this.focusTick();return this.lastFocus;
  }
}
module.exports={Engine,equal,PROTECTED,isProtectedProcess};
