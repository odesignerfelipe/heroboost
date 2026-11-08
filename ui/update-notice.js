'use strict';
function renderUpdateNotice(){
  if(!state)return;
  const notice=document.querySelector('#global-update-notice'),u=state.telemetry.updates||state.updates;
  const visible=['available','downloading','downloaded'].includes(u.status)||(u.status==='error'&&u.version);
  notice.hidden=!visible;if(!visible){notice.replaceChildren();delete notice.dataset.signature;return;}
  const label=u.status==='available'?'Atualizar para '+u.version:u.status==='downloaded'?'Instalar atualização':u.status==='error'?'Tentar novamente':'Baixando… '+u.progress+'%';
  const detail=u.status==='available'?'Uma nova versão do Hero Boost está disponível.':u.status==='downloaded'?'Download verificado. Reinicie o Hero para concluir a instalação.':u.status==='error'?'Não foi possível concluir. Seus ajustes permanecem salvos.':'Baixando e verificando o pacote. Você pode continuar usando o app.';
  const action=u.status==='downloaded'?'installUpdate':u.status==='error'?'checkUpdates':'downloadUpdate';
  const signature=JSON.stringify([u.status,u.version]);
  if(notice.dataset.signature!==signature){
    notice.dataset.signature=signature;
    notice.innerHTML=`<span class="update-notice-icon">${icon('arrow')}</span><div class="update-notice-copy"><strong>Hero Boost ${esc(u.version)}</strong><p id="global-update-detail"></p></div><button id="global-update-action" class="button primary small" data-action="${action}"></button>`;
  }
  notice.querySelector('#global-update-detail').textContent=detail;
  const control=notice.querySelector('#global-update-action');control.textContent=label;control.disabled=u.status==='downloading';
}
// Keep the notice outside page content so it remains visible during navigation.
const metricsWithUpdateNotice=updateMetrics;
updateMetrics=function(){metricsWithUpdateNotice();renderUpdateNotice();};
handlers.downloadUpdate=async()=>{
  if(!await confirmDialog('Baixar atualização do Hero Boost?',`<p>O pacote da versão ${esc((state.telemetry.updates||state.updates).version)} será baixado do canal oficial e sua integridade será verificada.</p><p>Você poderá continuar usando o Hero. A instalação e o reinício precisam de uma nova confirmação.</p>`,'Baixar atualização'))return;
  try{await Promise.all([request('downloadUpdate'),reload()]);await reload();toast('Atualização verificada. Use Instalar atualização para concluir.');}catch(error){try{await reload();}catch{}toast(error.message,true);}
};
