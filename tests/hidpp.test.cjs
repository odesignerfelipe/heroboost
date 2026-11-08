'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {Hidpp}=require('../electron/logitech.cjs');
function device(responder){const d=new EventEmitter();d.write=async request=>{queueMicrotask(()=>responder(d,request));return request.length;};return d;}
test('HID++ replies are matched to device, feature and software ID',async()=>{
  const d=device((emitter,request)=>{emitter.emit('data',Buffer.from([0x10,2,request[2],request[3],99,0,0]));emitter.emit('data',Buffer.from([0x10,1,request[2],request[3],42,0,0]));});
  const h=new Hidpp(d,1);assert.equal((await h.command(5,2))[0],42);assert.equal(d.listenerCount('data'),0);
});
test('HID++ errors do not report success',async()=>{
  const d=device((emitter,request)=>emitter.emit('data',Buffer.from([0x11,1,0xff,request[2],request[3],2,0])));await assert.rejects(()=>new Hidpp(d,1).command(5,2),/recusou/);
});
test('DPI write is bounded by values advertised by the device and is read back',async()=>{
  let dpi=800,writes=0;
  const d=device((emitter,request)=>{if((request[3]>>4)===3){writes++;dpi=(request[5]<<8)|request[6];}emitter.emit('data',Buffer.from([0x10,1,request[2],request[3],0,dpi>>8,dpi&255]));});
  const h=new Hidpp(d,1),info={dpiSupported:true,dpiFeature:5,dpiRange:{min:400,max:3200,step:400}};
  await assert.rejects(()=>h.setDpi(info,777),/fora/);assert.equal(writes,0);assert.equal(await h.setDpi(info,1600),1600);assert.equal(writes,1);
});
test('DPI does not succeed if hardware fails to confirm the change',async()=>{
  const d=device((emitter,request)=>emitter.emit('data',Buffer.from([0x10,1,request[2],request[3],0,3,32])));await assert.rejects(()=>new Hidpp(d,1).setDpi({dpiSupported:true,dpiFeature:5,dpiValues:[800,1600]},1600),/não confirmou/);
});
