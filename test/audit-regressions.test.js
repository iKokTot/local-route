const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createNetworkDetector}=require('../src/core/network');
const {waitForListener}=require('../src/core/runtime-readiness');
const {parseProxyInput,createSingBoxConfig}=require('../src/core/vless');
const {parseSubscription}=require('../src/core/subscriptions');
const {addSubscription,reconcileSelectedServer}=require('../src/core/server-library');
const {createLineSink}=require('../src/core/log-lines');
const uri='vless://11111111-1111-4111-8111-111111111111@old.example:443?security=tls#Server';

test('subscription refresh updates a uniquely matched server and clears removed or ambiguous selection',()=>{
  const before=addSubscription({},parseSubscription(uri),'https://provider.example/sub');
  const updated=uri.replace('old.example','new.example');
  const after=addSubscription(before,parseSubscription(updated),'https://provider.example/sub');
  assert.deepEqual(reconcileSelectedServer(before,after,uri),{uri:updated,changed:true,removed:false});
  const ambiguous=addSubscription(before,parseSubscription(updated+'\n'+updated.replace('new.example','other.example')),'https://provider.example/sub');
  assert.equal(reconcileSelectedServer(before,ambiguous,uri).removed,true);
  assert.equal(reconcileSelectedServer(before,{},uri).removed,true);
  assert.equal(reconcileSelectedServer({},after,uri).uri,uri,'Independent manual profile must not be replaced');
});

test('JSON imports preserve ALPN and disabled TLS/uTLS flags without importing local paths',()=>{
  const raw={type:'vless',server:'test.example',server_port:443,uuid:'dummy',tls:{enabled:true,server_name:'test.example',alpn:['h2','http/1.1'],utls:{enabled:false,fingerprint:'chrome'},certificate_path:'C:/private'}};
  const result=parseProxyInput(JSON.stringify(raw));
  assert.deepEqual(result.tls.alpn,raw.tls.alpn);assert.equal(result.tls.utls.enabled,false);assert.equal(result.tls.certificate_path,undefined);
  raw.tls.enabled=false;assert.equal(parseProxyInput(JSON.stringify(raw)).tls.enabled,false);
});

test('Hysteria2 password fragments, obfuscation and supported URI schemes are redacted across chunks',()=>{
  const lines=[];const sink=createLineSink(line=>lines.push(line),['password-fragment','obfs-fragment']);
  sink(Buffer.from('password=password-'));sink(Buffer.from('fragment obfs=obfs-fragment\nhy2://other-secret@test.example:443\n'));sink.end();
  assert(!lines.join('').includes('password-fragment'));assert(!lines.join('').includes('obfs-fragment'));assert(!lines.join('').includes('other-secret'));
});

test('network detection caches successful checks briefly and invalidates on interface change, timeout and force',async()=>{
  let calls=0,time=0,key='wifi';
  const detect=createNetworkDetector({query:async()=>{calls++;return {ipv6:true};},key:()=>key,now:()=>time,maxAgeMs:5000});
  await detect();await detect();assert.equal(calls,1);
  key='ethernet';await detect();assert.equal(calls,2);
  time=6000;await detect();assert.equal(calls,3);
  await detect({force:true});assert.equal(calls,4);
  const controller=new AbortController();controller.abort();await assert.rejects(detect({signal:controller.signal}));assert.equal(calls,4);
});

test('failed network discovery is never cached as authoritative',async()=>{
  let calls=0;const detect=createNetworkDetector({query:async()=>{calls++;return {ipv6:false,detected:false};},key:()=>''});
  await detect();await detect();assert.equal(calls,2);
});

test('network warm-up is shared and a cancelled waiter does not cancel the preparation',async()=>{
  let calls=0,release;
  const detect=createNetworkDetector({query:()=>{calls++;return new Promise(resolve=>release=resolve);},key:()=> 'wifi'});
  const warm=detect();
  const controller=new AbortController();
  const cancelled=detect({signal:controller.signal});
  controller.abort();await assert.rejects(cancelled);
  const foreground=detect();
  release({ipv6:true});
  assert.equal((await warm).ipv6,true);assert.equal((await foreground).ipv6,true);
  await detect();assert.equal(calls,1);
});

test('VPN startup readiness uses an actual local listener rather than a fixed sleep',async()=>{
  let probes=0;const start=Date.now();
  await waitForListener({exitCode:null,killed:false},12345,{probe:async()=>{probes++;return true;}});
  assert.equal(probes,1);assert(Date.now()-start<500);
  await assert.rejects(waitForListener({exitCode:1,killed:false},12345),/завершился/);
  const controller=new AbortController();controller.abort();await assert.rejects(waitForListener({exitCode:null,killed:false},12345,{signal:controller.signal}));
});

test('running VPN health traffic cannot take the application direct-route exception',()=>{
  const config=createSingBoxConfig(uri,{mode:'exclude'},{diagnosticPort:34567});
  const health=config.inbounds.find(item=>item.tag==='local-route-health');
  assert.equal(health.listen,'127.0.0.1');assert.equal(health.listen_port,34567);
  const healthRule=config.route.rules.findIndex(item=>item.inbound?.includes('local-route-health'));
  const directApp=config.route.rules.findIndex(item=>item.process_name?.includes('Local Route.exe'));
  assert(healthRule>=0 && healthRule<directApp);assert.equal(config.route.rules[healthRule].outbound,'vless-out');
});
