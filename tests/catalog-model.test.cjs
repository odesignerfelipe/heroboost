'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {query,summary,selectable}=require('../ui/catalog-model.js');
const settings=[
  {id:'prior',name:'Jogo',description:'Prévio',category:'Desempenho',applied:true},
  {id:'owned',name:'Transparência',description:'Interface',category:'Visual',applied:true},
  {id:'ready',name:'Publicidade',description:'Sugestões de conteúdo',category:'Privacidade',recommended:true},
  {id:'admin',name:'Política',description:'Computador',category:'Privacidade',admin:true},
  {id:'unsupported',name:'Legado',description:'Antigo',category:'Visual',unavailable:'Windows incompatível'},
  {id:'pending',name:'Pendente',description:'Revisar',category:'Visual'}
];
const journal=[{id:'1',settingId:'owned',type:'setting',status:'applied'},{id:'2',settingId:'pending',type:'setting',status:'pending'}];
test('dashboard distinguishes configured preferences, Hero ownership and available choices',()=>{
  assert.deepEqual(summary(settings,{admin:false},journal),{total:6,configured:2,hero:1,available:1,attention:3});
  assert.equal(selectable(settings[5],{admin:true},journal),false);assert.equal(selectable(settings[3],{admin:true},journal),true);
});
test('catalog combines text, category and status instead of resetting other filters',()=>{
  const result=query(settings,{category:'Privacidade',search:'conteudo',status:'available'},{admin:false},journal);
  assert.deepEqual(result.map(s=>s.id),['ready']);assert.deepEqual(query(settings,{search:'transparencia',status:'hero'},{},journal).map(s=>s.id),['owned']);
  assert.deepEqual(query(settings,{category:'Visual',status:'attention'},{},journal).map(s=>s.id),['unsupported','pending']);
});
test('favorites and selected filters never imply an applied system change',()=>{
  assert.deepEqual(query(settings,{status:'favorites',favorites:['ready','prior']},{},journal).map(s=>s.id),['prior','ready']);
  assert.deepEqual(query(settings,{status:'selected',selected:['ready']},{},journal).map(s=>s.id),['ready']);
  assert.equal(summary(settings,{},journal).configured,2);assert.equal(query(settings,{status:'recommended'},{},journal).length,1);
});
