'use strict';
const dns=require('node:dns').promises;
const net=require('node:net');
const {WindowsBridge}=require('./bridge.cjs');
function validateTarget(value){
  if(typeof value!=='string')throw new Error('Informe um IP ou domínio.');
  const target=value.trim();
  if(!target||target.length>253||(!net.isIP(target)&&!target.split('.').every(label=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))))throw new Error('Use somente IP ou domínio, sem URL, porta ou comandos.');
  if(net.isIP(target)&&['0.0.0.0','255.255.255.255','::','ff02::1'].includes(target))throw new Error('Alvo inválido para este teste.');
  return target;
}
function summarize(samples){
  const isValid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const valid=samples.filter(isValid);const sorted=[...valid].sort((a,b)=>a-b);
  const diffs=[];for(let i=1;i<samples.length;i++)if(isValid(samples[i])&&isValid(samples[i-1]))diffs.push(Math.abs(samples[i]-samples[i-1]));
  return {sent:samples.length,received:valid.length,unanswered:samples.length-valid.length,loss:samples.length?100*(samples.length-valid.length)/samples.length:0,min:valid.length?sorted[0]:null,max:valid.length?sorted.at(-1):null,mean:valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null,p95:valid.length?sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]:null,jitter:diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:null};
}
function assess(result){
  const tips=[];const gateway=result.gateway?.summary,destination=result.destination.summary;
  if(!destination.received)tips.push('O alvo não respondeu a ICMP. Pode haver bloqueio de ping; isso não prova falha de conexão com o jogo.');
  if(gateway?.loss>0||gateway?.jitter>5)tips.push('Há variação ou ausência de resposta até o gateway. Confira Wi-Fi, cabo, roteador e saturação local antes de atribuir o problema ao servidor.');
  if(destination.received&&destination.jitter>=10)tips.push('A latência ao alvo varia. Repita por Ethernet e sem uploads; compare no mesmo IP e horário semelhante.');
  if(destination.received&&destination.mean>=50)tips.push('O RTT inclui distância e rota do provedor. Marcação QoS ou DNS não eliminam o tempo de propagação até servidores distantes.');
  if(destination.received&&destination.loss===0&&destination.jitter<10)tips.push('Nesta janela o alvo respondeu com pouca variação. Isso não comprova a qualidade do tráfego UDP do CS2; confira a telemetria dentro do jogo.');
  tips.push('Saltos sem resposta no traceroute podem apenas bloquear ICMP. Não identifique um hop como culpado somente por asteriscos.');return tips;
}
class Connection {
  constructor(script,store,bridge){this.script=script;this.store=store;this.bridge=bridge;this.running=false;store.data.connection ||= {reports:[]};}
  call(operation,payload={},bridge=this.bridge){return bridge.call('network',{operation,payload});}
  qosValue(value){return value?.exists?{exists:true,path:value.path.toLowerCase(),protocol:value.protocol==='None'?'Both':value.protocol,dscp:Number(value.dscp),rate:Number(value.rate)}:{exists:false};}
  async qosSnapshot(id){return this.qosValue(await this.call('qos',{id}));}
  async qosWrite(id,snapshot){return this.qosValue(await this.call('setQos',{id,snapshot}));}
  async run(target,trace=true){
    target=validateTarget(target);if(this.running)throw new Error('Aguarde o diagnóstico atual terminar.');this.running=true;
    const worker=new WindowsBridge(this.script);
    try{
      let lookupTimeout;
      let resolved;
      try{resolved=net.isIP(target)?{address:target}:await Promise.race([dns.lookup(target,{family:4}),new Promise((_,reject)=>lookupTimeout=setTimeout(()=>reject(new Error('A resolução do domínio excedeu 10 segundos. Tente um IP.')),10000))]);}finally{clearTimeout(lookupTimeout);}
      const info=await this.call('connection',{},worker);const gateway=(info.interfaces?.find(i=>i.default)||info.interfaces?.[0])?.gateway;
      let gatewayResult=null;if(gateway){const probe=await this.call('probe',{ip:gateway,count:6},worker);gatewayResult={...probe,summary:summarize(probe.samples)};}
      const probe=await this.call('probe',{ip:resolved.address,count:20},worker);
      const result={target,ip:resolved.address,date:new Date().toISOString(),interfaces:info.interfaces,gateway:gatewayResult,destination:{...probe,summary:summarize(probe.samples)},hops:trace?await this.call('trace',{ip:resolved.address},worker):[]};
      result.tips=assess(result);this.store.data.connection.reports.push(result);this.store.data.connection.reports=this.store.data.connection.reports.slice(-10);await this.store.save();return result;
    }finally{worker.close();this.running=false;}
  }
}
module.exports={Connection,validateTarget,summarize,assess};
