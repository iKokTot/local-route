const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFileSync, execFile, spawn } = require('node:child_process');
const net = require('node:net');
const { listenerReady } = require('../src/core/telegram-proxy');
const { createSingBoxConfig, createVlessCheckConfig, vlessProbeTargets } = require('../src/core/vless');
const { responseResult, probeThroughProxy } = require('../src/core/vless-check');
const { runWithInput } = require('../src/platform/windows');
const uri = 'vless://11111111-1111-4111-8111-111111111111@server.example:443?security=tls&sni=server.example';

test('selective routing can identify domains and covers IPv4 and IPv6', () => {
  const config = createSingBoxConfig(uri, { services: ['chatgpt'], apps: ['ChatGPT.exe', 'codex.exe'] }, { ipv6: true });
  assert.equal(config.route.final, 'direct');
  assert.equal(config.dns.reverse_mapping, true);
  assert.equal(config.route.rules[0].action, 'sniff');
  assert(config.inbounds[0].address.some((address) => address.includes(':')));
  assert(config.inbounds[0].address.some((address) => address.includes('.')));
  const appRule = config.route.rules.find((rule) => rule.process_name?.includes('ChatGPT.exe'));
  assert.equal(appRule.outbound, 'vless-out');
  assert(appRule.process_name.includes('codex.exe'));
  assert(config.route.rules.findIndex((rule) => rule.ip_is_private) < config.route.rules.indexOf(appRule));
  assert(config.route.rules.some((rule) => rule.domain_suffix?.includes('chatgpt.com')));
  assert(!config.route.rules.some((rule) => rule.domain_suffix?.includes('tiktok.com')));
});
test('full routing keeps LAN and TGWs direct and sends remaining traffic through VLESS', () => {
  const config = createSingBoxConfig(uri, { mode: 'all', apps: ['ChatGPT.exe'] });
  assert.equal(config.route.final, 'vless-out');
  assert.equal(config.route.rules.find((rule) => rule.process_name?.includes('local-route-tg.exe')).outbound, 'direct');
  assert.equal(config.route.rules.find((rule) => rule.process_name?.includes('Local Route.exe')).outbound, 'direct');
  assert.equal(config.route.rules.find((rule) => rule.ip_is_private).outbound, 'direct');
  assert(!config.route.rules.some((rule) => rule.process_name?.includes('ChatGPT.exe')));
});

test('Reality, TLS fingerprints and ALPN are preserved and accepted through stdin offline', {skip:process.platform!=='win32'}, async()=>{
  const executable=path.resolve(__dirname,'../engine/sing-box/sing-box-1.14.2-windows-amd64/sing-box.exe');
  const reality=uri.replace('security=tls','security=reality')+'&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=0123456789abcdef&fp=chrome';
  for(const transport of ['', '&type=ws&path=%2Ftest&host=server.example','&type=grpc&serviceName=test','&type=httpupgrade&path=%2Ftest']){
    const config=createVlessCheckConfig(transport ? uri+transport+'&fp=firefox&alpn=h2%2Chttp%2F1.1':reality,23456);
    assert.equal(config.outbounds[0].tls.utls.enabled,true);
    if(transport)assert.deepEqual(config.outbounds[0].tls.alpn,['h2','http/1.1']);
    const result=await runWithInput(executable,['check','-c','stdin'],{input:JSON.stringify(config)});
    assert(result.ok,result.output);
  }
});
test('TUN does not advertise IPv6 unless the uplink supports it', () => {
  const config = createSingBoxConfig(uri, { services: ['chatgpt'] });
  assert.deepEqual(config.inbounds[0].address, ['198.18.0.1/30']);
  assert.equal(config.inbounds[0].strict_route, true);
});
test('probe targets include every selected service and custom domain, also with apps only', () => {
  const targets = vlessProbeTargets({ services: ['tiktok', 'instagram', 'x', 'chatgpt'], customDomains: ['example.org'] });
  assert.deepEqual(targets.map((target) => target.label), ['Соединение через сервер', 'TikTok', 'Instagram', 'X / Twitter', 'ChatGPT', 'example.org']);
  assert.equal(vlessProbeTargets({ services: [], apps: ['ChatGPT.exe'] }).length, 1);
  assert.equal(vlessProbeTargets({ mode: 'all', services: [] }).length, 5);
});
test('diagnostic configuration has only a loopback proxy and no direct fallback or TUN', () => {
  const config = createVlessCheckConfig(uri, 23456);
  assert.deepEqual(config.inbounds, [{ type: 'http', tag: 'diagnostics', listen: '127.0.0.1', listen_port: 23456 }]);
  assert.equal(config.outbounds.length, 1);
  assert.equal(config.outbounds[0].type, 'vless');
  assert.equal(config.route.final, 'vless-out');
  assert.throws(() => createVlessCheckConfig(uri, 80));
});
test('HTTP restrictions are distinct from success and network errors', () => {
  assert.equal(responseResult(200).success, true);
  assert.equal(responseResult(302).success, true);
  assert.equal(responseResult(403).success, false);
  assert.equal(responseResult(403).reachable, true);
  assert.equal(responseResult(403).level, 'warning');
  assert.equal(responseResult(429).level, 'warning');
  assert.equal(responseResult(503).level, 'fail');
});
test('HTTPS check uses CONNECT and never falls back to direct when the proxy refuses', async () => {
  const requests = [];
  const proxy = http.createServer();
  proxy.on('connect', (request, socket) => { requests.push(request.url); socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const result = await probeThroughProxy('https://example.invalid/', proxy.address().port, { timeoutMs: 500 });
    assert.equal(result.success, false); assert.equal(result.reachable, false);
    assert.deepEqual(requests, ['example.invalid:443']);
  } finally { await new Promise((resolve) => proxy.close(resolve)); }
});
test('a stalled proxy is bounded by the check timeout', async () => {
  const sockets = new Set();
  const proxy = http.createServer();
  proxy.on('connect', (_request, socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const result = await probeThroughProxy('https://example.invalid/', proxy.address().port, { timeoutMs: 70 });
    assert.equal(result.success, false); assert.match(result.detail, /Тайм-аут/);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => proxy.close(resolve)); }
});
test('bundled sing-box validates selective, full and diagnostic configurations offline', { skip: process.platform !== 'win32' }, () => {
  const executable = path.resolve(__dirname, '../engine/sing-box/sing-box-1.14.2-windows-amd64/sing-box.exe');
  assert(fs.existsSync(executable));
  const file = path.join(os.tmpdir(), `local-route-config-check-${process.pid}.json`);
  try {
    for (const config of [createSingBoxConfig(uri, { apps: ['ChatGPT.exe'] }), createSingBoxConfig(uri, { mode: 'all' }), createSingBoxConfig(uri, {}, { ipv6: true }), createSingBoxConfig(uri,{mode:'exclude'},{diagnosticPort:34567}), createVlessCheckConfig(uri, 23456)]) {
      fs.writeFileSync(file, JSON.stringify(config));
      execFileSync(executable, ['check', '-c', file], { windowsHide: true, timeout: 7000, stdio: 'pipe' });
    }
  } finally { fs.unlinkSync(file); }
});
test('Windows process rules distinguish a selected executable from an unselected one', { skip: process.platform !== 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-route-process-test-'));
  const selected = path.join(directory, 'local-route-selected.exe');
  const helper = path.join(directory, 'request.cjs');
  const configFile = path.join(directory, 'config.json');
  const executable = path.resolve(__dirname, '../engine/sing-box/sing-box-1.14.2-windows-amd64/sing-box.exe');
  let served = 0;
  const target = http.createServer((_request, response) => { served++; response.writeHead(200); response.end('local fixture'); });
  let engine;
  try {
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    const allocator = net.createServer();
    await new Promise((resolve) => allocator.listen(0, '127.0.0.1', resolve));
    const proxyPort = allocator.address().port;
    await new Promise((resolve) => allocator.close(resolve));
    // Copying Node gives this one fixture process a distinct executable name.
    // Both clients only request the local fixture server, never the internet.
    fs.copyFileSync(process.execPath, selected);
    fs.writeFileSync(helper, `const http=require('node:http');const request=http.get({host:'127.0.0.1',port:Number(process.argv[2]),path:'http://127.0.0.1:'+process.argv[3]+'/',agent:false},response=>{response.resume();console.log(JSON.stringify({status:response.statusCode}));});request.on('error',()=>console.log(JSON.stringify({status:null})));request.setTimeout(2500,()=>request.destroy());`);
    const fixtureConfig = {
      log: { level: 'error' },
      inbounds: [{ type: 'http', tag: 'fixture', listen: '127.0.0.1', listen_port: proxyPort }],
      outbounds: [{ type: 'direct', tag: 'selected-only' }],
      route: { rules: [{ process_name: ['local-route-selected.exe'], outbound: 'selected-only' }, { action: 'reject' }] }
    };
    engine = spawn(executable, ['run', '-c', 'stdin'], { windowsHide: true, stdio: ['pipe','ignore','ignore'] });
    engine.stdin.on('error',()=>{});engine.stdin.end(JSON.stringify(fixtureConfig));
    let engineError;
    engine.once('error', (error) => { engineError = error; });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (engineError || engine.exitCode !== null) throw engineError || new Error('Fixture engine exited');
      if (await listenerReady(proxyPort)) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(ready);
    const request = (client) => new Promise((resolve, reject) => execFile(client, [helper, String(proxyPort), String(target.address().port)], { windowsHide: true, timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
    assert.equal((await request(selected)).status, 200);
    assert.notEqual((await request(process.execPath)).status, 200);
    assert.equal(served, 1);
    assert.equal(fs.existsSync(configFile),false,'The engine config was never written to disk');
  } finally {
    if (engine && engine.exitCode === null) {
      engine.kill();
      await new Promise((resolve) => { const timer = setTimeout(resolve, 1500); engine.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    await new Promise((resolve) => target.close(resolve));
    for (const file of [selected, helper, configFile]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
});
