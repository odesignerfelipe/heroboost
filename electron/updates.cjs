'use strict';
class Updates {
  constructor(app,store,options={}){
    this.app=app;this.store=store;this.now=options.now||Date.now;this.clock=options.clock||globalThis;this.lastCheckAt=null;this.checkPromise=null;
    this.state={status:'idle',version:null,error:null,progress:0,checkedAt:null,repository:'odesignerfelipe/heroboost'};
    if(!app.isPackaged)return;
    this.updater=options.updater||require('electron-updater').autoUpdater;
    this.updater.autoDownload=false;this.updater.autoInstallOnAppQuit=false;
    this.updater.setFeedURL({provider:'github',owner:'odesignerfelipe',repo:'heroboost',private:false});
    this.updater.on('checking-for-update',()=>this.state={...this.state,status:'checking',error:null});
    this.updater.on('update-available',info=>this.state={...this.state,status:'available',version:info.version});
    this.updater.on('update-not-available',()=>this.state={...this.state,status:'current',version:null,error:null});
    this.updater.on('download-progress',progress=>this.state={...this.state,status:'downloading',progress:Math.round(progress.percent)});
    this.updater.on('update-downloaded',info=>this.state={...this.state,status:'downloaded',version:info.version});
    this.updater.on('error',error=>this.fail(error));
  }
  fail(error){this.state={...this.state,status:'error',error:error.message.includes('404')?'O canal de atualizações está temporariamente indisponível. Tente novamente mais tarde.':error.message};}
  check(){
    if(!this.updater){this.state={...this.state,status:'development',error:'Verificação disponível na versão instalada para Windows.'};return this.state;}
    if(this.checkPromise)return this.checkPromise;
    if(['downloading','downloaded'].includes(this.state.status))return Promise.resolve(this.state);
    this.lastCheckAt=this.now();this.state.checkedAt=new Date(this.lastCheckAt).toISOString();
    this.checkPromise=Promise.resolve().then(()=>this.updater.checkForUpdates()).catch(error=>this.fail(error)).then(()=>this.state).finally(()=>{this.checkPromise=null;});
    return this.checkPromise;
  }
  checkIfDue(minimumAge=5*60000){
    if(!this.updater||['available','downloading','downloaded'].includes(this.state.status))return Promise.resolve(this.state);
    if(this.lastCheckAt!==null&&this.now()-this.lastCheckAt<minimumAge)return Promise.resolve(this.state);
    return this.check();
  }
  start(){
    if(!this.updater||this.initialTimer||this.pollTimer)return;
    this.initialTimer=this.clock.setTimeout(()=>{this.initialTimer=null;this.checkIfDue();},10000);
    this.pollTimer=this.clock.setInterval(()=>this.checkIfDue(30*60000),30*60000);
    this.initialTimer?.unref?.();this.pollTimer?.unref?.();
  }
  stop(){this.clock.clearTimeout(this.initialTimer);this.clock.clearInterval(this.pollTimer);this.initialTimer=null;this.pollTimer=null;}
  async download(){
    if(!this.updater||this.state.status!=='available')throw new Error('Nenhuma atualização disponível para baixar.');
    this.state={...this.state,status:'downloading',progress:0,error:null};
    try{await this.updater.downloadUpdate();return this.state;}catch(error){this.fail(error);throw error;}
  }
  install(){if(!this.updater||this.state.status!=='downloaded')throw new Error('Baixe e verifique a atualização primeiro.');this.updater.quitAndInstall(false,true);return true;}
}
module.exports={Updates};
