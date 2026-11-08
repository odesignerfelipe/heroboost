'use strict';
class Updates {
  constructor(app,store){
    this.app=app;this.store=store;this.state={status:'idle',version:null,error:null,progress:0,repository:'odesignerfelipe/heroboost'};
    if(!app.isPackaged)return;
    this.updater=require('electron-updater').autoUpdater;
    this.updater.autoDownload=false;this.updater.autoInstallOnAppQuit=false;
    this.updater.setFeedURL({provider:'github',owner:'odesignerfelipe',repo:'heroboost',private:false});
    this.updater.on('checking-for-update',()=>this.state={...this.state,status:'checking',error:null});
    this.updater.on('update-available',info=>this.state={...this.state,status:'available',version:info.version});
    this.updater.on('update-not-available',()=>this.state={...this.state,status:'current'});
    this.updater.on('download-progress',progress=>this.state={...this.state,status:'downloading',progress:Math.round(progress.percent)});
    this.updater.on('update-downloaded',info=>this.state={...this.state,status:'downloaded',version:info.version});
    this.updater.on('error',error=>this.state={...this.state,status:'error',error:error.message.includes('404')?'Canal sem versão publicada ou repositório privado. Publique uma release pública com latest.yml e instalador.':error.message});
  }
  async check(){
    if(!this.updater){this.state={...this.state,status:'development',error:'Verificação disponível na versão instalada para Windows.'};return this.state;}
    try{await this.updater.checkForUpdates();}catch{}return this.state;
  }
  async download(){if(!this.updater||this.state.status!=='available')throw new Error('Nenhuma atualização disponível para baixar.');await this.updater.downloadUpdate();return this.state;}
  install(){if(!this.updater||this.state.status!=='downloaded')throw new Error('Baixe e verifique a atualização primeiro.');this.updater.quitAndInstall(false,true);return true;}
}
module.exports={Updates};
