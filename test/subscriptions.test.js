const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { parseSubscription, downloadSubscription } = require('../src/core/subscriptions');
const { createSingBoxConfig } = require('../src/core/vless');
const link = 'vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls#Test';
test('Список и Base64 дают одинаковые серверы VLESS и Hysteria2', () => {
  const text = link + '\n' + link + '\nhysteria2://secret@example.com:443';
  const parsed = parseSubscription(text);
  assert.equal(parsed.profiles.length, 2);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parseSubscription(Buffer.from(text).toString('base64url')), parsed);
  assert.throws(() => parseSubscription('x'.repeat(512001)));
  assert.throws(() => parseSubscription('<html>ошибка</html>'));
});
function requestMock(body, statusCode = 200) {
  return (_url, _options, receive) => {
    const req = new EventEmitter(); req.destroy = () => {};
    queueMicrotask(() => { const response = new PassThrough(); response.statusCode = statusCode; receive(response); response.end(body); });
    return req;
  };
}
test('HTTPS-загрузка ограничена размером; редиректы и незашифрованные адреса отклоняются', async () => {
  const address = 'https://example.com/private-token';
  assert.equal(await downloadSubscription(address, {request:requestMock(link)}), link);
  await assert.rejects(downloadSubscription(address, {request:requestMock('x'.repeat(2*1024*1024+1))}), /большой/);
  await assert.rejects(downloadSubscription(address, {request:requestMock('',302)}), error => !error.message.includes('private-token'));
  assert.throws(() => downloadSubscription('http://example.com'), /HTTPS/);
  assert.throws(() => downloadSubscription('https://user:secret@example.com'), /HTTPS/);
});
test('Отмена и общий таймаут завершают зависшую загрузку', async () => {
  const pending = () => Object.assign(new EventEmitter(),{destroy(){}});
  const controller = new AbortController();
  const promise = downloadSubscription('https://example.com', {request:pending,signal:controller.signal});
  controller.abort();
  await assert.rejects(promise, {code:'ABORT_ERR'});
  await assert.rejects(downloadSubscription('https://example.com', {request:pending,timeoutMs:5}), /вовремя/);
});

test('HTTPS redirects stay on the original origin and share the timeout; 2MB limit matches text imports',async()=>{
  const visited=[];
  const request=(url,_options,receive)=>{
    const req=new EventEmitter();req.destroy=()=>{};
    queueMicrotask(()=>{const response=new PassThrough();response.headers={};if(url.pathname==='/first'){response.statusCode=302;response.headers.location='/final';}else{response.statusCode=200;}visited.push(url.pathname);receive(response);response.end(url.pathname==='/final'?link:'');});
    return req;
  };
  assert.equal(await downloadSubscription('https://provider.example/first',{request}),link);
  assert.deepEqual(visited,['/first','/final']);
  const cross=(_url,_options,receive)=>{const req=new EventEmitter();req.destroy=()=>{};queueMicrotask(()=>{const response=new PassThrough();response.statusCode=302;response.headers={location:'https://other.example/token'};receive(response);response.end();});return req;};
  await assert.rejects(downloadSubscription('https://provider.example/first',{request:cross}),/другой сервер/);
  assert.equal((await downloadSubscription('https://provider.example/large',{request:requestMock('x'.repeat(600000))})).length,600000);
});
test('Домены DPI обходят VPN раньше правила приложения и полного туннеля', () => {
  for (const mode of ['selective','all']) {
    const config = createSingBoxConfig(link,{mode,customDomains:['youtube.com'],apps:['chrome.exe']},{dpiDomains:['youtube.com']});
    const rules = config.route.rules;
    const dpi = rules.findIndex(rule => rule.domain_suffix?.includes('youtube.com') && rule.outbound==='direct');
    const vpn = rules.findIndex(rule => rule.outbound==='vless-out');
    assert.ok(dpi >= 0);
    if (vpn >= 0) assert.ok(dpi < vpn);
    assert.equal(config.dns.rules[0].server,'local-dns');
    assert.equal(config.route.final,mode==='all'?'vless-out':'direct');
  }
  assert.ok(!createSingBoxConfig(link,{},{}).route.rules.some(rule=>rule.domain_suffix && rule.outbound==='direct'));
});
