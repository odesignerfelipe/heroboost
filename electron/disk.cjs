'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {Cleanup,inside}=require('./cleanup.cjs');
class DiskTools {
  constructor(local,directory,store,bridge){
    this.store=store;this.bridge=bridge;this.sources=[
      {id:'temp',name:'Temporários do usuário',root:path.join(local,'Temp')},
      {id:'shader',name:'Cache DirectX (recriado pelo Windows)',root:path.join(local,'D3DSCache')},
      {id:'nvidia',name:'Cache de shaders NVIDIA',root:path.join(local,'NVIDIA','DXCache')},
      {id:'chrome',name:'Cache do Chrome — perfil padrão',root:path.join(local,'Google','Chrome','User Data','Default','Cache','Cache_Data'),process:'chrome'},
      {id:'edge',name:'Cache do Edge — perfil padrão',root:path.join(local,'Microsoft','Edge','User Data','Default','Cache','Cache_Data'),process:'msedge'},
      {id:'brave',name:'Cache do Brave — perfil padrão',root:path.join(local,'BraveSoftware','Brave-Browser','User Data','Default','Cache','Cache_Data'),process:'brave'}
    ];
    this.cleaners=new Map(this.sources.map(s=>[s.id,new Cleanup(s.root,directory,store)]));this.selection=[];
  }
  async available(){
    const values=[];for(const source of this.sources){try{const stat=await fs.lstat(source.root);if(stat.isDirectory()&&!stat.isSymbolicLink())values.push({id:source.id,name:source.name});}catch{}}
    return values;
  }
  async scan(ids=['temp']){
    if(!Array.isArray(ids)||!ids.length||ids.length>this.sources.length||ids.some(id=>!this.cleaners.has(id)))throw new Error('Seleção de limpeza inválida.');
    const processes=await this.bridge.call('processes');const names=new Set((Array.isArray(processes)?processes:[]).map(p=>p.name.toLowerCase()));
    const results=[];this.selection=[];
    for(const id of new Set(ids)){
      const source=this.sources.find(s=>s.id===id);
      if(source.process&&names.has(source.process)){results.push({id,name:source.name,count:0,bytes:0,skipped:0,blocked:'Feche o navegador antes de limpar seu cache.'});continue;}
      try{const scan=await this.cleaners.get(id).scan();results.push({...scan,id,name:source.name});this.selection.push(id);}catch(e){results.push({id,name:source.name,count:0,bytes:0,skipped:1,blocked:e.message});}
    }
    return {count:results.reduce((sum,s)=>sum+s.count,0),bytes:results.reduce((sum,s)=>sum+s.bytes,0),skipped:results.reduce((sum,s)=>sum+s.skipped,0),truncated:results.some(s=>s.truncated),sources:results};
  }
  async isolate(){
    if(!this.selection.length)throw new Error('Faça uma análise antes de limpar.');
    const result={count:0,bytes:0,skipped:0};
    // Recheck running browsers immediately before touching any cached file.
    const processes=await this.bridge.call('processes');const names=new Set((Array.isArray(processes)?processes:[]).map(p=>p.name.toLowerCase()));
    for(const id of this.selection){const s=this.sources.find(s=>s.id===id);if(s.process&&names.has(s.process)){result.skipped++;continue;}const cleaner=this.cleaners.get(id);if(!cleaner.candidates.size)continue;const r=await cleaner.isolate();for(const key of Object.keys(result))result[key]+=r[key];}
    this.selection=[];return result;
  }
  async recoverPending(){for(const cleaner of this.cleaners.values())await cleaner.recoverPending();}
  async restore(){const result={count:0,skipped:0};for(const cleaner of this.cleaners.values()){const r=await cleaner.restore();result.count+=r.count;result.skipped+=r.skipped;}return result;}
  async purge(confirmation){const result={count:0,bytes:0,skipped:0};for(const cleaner of this.cleaners.values()){const r=await cleaner.purge(confirmation);for(const key of Object.keys(result))result[key]+=r[key];}return result;}
}
async function analyzeDirectory(root,{maxEntries=50000,timeLimit=15000}={}){
  root=path.resolve(root);const canonical=await fs.realpath(root);
  if(canonical.toLowerCase()!==root.toLowerCase()||(await fs.lstat(root)).isSymbolicLink())throw new Error('Escolha uma pasta sem redirecionamento por link ou junção.');
  const start=Date.now();let visited=0,skipped=0,truncated=false,total=0;
  const groups=new Map(),largest=[];
  async function walk(directory,group,depth){
    if(depth>16||Date.now()-start>timeLimit||visited>=maxEntries){truncated=true;return;}
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch{skipped++;return;}
    for(const entry of entries){
      if(++visited>maxEntries||Date.now()-start>timeLimit){truncated=true;return;}
      const full=path.join(directory,entry.name);if(!inside(root,full)||entry.isSymbolicLink()){skipped++;continue;}
      try{
        const stat=await fs.lstat(full);if(stat.isSymbolicLink()){skipped++;continue;}
        const bucket=group||(entry.isDirectory()?entry.name:'Arquivos nesta pasta');
        if(stat.isDirectory())await walk(full,bucket,depth+1);
        else if(stat.isFile()){total+=stat.size;groups.set(bucket,(groups.get(bucket)||0)+stat.size);largest.push({name:entry.name,path:full,size:stat.size});largest.sort((a,b)=>b.size-a.size);if(largest.length>20)largest.pop();}
      }catch{skipped++;}
    }
  }
  await walk(root,null,0);return {root,total,entries:visited,skipped,truncated,groups:[...groups.entries()].map(([name,bytes])=>({name,bytes})).sort((a,b)=>b.bytes-a.bytes),largest,durationMs:Date.now()-start};
}
module.exports={DiskTools,analyzeDirectory};
