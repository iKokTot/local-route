const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {engineManifest,verifyEngines,COMPONENTS}=require('../scripts/engine-integrity');
test('engine manifest detects changed, added and missing files, independent of enumeration order',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-engine-fixture-'));
  try {
    for(const name of COMPONENTS)fs.mkdirSync(path.join(root,name),{recursive:true});
    const file=path.join(root,'bin','fixture.dll');fs.writeFileSync(file,'original');
    const expected=engineManifest(root);assert.deepEqual(verifyEngines(root,expected),expected);
    fs.writeFileSync(file,'changed');assert.throws(()=>verifyEngines(root,expected),/Engine differs/);
    fs.writeFileSync(file,'original');const extra=path.join(root,'bin','extra.exe');fs.writeFileSync(extra,'extra');
    assert.throws(()=>verifyEngines(root,expected),/Engine differs/);fs.unlinkSync(extra);
    fs.unlinkSync(file);assert.throws(()=>verifyEngines(root,expected),/Engine differs/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
