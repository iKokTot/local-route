const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
function buildHost(){
  if(process.platform!=='win32')throw new Error('Windows compiler required for process host');
  const source=path.resolve(__dirname,'../native/ProcessHost.cs');
  const digest=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const directory=path.resolve(__dirname,'../artifacts/native',digest);fs.mkdirSync(directory,{recursive:true});
  const output=path.join(directory,'LocalRoute.ProcessHost.exe');
  if(!fs.existsSync(output)){
    const compiler=path.join(process.env.SystemRoot || 'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+output,source],{windowsHide:true,stdio:'pipe'});
  }
  return output;
}
if(require.main===module)console.log(buildHost());
module.exports={buildHost};
