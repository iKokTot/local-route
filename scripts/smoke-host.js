const {app}=require('electron');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'local-route-runtime-smoke-')));
globalThis.__smokeSpawnOwned=require('../src/platform/windows').spawnOwned;
setTimeout(()=>app.exit(2),25000).unref();
require('../src/main');
