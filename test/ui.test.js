const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('automatic strategy selection is visible on both application pages', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.equal((html.match(/data-auto-select/g) || []).length, 2);
  assert.match(html, /Автоподбор и запуск/);
  assert.match(html, /Автоподбор всех стратегий/);
});

test('both pages expose an emergency stop control', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.equal((html.match(/stop-engine/g) || []).length, 2);
});

test('strategy results have one destination and raw logs are separated', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  assert.equal((html.match(/id="test-results"/g) || []).length, 1);
  assert.match(html, /id="activity-log"/);
  assert.match(html, /class="technical-log"/);
});

test('window behavior includes a visible Windows title bar and a tray exit path', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /new Tray/);
  assert.match(main, /Открыть Local Route/);
  assert.match(main, /mainWindow\.hide\(\)/);
  assert.doesNotMatch(main, /titleBarStyle:\s*'hidden'/);
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
