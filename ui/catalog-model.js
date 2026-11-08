'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HeroCatalog=factory();})(globalThis,()=>{
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const owner=(journal,id)=>journal.find(j=>j.type==='setting'&&j.settingId===id&&['applied','pending'].includes(j.status));
  const selectable=(setting,info,journal)=>!!setting&&!setting.applied&&!setting.unavailable&&(!setting.admin||!!info.admin)&&!owner(journal,setting.id);
  function query(settings,{category='Todos',search='',status='all',favorites=[],selected=[]}={},info={},journal=[]){
    const term=normalize(search),stars=new Set(favorites),choices=new Set(selected);
    return settings.filter(s=>{
      if(category!=='Todos'&&s.category!==category)return false;
      if(term&&!normalize(s.name+' '+s.description+' '+s.category).includes(term))return false;
      const owned=owner(journal,s.id);
      return status==='all'||status==='available'&&selectable(s,info,journal)||status==='configured'&&s.applied||status==='hero'&&s.applied&&!!owned||status==='recommended'&&s.recommended||status==='favorites'&&stars.has(s.id)||status==='selected'&&choices.has(s.id)||status==='attention'&&(!s.applied&&(!!s.unavailable||s.admin&&!info.admin||!!owned));
    });
  }
  function summary(settings,info={},journal=[]){return {total:settings.length,configured:settings.filter(s=>s.applied).length,hero:settings.filter(s=>s.applied&&owner(journal,s.id)).length,available:settings.filter(s=>selectable(s,info,journal)).length,attention:settings.filter(s=>!s.applied&&(s.unavailable||s.admin&&!info.admin||owner(journal,s.id))).length};}
  return {normalize,owner,selectable,query,summary};
});
