// Isolated cold application start: no user settings, autostart or network engines.
const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const started=process.hrtime.bigint();
const elapsed=()=>Number(process.hrtime.bigint()-started)/1e6;
const target=process.argv[2];
if(!target)throw new Error('Pass an absolute main.js path');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'local-route-startup-'));
app.setPath('userData',profile);
let ready;
app.whenReady().then(()=>{ready=elapsed();});
app.once('browser-window-created',(_event,window)=>{
  window.once('ready-to-show',()=>{
    console.log(JSON.stringify({appReadyMs:Math.round(ready),firstWindowMs:Math.round(elapsed()),processFirstWindowMs:Math.round(process.uptime()*1000)}));
    // This profile starts no engines. Do not invoke the main app's recovery
    // shutdown, which could inspect processes belonging to the real session.
    app.exit(0);
  });
});
setTimeout(()=>app.exit(2),15000).unref();
require(path.resolve(target));
