const { execFile, spawn } = require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');

function processHostPath(){
  const root=path.resolve(__dirname,'../..');
  const bundled=path.join(root,'native','LocalRoute.ProcessHost.exe');
  if(fs.existsSync(bundled))return bundled;
  const source=path.join(root,'native','ProcessHost.cs');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  return path.join(root,'artifacts/native',hash,'LocalRoute.ProcessHost.exe');
}
function spawnOwned(executable,args,options={}){
  if(process.platform!=='win32')return spawn(executable,args,options);
  const child=spawn(processHostPath(),[String(process.pid),executable,...args],{...options,windowsHide:true});
  child.supervised=true;
  let header='';
  const metadata=chunk=>{
    header=(header+String(chunk)).slice(0,1024);
    const match=/LR_SUPERVISOR_CHILD=(\d+)\r?\n/.exec(header);
    if(match){child.managedPid=Number(match[1]);child.stderr.off('data',metadata);}
  };
  child.stderr?.on('data',metadata);
  return child;
}

function runWithInput(executable, args, { input = '', timeoutMs = 7000, signal } = {}) {
  return new Promise((resolve) => {
    let output = ''; let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, output }); } };
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal });
    const timer = setTimeout(() => { child.kill(); finish(false); }, timeoutMs);
    const collect = (chunk) => { output = (output + String(chunk)).slice(-65536); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', () => finish(false));
    child.once('close', (code) => finish(code === 0));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function runCommand(executable, args, { timeoutMs = 7000, signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024, signal }, (error, stdout, stderr) => {
      if (error) { error.output = stderr; reject(error); }
      else resolve(stdout);
    });
  });
}
const stoppingChildren = new WeakMap();
function terminateChild(child, options = {}) {
  if (!child) return Promise.resolve();
  if (stoppingChildren.has(child)) return stoppingChildren.get(child);
  const stopping = stopChild(child,options).then(()=>waitForOwnedExit(child)).finally(() => stoppingChildren.delete(child));
  stoppingChildren.set(child, stopping);
  return stopping;
}
async function waitForOwnedExit(child){
  if(!child.supervised || !child.managedPid)return;
  const deadline=Date.now()+5000;
  while(true){
    try {process.kill(child.managedPid,0);}catch(error){if(error.code==='ESRCH')return;throw error;}
    if(Date.now()>=deadline)throw new Error('Сетевое ядро ещё не завершилось. Повторите остановку.');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
async function stopChild(child, {tree=true}={}) {
  if (!child || child.exitCode !== null || child.signalCode != null) return;
  if (process.platform === 'win32' && child.pid && tree) {
    try { await runCommand('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeoutMs: 5000 }); }
    catch { if (child.exitCode === null) child.kill(); }
  } else child.kill();
  if (child.exitCode !== null || child.signalCode != null) return;
  await new Promise((resolve, reject) => {
    const onExit = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { child.off('exit', onExit); reject(new Error('Процесс не подтвердил остановку. Повторите остановку.')); }, 5000);
    child.once('exit', onExit);
  });
}
async function inspectNetworkConflicts() {
  if (process.platform !== 'win32') return { proxyEnabled: false, tunnelNames: [] };
  const script = "$ErrorActionPreference='Stop';$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';$a=@(Get-NetAdapter -ErrorAction SilentlyContinue|Where-Object {$_.Status -eq 'Up' -and $_.Name -ne 'LocalRouteVless' -and ($_.Name+' '+$_.InterfaceDescription) -match 'tun|wireguard|warp|vpn|incy|hiddify|happ'}|ForEach-Object {$_.Name});@{proxyEnabled=([bool]$p.ProxyEnable);tunnelNames=$a}|ConvertTo-Json -Compress";
  try { return JSON.parse(await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])); }
  catch { return { proxyEnabled: false, tunnelNames: [], unavailable: true }; }
}
module.exports = { runCommand, runWithInput, terminateChild, inspectNetworkConflicts,spawnOwned,processHostPath };
