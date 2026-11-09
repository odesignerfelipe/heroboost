'use strict';
const path=require('node:path');const fs=require('node:fs/promises');const {randomUUID}=require('node:crypto');
const {isProtectedProcess}=require('./engine.cjs');
const CREATIVE=/^(photoshop|illustrator|afterfx|afterfx_render_engine|aerender|adobe premiere pro|adobe media encoder|dynamiclinkmanager|dynamiclinkmediaserver|adobe desktop service|coresync|ccxprocess|indesign|lightroom|lightroom classic|blender|resolve|obs64)\.exe$/i;
const GAMES=/^(cs2|csgo|valorant|valorant-win64-shipping|fortniteclient-win64-shipping|dota2|r5apex|rocketleague|league of legends|gta5|overwatch|eldenring|minecraft|javaw)\.exe$/i;
const CREATIVE_TARGETS=/^(photoshop|illustrator|afterfx|afterfx_render_engine|aerender|adobe premiere pro|adobe media encoder|indesign|lightroom|lightroom classic)\.exe$/i;
function workProtected(p){return isProtectedProcess(p)||CREATIVE.test(path.basename(p.path))||GAMES.test(path.basename(p.path))||/[\\/](Adobe|steamapps[\\/]common|XboxGames|Games)[\\/]/i.test(p.path);}
function activeWorkloads(processes,focusApps=[]){const targets=new Set(focusApps.map(p=>p.path.toLowerCase()));return processes.filter(p=>CREATIVE.test(path.basename(p.path))||GAMES.test(path.basename(p.path))||/[\\/](Adobe|steamapps[\\/]common|XboxGames)[\\/]/i.test(p.path)||targets.has(p.path.toLowerCase()));}
async function executable(file){const canonical=await fs.realpath(file);if(path.extname(canonical).toLowerCase()!=='.exe'||!(await fs.lstat(canonical)).isFile())throw new Error('Executável inválido.');const handle=await fs.open(canonical,'r');try{const bytes=Buffer.alloc(2);await handle.read(bytes,0,2,0);if(bytes.toString('ascii')!=='MZ')throw new Error('O arquivo não é um executável Windows.');}finally{await handle.close();}return canonical;}
async function discoverCreative(processes,roots){
  const found=new Map();const add=async(file,name)=>{try{const canonical=await executable(file);found.set(canonical.toLowerCase(),{name,path:canonical});}catch{}};
  for(const p of processes)if(CREATIVE_TARGETS.test(path.basename(p.path)))await add(p.path,path.basename(p.path,'.exe'));
  const targets=[['Adobe Photoshop','Photoshop.exe','Photoshop'],['Adobe Illustrator',path.join('Support Files','Contents','Windows','Illustrator.exe'),'Illustrator'],['Adobe After Effects',path.join('Support Files','AfterFX.exe'),'After Effects'],['Adobe Premiere Pro','Adobe Premiere Pro.exe','Premiere Pro'],['Adobe Media Encoder','Adobe Media Encoder.exe','Media Encoder']];
  for(const root of roots.filter(Boolean)){
    const directory=path.join(root,'Adobe');let dirs=[];try{dirs=await fs.readdir(directory,{withFileTypes:true});}catch{}
    for(const dir of dirs.filter(d=>d.isDirectory()&&!d.isSymbolicLink()))for(const [prefix,relative,name] of targets)if(dir.name.startsWith(prefix))await add(path.join(directory,dir.name,relative),name);
  }
  return [...found.values()];
}
async function addFocusPreset(engine,store,apps,foregroundOnly){
  if(!Array.isArray(apps)||!apps.length||apps.length>20||typeof foregroundOnly!=='boolean')throw new Error('Preset inválido.');
  const additions=[];for(const app of apps){const canonical=await executable(app.path);if(isProtectedProcess({path:canonical}))throw new Error('Componente protegido.');if(!store.data.focusApps.some(a=>a.path.toLowerCase()===canonical.toLowerCase())&&!additions.some(a=>a.path.toLowerCase()===canonical.toLowerCase()))additions.push({id:randomUUID(),name:String(app.name||path.basename(canonical,'.exe')).slice(0,80),path:canonical});}
  if(store.data.focusApps.length+additions.length>30)throw new Error('Limite de 30 programas na lista de foco.');
  const prior={apps:structuredClone(store.data.focusApps),options:structuredClone(store.data.focusOptions)};
  // Restore any existing focus priorities before applying a different policy.
  const restored=await engine.setFocus(false);if(restored?.errors?.length||engine.lastFocus?.errors?.length)throw new Error('Revise os erros da sessão anterior no histórico antes de mudar o foco.');
  store.data.focusApps.push(...additions);store.data.focusOptions={...store.data.focusOptions,priority:'AboveNormal',foregroundOnly,pauseServices:false,timer:false};
  try{await store.save();}catch(error){store.data.focusApps=prior.apps;store.data.focusOptions=prior.options;throw error;}
  await engine.setFocus(true);return {added:additions.length,foregroundOnly};
}
module.exports={workProtected,activeWorkloads,executable,discoverCreative,addFocusPreset};
