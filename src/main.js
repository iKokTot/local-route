const {normalizeLibrary,addSubscription,removeSubscription,reconcileSelectedServer} = require('./core/server-library');
const { parseSubscription, downloadSubscription, serverId } = require('./core/subscriptions');
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage, clipboard, dialog, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { URL, pathToFileURL } = require('node:url');
const https = require('node:https');
const dns = require('node:dns').promises;
const { createProfile, createEnginePlan, orderedAutoStrategies, STRATEGY_IDS } = require('./core/profile');
const { buildEngineArgs } = require('./core/engine');
const { createTaskArgs, deleteTaskArgs, queryTaskArgs,taskMatchesExecutable } = require('./core/autostart');
const { createVlessProfile, createSingBoxConfig } = require('./core/vless');
const { launchSettings } = require('./core/launch-settings');
const { runVlessCheck,checkProxyTargets,checkProxySpeed,freePort } = require('./core/vless-check');
const {waitForListener} = require('./core/runtime-readiness');
const { detectVlessNetwork } = require('./core/network');
const { proxySettings, proxySecret, proxyLink, portAvailable, listenerReady } = require('./core/telegram-proxy');
const { createStateStore } = require('./core/state-store');
const { createOperationCoordinator, checkOperation } = require('./core/operations');
const { runCommand, runWithInput, terminateChild, inspectNetworkConflicts } = require('./platform/windows');
const { publicCatalog } = require('./core/catalog');
const { diagnosticReport } = require('./core/diagnostic-report');
const { createLineSink } = require('./core/log-lines');
const { prepareProbeSession, probeWithRetry } = require('./core/dpi-check');
const APP_VERSION = require('../package.json').version;
let telegramProcess = null;
let telegramBusy = false;
let telegramError = '';
const telegramRunning = () => Boolean(telegramProcess && telegramProcess.exitCode === null && !telegramProcess.killed);
async function stopTelegram() {
  const child = telegramProcess;
  if (child) { expectedStops.add(child); await terminateChild(child); }
  if (telegramProcess === child) telegramProcess = null;
  telegramError = '';
  pushLog('Telegram: локальный прокси остановлен.');
}
async function startTelegram(operation = activeOperation) {
  checkOperation(operation);
  if (telegramRunning()) return { ok: true };
  if (telegramBusy) return { ok: false, message: 'Telegram-прокси уже запускается.' };
  telegramBusy = true; telegramError = '';
  try {
    const state = readState();
    const settings = proxySettings(state.telegram);
    const executable = path.join(engineRoot(), 'tg-ws', 'local-route-tg.exe');
    if (!fs.existsSync(executable)) throw new Error('Ядро TGWs отсутствует в сборке.');
    if (!await portAvailable(settings.port)) throw new Error(`Порт ${settings.port} занят. Если работает отдельный TGWs Proxy, используйте его в Telegram либо остановите его и повторите запуск.`);
    checkOperation(operation);
    let secret;
    if (state.telegramSecret) secret = safeStorage.decryptString(Buffer.from(state.telegramSecret, 'base64'));
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно.');
      secret = proxySecret();
      writeState({ ...readState(), telegramSecret: safeStorage.encryptString(secret).toString('base64') });
    }
    const child = spawn(executable, ['--host', '127.0.0.1', '--port', String(settings.port), '--secret', secret, '--pool-size', '2'], { windowsHide: true, cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'] });
    telegramProcess = child;
    captureProcessOutput(child, 'tgws', [secret]);
    child.once('error', (error) => { telegramError = error.message; if (telegramProcess === child) telegramProcess = null; });
    child.once('exit', (code) => {
      if (!expectedStops.has(child)) telegramError = `Telegram-прокси завершился: код ${code}. Откройте журнал.`;
      if (telegramProcess === child) telegramProcess = null;
    });
    for (let attempt = 0; attempt < 30; attempt++) {
      checkOperation(operation);
      if (!telegramRunning()) throw new Error(telegramError || 'Telegram-прокси не запустился.');
      if (await listenerReady(settings.port)) { checkOperation(operation); pushLog('Telegram: локальный порт готов. Подключите прокси в Telegram Desktop.'); return { ok: true }; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Telegram-прокси не открыл локальный порт за отведённое время.');
  } catch (error) { await stopTelegram(); telegramError = error.code === 'ABORT_ERR' ? '' : error.message; return { ok: false, message: error.message }; }
  finally { telegramBusy = false; }
}

const stateFile = () => path.join(app.getPath('userData'), 'local-route.json');
const defaults = { profile: createProfile({ services: ['youtube', 'discord'] }), enginePath: '', active: false, autoStart: false, verifiedStrategy: null, vless: createVlessProfile({mode:'exclude'}), vlessConfigured: false, vlessActive: false };
const launchedFromAutoStart = process.argv.includes('--autostart');
let engineProcess = null;
let vlessProcess = null;
let vlessHealthPort = null;
let lastVlessCheck = null;
let vlessError = '';
let autoStartWarning = '';
let vlessRoutingDomainsKey = null;
function dpiRoutingDomains(state) {
  if(activeOperation?.dpiRouteDomains && !activeOperation.cancelled)return activeOperation.dpiRouteDomains;
  return engineIsRunning() ? state.profile.domains : [];
}
let engineLog = [];
let mainWindow = null;
let tray = null;
let isQuitting = false;
let quitReady = false;
let mainWindowReady = false;
let showWindowWhenReady = false;
let cachedAutoStart = false;
let externalWinwsCache = { checkedAt: 0, pids: [] };
let logWritesSinceTrim = 0;
let queuedLogs = [];
let logFlushPromise = null;
let logFlushTimer = null;
const expectedStops = new WeakSet();
let activeOperation = null;
const operations = createOperationCoordinator();
let stoppingPromise = null;
let stateStore;
let networkConflicts = { proxyEnabled: false, tunnelNames: [] };
let networkConflictCheck = null;
let networkConflictCheckedAt = 0;
let telegramProxySnapshot = null;
const TELEGRAM_DC_HOSTS = Object.freeze([
  'pluto.web.telegram.org', 'venus.web.telegram.org', 'aurora.web.telegram.org',
  'vesta.web.telegram.org', 'flora.web.telegram.org'
]);
const SERVICE_PROBES = Object.freeze({
  youtube: [{ label: 'YouTube', url: 'https://www.youtube.com/generate_204' }],
  discord: [
    { label: 'Discord API', url: 'https://discord.com/api/v10/gateway' },
    { label: 'Discord Gateway приложения', url: 'https://gateway.discord.gg/?v=10&encoding=json' },
    { label: 'Discord CDN', url: 'https://cdn.discordapp.com/' },
    { label: 'Discord Updates', url: 'https://updates.discord.com/' }
  ],
  telegram: [
    { label: 'Telegram Web', url: 'https://web.telegram.org/' },
    { label: 'Telegram DC 1', url: 'https://pluto.web.telegram.org/apiws' },
    { label: 'Telegram DC 2', url: 'https://venus.web.telegram.org/apiws' }
  ]
});

function beginOperation(kind) {
  if (activeOperation || stoppingPromise || isQuitting) return null;
  activeOperation = operations.begin(kind);
  return activeOperation;
}
function finishOperation(operation) {
  operations.finish(operation);
  if (activeOperation === operation) activeOperation = null;
  publishProgress();
}

async function cancelAndStop(scope = 'all') {
  operations.cancel();
  if (stoppingPromise) return stoppingPromise;
  const operation = activeOperation;
  stoppingPromise = (async () => {
    const results = await Promise.allSettled(scope === 'all' ? [stopEngine({refreshRoutes:false}), stopVless(), stopTelegram()] : [stopEngine()]);
    if (operation) await operation.done;
    if (scope !== 'all' && operation?.cancelled && vlessIsRunning()) await refreshVlessRouting(null);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  })();
  try { await stoppingPromise; } finally { stoppingPromise = null; }
}

function engineRoot() { return app.isPackaged ? path.join(process.resourcesPath, 'app', 'engine') : path.join(__dirname, '..', 'engine'); }
function singBoxExecutable() { return path.join(engineRoot(), 'sing-box', 'sing-box-1.14.2-windows-amd64', 'sing-box.exe'); }
function vlessConfigPath() { return path.join(app.getPath('userData'), 'runtime', 'sing-box.json'); }
function vlessIsRunning() { return Boolean(vlessProcess && !vlessProcess.killed && vlessProcess.exitCode === null); }
function encodeVlessUri(uri) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно. Войдите в обычную учётную запись Windows и попробуйте снова.');
  return safeStorage.encryptString(uri).toString('base64');
}
function decodeVlessUri(state) {
  if (!state.vlessSecret || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(state.vlessSecret, 'base64')); } catch { return ''; }
}
async function stopVless({ silent = false } = {}) {
  const child = vlessProcess;
  if (child) expectedStops.add(child);
  if (child) await terminateChild(child,{tree:false});
  if (vlessProcess === child) vlessProcess = null;
  vlessHealthPort=null;lastVlessCheck=null;vlessRoutingDomainsKey=null;
  if(!silent)vlessError='';
  cleanupLegacyVlessFiles();
  if (!silent) pushLog('VLESS-маршрутизация остановлена.');
  return { vlessActive: false };
}
function cleanupLegacyVlessFiles() {
  const directory = path.dirname(vlessConfigPath());
  try {
    for (const name of fs.readdirSync(directory)) {
      if (name === 'sing-box.json' || /^vless-check-[a-f0-9-]+\.json$/i.test(name)) fs.unlinkSync(path.join(directory, name));
    }
  } catch (error) { if (error.code !== 'ENOENT') pushLog('Не удалось удалить старый временный VLESS-конфиг. Проверьте права на runtime.'); }
}
async function startVless(operation = activeOperation) {
  checkOperation(operation);
  const state = readState();
  if (vlessIsRunning()) return { ok: true, state };
  vlessError='';
  if (!state.vlessConfigured) return { ok: false, message: 'Сначала добавьте VLESS-ссылку.' };
  const executable = singBoxExecutable();
  if (!fs.existsSync(executable)) return { ok: false, message: 'VLESS-движок sing-box не найден в сборке.' };
  const uri = decodeVlessUri(state);
  if (!uri) {
    vlessError='Не удалось расшифровать сохранённый VPN-профиль. Добавьте ссылку заново. Исходные настройки сохранены.';
    return { ok: false, message: vlessError };
  }
  fs.mkdirSync(path.dirname(vlessConfigPath()), { recursive: true });
  const network = await detectVlessNetwork({signal:operation?.signal});
  checkOperation(operation);
  const diagnosticPort=await freePort();
  checkOperation(operation);
  let config;
  const dpiDomains=dpiRoutingDomains(state);
  try { config = createSingBoxConfig(uri, state.vless, { ...network, diagnosticPort, dpiDomains }); } catch (error) { return { ok: false, message: `VLESS-профиль некорректен: ${error.message}` }; }
  pushLog(network.ipv6 ? 'VLESS: IPv4 и IPv6, внешний IPv6 подтверждён на основном подключении.' : 'VLESS: используется IPv4; внешний IPv6 на основном подключении не подтверждён.');
  const check = await runWithInput(executable, ['check', '-c', 'stdin'], { input: JSON.stringify(config), signal: operation?.signal });
  checkOperation(operation);
  if (!check.ok) {
    return { ok: false, message: 'VLESS-конфигурация не прошла проверку движка. Проверьте параметры ссылки.' };
  }
  const child = spawn(executable, ['run', '-c', 'stdin'], { windowsHide: true, cwd: path.dirname(executable), stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(config));
  vlessProcess = child;
  vlessHealthPort=diagnosticPort;lastVlessCheck=null;
  captureProcessOutput(child, 'vless', [uri, config.outbounds[0].uuid, config.outbounds[0].password, config.outbounds[0].obfs?.password]);
  child.once('error', (error) => { pushLog(`VLESS: ошибка запуска: ${error.message}`); if (vlessProcess === child) vlessProcess = null; });
  child.once('exit', (code) => {
    if (!expectedStops.has(child)) {
      vlessError='VPN неожиданно отключён. Трафик может идти напрямую. Запустите VPN повторно или проверьте журнал.';
      lastVlessCheck=null;
      pushLog(`VLESS неожиданно завершился: ${code ?? 'сигнал'}. ${vlessError}`);
    }
    if (vlessProcess === child) vlessProcess = null;
    publishProgress();
  });
  try { await waitForListener(child,diagnosticPort,{signal:operation?.signal}); }
  catch(error) { await stopVless({silent:true});checkOperation(operation);return {ok:false,message:error.message}; }
  checkOperation(operation);
  vlessRoutingDomainsKey=JSON.stringify([...dpiDomains].sort());
  const next = { ...readState(), vlessActive: vlessIsRunning() };
  writeState(next); pushLog(state.vless.mode === 'exclude' ? `VPN включён: весь внешний трафик через сервер, ${state.vless.excludedDomains.length} доменов и ${state.vless.excludedApps.length} приложений напрямую.` : state.vless.mode === 'all' ? 'VLESS включён: весь интернет направляется в туннель.' : `VLESS включён: ${state.vless.domains.length} доменов направляются в туннель.`);
  return { ok: true, state: next };
}
function logFile() { return path.join(app.getPath('userData'), 'engine.log'); }
function trimLogFile() {
  try {
    const file = logFile();
    if (fs.statSync(file).size <= 512 * 1024) return;
    const content = fs.readFileSync(file, 'utf8');
    const tail = content.slice(-256 * 1024);
    fs.writeFileSync(file, tail.slice(tail.indexOf('\n') + 1), 'utf8');
  } catch { /* no log exists yet */ }
}
function pushLog(message) {
  message = String(message).replace(/(?:vless|hy2|hysteria2):\/\/\S+/gi, '[VPN-ссылка скрыта]').replace(/tg:\/\/\S+/gi, '[Telegram-ссылка скрыта]');
  const line = `${new Date().toLocaleTimeString('ru-RU')}  ${message}`;
  engineLog = [line, ...engineLog].slice(0, 80);
  queuedLogs.push(`${line}\n`);
  if (!logFlushTimer) { logFlushTimer = setTimeout(() => { logFlushTimer = null; flushLogs(); }, 250); logFlushTimer.unref?.(); }
}
function captureProcessOutput(child, prefix, secrets = []) {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const sink = createLineSink((line) => pushLog(`[${prefix}] ${line}`), secrets);
    stream.on('data', sink); stream.once('end', sink.end);
  }
}
async function flushLogs() {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (logFlushPromise) { await logFlushPromise; if (queuedLogs.length) return flushLogs(); return; }
  if (!queuedLogs.length) return;
  const lines = queuedLogs; queuedLogs = [];
  logFlushPromise = fs.promises.appendFile(logFile(), lines.join(''), 'utf8').then(() => {
    logWritesSinceTrim += lines.length;
    if (logWritesSinceTrim >= 100) { logWritesSinceTrim = 0; trimLogFile(); }
  }).catch(() => {});
  try { await logFlushPromise; } finally { logFlushPromise = null; }
}
function engineExecutable() { return path.join(engineRoot(), 'bin', 'winws.exe'); }
function engineIsRunning() { return Boolean(engineProcess && !engineProcess.killed && engineProcess.exitCode === null); }
async function localRouteEnginePids() {
  const script = "$all=@(Get-CimInstance Win32_Process);$routes=@($all|Where-Object {$_.Name -eq 'Local Route.exe'}|ForEach-Object {$_.ProcessId});@($all|Where-Object {$_.Name -eq 'winws.exe' -and $routes -contains $_.ParentProcessId}|ForEach-Object {$_.ProcessId})|ConvertTo-Json -Compress";
  try {
    const raw = (await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])).trim();
    if (!raw) return [];
    const result = JSON.parse(raw);
    return Array.isArray(result) ? result.map(Number) : [Number(result)];
  } catch { return []; }
}
async function otherWinwsPids({ force = false, signal } = {}) {
  const now = Date.now();
  if (!force && now - externalWinwsCache.checkedAt < 2500) return externalWinwsCache.pids;
  try {
    const rows = await runCommand('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/FO', 'CSV', '/NH'], {signal});
    const pids = rows.split(/\r?\n/).map((line) => /^"winws\.exe","(\d+)"/i.exec(line)?.[1]).filter(Boolean).map(Number).filter((pid) => pid !== engineProcess?.pid);
    externalWinwsCache = { checkedAt: now, pids };
    return pids;
  } catch {
    externalWinwsCache = { checkedAt: now, pids: [] };
    return [];
  }
}
async function stopEngine({ silent = false, recover = true, refreshRoutes = true } = {}) {
  const child = engineProcess;
  if (child) expectedStops.add(child);
  // The tracked child is the normal path. The slower CIM lookup is only a
  // recovery path for a process left behind after an earlier app crash.
  if (child) await terminateChild(child);
  else if (recover) {
    for (const pid of await localRouteEnginePids()) {
      await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 5000 });
    }
  }
  if (engineProcess === child) engineProcess = null;
  if (!silent) pushLog('Движок остановлен.');
  if (refreshRoutes && child && vlessIsRunning() && !activeOperation?.cancelled) await refreshVlessRouting();
  return { active: false };
}
function waitForEarlyExit(child, timeoutMs = 900) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.stdout?.off('data', onOutput);
      child.stderr?.off('data', onOutput);
      resolve(value);
    };
    const onError = (error) => finish({ error });
    const onExit = (code) => finish({ code });
    // winws reports this shortly after WinDivert is ready. Using it avoids an
    // unnecessary 900ms delay before every strategy in the selector.
    const onOutput = (chunk) => { if (/windivert initialized\. capture is started/i.test(String(chunk))) finish(null); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);
  });
}
function probe(url, { timeoutMs = 6500, signal, lookup } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (success, detail, code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ success, detail, code, durationMs: Date.now() - startedAt }); } };
    const request = https.get(url, { signal, lookup, agent: false, timeout: Math.max(1000, timeoutMs - 800), headers: { 'User-Agent': 'LocalRoute/0.15.2' } }, (response) => {
      response.resume();
      const success = response.statusCode >= 200 && response.statusCode < 500;
      finish(success, `HTTP ${response.statusCode}`);
    });
    const timer = setTimeout(() => { request.destroy(); finish(false, `Тайм-аут ${(timeoutMs / 1000).toLocaleString('ru-RU')} с`, 'ETIMEDOUT'); }, timeoutMs);
    request.once('timeout', () => { request.destroy(); finish(false, 'Тайм-аут соединения', 'ETIMEDOUT'); });
    request.once('error', (error) => finish(false, error.code === 'ECONNRESET' ? 'Сайт сбросил соединение (ECONNRESET).' : error.code === 'ENOTFOUND' ? 'DNS: не удалось определить адрес сайта (ENOTFOUND).' : `${error.code || 'Ошибка сети'}: ${error.message}`, error.code));
  });
}
function probesForProfile(profile) {
  return profile.services.flatMap((service) => (SERVICE_PROBES[service] || []).map((target) => ({ service, ...target })));
}
function quickProbesForProfile(profile) {
  const targets = probesForProfile(profile);
  return profile.services.map((service) => targets.find((target) => target.service === service)).filter(Boolean);
}
async function probeTargets(targets, { timeoutMs = 6500, concurrency = 2, signal, session } = {}) {
  const results = new Array(targets.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < targets.length) {
      if (signal?.aborted) break;
      const index = nextIndex++;
      results[index] = { ...(await probeWithRetry(targets[index],probe,{timeoutMs,signal,session})), route: vlessIsRunning() ? 'Проверка напрямую, вне VLESS' : 'Проверка напрямую' };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results.filter(Boolean);
}
async function prepareDpiCheck(operation, profile) {
  operation.progress = {message:'Проверяю DNS выбранных сервисов…'};
  publishProgress();
  const session = await prepareProbeSession(probesForProfile(profile),{signal:operation.signal});
  checkOperation(operation);
  return session;
}
function dnsFailureReport(session) {
  session.errors.forEach(result=>pushLog(`${result.label}: ошибка DNS ${result.code}. Подбор стратегий не начинался.`));
  return {ok:false,results:session.errors,diagnosticKind:'dns',state:publicState(readState()),message:'Не удалось определить адрес одного из сайтов через DNS. Это не ошибка стратегии DPI. Сохранённая стратегия не изменена; проверьте DNS и повторите проверку.'};
}
async function resolveTelegramAddresses() {
  const settled = await Promise.allSettled(TELEGRAM_DC_HOSTS.map((host) => dns.resolve4(host)));
  return [...new Set(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []))];
}
async function telegramProxyConnection() {
  const script = "$p=@(Get-Process Telegram -ErrorAction SilentlyContinue|% Id);if($p.Count){$c=Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue|?{$p -contains $_.OwningProcess -and ($_.RemoteAddress -eq '127.0.0.1' -or $_.RemoteAddress -eq '::1')}|select -First 1 RemoteAddress,RemotePort;if($c){$c|ConvertTo-Json -Compress}}";
  try {
    const raw = (await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])).trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function startEngine(operation = activeOperation) {
  checkOperation(operation);
  const state = readState();
  if (engineIsRunning()) return { ok: true, state };
  const existing = await otherWinwsPids({ force: true, signal:operation?.signal });
  checkOperation(operation);
  if (existing.length) return { ok: false, message: 'Обнаружен другой запущенный winws. Остановите прежний zapret/Winws, затем попробуйте снова.' };
  if (!state.profile.domains.length) return { ok: false, message: 'Выберите хотя бы один сервис или добавьте домен.' };
  const executable = engineExecutable();
  if (!fs.existsSync(executable)) return { ok: false, message: 'Локальный сетевой движок не найден в сборке.' };
  const runtimeDir = path.join(app.getPath('userData'), 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const hostList = path.join(runtimeDir, 'profile-hosts.txt');
  const googleHostList = path.join(runtimeDir, 'youtube-hosts.txt');
  const generalHostList = path.join(runtimeDir, 'general-hosts.txt');
  const telegramIpSet = path.join(runtimeDir, 'telegram-ipset.txt');
  fs.writeFileSync(hostList, `${state.profile.domains.join('\n')}\n`, 'utf8');
  const googleDomains = createProfile({ services: state.profile.services.includes('youtube') ? ['youtube'] : [] }).domains;
  const generalDomains = state.profile.domains.filter((domain) => !googleDomains.includes(domain));
  fs.writeFileSync(googleHostList, `${googleDomains.join('\n')}\n`, 'utf8');
  fs.writeFileSync(generalHostList, `${generalDomains.join('\n')}\n`, 'utf8');
  const telegramAddresses = state.profile.services.includes('telegram') ? await resolveTelegramAddresses() : [];
  checkOperation(operation);
  if (telegramAddresses.length) {
    fs.writeFileSync(telegramIpSet, `${telegramAddresses.map((address) => `${address}/32`).join('\n')}\n`, 'utf8');
    pushLog(`Telegram: найдено ${telegramAddresses.length} IP дата-центров для локального MTProto-профиля.`);
  }
  const args = buildEngineArgs({ engineRoot: engineRoot(), hostListPath: hostList, googleHostListPath: googleHostList, generalHostListPath: generalHostList, telegramIpSetPath: telegramAddresses.length ? telegramIpSet : undefined, profile: state.profile });
  try {
    const child = spawn(executable, args, { windowsHide: true, cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'] });
    engineProcess = child;
    const writeEngineOutput = (chunk) => String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => pushLog(`[winws] ${line}`));
    engineProcess.stdout?.on('data', writeEngineOutput);
    engineProcess.stderr?.on('data', writeEngineOutput);
    child.once('error', (error) => { pushLog(`Ошибка запуска: ${error.message}`); if (engineProcess === child) engineProcess = null; });
    child.once('exit', (code) => {
      if (!expectedStops.has(child) && code !== null) pushLog(`Движок неожиданно завершился с кодом ${code}. Причина указана строками [winws] выше.`);
      if (engineProcess === child) engineProcess = null;
    });
    const earlyExit = await waitForEarlyExit(child);
    if (operation?.cancelled) { await stopEngine({ recover: false }); checkOperation(operation); }
    if (earlyExit) {
      engineProcess = null;
      const reason = earlyExit.error ? earlyExit.error.message : `код ${earlyExit.code}`;
      pushLog(`Движок не запущен: ${reason}`);
      return { ok: false, message: 'Движок завершился до запуска. Откройте журнал: там указана причина от winws.' };
    }
    if (vlessIsRunning()) await refreshVlessRouting(operation);
    const next = { ...readState(), active: engineIsRunning() }; writeState(next); pushLog(`Движок запущен: ${state.profile.strategy}.`);
    return { ok: true, state: next };
  } catch (error) { return { ok: false, message: `Не удалось запустить движок: ${error.message}` }; }
}

function store() {
  if (!stateStore) stateStore = createStateStore({ file: stateFile(), defaults, normalize: (saved) => ({
    ...defaults, ...saved, profile: createProfile(saved.profile), vless: createVlessProfile(saved.vless || {mode:'exclude'}), telegram: proxySettings(saved.telegram), launchSettings: launchSettings(saved.launchSettings, saved.telegram?.enabled ?? true)
  }) });
  return stateStore;
}
function readState() { return store().read(); }
function writeState(next, options) { store().write(next, options); }
function publicState(next) {
  const { vlessSecret, vlessLibrarySecret, serverVault, telegramSecret, ...safe } = next;
  let library;
  let libraryWarning='';
  try {library=readVlessLibrary(next);}
  catch {library=normalizeLibrary();libraryWarning='Не удалось открыть зашифрованный список серверов. Исходные данные сохранены. Для восстановления потребуется исходная ссылка или подписка.';}
  const current = decodeVlessUri(next);
  safe.vlessServers = library.profiles.map(({id,name,server,port,protocol,supported,error,check}) => ({id,name,server,port,protocol,supported,error,check,selected:id===serverId(current)}));
  safe.vlessSubscriptionSaved = Boolean(library.source);
  safe.vlessSubscriptions = library.groups.map(({id,name,source,profiles,usage,updatedAt})=>({id,name,usage,updatedAt,canRefresh:Boolean(source),serverIds:profiles.map(item=>item.id)}));
  safe.platform = 'windows';
  return { ...safe, vpnCheck:lastVlessCheck?.serverId===serverId(current) ? lastVlessCheck : null, appVersion: APP_VERSION, catalog: publicCatalog(), operation: activeOperation ? { kind: activeOperation.kind, progress: activeOperation.progress, cancelled: activeOperation.cancelled } : null,
    storageWarning: stateStore?.warning || libraryWarning, autoStartWarning,vlessError, telegram: proxySettings(next.telegram), telegramActive: telegramRunning(), telegramBusy, telegramError, active: engineIsRunning(), vlessActive: vlessIsRunning() };
}
function profilesTargetSame(left, right) {
  return left.services.join('\n') === right.services.join('\n') && left.domains.join('\n') === right.domains.join('\n');
}
async function scheduledTaskExists() {
  if (process.platform !== 'win32') return false;
  try {
    const xml=await runCommand('schtasks.exe', [...queryTaskArgs(),'/XML']);
    autoStartWarning=taskMatchesExecutable(xml,process.execPath) ? '' : 'Автозапуск указывает на другую версию. Выключите и снова включите автозапуск в этой версии.';
    if(autoStartWarning && app.isPackaged && readState().autoStart) {
      try {
        await runCommand('schtasks.exe',createTaskArgs(process.execPath));
        autoStartWarning='';
        pushLog('Автозапуск обновлён: используется текущая версия приложения.');
      } catch { autoStartWarning='Не удалось обновить автозапуск. Запустите текущую версию от имени администратора и включите автозапуск повторно.'; }
    }
    return true;
  } catch { return false; }
}
async function configureAutoStart(enabled) {
  if (process.platform !== 'win32' || !app.isPackaged) return { ok: false, message: 'Автозапуск доступен только в собранной Windows-версии.' };
  const state = readState();
  try {
    if (enabled) await runCommand('schtasks.exe', createTaskArgs(process.execPath));
    else if (await scheduledTaskExists()) await runCommand('schtasks.exe', deleteTaskArgs());
    cachedAutoStart = enabled;
    autoStartWarning='';
    const next = { ...readState(), autoStart: enabled };
    writeState(next);
    pushLog(enabled ? 'Автозапуск Windows включён.' : 'Автозапуск Windows отключён.');
    return { ok: true, state: next, message: enabled ? 'Автозапуск включён. При входе в Windows Local Route запустится в трее.' : 'Автозапуск отключён.' };
  } catch {
    return { ok: false, message: 'Не удалось изменить автозапуск. Запустите Local Route от имени администратора.' };
  }
}
function readLogs() {
  if (engineLog.length) return engineLog;
  try { return fs.readFileSync(logFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-80).reverse(); } catch { return engineLog; }
}
function diagnostics(state) {
  const localEngineRunning = engineIsRunning();
  const localVlessRunning = vlessIsRunning();
  const externalWinwsPids = externalWinwsCache.pids;
  const items = [
    { label: 'Профиль', value: state.profile.domains.length ? `${state.profile.domains.length} доменов выбрано` : 'Сервисы не выбраны', level: state.profile.domains.length ? 'ok' : 'warning' },
    { label: 'Сетевой движок', value: externalWinwsPids.length ? 'Обнаружен внешний winws — возможен конфликт' : (localEngineRunning ? 'Запущен Local Route' : (fs.existsSync(engineExecutable()) ? 'Готов к запуску' : 'Не найден в сборке')), level: externalWinwsPids.length ? 'warning' : (localEngineRunning ? 'ok' : 'neutral') },
    { label: 'VLESS-маршрутизация', value: state.vlessConfigured ? (localVlessRunning ? (state.vless.mode === 'exclude' ? `VPN с исключениями: ${state.vless.excludedDomains.length} доменов и ${state.vless.excludedApps.length} приложений напрямую` : state.vless.mode === 'all' ? 'Весь интернет через туннель' : `${state.vless.domains.length} доменов через туннель`) : 'Профиль готов к запуску') : 'Не настроена', level: localVlessRunning ? 'ok' : (state.vlessConfigured ? 'neutral' : 'warning') },
    { label: 'Telegram-прокси', value: telegramBusy ? 'Запускается' : (telegramRunning() ? 'Локальный порт готов; подключение проверьте в Telegram' : (telegramError || 'Выключен')), level: telegramError ? 'warning' : (telegramRunning() ? 'ok' : 'neutral') },
    { label: 'Диагностика', value: 'Журнал хранится на компьютере. VLESS направляет выбранный трафик через ваш сервер.', level: 'neutral' }
  ];
  if (state.profile.services.includes('telegram')) {
    const proxy = telegramProxySnapshot;
    items.splice(2, 0, proxy
      ? { label: 'Telegram Desktop', value: `Сейчас использует локальный прокси ${proxy.RemoteAddress}:${proxy.RemotePort}; Local Route не видит его прямой трафик`, level: 'warning' }
      : { label: 'Telegram Desktop', value: 'Прямое соединение — доступна локальная обработка MTProto', level: 'ok' });
  }
  if (stateStore?.warning) items.unshift({ label: 'Настройки', value: stateStore.warning, level: 'warning' });
  if (networkConflicts.proxyEnabled) items.push({ label: 'Системный прокси', value: 'Включён другой системный прокси. Local Route его настройки не меняет.', level: 'warning' });
  if (networkConflicts.tunnelNames?.length) items.push({ label: 'Другие VPN', value: 'Обнаружен активный сторонний VPN/TUN. Он может влиять на маршруты и результаты DPI.', level: 'warning' });
  if (networkConflicts.unavailable) items.push({label:'Проверка конфликтов',value:'Не удалось проверить системный прокси и сторонние VPN.',level:'warning'});
  return items;
}

async function refreshDiagnostics({ force = false } = {}) {
  if (networkConflictCheck) return networkConflictCheck;
  if (!force && Date.now() - networkConflictCheckedAt < 15000) return;
  networkConflictCheck = (async () => {
    const [conflicts, , telegramProxy] = await Promise.all([inspectNetworkConflicts(), otherWinwsPids({ force }), readState().profile.services.includes('telegram') ? telegramProxyConnection() : Promise.resolve(null)]);
    telegramProxySnapshot = telegramProxy;
    networkConflicts = conflicts; networkConflictCheckedAt = Date.now();
  })();
  try { await networkConflictCheck; } finally { networkConflictCheck = null; }
}

function showMainWindow() {
  showWindowWhenReady = true;
  if (!mainWindow) {
    createWindow({ showOnReady: true });
    return;
  }
  if (!mainWindowReady) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}
function appIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'local-route-logo-256.png'));
}
function trayImage() {
  return appIcon().resize({ width: 20, height: 20, quality: 'best' });
}
function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Local Route');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Local Route', click: showMainWindow },
    { label: 'Остановить всё', click: () => { cancelAndStop().catch(() => pushLog('Не удалось остановить все процессы. Повторите остановку.')); } },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() }
  ]));
  tray.on('click', showMainWindow);
}
function createWindow({ showOnReady = true } = {}) {
  mainWindowReady = false;
  showWindowWhenReady = showOnReady;
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 860,
    minWidth: 390,
    minHeight: 560,
    show: false,
    title: 'Local Route',
    icon: appIcon(),
    backgroundColor: '#111418',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      // Keep the ready renderer alive: a tray click only reveals the window
      // instead of cold-starting Chromium again.
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; mainWindowReady = false; });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindowReady = true;
    if (showWindowWhenReady) {
      mainWindow.show();
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else app.on('second-instance', showMainWindow);

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  if (process.platform === 'win32') app.setAppUserModelId('com.localroute.app');
  createTray();
  powerMonitor?.on('resume',()=>{
    lastVlessCheck=null;
    if(vlessIsRunning())vlessError='Компьютер вышел из сна. Проверьте подключение к серверу: прежняя проверка больше не актуальна.';
    refreshDiagnostics({force:true}).catch(()=>{});
    publishProgress();
  });
  if (!launchedFromAutoStart) createWindow();
  // Prepare the uplink while the renderer/DPI loads, not on the VPN path.
  if(launchedFromAutoStart)detectVlessNetwork().catch(() => {});
  else mainWindow.once('ready-to-show',()=>{
    const preparation=setTimeout(()=>{if(!isQuitting)detectVlessNetwork().catch(()=>{});},300);
    preparation.unref?.();
  });
  const maintenance=setTimeout(()=>{
    if(isQuitting)return;
    trimLogFile();
    cleanupLegacyVlessFiles();
    refreshDiagnostics().catch(() => {});
  },1500);
  maintenance.unref?.();
  if (launchedFromAutoStart) {
    const warmup=setTimeout(()=>{if(!mainWindow && !isQuitting)createWindow({showOnReady:false});},1500);
    warmup.unref?.();
  }
  // The task scheduler is not a prerequisite for starting saved components.
  cachedAutoStart=Boolean(readState().autoStart);
  scheduledTaskExists().then(value=>{cachedAutoStart=value;}).catch(()=>{});
  if (launchedFromAutoStart) {
    if (readState().autoStart) {
      const operation = beginOperation('autostart');
      try { if (operation) { const result = await startAllComponents(operation, 'auto'); pushLog(result.message); } }
      catch (error) {
        const location=String(error.stack || '').split('\n').slice(1,3).join(' ').trim();
        pushLog(error.code === 'ABORT_ERR' ? error.message : `Автозапуск не завершён (${error.name || 'Error'}). ${location}`);
      }
      finally { finishOperation(operation); }
    }
    // Do not compete with Windows sign-in. Once the desktop is usable, load
    // the renderer invisibly so opening from tray is instant.
  }
  app.on('activate', showMainWindow);
}).catch(() => { pushLog('Не удалось завершить подготовку. Проверьте сообщение в окне приложения.'); showMainWindow(); });
app.on('before-quit', (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (isQuitting) return;
  isQuitting = true;
  cancelAndStop().then(flushLogs).then(() => { quitReady = true; app.quit(); }).catch(() => {
    isQuitting = false;
    pushLog('Завершение отложено: процесс не подтвердил остановку. Повторите «Остановить всё».');
    showMainWindow();
  });
});

const rendererUrl = pathToFileURL(path.join(__dirname, 'renderer/index.html')).href;
const managedChannels = new Set(['engine:toggle','engine:startVerified','network:startAll','telegram:start','telegram:stop','telegram:save','vless:toggle','vless:start','vless:save','profile:save','autostart:set','vless:delete','vless:import','vless:select','vless:removeSubscription','vless:autoSelect','vless:checkServers','applications:pick','diagnostics:export']);
function trustedEvent(event) {
  if (!mainWindow || event?.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try { const url = new URL(event.senderFrame.url); url.hash = ''; url.search = ''; return url.href === rendererUrl; }
  catch { return false; }
}
managedChannels.add('launch:save');
managedChannels.add('vless:stop');
function registerIpc(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedEvent(event)) throw new Error('Недопустимый источник команды.');
    let operation;
    if (managedChannels.has(channel)) {
      operation = beginOperation(channel);
      if (!operation) return {ok:false,message:'Дождитесь завершения операции или остановите её.'};
    }
    try { return await callback(event, ...args); }
    catch (error) {
      if (channel === 'state:read') throw error;
      return {ok:false,message:error.code === 'ABORT_ERR' ? 'Операция остановлена пользователем.' : 'Действие не выполнено. Проверьте настройки и повторите попытку.'};
    }
    finally { if (operation) finishOperation(operation); }
  });
}
function publishProgress() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('operation:progress', activeOperation ? {kind:activeOperation.kind,progress:activeOperation.progress} : null);
}

registerIpc('state:read', () => { if(mainWindowReady)refreshDiagnostics().catch(() => {}); const state = { ...readState(), active: engineIsRunning(), autoStart: cachedAutoStart, vlessActive: vlessIsRunning() }; return { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }; });
registerIpc('profile:save', async (_event, raw) => {
  if (engineIsRunning()) return { ok: false, message: 'Остановите DPI перед сохранением профиля.' };
  const state = readState();
  const profile = createProfile(raw);
  // Keep the validated option when a user simply opens the panel or saves an
  // unchanged set of domains. Any route change still forces a fresh test.
  const next = { ...state, profile, active: false, verifiedStrategy: profilesTargetSame(state.profile, profile) ? state.verifiedStrategy : null };
  writeState(next);
  return { ...publicState(next), diagnostics: diagnostics(next), plan: createEnginePlan(profile) };
});
registerIpc('engine:toggle', async () => {
  const result = engineIsRunning() ? { ok: true, state: await stopEngine() } : await startEngine();
  if (!result.ok) return result;
  const state = { ...readState(), active: engineIsRunning() };
  return { ok: true, state: { ...publicState(state), diagnostics: diagnostics(state), logs: engineLog } };
});
registerIpc('engine:startVerified', async () => {
  if (engineIsRunning()) return { ok: true, state: publicState({ ...readState(), active: true }) };
  const state = readState();
  if (!state.verifiedStrategy) return { ok: false, message: 'Нет подтверждённой стратегии. Сначала выполните автоподбор.' };
  const next = { ...state, profile: createProfile({ ...state.profile, strategy: state.verifiedStrategy }), active: false };
  writeState(next);
  pushLog(`Запуск подтверждённой стратегии: ${state.verifiedStrategy}.`);
  const result = await startEngine();
  if (!result.ok) return result;
  const running = { ...result.state, active: engineIsRunning() };
  return { ok: true, state: { ...publicState(running), diagnostics: diagnostics(running), logs: readLogs() }, message: `Запущена подтверждённая стратегия: ${state.verifiedStrategy}.` };
});
async function startAllComponents(operation, group = 'all') {
  checkOperation(operation);
  const current = readState();
  const selected = launchSettings(current.launchSettings, current.telegram?.enabled ?? true)[group];
  const errors = [];
  const skipped = [];
  if (selected.dpi && !engineIsRunning()) {
    if (!current.verifiedStrategy) skipped.push('DPI — нужен подбор стратегии');
    else {
      const next = { ...current, profile: createProfile({ ...current.profile, strategy: current.verifiedStrategy }) };
      writeState(next);
      const result = await startEngine(operation);
      checkOperation(operation);
      if (!result.ok) errors.push(`DPI: ${result.message}`);
    }
  }
  // DPI establishes direct-domain routing first. Telegram and VPN are
  // independent after that; settle both before releasing the operation lock.
  const independent=[];
  if(selected.telegram)independent.push({label:'Telegram',start:()=>startTelegram(operation)});
  if(selected.vpn && current.vlessConfigured && !vlessIsRunning())independent.push({label:'VLESS',start:()=>startVless(operation)});
  const results=await Promise.allSettled(independent.map(item=>item.start()));
  checkOperation(operation);
  results.forEach((result,index)=>{
    if(result.status==='rejected')errors.push(`${independent[index].label}: ${result.reason?.message || 'Ошибка запуска'}`);
    else if(!result.value.ok)errors.push(`${independent[index].label}: ${result.value.message}`);
  });
  if (selected.vpn && !current.vlessConfigured) skipped.push('VLESS — нет профиля');
  const state = { ...readState(), active: engineIsRunning(), vlessActive: vlessIsRunning() };
  const running = [state.active && 'DPI', state.vlessActive && 'VLESS', telegramRunning() && 'Telegram-прокси'].filter(Boolean);
  const message = [running.length ? `Запущено: ${running.join(', ')}.` : 'Ни один компонент не запущен.', errors.length ? `Ошибки: ${errors.join('; ')}.` : '', skipped.length ? `Пропущено: ${skipped.join('; ')}.` : ''].filter(Boolean).join(' ');
  return { ok: !errors.length && (Boolean(running.length) || !Object.values(selected).some(Boolean)), state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message };
}
registerIpc('network:startAll', () => startAllComponents(activeOperation));
registerIpc('launch:save', (_event, raw) => {
  const next = {...readState(),launchSettings:launchSettings(raw)};
  writeState(next);
  return {ok:true,state:publicState(next),message:'Параметры запуска сохранены. Работающие компоненты не изменены.'};
});
registerIpc('network:stopAll', async () => {
  await cancelAndStop();
  const state = readState();
  return { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() };
});
registerIpc('engine:stop', async () => {
  await cancelAndStop('dpi');
  const state = readState();
  return { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() };
});
registerIpc('telegram:save', (_event, raw) => {
  try {
    if (telegramRunning() || telegramBusy) return { ok: false, message: 'Остановите Telegram-прокси перед изменением порта.' };
    const current = readState();
    const state = { ...current, telegram: proxySettings({...raw,enabled:current.telegram?.enabled}) };
    writeState(state);
    return { ok: true, state: publicState(state), message: 'Настройки Telegram сохранены.' };
  } catch (error) { return { ok: false, message: error.message }; }
});
registerIpc('telegram:start', async () => {
  const result = await startTelegram();
  return { ...result, state: publicState(readState()), message: result.message || 'Локальный прокси готов. Подтвердите подключение в Telegram.' };
});
registerIpc('telegram:stop', async () => { await stopTelegram(); return { ok: true, state: publicState(readState()), message: 'Telegram-прокси остановлен.' }; });
registerIpc('telegram:connect', async () => {
  try {
    if (!telegramRunning()) return { ok: false, message: 'Сначала запустите Telegram-прокси.' };
    const state = readState();
    const secret = safeStorage.decryptString(Buffer.from(state.telegramSecret, 'base64'));
    const link = proxyLink(proxySettings(state.telegram).port, secret);
    const candidates = [
      path.join(app.getPath('appData'), 'Telegram Desktop', 'Telegram.exe'),
      ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'Telegram Desktop', 'Telegram.exe')] : []),
      ...(process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, 'Telegram Desktop', 'Telegram.exe')] : [])
    ];
    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    if (executable) {
      await new Promise((resolve, reject) => {
        const child = spawn(executable, ['--', link], { windowsHide: false, detached: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
    } else {
      try { await shell.openExternal(link); }
      catch {
        const selected = await dialog.showOpenDialog(mainWindow, { title: 'Выберите Telegram.exe', properties: ['openFile'], filters: [{ name: 'Telegram Desktop', extensions: ['exe'] }] });
        if (selected.canceled || !selected.filePaths.length) return { ok: false, message: 'Telegram не открыт. Нажмите «Скопировать ссылку» и откройте её из «Избранного» в Telegram.' };
        if (path.basename(selected.filePaths[0]).toLowerCase() !== 'telegram.exe') return { ok: false, message: 'Выберите файл Telegram.exe.' };
        await new Promise((resolve, reject) => {
          const child = spawn(selected.filePaths[0], ['--', link], { detached: true, stdio: 'ignore' });
          child.once('error', reject);
          child.once('spawn', () => { child.unref(); resolve(); });
        });
      }
    }
    return { ok: true, message: 'Подтвердите прокси в Telegram Desktop.' };
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? ` (${error.code})` : '';
    return { ok: false, message: `Не удалось передать подключение Telegram${code}. Скопируйте ссылку и откройте её из «Избранного» в Telegram.` };
  }
});
registerIpc('telegram:copy', () => {
  try {
    if (!telegramRunning()) return { ok: false, message: 'Сначала запустите Telegram-прокси.' };
    const state = readState();
    const secret = safeStorage.decryptString(Buffer.from(state.telegramSecret, 'base64'));
    clipboard.writeText(proxyLink(proxySettings(state.telegram).port, secret));
    return { ok: true, message: 'Ссылка скопирована. Вставьте её в «Избранное» Telegram, отправьте и нажмите для подключения. Ссылка содержит секрет локального прокси.' };
  } catch { return { ok: false, message: 'Не удалось получить сохранённый секрет прокси.' }; }
});

async function refreshVlessRouting(operation = activeOperation) {
  if(!vlessIsRunning())return;
  const key=JSON.stringify([...dpiRoutingDomains(readState())].sort());
  if(vlessRoutingDomainsKey===key)return;
  await stopVless({silent:true});
  const result = await startVless(operation);
  if (!result.ok) throw new Error('Маршруты VPN не применены. VPN остановлен; повторите запуск.');
}
function readVlessLibrary(state) {
  if (!state.vlessLibrarySecret) {
    if (state.serverVault) {
      try {
        const groups=JSON.parse(safeStorage.decryptString(Buffer.from(state.serverVault,'base64')));
        return normalizeLibrary({groups:groups.map(group=>({id:group.id,name:group.name,source:group.url || '',usage:group.usage,updatedAt:group.updatedAt,profiles:group.servers.map(server=>({...server,id:serverId(server.input),uri:server.input}))}))});
      } catch { throw new Error('Не удалось открыть подписки версии 0.16. Исходные настройки сохранены.'); }
    }
    return normalizeLibrary();
  }
  try { return normalizeLibrary(JSON.parse(safeStorage.decryptString(Buffer.from(state.vlessLibrarySecret,'base64')))); }
  catch { throw new Error('Не удалось расшифровать список серверов. Настройки сохранены без изменений.'); }
}
registerIpc('vless:subscriptionClipboard', () => ({text:clipboard.readText().slice(0,2000000)}));
registerIpc('vless:import', async (_event, raw) => {
  if (vlessIsRunning()) return {ok:false,message:'Остановите VPN перед обновлением списка.'};
  try {
    const current = readState();
    const previous = readVlessLibrary(current);
    const input = String(raw?.input || '').trim();
    let library=previous;
    let skipped=0;
    if(raw?.refresh) {
      const groups=previous.groups.filter(group=>group.source && (!raw.groupId || group.id===raw.groupId));
      if(!groups.length) return {ok:false,message:'Сохранённой HTTPS-подписки нет.'};
      for(const group of groups){
        const downloaded=await downloadSubscription(group.source,{signal:activeOperation?.signal,metadata:true});
        const parsed={...parseSubscription(downloaded.text),usage:downloaded.usage};skipped+=parsed.skipped;
        library=addSubscription(library,parsed,group.source);
      }
    } else {
      const source=/^https:\/\//i.test(input)?input:'';
      const downloaded=source?await downloadSubscription(source,{signal:activeOperation?.signal,metadata:true}):{text:input,usage:{}};
      const parsed={...parseSubscription(downloaded.text),usage:downloaded.usage,name:String(raw?.name || '').slice(0,120)};skipped=parsed.skipped;
      library=addSubscription(previous,parsed,source);
    }
    checkOperation(activeOperation);
    const next = {...readState(),vlessLibrarySecret:encodeVlessUri(JSON.stringify(library))};
    const selection = reconcileSelectedServer(previous,library,decodeVlessUri(current));
    if (selection.changed) {
      const config=createSingBoxConfig(selection.uri,current.vless);
      const checked=await runWithInput(singBoxExecutable(),['check','-c','stdin'],{input:JSON.stringify(config),signal:activeOperation?.signal});
      checkOperation(activeOperation);
      if(!checked.ok)return {ok:false,message:'Обновлённый сервер не поддерживается ядром. Прежняя подписка и профиль сохранены.'};
      next.vlessSecret=encodeVlessUri(selection.uri);next.vlessConfigured=true;
    }
    if (selection.removed) { delete next.vlessSecret; next.vlessConfigured=false; }
    writeState(next,{rewriteBackup:true});
    return {ok:true,state:publicState(next),message:`Сохранено серверов: ${library.profiles.length}. ${selection.removed ? 'Выбранный сервер удалён или неоднозначно изменён — выберите подключение заново.' : selection.changed ? 'Параметры выбранного сервера обновлены.' : 'Выберите сервер ниже.'} Пропущено строк: ${skipped}.`};
  } catch(error) { return {ok:false,message:error.message}; }
});
registerIpc('vless:removeSubscription', async (_event,id)=>{
  if(vlessIsRunning()) return {ok:false,message:'Остановите VPN перед удалением подписки.'};
  const state=readState();
  const before=readVlessLibrary(state);
  const removed=before.groups.find(group=>group.id===id);
  const library=removeSubscription(before,id);
  const next={...state,vlessLibrarySecret:encodeVlessUri(JSON.stringify(library))};
  const selected=serverId(decodeVlessUri(state));
  if(removed?.profiles.some(profile=>profile.id===selected) && !library.profiles.some(profile=>profile.id===selected)){delete next.vlessSecret;next.vlessConfigured=false;}
  writeState(next,{rewriteBackup:true});
  return {ok:true,state:publicState(next),message:'Подписка удалена. Другие подписки сохранены.'};
});
registerIpc('vless:select', async (_event, id) => {
  if (vlessIsRunning()) return {ok:false,message:'Остановите VPN перед выбором сервера.'};
  const state = readState();
  const profile = readVlessLibrary(state).profiles.find(item=>item.id===id);
  if (!profile) return {ok:false,message:'Сервер не найден. Обновите список.'};
  const config = createSingBoxConfig(profile.uri,state.vless);
  const check = await runWithInput(singBoxExecutable(),['check','-c','stdin'],{input:JSON.stringify(config),signal:activeOperation?.signal});
  checkOperation(activeOperation);
  if (!check.ok) return {ok:false,message:'Этот сервер не поддерживается комплектным движком. Предыдущий профиль сохранён.'};
  const next = {...readState(),vlessConfigured:true,vlessSecret:encodeVlessUri(profile.uri)};
  writeState(next,{rewriteBackup:true});
  return {ok:true,state:publicState(next),message:'Сервер выбран. Маршруты сохранены.'};
});
async function checkLibraryServers(auto = false, onlyId) {
  const operation = activeOperation;
  const state = readState();
  const library = readVlessLibrary(state);
  const profiles = library.profiles.filter(item=>!onlyId || item.id===onlyId);
  if (!profiles.length) return {ok:false,message:'Добавьте подписку или сервер.'};
  let cursor = 0; let completed = 0;
  const deadline = Date.now() + 120000;
  const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(120000)]);
  const worker = async () => {
    while(cursor < profiles.length && Date.now() < deadline && !signal.aborted) {
      const candidate = profiles[cursor++];
      if(candidate.supported === false) { candidate.check={success:false,detail:candidate.error,checkedAt:Date.now()}; completed++; continue; }
      try {
        const report = await runVlessCheck({uri:candidate.uri,profile:createVlessProfile({services:[],customDomains:[],apps:[]}),executable:singBoxExecutable(),signal});
        const durationMs=report.results?.[0]?.durationMs;
        candidate.check={success:report.ok,latency:report.ok?durationMs:null,detail:report.message,checkedAt:Date.now()};
      } catch {
        candidate.check={success:false,latency:null,detail:'Проверка не пройдена',checkedAt:Date.now()};
      }
      operation.progress={current:++completed,total:profiles.length,label:'HTTPS через серверы: '+completed+' / '+profiles.length};
      publishProgress();
    }
  };
  await Promise.all([worker(),worker()]);
  checkOperation(operation);
  const tested=profiles.filter(item=>item.check?.success && item.check.checkedAt>=deadline-120000);
  tested.sort((a,b)=>a.check.latency-b.check.latency);
  const best=tested[0];
  const next={...readState(),vlessLibrarySecret:encodeVlessUri(JSON.stringify(library))};
  if(auto && best) { next.vlessConfigured=true; next.vlessSecret=encodeVlessUri(best.uri); }
  writeState(next,{rewriteBackup:true});
  return {ok:!auto || Boolean(best),state:publicState(next),message:auto?(best?'Выбран сервер '+best.name+' · '+best.check.latency+' мс. Нажмите «Запустить VPN».':'Рабочий сервер не найден. Прежний выбор сохранён.'):'Проверка серверов завершена. Проверено '+completed+' из '+profiles.length+'.'};
}
registerIpc('vless:autoSelect', async () => {
  if(vlessIsRunning()) return {ok:false,message:'Остановите VPN перед автовыбором.'};
  return checkLibraryServers(true);
});
registerIpc('vless:checkServers', async (_event, id) => checkLibraryServers(false,id));
registerIpc('vless:cancelCheck', () => {
  if (['vless:checkServers','vless:autoSelect'].includes(activeOperation?.kind)) operations.cancel();
  return {ok:true};
});

registerIpc('vless:save', async (_event, raw) => {
  if (vlessIsRunning()) return {ok:false,message:'Остановите VLESS перед сохранением профиля.'};
  const state = readState();
  try {
    const uri = String(raw?.uri || '').trim() || decodeVlessUri(state);
    if (!uri) return { ok: false, message: 'Вставьте VLESS-ссылку.' };
    // Parse before persisting so an invalid secret never replaces a working one.
    const config = createSingBoxConfig(uri, raw);
    const check = await runWithInput(singBoxExecutable(), ['check', '-c', 'stdin'], {input: JSON.stringify(config), signal: activeOperation?.signal});
    checkOperation(activeOperation);
    if (!check.ok) return {ok:false,message:'Параметры VLESS не поддерживаются комплектным движком. Рабочий профиль сохранён.'};
    const vless = createVlessProfile(raw);
    const next = { ...readState(), vless, vlessConfigured: true, vlessSecret: encodeVlessUri(uri), vlessActive: vlessIsRunning() };
    writeState(next);
    pushLog(vless.mode === 'exclude' ? `VPN: ${vless.excludedDomains.length} доменов и ${vless.excludedApps.length} приложений напрямую; остальное через сервер.` : `VLESS-профиль сохранён: ${vless.domains.length} доменов выбрано.`);
    return { ok: true, state: { ...publicState(next), diagnostics: diagnostics(next), logs: readLogs() }, message: 'VLESS-профиль сохранён в шифрованном хранилище Windows.' };
  } catch (error) { return { ok: false, message: error.message || 'Не удалось сохранить VLESS-профиль.' }; }
});
registerIpc('vless:stop', async () => {
  await stopVless();
  return {ok:true,state:publicState(readState()),message:'VPN остановлен.'};
});
registerIpc('vless:toggle', async () => {
  const result = vlessIsRunning() ? { ok: true, state: await stopVless(), message: 'VLESS-маршрутизация остановлена.' } : await startVless();
  if (!result.ok) return result;
  const state = { ...readState(), active: engineIsRunning(), vlessActive: vlessIsRunning() };
  return { ...result, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message: result.message || 'VLESS-маршрутизация включена.' };
});
registerIpc('vless:start', async () => {
  const result = vlessIsRunning() ? { ok: true, state: readState(), message: 'VLESS уже включён.' } : await startVless();
  if (!result.ok) return result;
  const state = { ...result.state, active: engineIsRunning(), vlessActive: vlessIsRunning() };
  return { ...result, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message: result.message || 'VLESS включён.' };
});
registerIpc('vless:speed', async () => {
  if (activeOperation) return {ok:false,message:'Дождитесь завершения другой операции.'};
  if (!vlessIsRunning() || !vlessHealthPort) return {ok:false,message:'Сначала запустите VPN для проверки скорости.'};
  const operation = beginOperation('vless-speed');
  try {
    const report = await checkProxySpeed({port:vlessHealthPort,signal:operation.signal});
    checkOperation(operation);
    return report;
  } catch (error) {
    return {ok:false,message:error.message || 'Не удалось измерить скорость.'};
  } finally {finishOperation(operation);}
});
registerIpc('vless:test', async () => {
  if (activeOperation) return { ok: false, message: 'Дождитесь завершения другой проверки.' };
  const operation = beginOperation('vless-test');
  try {
    const current = readState();
    if (!current.vlessConfigured) return { ok: false, message: 'Сначала сохраните VLESS-профиль.' };
    const uri = decodeVlessUri(current);
    if (!uri) return { ok: false, message: 'Не удалось расшифровать VLESS-профиль. Добавьте ссылку заново.' };
    const report = vlessIsRunning() && vlessHealthPort ? await checkProxyTargets({profile:current.vless,port:vlessHealthPort,signal:operation.signal}) : await runVlessCheck({ uri, profile: current.vless, executable: singBoxExecutable(), signal: operation.signal });
    checkOperation(operation);
    lastVlessCheck={serverId:serverId(uri),success:Boolean(report.ok),checkedAt:report.checkedAt || new Date().toISOString(),latency:report.results?.[0]?.durationMs,detail:report.message};
    if(report.ok)vlessError='';
    report.results.forEach((result) => pushLog(`${result.label} через VLESS: ${result.detail}, ${result.durationMs} мс.`));
    const state = { ...readState(), active: engineIsRunning(), vlessActive: vlessIsRunning() };
    return { ...report, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() } };
  } catch (error) {
    return { ok: false, message: error.message || 'Не удалось проверить VLESS.' };
  } finally { finishOperation(operation); }
});
registerIpc('engine:testStrategy', async (_event, strategy) => {
  if (!STRATEGY_IDS.has(strategy) || strategy === 'auto') return { ok: false, message: 'Неизвестная стратегия.' };
  const operation = beginOperation('test');
  if (!operation) return { ok: false, message: 'Другая проверка уже выполняется.' };
  let state; let testStarted = false;
  try {
    state = readState();
    if (!state.profile.services.length) return { ok: false, message: 'Выберите сервисы для теста.' };
    if ((await otherWinwsPids({ force: true })).length) return { ok: false, message: 'Сначала остановите внешний zapret/Winws: одновременные движки нельзя тестировать корректно.' };
    const session = await prepareDpiCheck(operation,state.profile);
    if (session.errors.length) return dnsFailureReport(session);
    operation.dpiRouteDomains=[...state.profile.domains];
    testStarted = true;
    await stopEngine();
    const profile = createProfile({ ...state.profile, strategy });
    writeState({ ...state, profile, active: false });
    pushLog(`Тест стратегии «${strategy}» начат.`);
    const started = await startEngine();
    if (!started.ok) return started;
    const results = await probeTargets(probesForProfile(profile), { signal: operation.signal, session });
    if (operation.cancelled) return { ok: false, message: 'Проверка остановлена пользователем.' };
    results.forEach((result) => pushLog(`${result.label}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
    const passed = results.every((result) => result.success);
    const message = passed ? `Стратегия «${strategy}» прошла тест.` : `Стратегия «${strategy}» не прошла тест.`;
    const verified = passed
      ? { ...readState(), profile, verifiedStrategy: strategy, active: false }
      : { ...readState(), profile: state.profile, verifiedStrategy: state.verifiedStrategy, active: false };
    writeState(verified);
    pushLog(message);
    return { ok: true, results, message, logs: readLogs() };
  } finally {
    try {
      if (testStarted) await stopEngine();
    } finally {
      const pinned=operation.dpiRouteDomains;delete operation.dpiRouteDomains;
      try {if(pinned && vlessIsRunning())await refreshVlessRouting(null);} finally {finishOperation(operation);}
    }
  }
});
registerIpc('engine:autoSelect', async () => {
  const operation = beginOperation('auto');
  if (!operation) return { ok: false, message: 'Другая проверка уже выполняется.' };
  let state; let original; let bestResults = [];
  try {
    state = readState(); original = state.profile.strategy;
    if (!state.profile.services.length) return { ok: false, message: 'Выберите сервисы для автоподбора.' };
    if ((await otherWinwsPids({force:true})).length) return {ok:false,message:'Сначала остановите внешний zapret/Winws: одновременные движки нельзя тестировать корректно.'};
    const session = await prepareDpiCheck(operation,state.profile);
    if (session.errors.length) return dnsFailureReport(session);
    operation.dpiRouteDomains=[...state.profile.domains];
    if (engineIsRunning()) await stopEngine();
    const strategies = orderedAutoStrategies(state.verifiedStrategy);
    for (const [index, strategy] of strategies.entries()) {
      operation.progress = { strategy, index: index + 1, total: strategies.length };
      publishProgress();
      if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
      const profile = createProfile({ ...state.profile, strategy });
      writeState({ ...state, profile, active: false });
      let keepEngine = false;
      try {
        const started = await startEngine();
        if (!started.ok) { writeState({ ...state, profile: { ...state.profile, strategy: original }, active: false }); return started; }
        const targets = probesForProfile(profile);
        const quickTargets = quickProbesForProfile(profile);
        // First gate: one endpoint per selected service, at most two parallel
        // connections and a short timeout. Full diagnostics run only for a
        // viable candidate, keeping the whole desktop responsive.
        const quickResults = await probeTargets(quickTargets, { timeoutMs: 3200, concurrency: 2, signal: operation.signal, session });
        if (!bestResults.length || quickResults.filter(result=>result.success).length > bestResults.filter(result=>result.success).length) bestResults = quickResults;
        if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
        if (!quickResults.every((result) => result.success)) {
          quickResults.forEach((result) => pushLog(`${result.label} / ${strategy}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
          continue;
        }
        const quickUrls = new Set(quickTargets.map((target) => target.url));
        const detailedTargets = targets.filter((target) => !quickUrls.has(target.url));
        const detailedResults = await probeTargets(detailedTargets, { timeoutMs: 6500, concurrency: 2, signal: operation.signal, session });
        const results = [...quickResults, ...detailedResults];
        bestResults = results;
        if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
        results.forEach((result) => pushLog(`${result.label} / ${strategy}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
        if (results.every((result) => result.success)) {
          const next = { ...readState(), profile, active: true, verifiedStrategy: strategy };
          writeState(next); pushLog(`Автоподбор выбрал стратегию: ${strategy}.`);
          keepEngine = true;
          return { ok: true, state: { ...publicState(next), diagnostics: diagnostics(next), logs: engineLog }, message: `Подобрана стратегия: ${strategy}.` };
        }
      } finally {
        if (!keepEngine) await stopEngine({ silent: true, recover: false });
      }
    }
    const restored = { ...readState(), profile: { ...state.profile, strategy: original }, active: false, verifiedStrategy: state.verifiedStrategy };
    writeState(restored); pushLog('Автоподбор не нашёл рабочую стратегию.');
    return { ok: false, results:bestResults, state:publicState(restored), message: 'Проверка не подтвердила все сервисы. ' + (state.verifiedStrategy ? 'Прежняя стратегия сохранена: её можно запустить без повторного подбора.' : 'Ни одна стратегия не подтверждена.') + ' Результаты ниже.' };
  } finally {
    const pinned=operation.dpiRouteDomains;delete operation.dpiRouteDomains;
    try {if(pinned && vlessIsRunning())await refreshVlessRouting(null);} finally {finishOperation(operation);}
  }
});
registerIpc('autostart:set', async (_event, enabled) => {
  const result = await configureAutoStart(Boolean(enabled));
  if (!result.ok) return result;
  const state = { ...result.state, active: engineIsRunning(), autoStart: cachedAutoStart };
  return { ...result, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() } };
});
registerIpc('external:open', (_event, url) => {
  const allowed = new Set(['https://t.me/TheLocalRoute','https://max.ru/channel_LocalRoute','https://github.com/iKokTot/local-route']);
  if (!allowed.has(url)) return {ok:false,message:'Эта ссылка не разрешена.'};
  return shell.openExternal(url);
});
registerIpc('vless:delete', async () => {
  if (vlessIsRunning()) return {ok:false,message:'Остановите VLESS перед удалением профиля.'};
  const { vlessSecret, vlessLibrarySecret, serverVault, ...state } = readState();
  const next = {...state,vless:createVlessProfile({mode:'exclude'}),vlessConfigured:false,vlessActive:false};
  writeState(next, {rewriteBackup:true});
  cleanupLegacyVlessFiles();
  return {ok:true,state:publicState(next),message:'VLESS-профиль удалён, включая секрет в резервной копии.'};
});
registerIpc('applications:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow,{title:'Выберите приложение для VLESS',properties:['openFile'],filters:[{name:'Приложения Windows',extensions:['exe']}]});
  if (result.canceled || !result.filePaths.length) return {ok:true,canceled:true};
  const name = path.basename(result.filePaths[0]);
  if (!/^[a-z0-9][a-z0-9._ -]{0,120}\.exe$/i.test(name)) return {ok:false,message:'Это имя приложения не поддерживается. Добавьте имя .exe вручную.'};
  return {ok:true,process:name};
});
registerIpc('diagnostics:export', async () => {
  await refreshDiagnostics({force:true});
  const report = diagnosticReport(publicState(readState()),{version:APP_VERSION,network:networkConflicts});
  const result = await dialog.showSaveDialog(mainWindow,{title:'Сохранить диагностику без секретов',defaultPath:'local-route-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});
  if (result.canceled || !result.filePath) return {ok:true,canceled:true};
  await fs.promises.writeFile(result.filePath,JSON.stringify(report,null,2),'utf8');
  return {ok:true,message:'Диагностика сохранена. Ссылки, секреты, списки адресов и журналы в файл не включены.'};
});
