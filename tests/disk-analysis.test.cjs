'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const {analyzeDirectory}=require('../electron/disk.cjs');
test('directory analysis counts sizes without following junctions or changing files',async t=>{
  const base=await fs.mkdtemp(path.join(process.cwd(),'.qa-analysis-'));t.after(()=>{assert.equal(path.dirname(path.resolve(base)),process.cwd());return fs.rm(base,{recursive:true,force:true});});
  const root=path.join(base,'scan'),outside=path.join(base,'outside');await fs.mkdir(root);await fs.mkdir(outside);await fs.mkdir(path.join(root,'project'));await fs.writeFile(path.join(root,'project','file.bin'),Buffer.alloc(1234));await fs.writeFile(path.join(outside,'secret'),Buffer.alloc(9999));await fs.symlink(outside,path.join(root,'redirect'),'junction');
  const r=await analyzeDirectory(root);assert.equal(r.total,1234);assert.equal(r.groups[0].name,'project');assert.equal(r.skipped,1);assert.equal((await fs.stat(path.join(outside,'secret'))).size,9999);
});
