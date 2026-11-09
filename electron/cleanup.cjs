'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const DAY = 86400000;
function inside(root, candidate) { const relative = path.relative(root,candidate); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
function belongs(root,item){return item.root?path.resolve(item.root).toLowerCase()===root.toLowerCase():inside(root,item.source);}
class Cleanup {
  constructor(root, directory, store, clock=()=>Date.now()) { this.root=path.resolve(root); this.directory=path.resolve(directory); this.store=store; this.clock=clock; this.candidates=new Map(); }
  async scan(options={}) {
    const rootStat = await fs.lstat(this.root);
    if (rootStat.isSymbolicLink()) throw new Error('A pasta temporária é um link. Limpeza bloqueada por segurança.');
    const realRoot=await fs.realpath(this.root);
    if (realRoot.toLowerCase()!==this.root.toLowerCase()) throw new Error('A pasta temporária foi redirecionada. Limpeza bloqueada.');
    this.candidates.clear(); let visited=0; let skipped=0; let truncated=false;const started=Date.now();
    const walk = async (directory,depth=0) => {
      if(depth>12) {truncated=true;return;}
      let items; try {items=await fs.readdir(directory,{withFileTypes:true});} catch {skipped++;return;}
      for(const item of items) {
        if(options.shouldContinue&&!options.shouldContinue()||Date.now()-started>(options.timeLimitMs||15000)){truncated=true;return;}
        if(++visited>12000 || this.candidates.size>=2000) {truncated=true;return;}
        const source=path.join(directory,item.name);
        if(!inside(this.root,source) || item.isSymbolicLink()) {skipped++;continue;}
        try {
          const stat=await fs.lstat(source);
          if(stat.isSymbolicLink()) {skipped++;continue;}
          if(stat.isDirectory()) {await walk(source,depth+1);continue;}
          if(!stat.isFile() || this.clock()-stat.mtimeMs<7*DAY || this.clock()-stat.birthtimeMs<7*DAY) continue;
          const id=crypto.randomUUID(); this.candidates.set(id,{id,source,size:stat.size,mtime:stat.mtimeMs,ino:stat.ino});
        } catch {skipped++;}
      }
    };
    await walk(this.root);
    return {count:this.candidates.size,bytes:[...this.candidates.values()].reduce((s,f)=>s+f.size,0), skipped, truncated, root:this.root};
  }
  async validateSource(item) {
    if(!inside(this.root,item.source)) throw new Error('Caminho fora da pasta temporária.');
    let parent=path.dirname(item.source);
    while(parent!==this.root) {
      if(!inside(this.root,parent) || (await fs.lstat(parent)).isSymbolicLink()) throw new Error('Pasta redirecionada.');
      parent=path.dirname(parent);
    }
    if((await fs.lstat(this.root)).isSymbolicLink()) throw new Error('Pasta redirecionada.');
    const real=await fs.realpath(item.source);
    if(real.toLowerCase()!==path.resolve(item.source).toLowerCase()) throw new Error('Arquivo redirecionado.');
    const stat=await fs.lstat(item.source);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.size||stat.mtimeMs!==item.mtime||stat.ino!==item.ino) throw new Error('Arquivo alterado desde a análise.');
  }
  async isolate(options={}) {
    if(!this.candidates.size) throw new Error('Analise os temporários antes de limpar.');
    await fs.mkdir(this.directory,{recursive:true});
    if((await fs.lstat(this.directory)).isSymbolicLink()||(await fs.realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase()) throw new Error('Quarentena redirecionada.');
    let moved=0,bytes=0,skipped=0;
    for(const item of this.candidates.values()) {
      if(options.shouldContinue&&!options.shouldContinue())break;
      if(moved>=(options.maxFiles??2000)||bytes+item.size>(options.maxBytes??Number.MAX_SAFE_INTEGER)){skipped++;continue;}
      try {await this.validateSource(item);}catch{skipped++;continue;}
      if(options.allowFile&&!await options.allowFile(item.source)){skipped++;continue;}
      if(options.shouldContinue&&!options.shouldContinue())break;
      const destination=path.join(this.directory,item.id);
      const record={...item,root:this.root,destination,status:'pending',date:new Date().toISOString(),...(options.batch?{maintenanceBatch:options.batch}:{})};
      this.store.data.cleanup.push(record); await this.store.save();
      try {await fs.rename(item.source,destination);record.status='isolated';}
      catch {record.status='skipped';await this.store.save();skipped++;continue;}
      // Persistence failures must remain visible; pending records allow recovery.
      await this.store.save();moved++;bytes+=item.size;
    }
    this.candidates.clear();return {count:moved,bytes,skipped};
  }
  async validateIsolated(item) {
    if(!inside(this.directory,item.destination)||path.basename(item.destination)!==item.id||!inside(this.root,item.source)) throw new Error('Registro de limpeza inválido.');
    if((await fs.lstat(this.directory)).isSymbolicLink()||(await fs.realpath(this.directory)).toLowerCase()!==this.directory.toLowerCase()) throw new Error('Quarentena redirecionada.');
    const stat=await fs.lstat(item.destination);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.size||stat.ino!==item.ino||stat.mtimeMs!==item.mtime) throw new Error('Arquivo da quarentena alterado.');
  }
  async recoverPending() {
    let changed=false;
    for(const item of this.store.data.cleanup.filter(f=>f.status==='pending'&&belongs(this.root,f))) {
      try {await this.validateIsolated(item);item.status='isolated';changed=true;}
      catch(error) {
        if(error.code!=='ENOENT')continue;
        try {await this.validateSource(item);item.status='skipped';changed=true;}catch{}
      }
    }
    if(changed)await this.store.save();
  }
  async restore() {
    let restored=0,skipped=0;
    for(const item of this.store.data.cleanup.filter(f=>['isolated','pending'].includes(f.status)&&belongs(this.root,f))) {
      try {
        await this.validateIsolated(item);
        // Do not overwrite newly-created files or recreate paths through junctions.
        try {await fs.lstat(item.source);skipped++;continue;} catch(e) {if(e.code!=='ENOENT') throw e;}
        const missing=[];let parent=path.dirname(item.source);
        while(parent!==this.root) {
          if(!inside(this.root,parent))throw new Error('Pasta original inválida.');
          try{if((await fs.lstat(parent)).isSymbolicLink())throw new Error('Pasta redirecionada.');}catch(e){if(e.code!=='ENOENT')throw e;missing.push(parent);}
          parent=path.dirname(parent);
        }
        if((await fs.realpath(this.root)).toLowerCase()!==this.root.toLowerCase())throw new Error('Raiz redirecionada.');
        for(const directory of missing.reverse())await fs.mkdir(directory);
        if((await fs.realpath(path.dirname(item.source))).toLowerCase()!==path.dirname(item.source).toLowerCase()) throw new Error('Pasta original redirecionada.');
        // Exclusive copy prevents overwriting a file created between the check and restore.
        await fs.copyFile(item.destination,item.source,fs.constants.COPYFILE_EXCL);
        await fs.utimes(item.source,new Date(item.mtime),new Date(item.mtime));
        await fs.unlink(item.destination);item.status='restored';
      } catch {skipped++;continue;}
      await this.store.save();restored++;
    }
    return {count:restored,skipped};
  }
  async purge(confirmation,options={}) {
    if(confirmation!=='EXCLUIR') throw new Error('Confirmação de exclusão necessária.');
    let count=0,bytes=0,skipped=0;
    for(const item of this.store.data.cleanup.filter(f=>['isolated','pending'].includes(f.status)&&belongs(this.root,f)&&(!options.batch||f.maintenanceBatch===options.batch))) {
      if(options.shouldContinue&&!options.shouldContinue())break;
      try {await this.validateIsolated(item);if(options.shouldContinue&&!options.shouldContinue())break;await fs.unlink(item.destination);item.status='deleted';} catch {skipped++;continue;}
      await this.store.save();count++;bytes+=item.size;
    }
    return {count,bytes,skipped};
  }
}
module.exports={Cleanup,inside};
