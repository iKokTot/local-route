const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const https = require('node:https');
const dns = require('node:dns').promises;
const { createProfile, createEnginePlan, AUTO_STRATEGIES } = require('./core/profile');
const { buildEngineArgs } = require('./core/engine');

const stateFile = () => path.join(app.getPath('userData'), 'local-route.json');
const defaults = { profile: createProfile({ services: ['youtube', 'discord'] }), enginePath: '', active: false };
let engineProcess = null;
let engineLog = [];
let mainWindow = null;
let tray = null;
let isQuitting = false;
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
function releaseSources() {
  const file = app.isPackaged ? path.join(process.resourcesPath, 'app', 'src', 'config', 'release-sources.json') : path.join(__dirname, 'config', 'release-sources.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function logFile() { return path.join(app.getPath('userData'), 'engine.log'); }
function pushLog(message) {
  const line = `${new Date().toLocaleTimeString('ru-RU')}  ${message}`;
  engineLog = [line, ...engineLog].slice(0, 40);
  try { fs.appendFileSync(logFile(), `${line}\n`, 'utf8'); } catch { /* logging must not break connection control */ }
}
function engineExecutable() { return path.join(engineRoot(), 'bin', 'winws.exe'); }
function localRouteEnginePids() {
  const script = "$all=@(Get-CimInstance Win32_Process);$routes=@($all|Where-Object {$_.Name -eq 'Local Route.exe'}|ForEach-Object {$_.ProcessId});@($all|Where-Object {$_.Name -eq 'winws.exe' -and $routes -contains $_.ParentProcessId}|ForEach-Object {$_.ProcessId})|ConvertTo-Json -Compress";
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
    if (!raw) return [];
    const result = JSON.parse(raw);
    return Array.isArray(result) ? result.map(Number) : [Number(result)];
  } catch { return []; }
}
function otherWinwsPids() {
  try {
    const rows = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return rows.split(/\r?\n/).map((line) => /^"winws\.exe","(\d+)"/i.exec(line)?.[1]).filter(Boolean).map(Number).filter((pid) => pid !== engineProcess?.pid);
  } catch { return []; }
}
function stopEngine() {
  if (engineProcess) expectedStops.add(engineProcess);
  const pids = [...new Set([engineProcess?.pid, ...localRouteEnginePids()].filter(Boolean))];
  for (const pid of pids) {
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* process may have exited between checks */ }
  }
  engineProcess = null;
  const state = { ...readState(), active: false }; writeState(state); pushLog('Движок остановлен.');
  return state;
}
function waitForEarlyExit(child, timeoutMs = 900) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); resolve({ error }); });
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code }); });
  });
}
function probe(url) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (success, detail) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ success, detail, durationMs: Date.now() - startedAt }); } };
    const request = https.get(url, { timeout: 5500, headers: { 'User-Agent': 'LocalRoute/0.1' } }, (response) => {
      response.resume();
      const success = response.statusCode >= 200 && response.statusCode < 500;
      finish(success, `HTTP ${response.statusCode}`);
    });
    const timer = setTimeout(() => { request.destroy(); finish(false, 'Тайм-аут 6,5 с'); }, 6500);
    request.once('timeout', () => { request.destroy(); finish(false, 'Тайм-аут соединения'); });
    request.once('error', (error) => finish(false, `${error.code || 'Ошибка сети'}: ${error.message}`));
  });
}
function probesForProfile(profile) {
  return profile.services.flatMap((service) => (SERVICE_PROBES[service] || []).map((target) => ({ service, ...target })));
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
  if (engineProcess && !engineProcess.killed) return { ok: true, state };
  const existing = otherWinwsPids();
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
    return { ...defaults, ...saved, profile: createProfile(saved.profile) };
  } catch { return defaults; }
}
function writeState(next) { fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2), 'utf8'); }
function readLogs() {
  try { return fs.readFileSync(logFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-80).reverse(); } catch { return engineLog; }
}
function diagnostics(state) {
  const localRoutePids = localRouteEnginePids();
  const items = [
    { label: 'Профиль', value: state.profile.domains.length ? `${state.profile.domains.length} доменов выбрано` : 'Сервисы не выбраны', level: state.profile.domains.length ? 'ok' : 'warning' },
    { label: 'Сетевой движок', value: otherWinwsPids().length ? 'Обнаружен внешний winws — возможен конфликт' : (localRoutePids.length ? 'Запущен Local Route' : (fs.existsSync(engineExecutable()) ? 'Готов к запуску' : 'Не найден в сборке')), level: otherWinwsPids().length ? 'warning' : (localRoutePids.length ? 'ok' : 'neutral') },
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
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}
function trayImage() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 48 48"><rect width="48" height="48" rx="15" fill="#98F5C0"/><path d="M12 34h10V25h8l6-11m-6-1 6-1 1 6" fill="none" stroke="#10271D" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="34" r="4" fill="#10271D"/><circle cx="22" cy="25" r="2.5" fill="#98F5C0" stroke="#10271D" stroke-width="3"/></svg>';
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Local Route');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Local Route', click: showMainWindow },
    { label: 'Остановить локальную защиту', click: () => stopEngine() },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() }
  ]));
  tray.on('click', showMainWindow);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 650,
    title: 'Local Route',
    backgroundColor: '#10131a',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  createTray();
  createWindow();
  app.on('activate', showMainWindow);
});
app.on('before-quit', () => { isQuitting = true; if (activeOperation) activeOperation.cancelled = true; stopEngine(); });

ipcMain.handle('state:read', () => { const state = { ...readState(), active: Boolean(localRouteEnginePids().length) }; return { ...state, diagnostics: diagnostics(state), logs: readLogs() }; });
ipcMain.handle('profile:save', (_event, raw) => {
  if (engineProcess && !engineProcess.killed) stopEngine();
  const state = readState();
  const profile = createProfile(raw);
  const next = { ...state, profile, active: false };
  writeState(next);
  return { ...next, diagnostics: diagnostics(next), plan: createEnginePlan(profile) };
});
ipcMain.handle('engine:toggle', async () => {
  if (activeOperation) return { ok: false, message: 'Сначала остановите или дождитесь завершения текущей проверки.' };
  const result = engineProcess && !engineProcess.killed ? { ok: true, state: stopEngine() } : await startEngine();
  if (!result.ok) return result;
  return { ok: true, state: { ...result.state, active: Boolean(engineProcess && !engineProcess.killed), diagnostics: diagnostics({ ...result.state, active: Boolean(engineProcess && !engineProcess.killed) }), logs: engineLog } };
});
ipcMain.handle('engine:stop', () => {
  if (activeOperation) activeOperation.cancelled = true;
  const state = stopEngine();
  return { ...state, active: false, diagnostics: diagnostics(state), logs: readLogs() };
});
ipcMain.handle('engine:testStrategy', async (_event, strategy) => {
  if (!AUTO_STRATEGIES.includes(strategy)) return { ok: false, message: 'Неизвестная стратегия.' };
  const operation = beginOperation('test');
  if (!operation) return { ok: false, message: 'Другая проверка уже выполняется.' };
  const state = readState();
  try {
    if (!state.profile.services.length) return { ok: false, message: 'Выберите сервисы для теста.' };
    if (otherWinwsPids().length) return { ok: false, message: 'Сначала остановите внешний zapret/Winws: одновременные движки нельзя тестировать корректно.' };
    stopEngine();
    const profile = createProfile({ ...state.profile, strategy });
    writeState({ ...state, profile, active: false });
    pushLog(`Тест стратегии «${strategy}» начат.`);
    const started = await startEngine();
    if (!started.ok) return started;
    const results = await Promise.all(probesForProfile(profile).map(async (target) => ({ ...target, ...(await probe(target.url)) })));
    if (operation.cancelled) return { ok: false, message: 'Проверка остановлена пользователем.' };
    results.forEach((result) => pushLog(`${result.label}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
    const message = results.every((result) => result.success) ? `Стратегия «${strategy}» прошла тест.` : `Стратегия «${strategy}» не прошла тест.`;
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
    if (engineProcess && !engineProcess.killed) stopEngine();
    for (const strategy of AUTO_STRATEGIES) {
      if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
      const profile = createProfile({ ...state.profile, strategy });
      writeState({ ...state, profile, active: false });
      let keepEngine = false;
      try {
        const started = await startEngine();
        if (!started.ok) { writeState({ ...state, profile: { ...state.profile, strategy: original }, active: false }); return started; }
        const targets = probesForProfile(profile);
        const results = await Promise.all(targets.map((target) => probe(target.url)));
        if (operation.cancelled) return { ok: false, message: 'Автоподбор остановлен пользователем.' };
        results.forEach((result, index) => pushLog(`${targets[index].label} / ${strategy}: ${result.success ? 'успешно' : 'ошибка'} — ${result.detail}, ${result.durationMs} мс.`));
        if (results.every((result) => result.success)) {
          const next = { ...readState(), profile, active: true };
          writeState(next); pushLog(`Автоподбор выбрал стратегию: ${strategy}.`);
          keepEngine = true;
          return { ok: true, state: { ...next, diagnostics: diagnostics(next), logs: engineLog }, message: `Подобрана стратегия: ${strategy}.` };
        }
      } finally {
        if (!keepEngine) stopEngine();
      }
    }
    const restored = { ...readState(), profile: { ...state.profile, strategy: original }, active: false };
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
ipcMain.handle('external:open', (_event, url) => shell.openExternal(url));
