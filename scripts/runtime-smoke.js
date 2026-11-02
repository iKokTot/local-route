const { _electron }=require('playwright');const path=require('node:path');
(async()=>{
  let instance,fixturePid,facts;
  try {
    if(process.platform==='win32')require('./build-process-host').buildHost();
    instance=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'smoke-host.js')],timeout:20000});
    const page=await instance.firstWindow();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(version=>document.querySelector('#app-version')?.textContent===version,require('../package.json').version);
    await page.locator('[data-page="routes"]').first().click();
    facts=await instance.evaluate(({app,BrowserWindow,safeStorage})=>{
      const prefs=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      const secret='isolated-smoke-only';
      return {version:app.getVersion(),electron:process.versions.electron,sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,
        encryptionRoundTrip:safeStorage.isEncryptionAvailable() && safeStorage.decryptString(safeStorage.encryptString(secret))===secret};
    });
    if(!facts.sandbox || !facts.contextIsolation || !facts.encryptionRoundTrip || errors.length)throw new Error(JSON.stringify({facts,errors}));
    if(process.platform==='win32')fixturePid=await instance.evaluate(async(_electron,options)=>{
      const spawnOwned=globalThis.__smokeSpawnOwned;
      return new Promise((resolve,reject)=>{
        const child=spawnOwned(options.node,['-e','console.log(process.pid);setInterval(()=>{},1000);'],{stdio:['ignore','pipe','pipe']});
        const timer=setTimeout(()=>{child.kill();reject(Error('Fixture startup timeout'));},5000);
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        let text='';child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(Number(text.trim()));}});
      });
    },{module:path.resolve(__dirname,'../src/platform/windows.js'),node:process.execPath});
    facts.rendererErrors=errors;
  } finally {
    // Never invoke main's recovery shutdown: the real app may be running.
    if(instance)await instance.evaluate(({app})=>app.exit(0)).catch(()=>{});
  }
  if(fixturePid){
    let gone=false;
    for(let i=0;i<100;i++){
      try{process.kill(fixturePid,0);}catch(error){if(error.code==='ESRCH'){gone=true;break;}throw error;}
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    if(!gone)throw new Error('Owned fixture survived isolated Electron exit');
    facts.ownedFixtureExited=true;
  }
  console.log(JSON.stringify({ok:true,...facts,appVersion:require('../package.json').version}));
})().catch(error=>{console.error(error);process.exitCode=1;});
