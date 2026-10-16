const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const https = require('node:https');
const dns = require('node:dns').promises;
const { createProfile, createEnginePlan, orderedAutoStrategies, STRATEGY_IDS } = require('./core/profile');
const { buildEngineArgs } = require('./core/engine');
const { createTaskArgs, deleteTaskArgs, queryTaskArgs } = require('./core/autostart');
const { createVlessProfile, createSingBoxConfig, vlessProbe } = require('./core/vless');

const stateFile = () => path.join(app.getPath('userData'), 'local-route.json');
const defaults = { profile: createProfile({ services: ['youtube', 'discord'] }), enginePath: '', active: false, autoStart: false, verifiedStrategy: null, vless: createVlessProfile(), vlessConfigured: false, vlessActive: false };
const launchedFromAutoStart = process.argv.includes('--autostart');
let engineProcess = null;
let vlessProcess = null;
let engineLog = [];
let mainWindow = null;
let tray = null;
let isQuitting = false;
let mainWindowReady = false;
let showWindowWhenReady = false;
let cachedAutoStart = false;
let externalWinwsCache = { checkedAt: 0, pids: [] };
let logWritesSinceTrim = 0;
const expectedStops = new WeakSet();
let activeOperation = null;
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
  if (activeOperation) return null;
  activeOperation = { kind, cancelled: false };
  return activeOperation;
}
function finishOperation(operation) {
  if (activeOperation === operation) activeOperation = null;
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
function stopVless({ silent = false } = {}) {
  const child = vlessProcess;
  if (child) expectedStops.add(child);
  if (child?.pid) {
    // Do not block Electron's main thread while Windows tears down the TUN
    // adapter. The process is detached from the UI state immediately.
    try { child.kill(); } catch { /* process may already be gone */ }
    try { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref(); } catch { /* process may already be gone */ }
  }
  vlessProcess = null;
  const state = { ...readState(), vlessActive: false };
  if (!silent) { writeState(state); pushLog('VLESS-маршрутизация остановлена.'); }
  return state;
}
function runChecked(executable, args, { timeoutMs = 7000 } = {}) {
  return new Promise((resolve) => {
    let output = ''; let done = false; let timer;
    const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };
    let child;
    try {
      child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk) => { output += String(chunk); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      child.once('error', (error) => finish({ ok: false, output: error.message }));
      child.once('exit', (code) => finish({ ok: code === 0, output }));
    } catch (error) { finish({ ok: false, output: error.message }); }
    timer = setTimeout(() => { try { child?.kill(); } catch {} finish({ ok: false, output: 'Превышено время проверки конфигурации.' }); }, timeoutMs);
  });
}
async function discoverDesktopApps() {
  if (process.platform !== 'win32') return [];
  const script = "$paths=@(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),(Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs');$w=New-Object -ComObject WScript.Shell;$items=Get-ChildItem -Path $paths -Filter *.lnk -Recurse -ErrorAction SilentlyContinue|ForEach-Object {$t=$w.CreateShortcut($_.FullName).TargetPath;if($t -match '\\.exe$'){[pscustomobject]@{name=$_.BaseName;process=[IO.Path]::GetFileName($t)}}}|Sort-Object name -Unique|Select-Object -First 80;$items|ConvertTo-Json -Compress";
  const result = await runChecked('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 9000 });
  if (!result.ok || !result.output.trim()) return [];
  try {
    const parsed = JSON.parse(result.output);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((item) => item && typeof item.name === 'string' && /^[a-z0-9][a-z0-9._ -]{0,120}\.exe$/i.test(item.process || ''));
  } catch { return []; }
}
async function startVless() {
  const state = readState();
  if (vlessIsRunning()) return { ok: true, state };
  if (!state.vlessConfigured) return { ok: false, message: 'Сначала добавьте VLESS-ссылку.' };
  const executable = singBoxExecutable();
  if (!fs.existsSync(executable)) return { ok: false, message: 'VLESS-движок sing-box не найден в сборке.' };
  const uri = decodeVlessUri(state);
  if (!uri) return { ok: false, message: 'Не удалось расшифровать VLESS-профиль. Добавьте ссылку заново.' };
  fs.mkdirSync(path.dirname(vlessConfigPath()), { recursive: true });
  let config;
  try { config = createSingBoxConfig(uri, state.vless); } catch (error) { return { ok: false, message: `VLESS-профиль некорректен: ${error.message}` }; }
  fs.writeFileSync(vlessConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  const check = await runChecked(executable, ['check', '-c', vlessConfigPath()]);
  if (!check.ok) {
    const detail = String(check.output || '').trim().split(/\r?\n/).pop();
    return { ok: false, message: `VLESS-конфигурация не прошла проверку${detail ? `: ${detail}` : '.'}` };
  }
  const child = spawn(executable, ['run', '-c', vlessConfigPath()], { windowsHide: true, cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'] });
  vlessProcess = child;
  const writeOutput = (chunk) => String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => pushLog(`[vless] ${line}`));
  child.stdout?.on('data', writeOutput); child.stderr?.on('data', writeOutput);
  child.once('error', (error) => { pushLog(`VLESS: ошибка запуска: ${error.message}`); if (vlessProcess === child) vlessProcess = null; });
  child.once('exit', (code) => { if (!expectedStops.has(child) && code !== null) pushLog(`VLESS неожиданно завершился с кодом ${code}.`); if (vlessProcess === child) vlessProcess = null; });
  const earlyExit = await waitForEarlyExit(child, 1300);
  if (earlyExit) {
    vlessProcess = null;
    return { ok: false, message: 'VLESS-движок завершился при запуске. Откройте технический журнал.' };
  }
  const next = { ...state, vlessActive: true };
  writeState(next); pushLog(state.vless.mode === 'all' ? 'VLESS включён: весь интернет направляется в туннель.' : `VLESS включён: ${state.vless.domains.length} доменов направляются в туннель.`);
  return { ok: true, state: next };
}
function releaseSources() {
  const file = app.isPackaged ? path.join(process.resourcesPath, 'app', 'src', 'config', 'release-sources.json') : path.join(__dirname, 'config', 'release-sources.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
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
  const line = `${new Date().toLocaleTimeString('ru-RU')}  ${message}`;
  engineLog = [line, ...engineLog].slice(0, 40);
  try {
    fs.appendFileSync(logFile(), `${line}\n`, 'utf8');
    if (++logWritesSinceTrim >= 100) { logWritesSinceTrim = 0; trimLogFile(); }
  } catch { /* logging must not break connection control */ }
}
function engineExecutable() { return path.join(engineRoot(), 'bin', 'winws.exe'); }
function engineIsRunning() { return Boolean(engineProcess && !engineProcess.killed && engineProcess.exitCode === null); }
function localRouteEnginePids() {
  const script = "$all=@(Get-CimInstance Win32_Process);$routes=@($all|Where-Object {$_.Name -eq 'Local Route.exe'}|ForEach-Object {$_.ProcessId});@($all|Where-Object {$_.Name -eq 'winws.exe' -and $routes -contains $_.ParentProcessId}|ForEach-Object {$_.ProcessId})|ConvertTo-Json -Compress";
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
    if (!raw) return [];
    const result = JSON.parse(raw);
    return Array.isArray(result) ? result.map(Number) : [Number(result)];
  } catch { return []; }
}
function otherWinwsPids({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - externalWinwsCache.checkedAt < 2500) return externalWinwsCache.pids;
  try {
    const rows = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    const pids = rows.split(/\r?\n/).map((line) => /^"winws\.exe","(\d+)"/i.exec(line)?.[1]).filter(Boolean).map(Number).filter((pid) => pid !== engineProcess?.pid);
    externalWinwsCache = { checkedAt: now, pids };
    return pids;
  } catch {
    externalWinwsCache = { checkedAt: now, pids: [] };
    return [];
  }
}
function stopEngine({ silent = false, recover = true } = {}) {
  if (engineProcess) expectedStops.add(engineProcess);
  // The tracked child is the normal path. The slower CIM lookup is only a
  // recovery path for a process left behind after an earlier app crash.
  const recoveredPids = !recover || engineIsRunning() ? [] : localRouteEnginePids();
  const pids = [...new Set([engineProcess?.pid, ...recoveredPids].filter(Boolean))];
  for (const pid of pids) {
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* process may have exited between checks */ }
  }
  engineProcess = null;
  const state = { ...readState(), active: false };
  if (!silent) { writeState(state); pushLog('Движок остановлен.'); }
  return state;
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
function probe(url, { timeoutMs = 6500 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (success, detail) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ success, detail, durationMs: Date.now() - startedAt }); } };
    const request = https.get(url, { timeout: Math.max(1000, timeoutMs - 800), headers: { 'User-Agent': 'LocalRoute/0.1' } }, (response) => {
      response.resume();
      const success = response.statusCode >= 200 && response.statusCode < 500;
      finish(success, `HTTP ${response.statusCode}`);
    });
    const timer = setTimeout(() => { request.destroy(); finish(false, `Тайм-аут ${(timeoutMs / 1000).toLocaleString('ru-RU')} с`); }, timeoutMs);
    request.once('timeout', () => { request.destroy(); finish(false, 'Тайм-аут соединения'); });
    request.once('error', (error) => finish(false, `${error.code || 'Ошибка сети'}: ${error.message}`));
  });
}
function probesForProfile(profile) {
  return profile.services.flatMap((service) => (SERVICE_PROBES[service] || []).map((target) => ({ service, ...target })));
}
function quickProbesForProfile(profile) {
  const targets = probesForProfile(profile);
  return profile.services.map((service) => targets.find((target) => target.service === service)).filter(Boolean);
}
async function probeTargets(targets, { timeoutMs = 6500, concurrency = 2 } = {}) {
  const results = new Array(targets.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < targets.length) {
      const index = nextIndex++;
      results[index] = { ...targets[index], ...(await probe(targets[index].url, { timeoutMs })) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}
async function resolveTelegramAddresses() {
  const settled = await Promise.allSettled(TELEGRAM_DC_HOSTS.map((host) => dns.resolve4(host)));
  return [...new Set(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []))];
}
function telegramProxyConnection() {
  const script = "$p=@(Get-Process Telegram -ErrorAction SilentlyContinue|% Id);if($p.Count){$c=Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue|?{$p -contains $_.OwningProcess -and ($_.RemoteAddress -eq '127.0.0.1' -or $_.RemoteAddress -eq '::1')}|select -First 1 RemoteAddress,RemotePort;if($c){$c|ConvertTo-Json -Compress}}";
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function startEngine() {
  const state = readState();
  if (engineIsRunning()) return { ok: true, state };
  const existing = otherWinwsPids({ force: true });
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
    if (earlyExit) {
      engineProcess = null;
      const reason = earlyExit.error ? earlyExit.error.message : `код ${earlyExit.code}`;
      pushLog(`Движок не запущен: ${reason}`);
      return { ok: false, message: 'Движок завершился до запуска. Откройте журнал: там указана причина от winws.' };
    }
    const next = { ...state, active: true }; writeState(next); pushLog(`Движок запущен: ${state.profile.strategy}.`);
    return { ok: true, state: next };
  } catch (error) { return { ok: false, message: `Не удалось запустить движок: ${error.message}` }; }
}

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return { ...defaults, ...saved, profile: createProfile(saved.profile), vless: createVlessProfile(saved.vless) };
  } catch { return defaults; }
}
function writeState(next) { fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2), 'utf8'); }
function publicState(next) {
  const { vlessSecret, ...safe } = next;
  return { ...safe, active: engineIsRunning(), vlessActive: vlessIsRunning() };
}
function profilesTargetSame(left, right) {
  return left.services.join('\n') === right.services.join('\n') && left.domains.join('\n') === right.domains.join('\n');
}
function scheduledTaskExists() {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('schtasks.exe', queryTaskArgs(), { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch { return false; }
}
function configureAutoStart(enabled) {
  if (process.platform !== 'win32' || !app.isPackaged) return { ok: false, message: 'Автозапуск доступен только в собранной Windows-версии.' };
  const state = readState();
  if (enabled && !state.verifiedStrategy) return { ok: false, message: 'Сначала запустите автоподбор и подтвердите рабочую стратегию.' };
  try {
    if (enabled) execFileSync('schtasks.exe', createTaskArgs(process.execPath), { windowsHide: true, stdio: 'ignore' });
    else if (scheduledTaskExists()) execFileSync('schtasks.exe', deleteTaskArgs(), { windowsHide: true, stdio: 'ignore' });
    cachedAutoStart = enabled;
    const next = { ...state, autoStart: enabled };
    writeState(next);
    pushLog(enabled ? 'Автозапуск Windows включён.' : 'Автозапуск Windows отключён.');
    return { ok: true, state: next, message: enabled ? 'Автозапуск включён. При входе в Windows Local Route запустится в трее.' : 'Автозапуск отключён.' };
  } catch {
    return { ok: false, message: 'Не удалось изменить автозапуск. Запустите Local Route от имени администратора.' };
  }
}
function readLogs() {
  try { return fs.readFileSync(logFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-80).reverse(); } catch { return engineLog; }
}
function diagnostics(state) {
  const localEngineRunning = engineIsRunning();
  const localVlessRunning = vlessIsRunning();
  const externalWinwsPids = otherWinwsPids();
  const items = [
    { label: 'Профиль', value: state.profile.domains.length ? `${state.profile.domains.length} доменов выбрано` : 'Сервисы не выбраны', level: state.profile.domains.length ? 'ok' : 'warning' },
    { label: 'Сетевой движок', value: externalWinwsPids.length ? 'Обнаружен внешний winws — возможен конфликт' : (localEngineRunning ? 'Запущен Local Route' : (fs.existsSync(engineExecutable()) ? 'Готов к запуску' : 'Не найден в сборке')), level: externalWinwsPids.length ? 'warning' : (localEngineRunning ? 'ok' : 'neutral') },
    { label: 'VLESS-маршрутизация', value: state.vlessConfigured ? (localVlessRunning ? (state.vless.mode === 'all' ? 'Весь интернет через туннель' : `${state.vless.domains.length} доменов через туннель`) : 'Профиль готов к запуску') : 'Не настроена', level: localVlessRunning ? 'ok' : (state.vlessConfigured ? 'neutral' : 'warning') },
    { label: 'Приватность', value: 'Трафик и диагностика остаются на устройстве', level: 'ok' }
  ];
  if (state.profile.services.includes('telegram')) {
    const proxy = telegramProxyConnection();
    items.splice(2, 0, proxy
      ? { label: 'Telegram Desktop', value: `Сейчас использует локальный прокси ${proxy.RemoteAddress}:${proxy.RemotePort}; Local Route не видит его прямой трафик`, level: 'warning' }
      : { label: 'Telegram Desktop', value: 'Прямое соединение — доступна локальная обработка MTProto', level: 'ok' });
  }
  return items;
}

function showMainWindow() {
  showWindowWhenReady = true;
  if (!mainWindow) {
    createWindow({ showOnReady: true });
    return;
  }
  if (!mainWindowReady) return;
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
    { label: 'Остановить всё', click: () => { stopEngine(); stopVless(); } },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() }
  ]));
  tray.on('click', showMainWindow);
}
function createWindow({ showOnReady = true } = {}) {
  mainWindowReady = false;
  showWindowWhenReady = showOnReady;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 920,
    minHeight: 760,
    show: false,
    title: 'Local Route',
    icon: appIcon(),
    backgroundColor: '#10131a',
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
  mainWindow.on('minimize', (event) => { event.preventDefault(); mainWindow.hide(); });
  mainWindow.on('closed', () => { mainWindow = null; mainWindowReady = false; });
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindowReady = true;
    mainWindow.maximize();
    if (showWindowWhenReady) {
      mainWindow.show();
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else app.on('second-instance', showMainWindow);

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.localroute.app');
  trimLogFile();
  cachedAutoStart = scheduledTaskExists();
  createTray();
  if (!launchedFromAutoStart) createWindow();
  else {
    const state = readState();
    if (state.autoStart && state.verifiedStrategy) {
      writeState({ ...state, profile: { ...state.profile, strategy: state.verifiedStrategy }, active: false });
      pushLog(`Автозапуск: включаю подтверждённую стратегию ${state.verifiedStrategy}.`);
      const result = await startEngine();
      if (!result.ok) pushLog(`Автозапуск не включил защиту: ${result.message}`);
    } else pushLog('Автозапуск пропущен: нет подтверждённой стратегии.');
    if (state.autoStart && state.vlessConfigured) {
      const result = await startVless();
      if (!result.ok) pushLog(`Автозапуск не включил VLESS: ${result.message}`);
    }
    // Do not compete with Windows sign-in. Once the desktop is usable, load
    // the renderer invisibly so opening from tray is instant.
    const warmup = setTimeout(() => { if (!mainWindow && !isQuitting) createWindow({ showOnReady: false }); }, 8000);
    warmup.unref?.();
  }
  app.on('activate', showMainWindow);
});
app.on('before-quit', () => { isQuitting = true; if (activeOperation) activeOperation.cancelled = true; stopEngine(); stopVless(); });

ipcMain.handle('state:read', () => { const state = { ...readState(), active: engineIsRunning(), autoStart: cachedAutoStart, vlessActive: vlessIsRunning() }; return { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }; });
ipcMain.handle('profile:save', (_event, raw) => {
  if (engineIsRunning()) stopEngine();
  const state = readState();
  const profile = createProfile(raw);
  // Keep the validated option when a user simply opens the panel or saves an
  // unchanged set of domains. Any route change still forces a fresh test.
  const next = { ...state, profile, active: false, verifiedStrategy: profilesTargetSame(state.profile, profile) ? state.verifiedStrategy : null };
  writeState(next);
  return { ...publicState(next), diagnostics: diagnostics(next), plan: createEnginePlan(profile) };
});
ipcMain.handle('engine:toggle', async () => {
  if (activeOperation) return { ok: false, message: 'Сначала остановите или дождитесь завершения текущей проверки.' };
  const result = engineIsRunning() ? { ok: true, state: stopEngine() } : await startEngine();
  if (!result.ok) return result;
  const state = { ...result.state, active: engineIsRunning() };
  return { ok: true, state: { ...publicState(state), diagnostics: diagnostics(state), logs: engineLog } };
});
ipcMain.handle('engine:startVerified', async () => {
  if (activeOperation) return { ok: false, message: 'Сначала остановите или дождитесь завершения текущей проверки.' };
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
ipcMain.handle('network:startAll', async () => {
  if (activeOperation) return { ok: false, message: 'Дождитесь завершения проверки Zapret.' };
  const current = readState();
  let engineResult = { ok: true, state: current }; let engineSkipped = false;
  if (!engineIsRunning()) {
    if (!current.verifiedStrategy) engineSkipped = true;
    else {
      const next = { ...current, profile: createProfile({ ...current.profile, strategy: current.verifiedStrategy }) };
      writeState(next);
      engineResult = await startEngine();
      if (!engineResult.ok) return engineResult;
    }
  }
  let vlessMessage = '';
  if (current.vlessConfigured && !vlessIsRunning()) {
    const vlessResult = await startVless();
    if (!vlessResult.ok) return { ok: false, message: `Zapret запущен, но VLESS не включился: ${vlessResult.message}` };
    vlessMessage = ' VLESS также включён.';
  }
  const state = { ...readState(), active: engineIsRunning(), vlessActive: vlessIsRunning() };
  const message = engineSkipped
    ? (vlessMessage ? 'VLESS включён. Zapret пока не запускался: сначала подтвердите стратегию на отдельной вкладке.' : 'Сначала подтвердите стратегию Zapret на отдельной вкладке.')
    : `Защита запущена.${vlessMessage}`;
  return { ok: true, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message };
});
ipcMain.handle('network:stopAll', () => {
  if (activeOperation) activeOperation.cancelled = true;
  stopEngine(); stopVless();
  const state = { ...readState(), active: false, vlessActive: false };
  return { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() };
});
ipcMain.handle('engine:stop', () => {
  if (activeOperation) activeOperation.cancelled = true;
  const state = stopEngine();
  return { ...publicState(state), active: false, diagnostics: diagnostics(state), logs: readLogs() };
});
ipcMain.handle('vless:save', (_event, raw) => {
  const state = readState();
  try {
    const uri = String(raw?.uri || '').trim() || decodeVlessUri(state);
    if (!uri) return { ok: false, message: 'Вставьте VLESS-ссылку.' };
    // Parse before persisting so an invalid secret never replaces a working one.
    createSingBoxConfig(uri, raw);
    const vless = createVlessProfile(raw);
    const next = { ...state, vless, vlessConfigured: true, vlessSecret: encodeVlessUri(uri), vlessActive: vlessIsRunning() };
    writeState(next);
    pushLog(`VLESS-профиль сохранён: ${vless.domains.length} доменов выбрано.`);
    return { ok: true, state: { ...publicState(next), diagnostics: diagnostics(next), logs: readLogs() }, message: 'VLESS-профиль сохранён в шифрованном хранилище Windows.' };
  } catch (error) { return { ok: false, message: error.message || 'Не удалось сохранить VLESS-профиль.' }; }
});
ipcMain.handle('vless:toggle', async () => {
  const result = vlessIsRunning() ? { ok: true, state: stopVless(), message: 'VLESS-маршрутизация остановлена.' } : await startVless();
  if (!result.ok) return result;
  const state = { ...result.state, active: engineIsRunning(), vlessActive: vlessIsRunning() };
  return { ...result, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message: result.message || 'VLESS-маршрутизация включена.' };
});
ipcMain.handle('vless:start', async () => {
  const result = vlessIsRunning() ? { ok: true, state: readState(), message: 'VLESS уже включён.' } : await startVless();
  if (!result.ok) return result;
  const state = { ...result.state, active: engineIsRunning(), vlessActive: vlessIsRunning() };
  return { ...result, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message: result.message || 'VLESS включён.' };
});
ipcMain.handle('vless:apps', async () => {
  const apps = await discoverDesktopApps();
  return { ok: true, apps };
});
ipcMain.handle('vless:test', async () => {
  if (activeOperation) return { ok: false, message: 'Дождитесь завершения другой проверки.' };
  const operation = beginOperation('vless-test');
  try {
    const current = readState();
    if (!current.vlessConfigured) return { ok: false, message: 'Сначала сохраните VLESS-профиль.' };
    const target = vlessProbe(current.vless);
    if (!target) return { ok: false, message: 'Выберите сервис для VLESS или включите режим «Весь интернет».' };
    const wasRunning = vlessIsRunning();
    const started = wasRunning ? { ok: true } : await startVless();
    if (!started.ok) return started;
    const result = await probe(target.url, { timeoutMs: 8000 });
    pushLog(`${target.label} через VLESS: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`);
    if (!wasRunning) stopVless({ silent: true });
    const state = { ...readState(), active: engineIsRunning(), vlessActive: vlessIsRunning() };
    return { ok: result.success, result: { ...target, ...result }, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() }, message: result.success ? `VLESS-маршрут «${target.label}» работает.` : `VLESS-маршрут «${target.label}» не ответил: ${result.detail}.` };
  } finally { finishOperation(operation); }
});
ipcMain.handle('engine:testStrategy', async (_event, strategy) => {
  if (!STRATEGY_IDS.has(strategy) || strategy === 'auto') return { ok: false, message: 'Неизвестная стратегия.' };
  const operation = beginOperation('test');
  if (!operation) return { ok: false, message: 'Другая проверка уже выполняется.' };
  const state = readState();
  try {
    if (!state.profile.services.length) return { ok: false, message: 'Выберите сервисы для теста.' };
    if (otherWinwsPids({ force: true }).length) return { ok: false, message: 'Сначала остановите внешний zapret/Winws: одновременные движки нельзя тестировать корректно.' };
    stopEngine();
    const profile = createProfile({ ...state.profile, strategy });
    writeState({ ...state, profile, active: false });
    pushLog(`Тест стратегии «${strategy}» начат.`);
    const started = await startEngine();
    if (!started.ok) return started;
    const results = await probeTargets(probesForProfile(profile));
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
    stopEngine();
    finishOperation(operation);
  }
});
ipcMain.handle('engine:autoSelect', async () => {
  const operation = beginOperation('auto');
  if (!operation) return { ok: false, message: 'Другая проверка уже выполняется.' };
  const state = readState();
  const original = state.profile.strategy;
  try {
    if (!state.profile.services.length) return { ok: false, message: 'Выберите сервисы для автоподбора.' };
    if (engineIsRunning()) stopEngine();
    for (const strategy of orderedAutoStrategies(state.verifiedStrategy)) {
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
        const quickResults = await probeTargets(quickTargets, { timeoutMs: 3200, concurrency: 2 });
        if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
        if (!quickResults.every((result) => result.success)) {
          quickResults.forEach((result) => pushLog(`${result.label} / ${strategy}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
          continue;
        }
        const quickUrls = new Set(quickTargets.map((target) => target.url));
        const detailedTargets = targets.filter((target) => !quickUrls.has(target.url));
        const detailedResults = await probeTargets(detailedTargets, { timeoutMs: 6500, concurrency: 2 });
        const results = [...quickResults, ...detailedResults];
        if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
        results.forEach((result, index) => pushLog(`${targets[index].label} / ${strategy}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
        if (results.every((result) => result.success)) {
          const next = { ...readState(), profile, active: true, verifiedStrategy: strategy };
          writeState(next); pushLog(`Автоподбор выбрал стратегию: ${strategy}.`);
          keepEngine = true;
          return { ok: true, state: { ...publicState(next), diagnostics: diagnostics(next), logs: engineLog }, message: `Подобрана стратегия: ${strategy}.` };
        }
      } finally {
        if (!keepEngine) stopEngine({ silent: true, recover: false });
      }
    }
    const restored = { ...readState(), profile: { ...state.profile, strategy: original }, active: false, verifiedStrategy: null };
    writeState(restored); pushLog('Автоподбор не нашёл рабочую стратегию.');
    return { ok: false, message: 'Автоподбор не подтвердил доступность всех выбранных сервисов. Откройте журнал — теперь там указана точная причина каждого сбоя.' };
  } finally {
    finishOperation(operation);
  }
});
ipcMain.handle('updates:check', () => {
  const source = releaseSources();
  if (!source.manifestUrl) return { channel: 'stable', status: 'waiting_for_manifest', message: source.telegramChannel ? 'Ссылка на канал сохранена. Ждём адрес подписанного манифеста.' : 'Канал обновлений подготовлен. Добавим ссылку на Telegram, когда ты её передашь.' };
  return { channel: 'stable', status: 'configured', message: 'Источник обновлений настроен. Проверка манифеста будет добавлена вместе с первым релизом.' };
});
ipcMain.handle('autostart:set', (_event, enabled) => {
  const result = configureAutoStart(Boolean(enabled));
  if (!result.ok) return result;
  const state = { ...result.state, active: engineIsRunning(), autoStart: cachedAutoStart };
  return { ...result, state: { ...publicState(state), diagnostics: diagnostics(state), logs: readLogs() } };
});
ipcMain.handle('external:open', (_event, url) => shell.openExternal(url));
