const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createVlessProfile, createSingBoxConfig, vlessProbeTargets } = require('../src/core/vless');
const { runWithInput,spawnOwned } = require('../src/platform/windows');
const { spawn } = require('node:child_process');
const { Resolver } = require('node:dns').promises;
const http = require('node:http');
const { freePort } = require('../src/core/vless-check');
const { listenerReady } = require('../src/core/telegram-proxy');
const { terminateChild } = require('../src/platform/windows');
const uri = 'vless://11111111-1111-4111-8111-111111111111@server.example:443?security=tls';

test('direct DNS cannot recurse through Windows system DNS after TUN starts',()=>{
  for(const mode of ['exclude','all','selective']) {
    const config=createSingBoxConfig(uri,{mode,excludedDomains:['avito.ru']});
    const resolver=config.dns.servers.find(server=>server.tag==='local-dns');
    assert.equal(resolver.type,'https');
    assert.equal(resolver.detour,'direct');
    assert.equal(resolver.server,'1.1.1.1');
    assert.equal(config.route.default_domain_resolver,'local-dns');
    assert(!config.dns.servers.some(server=>server.type==='local'));
  }
});

test('recommended VPN exclusions default on but explicitly empty exclusions remain empty', () => {
  const profile = createVlessProfile({mode:'exclude'});
  assert(profile.excludedDomains.includes('avito.ru'));
  assert(profile.excludedDomains.includes('ozon.ru'));
  assert.deepEqual(profile.excludedApps, []);
  assert.deepEqual(profile.services, []);
  const config = createSingBoxConfig(uri, profile);
  assert.equal(config.route.final, 'vless-out');
  assert.equal(config.dns.final, 'vless-dns');
  assert(config.route.rules.some(rule => rule.domain_suffix?.includes('avito.ru')));
  assert.deepEqual(createVlessProfile({mode:'exclude',excludedDomains:[]}).excludedDomains,[]);
});

test('excluded sites retain DNS identity and direct connections resolve outside VPN', () => {
  const config = createSingBoxConfig(uri, {mode:'exclude',excludedDomains:['https://Avito.ru/item','*.avito.ru','ozon.ru','bad:443'],excludedApps:['chrome.exe','CHROME.EXE','not-an-app']},{dpiDomains:['youtube.com']});
  const domains = config.route.rules.find(rule => rule.domain_suffix);
  assert.equal(domains.outbound, 'direct');
  assert.deepEqual(domains.domain_suffix, ['youtube.com','avito.ru','ozon.ru']);
  assert.deepEqual(config.dns.rules[0].domain_suffix, domains.domain_suffix);
  assert.equal(config.dns.rules[0].server, 'excluded-dns');
  assert.deepEqual(config.dns.rules[0].query_type, ['A','AAAA']);
  assert.equal(config.dns.rules[1].server, 'local-dns');
  assert.equal(config.outbounds.find(rule=>rule.tag==='direct').domain_resolver,'local-dns');
  assert.equal(config.dns.rules.find(rule=>rule.process_name?.includes('CHROME.EXE')).server,'local-dns');
  assert.equal(config.route.rules.find(rule => rule.process_name?.includes('CHROME.EXE')).outbound, 'direct');
  assert.equal(config.route.final, 'vless-out');
  assert.equal(config.route.rules.find(rule => rule.ip_is_private).outbound, 'direct');
  assert.equal(config.route.rules.find(rule => rule.process_name?.includes('local-route-tg.exe')).outbound, 'direct');
});

test('synthetic exclusion addresses never change all-traffic mode or explicit empty exclusions',()=>{
  for(const profile of [{mode:'all'}, {mode:'exclude',excludedDomains:[]}]) {
    const config=createSingBoxConfig(uri,profile);
    assert(!config.dns.servers.some(server=>server.type==='fakeip'));
    assert.equal(config.route.final,'vless-out');
  }
  const config=createSingBoxConfig(uri,{mode:'exclude',excludedDomains:['avito.ru']},{ipv6:true});
  const pool=config.dns.servers.find(server=>server.type==='fakeip');
  assert.equal(pool.inet4_range,'198.19.0.0/16');
  assert(pool.inet6_range);
  assert(!config.inbounds[0].address.some(address=>address.startsWith('198.19.')));
  const cached=createSingBoxConfig(uri,{mode:'exclude',excludedDomains:['avito.ru']},{exclusionCachePath:'C:\\fixture\\vpn-exclusions.db'});
  assert.equal(cached.experimental.cache_file.store_fakeip,true);
  assert.equal(cached.experimental.cache_file.path,'C:\\fixture\\vpn-exclusions.db');
});

test('old selected sites are never inverted into bypass sites during migration', () => {
  const legacy = createVlessProfile({mode:'selective',services:['chatgpt'],customDomains:['example.org'],apps:['ChatGPT.exe']});
  assert.deepEqual(legacy.excludedDomains, []);
  assert.deepEqual(legacy.excludedApps, []);
  assert.equal(createSingBoxConfig(uri, legacy).route.final, 'direct');
  const migrated = createVlessProfile({...legacy,mode:'exclude'});
  assert.deepEqual(migrated.excludedDomains, []);
  assert.deepEqual(migrated.excludedApps, []);
  assert.equal(createSingBoxConfig(uri, migrated).route.final, 'vless-out');
});

test('exclusions persist across repeated profile normalization without becoming VPN targets', () => {
  const raw = {mode:'exclude',excludedDomains:['avito.ru'],excludedApps:['Avito.exe']};
  const profile = createVlessProfile(raw);
  assert.deepEqual(createVlessProfile(profile), profile);
  assert.deepEqual(vlessProbeTargets(profile).map(item => item.kind), ['server']);
  assert(!JSON.stringify(vlessProbeTargets(profile)).includes('avito'));
});

test('bundled sing-box accepts exclusion configurations for VLESS and Hysteria2 offline', {skip:process.platform!=='win32'}, async () => {
  const executable = path.resolve(__dirname,'../engine/sing-box/sing-box-1.14.2-windows-amd64/sing-box.exe');
  for(const input of [uri,'hy2://password@server.example:443?sni=server.example']) {
    const config = createSingBoxConfig(input,{mode:'exclude',excludedDomains:['avito.ru','ozon.ru'],excludedApps:['chrome.exe']},{ipv6:true,dpiDomains:['youtube.com']});
    const result = await runWithInput(executable,['check','-c','stdin'],{input:JSON.stringify(config)});
    assert(result.ok,result.output);
  }
});

test('real core restores excluded domain from DNS identity even when HTTP contains only an IP', {skip:process.platform!=='win32',timeout:15000}, async()=>{
  const target=http.createServer((_req,res)=>res.end('excluded-direct'));
  let engine;
  try {
    await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
    const port=await freePort();
    // TCP port availability does not imply UDP bind permission on Windows.
    const udp=require('node:dgram').createSocket('udp4');
    await new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(0,'127.0.0.1',resolve);});
    const dnsPort=udp.address().port;
    await new Promise(resolve=>udp.close(resolve));
    const config=createSingBoxConfig(uri,{mode:'exclude',excludedDomains:['avito.test']});
    config.log={level:'error'};
    config.inbounds=[{type:'http',tag:'fixture-http',listen:'127.0.0.1',listen_port:port},{type:'direct',tag:'fixture-dns',listen:'127.0.0.1',listen_port:dnsPort,network:'udp'}];
    // All resolution and HTTP stay on loopback. No TUN or real VPN is started.
    config.dns.servers[config.dns.servers.findIndex(s=>s.tag==='local-dns')]={type:'hosts',tag:'local-dns',predefined:{'avito.test':['127.0.0.1']}};
    config.route.rules=[{inbound:['fixture-dns'],action:'hijack-dns'},...config.route.rules.filter(rule=>rule.action==='sniff'||rule.domain_suffix),{action:'reject'}];
    const executable=path.resolve(__dirname,'../engine/sing-box/sing-box-1.14.2-windows-amd64/sing-box.exe');
    const checked=await runWithInput(executable,['check','-c','stdin'],{input:JSON.stringify(config)});
    assert(checked.ok,checked.output);
    require('../scripts/build-process-host').buildHost();
    engine=spawnOwned(executable,['run','-c','stdin'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let output='';engine.stderr.on('data',chunk=>{output+=chunk;});
    engine.stdin.on('error',()=>{});engine.stdin.end(JSON.stringify(config));
    for(let i=0;i<50 && !await listenerReady(port);i++)await new Promise(resolve=>setTimeout(resolve,40));
    assert(await listenerReady(port),output);
    const resolver=new Resolver({timeout:1500,tries:1});resolver.setServers([`127.0.0.1:${dnsPort}`]);
    const [address]=await resolver.resolve4('avito.test');
    assert.match(address,/^198\.19\./);
    await assert.rejects(resolver.resolve6('avito.test'),error=>error.code==='ENODATA');
    const response=await new Promise((resolve,reject)=>{
      const req=http.get({host:'127.0.0.1',port,path:`http://${address}:${target.address().port}/`,agent:false},res=>{
        let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body}));
      });req.on('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('Fixture timeout')));
    });
    assert.equal(response.body,'excluded-direct',JSON.stringify(response)+' '+output);
  } finally {
    await terminateChild(engine,{tree:false});
    await new Promise(resolve=>target.close(resolve));
  }
});
