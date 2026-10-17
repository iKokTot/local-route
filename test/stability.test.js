const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createStateStore}=require('../src/core/state-store');
const {createOperationCoordinator,checkOperation}=require('../src/core/operations');
const {createProfile}=require('../src/core/profile');
const {diagnosticReport}=require('../src/core/diagnostic-report');
const {createLineSink}=require('../src/core/log-lines');

function temporaryStore(t,io=fs){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'local-route-store-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'settings.json');
  const store=createStateStore({file,defaults:{value:0},normalize:raw=>({...raw}),io});
  return {store,file,directory};
}
test('manual domains survive save/read normalization even when present in another service catalog',()=>{
  const first=createProfile({services:['discord'],customDomains:['googlevideo.com','example.org']});
  assert.deepEqual(createProfile(first),first);
  assert(first.customDomains.includes('googlevideo.com'));
});
test('settings use atomic replacements and recover last valid generation with a visible warning',t=>{
  const {store,file,directory}=temporaryStore(t);
  store.write({value:1,active:true,vlessActive:true}); store.write({value:2});
  fs.writeFileSync(file,'{broken');
  assert.equal(store.read().value,1);
  assert.match(store.warning,/копия/);
  store.write({...store.read(),value:3});
  assert.equal(store.read().value,3);
  assert(!fs.readFileSync(file,'utf8').includes('vlessActive'));
  assert.deepEqual(fs.readdirSync(directory).sort(),['settings.json','settings.json.bak']);
});
test('unrecoverable corruption is preserved and cannot be silently overwritten',t=>{
  const {store,file}=temporaryStore(t);
  fs.writeFileSync(file,'{original broken data');
  assert.throws(()=>store.read(),/автоматический сброс отключён/);
  assert.throws(()=>store.write({value:1}),/запрещено/);
  assert.equal(fs.readFileSync(file,'utf8'),'{original broken data');
});

test('a newer settings schema is preserved instead of replaced by an older backup',t=>{
  const {store,file}=temporaryStore(t);store.write({value:1});
  fs.writeFileSync(file,JSON.stringify({schemaVersion:2,value:99}));
  assert.throws(()=>store.read(),/Версия настроек/);
  assert.equal(JSON.parse(fs.readFileSync(file)).value,99);
});
test('failed final rename preserves the original settings and removes temporary files',t=>{
  let fail=false;
  const io=Object.create(fs);
  io.renameSync=(source,target)=>{if(fail&&target.endsWith('settings.json'))throw Object.assign(new Error('simulated disk error'),{code:'EIO'});fs.renameSync(source,target);};
  const {store,file,directory}=temporaryStore(t,io);
  store.write({value:1});fail=true;
  assert.throws(()=>store.write({value:2}),/disk error/);
  assert.equal(JSON.parse(fs.readFileSync(file)).value,1);
  assert(!fs.readdirSync(directory).some(name=>name.endsWith('.tmp')));
});
test('explicit secret deletion rewrites the backup without retaining the removed key',t=>{
  const {store,file}=temporaryStore(t);
  store.write({value:1,vlessSecret:'encrypted-test'});
  store.write({value:2},{rewriteBackup:true});
  for(const target of [file,file+'.bak'])assert(!fs.readFileSync(target,'utf8').includes('encrypted-test'));
});
test('operations keep the lock during cancellation until the owner has completed cleanup',async()=>{
  const operations=createOperationCoordinator();
  const first=operations.begin('start');
  assert.equal(operations.begin('parallel'),null);
  operations.cancel();
  assert.throws(()=>checkOperation(first),/остановлена/);
  assert.equal(first.signal.aborted,true);
  assert.equal(operations.begin('too-early'),null);
  operations.finish(first);await first.done;
  const next=operations.begin('next');
  operations.finish(first);
  assert.equal(operations.current,next);
  operations.finish(next);
});
test('diagnostic exports contain only allowlisted aggregates, never raw secrets, domains or paths',()=>{
  const secret='DO-NOT-EXPORT';
  const report=diagnosticReport({vlessSecret:secret,telegramSecret:secret,logs:[secret],profile:{domains:[secret]},vless:{uri:secret,domains:[secret],apps:[secret]},telegramError:secret},{version:'0.15.2',network:{tunnelNames:[secret]}});
  assert(!JSON.stringify(report).includes(secret));
  assert.equal(report.vless.appCount,1);
});

test('process output redacts secrets even when UTF-8 text and secret cross stream chunks',()=>{
  const lines=[];const secret='synthetic-secret-value';const sink=createLineSink(line=>lines.push(line),[secret]);
  const data=Buffer.from('Готов: '+secret+'\ntg://proxy?secret='+secret+'\n');
  for(let index=0;index<data.length;index+=3)sink(data.subarray(index,index+3));
  sink.end();
  assert.equal(lines.length,2);
  assert.match(lines[0],/^Готов:/);
  assert(!lines.join('\n').includes(secret));
  assert(!lines.join('\n').includes('tg://'));
});
