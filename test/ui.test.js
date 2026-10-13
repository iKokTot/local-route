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

test('window behavior includes a visible Windows title bar and a tray exit path', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /new Tray/);
  assert.match(main, /Открыть Local Route/);
  assert.match(main, /mainWindow\.hide\(\)/);
  assert.doesNotMatch(main, /titleBarStyle:\s*'hidden'/);
});
