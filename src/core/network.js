const { execFile } = require('node:child_process');

function nativeIpv6Available(snapshot) {
  const index = Number(snapshot?.ipv4InterfaceIndex);
  if (!Number.isInteger(index) || index <= 0) return false;
  if (!Array.isArray(snapshot.ipv6DefaultInterfaces) || !snapshot.ipv6DefaultInterfaces.some((value) => Number(value) === index)) return false;
  return Array.isArray(snapshot.ipv6Addresses) && snapshot.ipv6Addresses.some((entry) => Number(entry.interfaceIndex) === index && /^[23][0-9a-f]*:/i.test(entry.address || '') && !/^2001:0{0,4}:/i.test(entry.address) && !/^2002:/i.test(entry.address));
}
// Check the IPv4 uplink before starting TUN. Teredo or a different virtual
// adapter must not make a Wi-Fi connection look capable of native IPv6.
async function queryVlessNetwork({ signal } = {}) {
  if (process.platform !== 'win32') return { ipv6: false };
  const script = "$ErrorActionPreference='Stop';$uplink=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0'|Where-Object {$_.InterfaceAlias -ne 'LocalRouteVless'}|Sort-Object RouteMetric|Select-Object -First 1;$routes=@(Get-NetRoute -AddressFamily IPv6 -DestinationPrefix '::/0' -ErrorAction SilentlyContinue|ForEach-Object {$_.InterfaceIndex});$addresses=@(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue|Where-Object {$_.AddressState -eq 'Preferred'}|ForEach-Object {@{interfaceIndex=$_.InterfaceIndex;address=$_.IPAddress}});@{ipv4InterfaceIndex=$uplink.InterfaceIndex;ipv6DefaultInterfaces=$routes;ipv6Addresses=$addresses}|ConvertTo-Json -Depth 4 -Compress";
  try {
    const snapshot = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 7000, maxBuffer: 32768, signal }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    }));
    return { ipv6: nativeIpv6Available(snapshot) };
  } catch(error) { if(signal?.aborted)throw error;return { ipv6: false, detected:false }; }
}
function createNetworkDetector({query=queryVlessNetwork,key=()=>JSON.stringify(Object.entries(require('node:os').networkInterfaces()).filter(([name])=>name!=='LocalRouteVless')),now=Date.now,maxAgeMs=5000}={}) {
  let cache;
  let pending;
  return async function detect(options={}) {
    options.signal?.throwIfAborted();
    const fingerprint=key();
    if(!options.force && cache?.key===fingerprint && now()-cache.at<maxAgeMs)return {...cache.value};
    // Share only an uncancellable warm-up; each foreground caller can still
    // cancel its own wait without aborting another component's preparation.
    if (!options.force && pending?.key===fingerprint) {
      const value=await waitForNetwork(pending.promise,options.signal);
      options.signal?.throwIfAborted();
      if(key()!==fingerprint)return detect(options);
      return {...value};
    }
    const request=query(options);
    const entry=!options.signal ? {key:fingerprint,promise:request} : null;
    if(entry)pending=entry;
    let value;
    try { value=await request; } finally {if(entry && pending===entry)pending=undefined;}
    options.signal?.throwIfAborted();
    if(value.detected!==false && key()===fingerprint)cache={key:fingerprint,at:now(),value};
    return {...value};
  };
}
function waitForNetwork(promise,signal) {
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason || new Error('Проверка отменена'));};
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
const detectVlessNetwork=createNetworkDetector();
module.exports = { nativeIpv6Available, detectVlessNetwork,createNetworkDetector };
