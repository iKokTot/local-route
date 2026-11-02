const path=require('node:path');
const {build,Platform,Arch}=require('electron-builder');
const version=require('../package.json').version;
const staged=path.resolve(__dirname,'../outputs/Local Route '+version);
require('./engine-integrity').verifyEngines(path.join(staged,'resources/app/engine'),require('../src/config/engine-lock.json'));
const fs=require('node:fs');const crypto=require('node:crypto');
const info=JSON.parse(fs.readFileSync(path.join(staged,'build-info.json'),'utf8'));
const hostHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(staged,'resources/app/native/LocalRoute.ProcessHost.exe'))).digest('hex');
if(hostHash!==info.processHostSha256)throw new Error('Staged process host differs from build-info');
build({targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),prepackaged:staged,publish:'never',
  config:{...require('../electron-builder.json'),directories:{output:'outputs/installer-'+version}}
}).catch(error=>{console.error(error);process.exitCode=1;});
