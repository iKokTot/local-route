const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { runWithInput, terminateChild } = require('../platform/windows');
const { createVlessCheckConfig, createVlessProfile, vlessProbeTargets } = require('./vless');
const { listenerReady } = require('./telegram-proxy');

function responseResult(statusCode) {
  return { success: statusCode >= 200 && statusCode < 400, reachable: true, statusCode, level: statusCode < 400 ? 'ok' : (statusCode < 500 ? 'warning' : 'fail'), detail: statusCode >= 400 && statusCode < 500 ? `HTTP ${statusCode} · сайт ответил, доступ ограничен` : `HTTP ${statusCode}` };
}
// CONNECT is always sent to the diagnostic proxy. This probe cannot silently
// fall back to a direct HTTPS connection or depend on the app's process rule.
function probeThroughProxy(url, port, { timeoutMs = 8000, signal, downloadBytes = 0 } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({success:false,reachable:false,level:'fail',detail:'Проверка отменена',durationMs:0});
    const target = new URL(url);
    if (target.protocol !== 'https:') return resolve({ success: false, reachable: false, level: 'fail', detail: 'Поддерживается только HTTPS.', durationMs: 0 });
    const start = Date.now();
    let done = false;
    let connectRequest;
    let tunnelSocket;
    let request;
    const agent = new https.Agent({ keepAlive: false });
    const finish = (result) => {
      if (done) return;
      done = true; clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      connectRequest?.destroy(); request?.destroy(); tunnelSocket?.destroy(); agent.destroy();
      resolve({ ...result, durationMs: Date.now() - start });
    };
    const fail = (detail) => finish({ success: false, reachable: false, level: 'fail', detail });
    const timer = setTimeout(() => fail('Тайм-аут соединения'), timeoutMs);
    const abort = () => fail('Проверка отменена');
    signal?.addEventListener('abort', abort, {once:true});
    agent.createConnection = (options, callback) => {
      let answered = false;
      const reply = (error, socket) => { if (!answered) { answered = true; callback(error, socket); } };
      connectRequest = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${target.hostname}:${target.port || 443}`, agent: false });
      connectRequest.once('connect', (response, socket, head) => {
        tunnelSocket = socket;
        if (done) { socket.destroy(); return; }
        if (response.statusCode !== 200) {
          socket.destroy(); reply(new Error('Не удалось открыть туннель через VLESS')); return;
        }
        if (head.length) socket.unshift(head);
        reply(null, tls.connect({ ...options, socket, servername: target.hostname, rejectUnauthorized: true }));
      });
      connectRequest.once('error', (error) => reply(error));
      connectRequest.end();
    };
    request = https.get(target, { agent, headers: { 'User-Agent': 'LocalRoute/0.15.2' } }, (response) => {
      if (!downloadBytes || response.statusCode !== 200) {
        response.resume(); finish(responseResult(response.statusCode)); return;
      }
      const bodyStarted = Date.now();
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > downloadBytes) fail('Сервер превысил лимит тестового скачивания');
      });
      response.once('error', () => fail('Тестовое скачивание прервано'));
      response.once('aborted', () => fail('Тестовое скачивание прервано'));
      response.once('end', () => finish(downloadResult(bytes, downloadBytes, Date.now() - start, Date.now() - bodyStarted)));
    });
    request.once('error', (error) => fail(error.code ? `Ошибка соединения: ${error.code}` : 'Не удалось открыть туннель через VLESS'));
  });
}
function downloadResult(bytes, expectedBytes, elapsedMs, bodyMs) {
  if (bytes !== expectedBytes) return {success:false,reachable:true,level:'fail',detail:'Получен неполный тестовый файл'};
  const mbps = Number((bytes * 8 / Math.max(1, elapsedMs) / 1000).toFixed(1));
  return {success:true,reachable:true,level:'ok',bytes,mbps,bodyMs,detail:`${mbps} Мбит/с · ${bytes / 1000000} МБ, включая установку соединения`};
}
async function checkProxySpeed({port,signal}) {
  const result = await probeThroughProxy('https://speed.cloudflare.com/__down?bytes=10000000',port,{signal,timeoutMs:20000,downloadBytes:10000000});
  signal?.throwIfAborted();
  return {ok:result.success,results:[{label:'Скорость через VPN',...result}],checkedAt:new Date().toISOString(),message:result.success ? 'Замер завершён. Это скорость одного скачивания до Cloudflare, не предел скорости интернета.' : result.detail};
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port)); });
  });
}
async function checkProxyTargets({profile,port,signal}) {
  const targets=vlessProbeTargets(profile);
  const results=new Array(targets.length);
  let next=0;
  const worker=async()=>{
    while(next<targets.length) {
      signal?.throwIfAborted();
      const index=next++;
      results[index]={...targets[index],...(await probeThroughProxy(targets[index].url,port,{signal}))};
    }
  };
  await Promise.all(Array.from({length:Math.min(2,targets.length)},worker));
  signal?.throwIfAborted();
  const passed=results.filter(result=>result.success).length;
  const normalized=createVlessProfile(profile);
  return {ok:passed===results.length,results,checkedAt:new Date().toISOString(),appRules:normalized.apps.map(process=>({process,trafficVerified:false})),excludedDomains:normalized.excludedDomains,excludedApps:normalized.excludedApps,message:'Проверка через VPN: '+passed+' из '+results.length+' адресов ответили без HTTP-ошибок. Работа приложений этим тестом не подтверждается.'};
}
async function runVlessCheck({ uri, profile, executable, signal }) {
  if (!fs.existsSync(executable)) throw new Error('Движок sing-box не найден в сборке.');
  const port = await freePort();
  const config = createVlessCheckConfig(uri, port);
  let child;
  try {
    signal?.throwIfAborted();
    const checked = await runWithInput(executable, ['check', '-c', 'stdin'], {input:JSON.stringify(config),signal});
    signal?.throwIfAborted();
    if (!checked.ok) throw new Error('Конфигурация проверки VLESS не прошла проверку движка.');
    child = spawn(executable, ['run', '-c', 'stdin'], { windowsHide: true, cwd: path.dirname(executable), stdio: ['pipe','ignore','ignore'] });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(config));
    let failed = false;
    child.once('error', () => { failed = true; });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      signal?.throwIfAborted();
      if (failed || child.exitCode !== null) throw new Error('Не удалось запустить проверку VLESS.');
      if (await listenerReady(port)) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Проверка VLESS не открыла локальный порт.');
    return await checkProxyTargets({profile,port,signal});
  } finally {
    await terminateChild(child,{tree:false});
  }
}
module.exports = { responseResult, probeThroughProxy, runVlessCheck,checkProxyTargets,checkProxySpeed,downloadResult,freePort };
