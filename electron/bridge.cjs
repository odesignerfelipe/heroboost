'use strict';
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const path = require('node:path');
class WindowsBridge {
  constructor(script,options={}) { this.script = script; this.options=options;this.next = 0; this.pending = new Map(); this.closed = false; this.queue=Promise.resolve(); }
  start() {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.script];
    if(this.options.testRegistryRoot)args.push('-TestRegistryRoot',this.options.testRegistryRoot);
    this.child = spawn(executable, args, {windowsHide:true, stdio:['pipe','pipe','pipe']});
    // The bundled, fixed worker accepts data over stdin; no user input becomes PowerShell source.
    this.child.stderr.on('data', () => {});
    createInterface({input:this.child.stdout}).on('line', line => {
      let message; try { message = JSON.parse(line.replace(/^\uFEFF/,'')); } catch { return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error || 'O Windows recusou a operação.'));
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('A conexão com o Windows foi encerrada. Reinicie o Hero Boost.')));
  }
  fail(error) { this.closed = true; for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(error);} this.pending.clear(); }
  call(action, data = {}) {
    const job=this.queue.then(()=>this.dispatch(action,data));this.queue=job.catch(()=>{});return job;
  }
  dispatch(action,data) {
    if (this.closed) return Promise.reject(new Error('Conexão com o Windows indisponível. Reinicie o aplicativo.'));
    if (!this.child) this.start();
    const id = ++this.next;
    return new Promise((resolve,reject) => {
      const duration=action==='advanced'&&['backupDrivers','restoreDriver','restorePoint'].includes(data.operation)?300000:45000;
      const timer = setTimeout(() => { this.fail(new Error('O Windows demorou para responder. Reinicie o Hero e verifique o histórico antes de tentar novamente.'));this.child.kill(); }, duration);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,action,data})+'\n', error => {if(error) {clearTimeout(timer); this.pending.delete(id); reject(error);}});
    });
  }
  close() { this.child?.stdin.end(); }
}
module.exports = {WindowsBridge};
