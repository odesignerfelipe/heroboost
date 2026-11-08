'use strict';
// Create one draft before electron-builder starts parallel asset uploads.
const {version}=require('../../package.json');
async function prepare(){
  const repo=process.env.GITHUB_REPOSITORY;
  if(repo!=='odesignerfelipe/heroboost'||!process.env.GH_TOKEN)throw new Error('Release repository or GitHub token unavailable.');
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw new Error('Invalid release version.');
  const root='https://api.github.com/repos/'+repo;
  const headers={Authorization:'Bearer '+process.env.GH_TOKEN,'User-Agent':'HeroBoost-Release',Accept:'application/vnd.github+json','Content-Type':'application/json'};
  const response=await fetch(root+'/releases?per_page=100',{headers});
  if(!response.ok)throw new Error('Cannot list releases: HTTP '+response.status);
  const releases=await response.json();const tag='v'+version;const existing=releases.filter(r=>r.tag_name===tag);
  if(existing.some(r=>!r.draft))throw new Error(tag+' is already published. Increment the version instead of overwriting installers.');
  if(existing.length>1)throw new Error('Duplicate drafts found. Consolidate before publishing.');
  if(existing.length===1){console.log('Using existing draft '+tag);return;}
  const created=await fetch(root+'/releases',{method:'POST',headers,body:JSON.stringify({tag_name:tag,target_commitish:process.env.GITHUB_SHA,name:'Hero Boost '+version,draft:true,prerelease:false})});
  if(!created.ok)throw new Error('Cannot create draft: HTTP '+created.status);
  console.log('Prepared single draft '+tag);
}
prepare().catch(error=>{console.error(error.message);process.exitCode=1;});
