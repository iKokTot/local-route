const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Zapret auto-selection stays on its dedicated strategy page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.equal((html.match(/data-auto-select/g) || []).length, 1);
  assert.match(html, /Проверка стратегий/);
  assert.match(html, /Автоподбор всех стратегий/);
});

test('management exposes a single all-network start and stop control', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="start-all"/);
  assert.match(html, /id="stop-all"/);
  assert.equal((html.match(/stop-engine/g) || []).length, 1);
});

test('strategy results have one destination and raw logs are separated', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.equal((html.match(/id="test-results"/g) || []).length, 1);
  assert.match(html, /id="activity-log"/);
  assert.match(html, /class="technical-log"/);
});

test('window behavior includes a visible Windows title bar and keeps its renderer warm in tray', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const routing = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'vless.js'), 'utf8');
  assert.match(main, /new Tray/);
  assert.match(main, /Открыть Local Route/);
  assert.match(main, /mainWindow\.hide\(\)/);
  assert.match(main, /createWindow\(\{ showOnReady: false \}\)/);
  assert.doesNotMatch(main, /titleBarStyle:\s*'hidden'/);
});

test('tray state avoids spawning scheduled-task and process checks on every renderer read', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /let cachedAutoStart = false/);
  assert.match(main, /autoStart: cachedAutoStart/);
  assert.match(main, /externalWinwsCache/);
  assert.match(main, /otherWinwsPids\(\{ force: true \}\)/);
});

test('routine status checks use the tracked engine instead of a PowerShell process scan', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /function engineIsRunning\(\)/);
  assert.match(main, /active: engineIsRunning\(\)/);
  assert.doesNotMatch(main, /active: Boolean\(localRouteEnginePids\(\)\.length\)/);
});

test('Windows window and tray use the rasterized Local Route icon', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const icon = path.join(root, 'src', 'renderer', 'assets', 'local-route-logo-256.png');
  assert.match(main, /local-route-logo-256\.png/);
  assert.ok(fs.statSync(icon).size > 1_000);
});

test('autostart can be controlled from the management page and starts hidden', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(html, /id="autostart-toggle"/);
  assert.match(main, /process\.argv\.includes\('--autostart'\)/);
  assert.match(main, /if \(!launchedFromAutoStart\) createWindow\(\)/);
  assert.match(main, /state\.verifiedStrategy/);
});

test('management starts saved Zapret and VLESS together', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(html, /id="start-all"/);
  assert.match(renderer, /startAll\(\)/);
  assert.match(main, /network:startAll/);
});

test('release and source links are compactly available in the sidebar', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const sources = JSON.parse(fs.readFileSync(path.join(root, 'src', 'config', 'release-sources.json'), 'utf8'));
  assert.match(html, /id="open-release-channel"/);
  assert.match(html, /id="open-max-channel"/);
  assert.match(html, /id="open-repository"/);
  assert.match(renderer, /https:\/\/t\.me\/TheLocalRoute/);
  assert.match(renderer, /https:\/\/max\.ru\/channel_LocalRoute/);
  assert.equal(sources.telegramChannel, 'https://t.me/TheLocalRoute');
  assert.equal(sources.maxChannel, 'https://max.ru/channel_LocalRoute');
});

test('protection actions fit as four equal controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /\.connection-actions \{ display: grid;/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.startup-panel \{ grid-column: 1 \/ -1;/);
});

test('the desktop window opens maximized and exposes the upstream ALT12 strategy', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(main, /mainWindow\.maximize\(\)/);
  assert.match(html, /strategy-tests/);
  assert.match(fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8'), /zapretAlt12/);
});

test('strategy testing exposes the complete upstream catalogue and a loading indicator', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(html, /id="strategy-tests"/);
  assert.match(html, /id="operation-progress"/);
  assert.match(renderer, /UPSTREAM_STRATEGY_IDS/);
  assert.match(renderer, /setOperationBusy/);
});

test('VLESS routes offer selective and whole-internet modes without sending secrets to the renderer', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const routing = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'vless.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /function publicState/);
  assert.match(routing, /selective \? 'direct' : 'vless-out'/);
  assert.match(preload, /saveVless/);
  assert.match(preload, /testVless/);
  assert.match(renderer, /Маршруты VLESS/);
  assert.match(renderer, /Весь интернет через VLESS/);
  assert.match(appJs, /VLESS_APP_LIBRARY/);
  assert.match(renderer, /Добавить приложение вручную/);
  assert.doesNotMatch(preload, /vlessSecret/);
  assert.doesNotMatch(renderer, /vlessSecret/);
});

test('automatic selection uses staged, low-concurrency probes before a full check', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /quickProbesForProfile/);
  assert.match(main, /timeoutMs: 3200, concurrency: 2/);
  assert.match(main, /orderedAutoStrategies\(state\.verifiedStrategy\)/);
  assert.match(main, /windivert initialized/);
});
