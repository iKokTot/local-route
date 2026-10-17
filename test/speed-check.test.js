const {test}=require('node:test');
const assert=require('node:assert/strict');
const {downloadResult,probeThroughProxy}=require('../src/core/vless-check');

test('speed includes connection setup and uses decimal megabits, not megabytes',()=>{
  const result=downloadResult(10000000,10000000,4000,2000);
  assert.equal(result.mbps,20);
  assert.equal(result.bodyMs,2000);
  assert.equal(result.success,true);
});
test('truncated downloads never report a successful speed',()=>{
  assert.equal(downloadResult(5000000,10000000,1000,900).success,false);
  assert.equal(downloadResult(0,10000000,1000,900).success,false);
  assert.equal(downloadResult(10000001,10000000,1000,900).success,false);
});
test('cancelled speed probes do not open a connection',async()=>{
  const controller=new AbortController();controller.abort();
  const result=await probeThroughProxy('https://speed.cloudflare.com/__down?bytes=10000000',1,{signal:controller.signal,downloadBytes:10000000});
  assert.equal(result.success,false);
  assert.match(result.detail,/отменена/);
});
