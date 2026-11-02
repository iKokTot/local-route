const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const COMPONENTS=['bin','sing-box/sing-box-1.14.2-windows-amd64','tg-ws'];
function componentDigest(root,component){
  const entries=[];let bytes=0;
  function walk(relative){
    for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const name=path.join(relative,entry.name);const file=path.join(root,name);
      if(entry.isSymbolicLink())throw new Error('Engine symlink forbidden: '+name);
      if(entry.isDirectory())walk(name);
      else if(entry.isFile()){
        const body=fs.readFileSync(file);bytes+=body.length;
        entries.push(name.replaceAll('\\','/')+'\0'+crypto.createHash('sha256').update(body).digest('hex'));
      } else throw new Error('Unsupported engine file: '+name);
    }
  }
  walk(component);
  return {sha256:crypto.createHash('sha256').update(entries.join('\n')).digest('hex'),files:entries.length,bytes};
}
function engineManifest(root){return {format:1,components:Object.fromEntries(COMPONENTS.map(name=>[name,componentDigest(root,name)]))};}
function verifyEngines(root,expected){
  const actual=engineManifest(root);
  for(const component of COMPONENTS)if(JSON.stringify(actual.components[component])!==JSON.stringify(expected.components?.[component]))throw new Error('Engine differs from reviewed manifest: '+component);
  return actual;
}
if(require.main===module)console.log(JSON.stringify(engineManifest(path.resolve(__dirname,'../engine')),null,2));
module.exports={engineManifest,verifyEngines,COMPONENTS};
