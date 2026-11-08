'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {settings,profiles,support}=require('../electron/catalog.cjs');
test('catalog contains distinct registry preferences and every profile resolves',()=>{
  assert.equal(settings.length,101);assert.equal(new Set(settings.map(s=>s.hive+'|'+s.path.toLowerCase()+'|'+s.value.toLowerCase())).size,101);
  for(const p of profiles){assert.equal(new Set(p.settings).size,p.settings.length);for(const id of p.settings)assert.ok(settings.some(s=>s.id===id));}
});
test('automatic profiles do not deny sensitive app permissions or change protected services',()=>{
  for(const profile of profiles)for(const id of profile.settings){const s=settings.find(s=>s.id===id);assert.notEqual(s.category,'Permissões de apps');assert.equal(s.hive,'HKCU');assert.equal(s.risk,'low');}
  for(const s of settings){assert.ok(!/Windows Defender|WindowsFirewall|WindowsUpdate|Policies\\Microsoft\\Windows Defender/i.test(s.path));assert.ok(['HKCU','HKLM'].includes(s.hive));if(s.hive==='HKLM')assert.equal(s.admin,true);}
});
test('legacy and future policies are gated by Windows build and edition',()=>{
  assert.ok(support(settings.find(s=>s.id==='copilot-legacy'),{build:26200,edition:'Professional'}));
  assert.ok(support(settings.find(s=>s.id==='ai-settings'),{build:22621,edition:'Professional'}));
  assert.ok(support(settings.find(s=>s.id==='search-web'),{build:26200,edition:'Core'}));
  assert.equal(support(settings.find(s=>s.id==='advertising'),{build:26200,edition:'Professional'}),null);
});
