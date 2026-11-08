'use strict';
const {createHash}=require('node:crypto');
class Hidpp {
  constructor(device,index){this.device=device;this.index=index;this.softwareId=0x0b;}
  async command(feature,fn,params=[]){
    const address=(fn<<4)|this.softwareId;
    // Use short requests when possible; both report lengths can be returned by devices.
    const report=Buffer.alloc(params.length<=3?7:20);report[0]=report.length===7?0x10:0x11;report[1]=this.index;report[2]=feature;report[3]=address;Buffer.from(params).copy(report,4);
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{clearTimeout(timeout);this.device.removeListener('data',onData);this.device.removeListener('error',onError);if(error)reject(error);else resolve(value);};
      const onError=error=>finish(error);
      const onData=raw=>{const data=Buffer.from(raw);if(![0x10,0x11].includes(data[0])||data[1]!==this.index)return;
        if(data[2]===0xff&&data[3]===feature&&data[4]===address)return finish(new Error('HID++ recusou o comando: '+data[5]));
        if(data[2]===0x8f&&data[3]===feature&&data[4]===address)return finish(new Error('Dispositivo HID++ 1.0 ou recurso indisponível.'));
        if(data[2]===feature&&data[3]===address)finish(null,data.subarray(4));
      };
      const timeout=setTimeout(()=>finish(new Error('O dispositivo não respondeu ao HID++.')),700);
      this.device.on('data',onData);this.device.once('error',onError);
      this.device.write(report).catch(onError);
    });
  }
  async feature(id){return (await this.command(0,0,[id>>8,id&255,0]))[0];}
  async readInfo(){
    const info={index:this.index,battery:null,firmware:null,dpi:null,dpiSupported:false,dpiValues:[],dpiRange:null};
    const probe=await this.command(0,1,[0,0,0x5a]);if(probe[0]<2)throw new Error('Requer HID++ 2.0.');
    for(const id of [0x1004,0x1000])try{const f=await this.feature(id);if(f){const b=await this.command(f,id===0x1004?1:0);if(b[0]<=100)info.battery=b[0];break;}}catch{}
    try{const f=await this.feature(0x0003);if(f){const fw=await this.command(f,1,[0]);info.firmware=`${fw.subarray(1,4).toString('ascii').replace(/\0/g,'')} ${fw[4]}.${fw[5]}.${(fw[6]<<8)|fw[7]}`;}}catch{}
    try{
      const f=await this.feature(0x2201);if(f){const count=await this.command(f,0);if(count[0]>0){const dpi=await this.command(f,2,[0]);info.dpi=(dpi[1]<<8)|dpi[2];info.dpiFeature=f;
        const list=await this.command(f,1,[0]);const values=[];let step=null;
        for(let i=1;i+1<list.length;i+=2){const value=(list[i]<<8)|list[i+1];if(!value)break;if(value>=0xe000)step=value&0x1fff;else values.push(value);}
        if(step&&values.length>=2)info.dpiRange={min:values[0],max:values[values.length-1],step};else info.dpiValues=values;
        info.dpiSupported=!!info.dpi&&(!!info.dpiRange||info.dpiValues.length>0);
      }}
    }catch{}
    return info;
  }
  async setDpi(info,dpi){
    if(!Number.isInteger(dpi)||!info.dpiSupported)throw new Error('DPI não suportado.');
    const range=info.dpiRange;
    if(range?dpi<range.min||dpi>range.max||(dpi-range.min)%range.step!==0:!info.dpiValues.includes(dpi))throw new Error('DPI fora dos valores anunciados pelo mouse.');
    await this.command(info.dpiFeature,3,[0,dpi>>8,dpi&255]);
    const actual=await this.command(info.dpiFeature,2,[0]);const value=(actual[1]<<8)|actual[2];if(value!==dpi)throw new Error('O mouse não confirmou o DPI.');return value;
  }
}
class Logitech {
  constructor(){this.devices=new Map();}
  async list(){
    const HID=require('node-hid');const found=(await HID.devicesAsync(0x046d,0)).filter(d=>d.path&&d.usagePage>=0xff00);
    this.devices.clear();
    for(const d of found){const id=createHash('sha256').update(d.path).digest('hex');this.devices.set(id,d);}
    return [...this.devices.entries()].map(([id,d])=>({id,name:d.product||'Dispositivo Logitech',productId:d.productId}));
  }
  async withDevice(id,index,fn){const descriptor=this.devices.get(id);if(!descriptor)throw new Error('Detecte novamente o dispositivo.');if(![0xff,1,2,3,4,5,6].includes(index))throw new Error('Índice de dispositivo inválido.');
    const HID=require('node-hid');const device=await HID.HIDAsync.open(descriptor.path);
    try{return await fn(new Hidpp(device,index));}finally{await device.close();}
  }
  async inspect(id,index=0xff){return this.withDevice(id,index,h=>h.readInfo());}
  async setDpi(id,index,dpi){return this.withDevice(id,index,async h=>{const info=await h.readInfo();return h.setDpi(info,dpi);});}
}
module.exports={Logitech,Hidpp};
