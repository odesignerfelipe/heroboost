'use strict';
const {workProtected,activeWorkloads}=require('./workloads.cjs');
function memoryCandidates(current,previous,allowed,focusApps=[],cooldowns={},now=Date.now()){
  const choices=new Set(allowed.map(p=>p.toLowerCase())),targets=new Set(focusApps.map(p=>p.path.toLowerCase()));
  const foreground=current.processes.find(p=>p.id===current.foreground)?.path?.toLowerCase();const elapsed=current.at-(previous?.at||current.at);
  const groups=new Map();for(const p of current.processes){const key=p.path.toLowerCase();if(!groups.has(key))groups.set(key,{minimized:false,visible:false});const g=groups.get(key);g.minimized ||= !!p.minimized;g.visible ||= !!p.visible;}
  return current.processes.map(p=>{
    const key=p.path.toLowerCase(),group=groups.get(key),old=previous?.processes.find(o=>o.id===p.id&&o.started===p.started&&o.path.toLowerCase()===key);
    let reason=workProtected(p)||targets.has(key)?'Windows, criação, jogos ou aplicativo prioritário protegido.':!choices.has(key)?'Não selecionado para gestão de RAM.':foreground===key||group.visible?'Há janela em uso.':!group.minimized?'Minimize todas as janelas deste aplicativo.':!old||elapsed<1000?'Aguardando segunda amostra de atividade.':p.cpuMs<old.cpuMs||p.cpuMs-old.cpuMs>elapsed*.01?'Aplicativo está usando CPU.':p.ioBytes<0||old.ioBytes<0||p.ioBytes!==old.ioBytes?'Aplicativo apresentou atividade de disco/rede.':p.workingSet<64*1024**2?'Conjunto residente menor que 64 MB.':now-(cooldowns[p.id+':'+p.started]||0)<15*60000?'Aguarde 15 minutos entre ações neste processo.':null;
    return {...p,allowed:choices.has(key),protected:workProtected(p)||targets.has(key),eligible:!reason,reason};
  });
}
class MemoryManager {
  constructor(store,bridge){this.store=store;this.bridge=bridge;this.previous=null;this.latest=null;this.cooldowns={};this.running=false;}
  call(operation,payload={}){return this.bridge.call('performance',{operation,payload});}
  async sample(){const current=await this.call('snapshot');this.previous=this.latest;this.latest=current;return current;}
  candidates(){return this.latest?memoryCandidates(this.latest,this.previous,this.store.data.maintenance.memory.apps,this.store.data.focusApps,this.cooldowns):[];}
  async inspect(){await this.sample();await new Promise(r=>setTimeout(r,1200));await this.sample();return this.view();}
  view(){const s=this.latest;return s?{...s,processes:this.candidates().sort((a,b)=>b.workingSet-a.workingSet)}:null;}
  async trim(automatic=false){
    if(this.running)throw new Error('Já existe uma análise de RAM em andamento.');this.running=true;
    try{
      await this.inspect();const before=this.latest,config=this.store.data.maintenance.memory;
      if(automatic&&activeWorkloads(before.processes,this.store.data.focusApps).length)return {skipped:'Adobe, jogo ou aplicativo prioritário aberto; RAM automática adiada.',items:[],residentReduced:0};
      if(automatic&&(typeof before.pagesInput!=='number'||before.pagesInput>=100))return {skipped:'Paginação intensa ou leitura indisponível; RAM preservada.',items:[],residentReduced:0};
      if(automatic&&before.usedPercent<config.threshold)return {skipped:'A memória disponível está acima do limite de intervenção.',items:[],residentReduced:0};
      if(automatic&&(!this.previous||this.previous.usedPercent<config.threshold))return {skipped:'A pressão de RAM ainda não é persistente.',items:[],residentReduced:0};
      const candidates=this.candidates().filter(p=>p.eligible).slice(0,automatic?3:8),items=[];
      for(const p of candidates){
        try{const actual=await this.call('trim',{id:p.id,path:p.path,started:p.started,creation:p.creation});this.cooldowns[p.id+':'+p.started]=Date.now();items.push({name:p.name,id:p.id,...actual});}
        catch(error){items.push({name:p.name,id:p.id,error:error.message});}
      }
      await this.sample();return {date:new Date().toISOString(),automatic,items,residentReduced:items.reduce((sum,p)=>sum+Math.max(0,(p.before||0)-(p.after||0)),0),availableBefore:before.available,availableAfter:this.latest.available,skipped:candidates.length?null:'Nenhum aplicativo selecionado está minimizado e ocioso com segurança.'};
    }finally{this.running=false;}
  }
}
module.exports={MemoryManager,memoryCandidates};
