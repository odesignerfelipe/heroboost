'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateTarget,summarize,assess,Connection}=require('../electron/connection.cjs');
test('diagnostic targets are only IPs or hostnames without shell or URL syntax',()=>{
  for(const value of ['127.0.0.1','::1','1.1.1.1','example.com','relay-1.example.com'])assert.equal(validateTarget(value),value);
  for(const value of ['','https://example.com','1.1.1.1:730','1.1.1.1; whoami','$(whoami)','a..b','-option',null,'0.0.0.0','255.255.255.255'])assert.throws(()=>validateTarget(value));
});
test('statistics keep zero millisecond replies, missing samples and contiguous jitter distinct',()=>{
  assert.deepEqual(summarize([0,10,null,40,50]),{sent:5,received:4,unanswered:1,loss:20,min:0,max:50,mean:25,p95:50,jitter:10});
  const absent=summarize([null,null]);assert.equal(absent.mean,null);assert.equal(absent.jitter,null);assert.equal(absent.loss,100);
  assert.equal(summarize([10,null,50]).jitter,null);assert.equal(summarize([]).loss,0);
});
test('unanswered ICMP is not described as measured game packet loss',()=>{
  const tips=assess({destination:{summary:summarize([null,null])}}).join(' ');assert.match(tips,/não prova/);assert.match(tips,/bloquear ICMP/);
  assert.ok(assess({destination:{summary:summarize([80,81,80])}}).some(t=>t.includes('distância')));
});
test('QoS snapshots normalize missing state and stable types for exact rollback',async()=>{
  const c=new Connection('',{data:{},save:async()=>{}},{call:async()=>null});
  assert.deepEqual(c.qosValue(null),{exists:false});
  assert.deepEqual(c.qosValue({exists:true,path:'C:\\Games\\CS2.exe',protocol:'UDP',dscp:'46',rate:'0'}),{exists:true,path:'c:\\games\\cs2.exe',protocol:'UDP',dscp:46,rate:0});
  assert.equal(c.qosValue({exists:true,path:'C:\\Apps\\upload.exe',protocol:'None',dscp:-1,rate:2000000}).protocol,'Both');
});
