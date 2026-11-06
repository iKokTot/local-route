const https = require('node:https');
const REPOSITORY = 'https://github.com/iKokTot/local-route';
const API_URL = 'https://api.github.com/repos/iKokTot/local-route/releases?per_page=30';
const AUTO_INTERVAL = 6 * 60 * 60 * 1000;
const MANUAL_INTERVAL = 60 * 1000;

function versionParts(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const numbers = match.slice(1,4).map(Number);
  const prerelease = match[4]?.split('.') || [];
  if (numbers.some(n=>!Number.isSafeInteger(n)) || prerelease.some(p=>/^\d+$/.test(p) && (p.length>1 && p[0]==='0' || !Number.isSafeInteger(Number(p))))) return null;
  return {numbers,prerelease};
}
function compareVersions(left,right) {
  const a=versionParts(left),b=versionParts(right);
  if(!a || !b) throw new Error('Invalid version');
  for(let i=0;i<3;i++)if(a.numbers[i]!==b.numbers[i])return Math.sign(a.numbers[i]-b.numbers[i]);
  if(!a.prerelease.length || !b.prerelease.length)return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for(let i=0;i<Math.max(a.prerelease.length,b.prerelease.length);i++){
    const x=a.prerelease[i],y=b.prerelease[i];
    if(x===undefined)return -1;if(y===undefined)return 1;if(x===y)continue;
    const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
    return nx && ny ? Math.sign(Number(x)-Number(y)) : nx!==ny ? nx ? -1 : 1 : x<y ? -1 : 1;
  }
  return 0;
}
function selectRelease(releases,currentVersion) {
  if(!Array.isArray(releases))throw new Error('Invalid releases response');
  let latest=null;
  for(const entry of releases){
    if(!entry || entry.draft!==false || typeof entry.prerelease!=='boolean' || !versionParts(entry.tag_name) || !Array.isArray(entry.assets))continue;
    const version=entry.tag_name.replace(/^v/,'');
    // A published tag without a completed Windows installer is not an update.
    if(!entry.assets.some(asset=>asset?.name===`Local-Route-Setup-${version}-x64.exe` && asset.state==='uploaded' && asset.size>0))continue;
    if(!latest || compareVersions(version,latest.version)>0)latest={version,prerelease:entry.prerelease,url:`${REPOSITORY}/releases/tag/${encodeURIComponent(entry.tag_name)}`};
  }
  return latest && compareVersions(latest.version,currentVersion)>0 ? latest : null;
}
function fetchReleases({signal,request=https.get,timeoutMs=8000,maxBytes=1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    let req, timer, settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const fail=error=>{finish(error);req?.destroy();};
    const abort=()=>fail(Object.assign(new Error('Cancelled'),{code:'ABORT_ERR'}));
    if(signal?.aborted)return abort();
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>fail(new Error('Update timeout')),timeoutMs);timer.unref?.();
    try {
      req=request(API_URL,{headers:{Accept:'application/vnd.github+json','User-Agent':'Local-Route-update-check','X-GitHub-Api-Version':'2022-11-28'},agent:false},response=>{
        if(settled){response.destroy();return;}
        if(response.statusCode!==200){response.resume();fail(new Error('Update HTTP '+response.statusCode));return;}
        if(!/^application\/json\b/i.test(response.headers['content-type']||'')){response.resume();fail(new Error('Invalid update content'));return;}
        let bytes=0;const chunks=[];
        response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){response.destroy();fail(new Error('Update response too large'));}else chunks.push(chunk);});
        response.once('error',fail);
        response.once('aborted',()=>fail(new Error('Incomplete update response')));
        response.once('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{fail(new Error('Invalid update JSON'));}});
      });
      req.once('error',fail);
    } catch(error){fail(error);}
  });
}
function createUpdateChecker({currentVersion,load=fetchReleases,now=Date.now,onChange=()=>{}}) {
  if(!versionParts(currentVersion))throw new Error('Invalid current version');
  let state={status:'idle',checkedAt:null,latest:null,message:''},lastAttempt=null,inflight=null,generation=0;
  const snapshot=()=>({...state,latest:state.latest?{...state.latest}:null});
  const publish=()=>{try{onChange(snapshot());}catch{}};
  function cancel(){generation++;inflight?.controller.abort();inflight=null;state={...state,status:state.latest?'available':'idle'};publish();}
  function check({manual=false}={}) {
    if(inflight)return inflight.promise;
    const interval=manual?MANUAL_INTERVAL:state.status==='error'?15*60*1000:AUTO_INTERVAL;
    if(lastAttempt!==null && now()-lastAttempt<interval && now()>=lastAttempt)return Promise.resolve(snapshot());
    lastAttempt=now();const token=++generation,controller=new AbortController();
    state={...state,status:'checking',message:''};publish();
    const promise=Promise.resolve().then(()=>load({signal:controller.signal})).then(releases=>{
      if(token!==generation)return snapshot();
      const latest=selectRelease(releases,currentVersion);
      state={status:latest?'available':'current',checkedAt:now(),latest,message:''};publish();return snapshot();
    }).catch(()=>{
      if(token!==generation)return snapshot();
      state={...state,status:'error',message:'Не удалось проверить обновления. Проверьте доступ к GitHub и повторите позже.'};publish();return snapshot();
    }).finally(()=>{if(token===generation)inflight=null;});
    inflight={promise,controller};return promise;
  }
  return {snapshot,check,cancel};
}
module.exports={API_URL,REPOSITORY,compareVersions,selectRelease,fetchReleases,createUpdateChecker};
