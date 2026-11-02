const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createVpnHealth}=require('../src/core/vpn-health');
const {dpiResponse}=require('../src/core/dpi-response');
function fixture(check){let callback,time=0,delay;const monitor=createVpnHealth({check,now:()=>time,schedule:(fn,ms)=>{callback=fn;delay=ms;return 1;},unschedule:()=>{callback=null;}});return {monitor,run:async()=>{callback();await new Promise(setImmediate);},delay:()=>delay,advance:ms=>{time+=ms;}};}
test('health does not confuse port readiness with external reachability; checks expire',async()=>{
  const f=fixture(async()=>({success:true,durationMs:12,detail:'HTTP 200'}));
  f.monitor.start(1234);assert.equal(f.monitor.snapshot().status,'unchecked');
  await f.run();assert.equal(f.monitor.snapshot().status,'healthy');assert.equal(f.delay(),30000);
  f.advance(91000);assert.equal(f.monitor.snapshot().status,'stale');
  f.monitor.invalidate();assert.equal(f.monitor.snapshot().status,'unchecked');
  f.monitor.stop();assert.equal(f.monitor.snapshot().status,'off');
});
test('failed health checks back off, success resets retry rate',async()=>{
  let ok=false;const f=fixture(async()=>({success:ok,detail:'timeout'}));f.monitor.start(1);
  await f.run();assert.equal(f.monitor.snapshot().status,'degraded');assert.equal(f.delay(),15000);
  await f.run();assert.equal(f.delay(),30000);ok=true;await f.run();assert.equal(f.monitor.snapshot().failures,0);
});
test('late health results cannot revive a stopped or replaced VPN',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));f.monitor.start(1);await f.run();
  f.monitor.stop();resolve({success:true});await new Promise(setImmediate);assert.equal(f.monitor.snapshot().status,'off');
});
test('DPI endpoints use explicit status expectations; captcha/rate limits are not successful profiles',()=>{
  assert(dpiResponse('https://www.youtube.com/generate_204',204).success);
  assert(!dpiResponse('https://www.youtube.com/generate_204',200).success);
  assert(!dpiResponse('https://discord.com/api/v10/gateway',429).success);
  assert(!dpiResponse('https://discord.com/api/v10/gateway',403).success);
  assert(dpiResponse('https://cdn.discordapp.com/',403).success);
  assert(dpiResponse('https://gateway.discord.gg/?v=10',404).success);
});
