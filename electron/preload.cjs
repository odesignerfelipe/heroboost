'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['state','telemetry','refresh','apply','profile','revert','revertAll','startup','disableStartup','power','setPower','createHeroPower','focus','addApp','removeApp','scan','clean','restoreFiles','purge','windowsApps','startupSettings','export','analyzeDisk','drivers','backupDrivers','restoreDriver','packages','removePackage','resources','resource','restorePoint','timer','mouseStart','mouseRead','mouseStop','logitechDevices','logitechInfo','logitechDpi','boot','recycle','focusOptions','addBackground','removeBackground','checkUpdates','downloadUpdate','installUpdate','elevate']);
for(const action of ['cs2Discover','cs2Select','cs2Activate','cs2Deactivate','cs2Resume','cs2Launch','cs2Config','connectionRun','connectionExport','cs2Qos','limitUpload','windowsStorage','maintenanceInspect','maintenanceConfigure','maintenanceTrim','maintenanceCache','memoryAddApp','memoryRemoveApp','creativeDiscover','creativeActivate'])allowed.add(action);
contextBridge.exposeInMainWorld('hero',{
  request:async(action,data={})=>{
    if(!allowed.has(action))throw new Error('Operação não permitida.');
    const response=await ipcRenderer.invoke('hero:request',action,data);
    if(!response.ok)throw new Error(response.error);return response.result;
  }
});
