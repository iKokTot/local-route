const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepareProbeSession,probeWithRetry}=require('../src/core/dpi-check');
const target={service:'youtube',label:'YouTube',url:'https://www.youtube.com/generate_204'};
const addresses=[{address:'192.0.2.1',family:4},{address:'192.0.2.2',family:4}];
function chosen(lookup){return new Promise((resolve,reject)=>lookup('www.youtube.com',{all:true},(error,entries)=>error?reject(error):resolve(entries[0].address)));}
test('one transient DNS failure is retried and resolved addresses are reused for the whole selection',async()=>{
  let calls=0;
  const session=await prepareProbeSession([target],{retryDelayMs:0,lookup:async()=>{if(++calls===1)throw Object.assign(new Error('temporary'),{code:'ENOTFOUND'});return addresses;}});
  assert.deepEqual(session.errors,[]);
  assert.equal(await chosen(session.lookupFor(target.url,0)),'192.0.2.1');
  assert.equal(await chosen(session.lookupFor(target.url,1)),'192.0.2.2');
  assert.equal(calls,2);
});
test('persistent DNS failure is classified before any strategy is tested',async()=>{
  const session=await prepareProbeSession([target],{retryDelayMs:0,lookup:async()=>{throw Object.assign(new Error('missing'),{code:'ENOTFOUND'});}});
  assert.equal(session.errors[0].stage,'dns');assert.equal(session.errors[0].code,'ENOTFOUND');
});
test('a reset after kernel startup gets a fresh connection and another resolved address',async()=>{
  const session=await prepareProbeSession([target],{lookup:async()=>addresses});const used=[];
  const result=await probeWithRetry(target,async(url,options)=>{
    assert.equal(url,target.url,'Keep hostname for SNI and certificate verification');
    used.push(await chosen(options.lookup));
    return used.length===1?{success:false,code:'ECONNRESET',detail:'reset'}:{success:true,detail:'HTTP 204'};
  },{session,retryDelayMs:0});
  assert.equal(result.success,true);assert.deepEqual(used,['192.0.2.1','192.0.2.2']);
});
test('two resets remain a failure and a certificate error is never retried as success',async()=>{
  let calls=0;
  const result=await probeWithRetry(target,async()=>{calls++;return {success:false,code:'ECONNRESET'};},{retryDelayMs:0});
  assert.equal(result.success,false);assert.equal(calls,2);
  calls=0;
  await probeWithRetry(target,async()=>{calls++;return {success:false,code:'CERT_HAS_EXPIRED'};},{retryDelayMs:0});
  assert.equal(calls,1);
});
test('DNS deadlines and user cancellation bound a stalled resolver',async()=>{
  const result=await prepareProbeSession([target],{lookup:()=>new Promise(()=>{}),timeoutMs:10,retryDelayMs:0});
  assert.equal(result.errors[0].code,'ETIMEDOUT');
  const controller=new AbortController();
  const pending=prepareProbeSession([target],{signal:controller.signal,lookup:()=>new Promise(()=>{})});
  controller.abort();await assert.rejects(pending,{code:'ABORT_ERR'});
});
