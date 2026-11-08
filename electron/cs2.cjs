'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID,createHash}=require('node:crypto');
const modes=[
  {id:'competitive',name:'CS2 Competitivo',description:'Modo Jogo e captura em segundo plano desativada. Prioridade automática, sem limitar núcleos ou desativar proteções.',settings:['game-mode','capture','dvr','taskbar-animations','transparency']},
  {id:'stable',name:'CS2 Estável',description:'Ajustes mínimos e foco no processo. Mantém efeitos e evita mudanças amplas no Windows.',settings:['game-mode','capture','dvr']},
  {id:'stream',name:'CS2 + Stream',description:'Desativa captura do Xbox para usar seu OBS. Adicione o OBS em Modo foco para priorizá-lo junto com o CS2.',settings:['game-mode','capture','dvr','tips']}
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function buildConfig({fps=240,maxPing=60,buffer=0}={}){
  if(!Number.isInteger(fps)||fps<60||fps>1000||!Number.isInteger(maxPing)||maxPing<25||maxPing>200||![0,1,2].includes(buffer))throw new Error('Use FPS 60–1000, ping 25–200 e buffer 0, 1 ou 2.');
  return `// Hero Boost — configuracao opcional para Counter-Strike 2\r\n// Execute manualmente: exec hero_boost_cs2.cfg\r\n// Nao muda tickrate, anticheat, binds, mira ou arquivos binarios.\r\n// Aumentar buffer pode suavizar jitter ao custo de atraso adicional.\r\nfps_max ${fps}\r\nmm_dedicated_search_maxping ${maxPing}\r\ncl_net_buffer_ticks ${buffer}\r\n`;
}
class CS2 {
  constructor(engine,store,bridge){this.engine=engine;this.store=store;this.bridge=bridge;store.data.cs2 ||= {path:null,session:null};}
  async validate(executable){
    if(typeof executable!=='string'||path.basename(executable).toLowerCase()!=='cs2.exe')throw new Error('Selecione o executável cs2.exe.');
    const canonical=await fs.realpath(executable);const stat=await fs.lstat(canonical);if(!stat.isFile())throw new Error('Executável inválido.');
    const handle=await fs.open(canonical,'r');try{const signature=Buffer.alloc(2);await handle.read(signature,0,2,0);if(signature.toString('ascii')!=='MZ')throw new Error('O arquivo não é um executável Windows.');}finally{await handle.close();}
    return canonical;
  }
  async discover(){
    const root=await this.bridge.call('network',{operation:'steamPath',payload:{}});const libraries=new Set();
    if(root){libraries.add(path.resolve(root));try{const vdf=await fs.readFile(path.join(root,'steamapps','libraryfolders.vdf'),'utf8');for(const match of vdf.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/g))libraries.add(match[1].replace(/\\\\/g,'\\'));}catch{}}
    for(const library of libraries)for(const name of ['Counter-Strike Global Offensive','Counter-Strike 2']){
      try{const found=await this.validate(path.join(library,'steamapps','common',name,'game','bin','win64','cs2.exe'));this.store.data.cs2.path=found;await this.store.save();return found;}catch{}
    }
    return null;
  }
  async select(executable){const found=await this.validate(executable);this.store.data.cs2.path=found;await this.store.save();return found;}
  async activate(modeId){
    const mode=modes.find(m=>m.id===modeId);if(!mode)throw new Error('Modo CS2 inválido.');
    const executable=await this.validate(this.store.data.cs2.path);
    if(this.store.data.cs2.session?.active)throw new Error('Desfaça o modo CS2 atual antes de trocar para outro.');
    const session={id:randomUUID(),mode:modeId,active:true,status:'pending',date:new Date().toISOString(),beforeFocus:this.store.data.focusEnabled,addedApp:null,addedObs:null};
    this.store.data.cs2.session=session;await this.store.save();
    const result=await this.engine.applyIds(mode.settings,{ownerSession:session.id});
    if(!this.store.data.focusApps.some(a=>a.path.toLowerCase()===executable.toLowerCase())){
      const app={id:randomUUID(),name:'Counter-Strike 2',path:executable};session.addedApp=app.id;this.store.data.focusApps.push(app);await this.store.save();
    }
    await this.engine.setFocus(true);session.status=result.failed?.length?'partial':'active';await this.store.save();return {...result,mode:mode.name};
  }
  async deactivate({restoreFocus=true}={}){
    const session=this.store.data.cs2.session;if(!session?.active)return {restored:0,errors:[]};
    const errors=[];let restored=0;
    for(const entry of [...this.store.data.journal].reverse().filter(j=>j.ownerSession===session.id&&['applied','pending'].includes(j.status))){try{await this.engine.revert(entry.id);restored++;}catch(e){errors.push(e.message);}}
    if(session.addedApp)this.store.data.focusApps=this.store.data.focusApps.filter(a=>a.id!==session.addedApp);
    const focusResult=await this.engine.setFocus(restoreFocus&&!!session.beforeFocus);errors.push(...(focusResult.errors||[]));session.active=errors.length>0;session.status=errors.length?'partial':'reverted';await this.store.save();return {restored,errors};
  }
  configPath(){const executable=this.store.data.cs2.path;if(!executable)return null;return path.join(path.dirname(path.dirname(path.dirname(executable))),'csgo','cfg','hero_boost_cs2.cfg');}
  async exportConfig(destination,options){
    if(path.basename(destination)!=='hero_boost_cs2.cfg')throw new Error('Mantenha o nome hero_boost_cs2.cfg para não sobrescrever autoexecs pessoais.');
    const parent=await fs.realpath(path.dirname(destination));destination=path.join(parent,'hero_boost_cs2.cfg');const after=Buffer.from(buildConfig(options));
    let before={exists:false};try{const stat=await fs.lstat(destination);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('Arquivo de destino não é um CFG simples.');const bytes=await fs.readFile(destination);before={exists:true,content:bytes.toString('base64'),hash:hash(bytes)};}catch(e){if(e.code!=='ENOENT')throw e;}
    const entry=await this.engine.record('cs2Config','Configuração opcional do CS2',before,{exists:true,hash:hash(after)},{resourceId:destination});
    if(!before.exists)await fs.writeFile(destination,after,{flag:'wx'});
    else{const current=await fs.readFile(destination);if(hash(current)!==before.hash)throw new Error('O arquivo mudou após a revisão.');await fs.writeFile(destination,after);}
    if(hash(await fs.readFile(destination))!==entry.after.hash)throw new Error('Arquivo não confirmado após salvar.');
    entry.status='applied';await this.store.save();return {path:destination,command:'exec hero_boost_cs2.cfg'};
  }
  async revertConfig(entry){
    const destination=entry.resourceId;if(path.basename(destination)!=='hero_boost_cs2.cfg')throw new Error('Destino inválido no histórico.');
    if((await fs.realpath(path.dirname(destination))).toLowerCase()!==path.dirname(destination).toLowerCase())throw new Error('A pasta do CFG foi redirecionada.');
    let current;try{const stat=await fs.lstat(destination);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Destino redirecionado.');current=await fs.readFile(destination);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(current&&hash(current)!==entry.after.hash){if(entry.before.exists&&hash(current)===entry.before.hash){entry.status='reverted';await this.store.save();return true;}throw new Error('O CFG foi alterado fora do Hero. Restauração bloqueada.');}
    if(entry.before.exists)await fs.writeFile(destination,Buffer.from(entry.before.content,'base64'));
    else if(current)await fs.unlink(destination);
    entry.status='reverted';await this.store.save();return true;
  }
}
module.exports={CS2,modes,buildConfig};
