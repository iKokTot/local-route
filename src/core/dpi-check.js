const dns = require('node:dns').promises;

function aborted() { return Object.assign(new Error('Проверка остановлена пользователем.'), {code:'ABORT_ERR'}); }
function pause(milliseconds, signal) {
  return new Promise((resolve,reject) => {
    if (signal?.aborted) return reject(aborted());
    const cancel = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort',cancel); resolve(); },milliseconds);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}
async function boundedLookup(hostname, lookup, signal, timeoutMs) {
  if (signal?.aborted) throw aborted();
  let timer; let cancel;
  try {
    return await Promise.race([
      lookup(hostname,{all:true,order:'ipv4first'}),
      new Promise((_,reject) => {
        timer=setTimeout(()=>reject(Object.assign(new Error('DNS timeout'),{code:'ETIMEDOUT'})),timeoutMs);
        cancel=()=>reject(aborted());signal?.addEventListener('abort',cancel,{once:true});
      })
    ]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
async function prepareProbeSession(targets,{signal,lookup=dns.lookup,timeoutMs=1800,retryDelayMs=250}={}) {
  const addresses=new Map(); const failures=new Map();
  const hosts=[...new Set(targets.map(target=>new URL(target.url).hostname))];
  let next=0;
  const worker=async()=>{
    while(next<hosts.length){
      const hostname=hosts[next++];
      for(let attempt=0;attempt<2;attempt++){
        try {
          const resolved=await boundedLookup(hostname,lookup,signal,timeoutMs);
          if(!resolved.length)throw Object.assign(new Error('No DNS addresses'),{code:'ENOTFOUND'});
          addresses.set(hostname,resolved);failures.delete(hostname);break;
        } catch(error) {
          if(signal?.aborted)throw aborted();
          failures.set(hostname,error.code||'ENOTFOUND');
          if(attempt===0)await pause(retryDelayMs,signal);
        }
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(2,hosts.length)},worker));
  return {
    errors:targets.filter(target=>failures.has(new URL(target.url).hostname)).map(target=>({...target,success:false,stage:'dns',code:failures.get(new URL(target.url).hostname),durationMs:0,detail:'DNS: не удалось определить адрес сайта. Это не результат проверки стратегии.'})),
    lookupFor(url,attempt=0) {
      const hostname=new URL(url).hostname;
      const entries=addresses.get(hostname);
      if(!entries)throw new Error('DNS-адрес для проверки не подготовлен.');
      const selected=entries[attempt%entries.length];
      return (_hostname,options,callback)=>{
        if(typeof options==='function'){callback=options;options={};}
        if(options?.all)callback(null,[selected]);else callback(null,selected.address,selected.family);
      };
    }
  };
}
async function probeWithRetry(target,probe,{session,signal,timeoutMs=6500,retryDelayMs=350}={}) {
  const started=Date.now();let result;
  for(let attempt=0;attempt<2;attempt++){
    if(signal?.aborted)throw aborted();
    result=await probe(target.url,{signal,timeoutMs,lookup:session?.lookupFor(target.url,attempt)});
    if(signal?.aborted)throw aborted();
    if(result.success || !['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ENOTFOUND'].includes(result.code))break;
    if(attempt===0)await pause(retryDelayMs,signal);
  }
  return {...target,...result,durationMs:Date.now()-started};
}
module.exports={prepareProbeSession,probeWithRetry};
