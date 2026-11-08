'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
class Store {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'state.json'); this.queue=Promise.resolve();this.data = {version:1, profile:'balanced', focusApps:[], focusEnabled:false, journal:[], cleanup:[]}; }
  async load() {
    await fs.mkdir(this.directory, {recursive:true});
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.journal) || !Array.isArray(data.focusApps) || !Array.isArray(data.cleanup)) throw new Error('Formato de dados inválido.');
      this.data = {...this.data, ...data};
    } catch (e) { if (e.code !== 'ENOENT') throw new Error('Não foi possível ler o histórico. Os dados foram preservados para recuperação. ' + e.message); }
    return this.data;
  }
  save(){const snapshot=JSON.stringify(this.data,null,2);const job=this.queue.then(()=>this.persist(snapshot));this.queue=job.catch(()=>{});return job;}
  async persist(snapshot) {
    const temp = this.file + '.tmp';
    const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(snapshot,'utf8');await handle.sync();}finally{await handle.close();}
    for(let attempt=0;;attempt++){try{await fs.rename(temp,this.file);break;}catch(e){if(attempt>=4||!['EBUSY','EPERM','EACCES'].includes(e.code))throw e;await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));}}
  }
}
module.exports = {Store};
