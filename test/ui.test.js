const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { createProfile } = require('../src/core/profile');
const { createVlessProfile } = require('../src/core/vless');
const { publicCatalog } = require('../src/core/catalog');
let browser;
const output = path.join(__dirname, '..', 'artifacts', 'ui');
const fixture = () => ({
  catalog: publicCatalog(),
  appVersion: require('../package.json').version,
  operation: null,
  profile: createProfile({ services: ['youtube', 'discord'], strategy: 'zapretAlt' }),
  vless: createVlessProfile({ mode: 'exclude', excludedDomains: [], excludedApps: ['chrome.exe'] }),
  active: false, vlessActive: false, vlessConfigured: true, verifiedStrategy: 'zapretAlt',
  autoStart: false, telegram: { enabled: true, port: 1443 }, telegramActive: false, telegramError: '',
  diagnostics: [
    { label: 'Профиль DPI', value: '29 доменов выбрано', level: 'ok' },
    { label: 'Движок DPI', value: 'Готов к запуску', level: 'neutral' },
    { label: 'VLESS', value: 'Профиль готов к запуску', level: 'neutral' },
    { label: 'Telegram-прокси', value: 'Выключен', level: 'neutral' },
    { label: 'Диагностика', value: 'Журнал хранится на компьютере.', level: 'neutral' }
  ], logs: []
});
before(async () => {
  fs.mkdirSync(output, { recursive: true });
  browser = await chromium.launch({ channel: process.env.LOCAL_ROUTE_BROWSER || 'msedge', headless: true });
});
after(async () => { await browser?.close(); });
async function open(initial = fixture(), viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript((initialState) => {
    const copy = (value) => JSON.parse(JSON.stringify(value));
    const mock = window.mock = { state: initialState, calls: [], fault: '', deferred: false };
    const snapshot = () => {
      mock.state.diagnostics[1].value = mock.state.active ? 'Запущен Local Route' : 'Готов к запуску';
      mock.state.diagnostics[1].level = mock.state.active ? 'ok' : 'neutral';
      mock.state.diagnostics[2].value = mock.state.vlessActive ? 'Выбранные маршруты через туннель' : 'Профиль готов к запуску';
      mock.state.diagnostics[2].level = mock.state.vlessActive ? 'ok' : 'neutral';
      mock.state.diagnostics[3].value = mock.state.telegramActive ? 'Локальный порт готов; подключение проверьте в Telegram' : 'Выключен';
      mock.state.diagnostics[3].level = mock.state.telegramActive ? 'ok' : 'neutral';
      return copy(mock.state);
    };
    const reply = () => ({ ok: true, state: snapshot(), message: 'Действие выполнено.' });
    window.localRoute = new Proxy({}, { get: (_, name) => name === 'onProgress' ? (callback) => { mock.progress=callback; return () => {}; } : async (raw) => {
      mock.calls.push({ name, raw: copy(raw ?? null) });
      if (mock.delays?.[name]) await new Promise((resolve) => setTimeout(resolve, mock.delays[name]));
      if (mock.fault === name) throw new Error('Тестовая ошибка IPC');
      if (name === 'readState') { mock.readsCompleted = (mock.readsCompleted || 0) + 1; return snapshot(); }
      if (name === 'saveProfile') {
        mock.state.profile = { ...raw, domains: raw.services.flatMap((service) => [`${service}.com`]).concat(raw.customDomains) };
        mock.state.verifiedStrategy = null; mock.state.active = false;
        return copy(mock.state);
      }
      if (name === 'saveVless') {
        mock.savedVless = copy(raw); mock.state.vless = { ...raw, domains: raw.customDomains || [], apps: raw.apps || [], services: raw.services || [] }; delete mock.state.vless.uri;
        mock.state.vlessConfigured = true; return reply();
      }
      if (name === 'deleteVless') { mock.state.vlessConfigured=false; mock.state.vless={mode:'selective',services:[],apps:[],customDomains:[],domains:[]}; return reply(); }
      if (name === 'importVless') { mock.state.vlessSubscriptionSaved=true; mock.state.vlessServers=[{id:'test-server',name:'<img src=x> Тест',server:'example.com',port:443}]; return reply(); }
      if (name === 'selectVless') { mock.state.vlessConfigured=true; mock.state.vlessServers[0].selected=true; return reply(); }
      if (name === 'pickApplication') return {ok:true,process:'sample-app.exe'};
      if (name === 'saveTelegram') { mock.state.telegram = copy(raw); return reply(); }
      if (name === 'startTelegram') { mock.state.telegramActive = true; return reply(); }
      if (name === 'stopTelegram') { mock.state.telegramActive = false; return reply(); }
      if (name === 'startVless') { mock.state.vlessActive = true; return reply(); }
      if (name === 'toggleVless') { mock.state.vlessActive = !mock.state.vlessActive; return reply(); }
      if (name === 'startVerified') { mock.state.active = true; return reply(); }
      if (name === 'stopEngine') { mock.state.active = false; return copy(mock.state); }
      if (name === 'stopAll') { mock.state.active = false; mock.state.vlessActive = false; mock.state.telegramActive = false; return copy(mock.state); }
      if (name === 'startAll') {
        const start = () => { mock.state.active = Boolean(mock.state.verifiedStrategy); mock.state.vlessActive = mock.state.vlessConfigured; mock.state.telegramActive = mock.state.telegram.enabled; return reply(); };
        if (mock.deferStartAll) return new Promise((resolve) => { mock.finishStartAll = () => resolve(start()); });
        return start();
      }
      if (name === 'setAutoStart') { mock.state.autoStart = raw; return reply(); }
      if (name === 'saveLaunchSettings') { mock.state.launchSettings = copy(raw); return reply(); }
      if (name === 'stopVless') { mock.state.vlessActive=false;return reply(); }
      if (name === 'testVless') {
        const labels = { tiktok: 'TikTok', instagram: 'Instagram', x: 'X / Twitter', chatgpt: 'ChatGPT' };
        const results = [{ label: 'Соединение через сервер', success: true, level: 'ok', detail: 'HTTP 200', durationMs: 30 }, ...mock.state.vless.services.map((service) => ({ label: labels[service], success: service !== 'instagram', level: service === 'instagram' ? 'warning' : 'ok', detail: service === 'instagram' ? 'HTTP 403 · сайт ответил, доступ ограничен' : 'HTTP 200', durationMs: 40 }))];
        return { ...reply(), ok: results.every((item) => item.success), results, excludedDomains: mock.state.vless.excludedDomains || [], excludedApps: mock.state.vless.excludedApps || [], appRules: mock.state.vless.apps.map((process) => ({ process, trafficVerified: false })), message: 'Ответы проверены через VLESS; трафик приложений не проверялся.' };
      }
      if(mock.state.platform==='android' && name==='autoSelect') {
        mock.state.active=true;mock.state.verifiedStrategy=null;
        mock.state.dpiTrial={candidate:'first',attempt:1,total:2,hasNext:true,pendingConfirmation:true,name:'Первый вариант'};
        return {...reply(),pendingConfirmation:true,message:'Проверьте первый вариант'};
      }
      if(name==='rejectDpi') {
        mock.state.dpiTrial={candidate:'second',attempt:2,total:2,hasNext:false,pendingConfirmation:true,name:'Второй вариант'};
        return {...reply(),pendingConfirmation:true,message:'Проверьте второй вариант'};
      }
      if(name==='confirmDpi') {mock.state.verifiedStrategy=mock.state.dpiTrial.candidate;mock.state.dpiTrial.candidate=null;mock.state.dpiTrial.pendingConfirmation=false;return reply();}
      if (name === 'autoSelect' || name === 'testStrategy') {
        if (mock.dnsFailure) return {ok:false,state:snapshot(),diagnosticKind:'dns',message:'Ошибка DNS. Сохранённая стратегия не изменена.',results:[{label:'YouTube',success:false,stage:'dns',code:'ENOTFOUND',detail:'DNS: не удалось определить адрес сайта.',durationMs:0}]};
        if (mock.deferred) return new Promise((resolve) => { mock.finish = resolve; });
        mock.state.verifiedStrategy = 'zapretAlt'; mock.state.active = true; return reply();
      }
      return reply();
    } });
  }, initial);
  const file = path.resolve(__dirname, '../src/renderer/index.html');
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => document.querySelector('#engine-status').textContent !== 'Загрузка состояния…');
  await page.waitForFunction(() => !document.querySelector('#page-content').inert);
  return page;
}
const nav = async (page, target) => {
  await page.locator(`.side-nav [data-page="${target}"]`).click();
  // Functional editor tests open the advanced controls they exercise.
  // Compact initial presentation is covered separately below.
  const selectors = target === 'lab' ? ['#dpi-services-settings'] : target === 'routes' ? ['#server-management','#vpn-exclusions-settings','#vpn-app-exclusions'] : target === 'telegram' ? ['#telegram-proxy-settings','#telegram-manual-link'] : target === 'control' ? ['#overview-diagnostics'] : [];
  for (const selector of selectors) await page.locator(selector).evaluate(node=>node.open=true);
};
const refreshOverview = async page => {
  await page.locator('#overview-diagnostics').evaluate(node=>node.open=true);
  await page.locator('#run-check').click();
};

test('overview diagnostics and advanced routing lists are collapsed by default',async()=>{
  const page=await open();
  assert.equal(await page.locator('#overview-diagnostics').getAttribute('open'),null);
  assert.equal(await page.locator('#diagnostics').isVisible(),false);
  await page.locator('.side-nav [data-page="lab"]').click();
  assert.equal(await page.locator('#service-list').isVisible(),false);
  await page.locator('.side-nav [data-page="routes"]').click();
  assert.equal(await page.locator('#vless-service-list').isVisible(),false);
  assert.equal(await page.locator('#save-vless').isVisible(),false);
  await page.screenshot({path:path.join(output,'routes-compact-1440.png'),animations:'disabled'});
  await page.locator('#vpn-exclusions-settings > summary').click();
  assert.equal(await page.locator('#vless-service-list').isVisible(),true);
  await page.locator('#recommended-exclusions').check();
  assert.equal(await page.locator('.vless-service:checked').count(),10);
  await page.locator('#recommended-exclusions').uncheck();
  assert.equal(await page.locator('#vless-custom-domains .chip').count(),0);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('service pages share primary command position, a separate stop action and compact advanced settings',async()=>{
  const page=await open();
  await page.setViewportSize({width:1120,height:860});
  for(const [target,stop] of [['lab','.stop-engine'],['telegram','#telegram-stop'],['routes','#stop-vless']]) {
    await page.locator('.side-nav [data-page="'+target+'"]').click();
    const bar=page.locator('[data-page-panel="'+target+'"] .service-command-bar');
    assert.equal(await bar.locator('button').count(),3);
    assert(await bar.locator('button').last().evaluate(node=>node.matches('.danger')));
    assert.equal(await bar.locator(stop).count(),1);
    await page.screenshot({path:path.join(output,target+'-commands-1120.png'),animations:'disabled'});
  }
  assert.equal(await page.locator('#toggle-vless').textContent(),'Запустить VPN');
  assert.equal(await page.locator('#server-management').getAttribute('open'),null);
  await page.locator('#vpn-exclusions-settings > summary').click();
  await page.locator('#vless-custom-domain').fill('audit.example');await page.locator('#add-vless-domain').click();
  assert.match(await page.locator('#vpn-exclusions-summary').textContent(),/1 домен напрямую/);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('startup option columns align and branding is consistent at desktop and phone widths',async()=>{
  for(const width of [1120,840,390]) {
    const page=await open(fixture(),{width,height:900});
    await page.locator('.topbar [data-page="settings"]').click();
    assert.equal(await page.title(),'Local Route');
    assert.equal(await page.locator('.topbar [data-page="settings"]').isVisible(),false);
    assert.doesNotMatch(await page.locator('body').textContent(),/Community/);
    for(const component of ['dpi','telegram','vpn']) {
      const left=await page.locator(`[data-launch-group="auto"][value="${component}"]`).locator('..').boundingBox();
      const right=await page.locator(`[data-launch-group="all"][value="${component}"]`).locator('..').boundingBox();
      if(width>700)assert(Math.abs(left.y-right.y)<2,`${component}: option rows must align at ${width}px`);
      else assert(right.y>left.y,'Narrow screens stack the two groups');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    await page.screenshot({path:path.join(output,`settings-aligned-${width}.png`),animations:'disabled'});
    assert.deepEqual(page.errors,[]);await page.close();
  }
});

test('settings configure Windows startup and start-all separately; Telegram no longer has the duplicate option',async()=>{
  const page=await open();await page.locator('.topbar [data-page="settings"]').click();
  await page.locator('[data-launch-group="auto"][value="dpi"]').uncheck();await idle(page);
  await page.locator('[data-launch-group="all"][value="vpn"]').uncheck();await idle(page);
  const saved=await page.evaluate(()=>mock.state.launchSettings);
  assert.equal(saved.auto.dpi,false);assert.equal(saved.all.dpi,true);
  assert.equal(saved.auto.vpn,true);assert.equal(saved.all.vpn,false);
  assert.equal(await page.evaluate(()=>mock.calls.some(call=>['startAll','startVless','startTelegram'].includes(call.name))),false);
  await page.screenshot({path:path.join(output,'settings-launch-1440.png'),animations:'disabled'});
  await nav(page,'telegram');
  assert.equal(await page.locator('#telegram-enabled').count(),0);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('На телефоне три плитки видны сразу, общие настройки возвращают на исходную страницу',async()=>{
  const page=await open(fixture(),{width:393,height:800});
  const navBounds=await page.locator('.sidebar').boundingBox();
  const cards=await page.locator('.component-card').all();assert.equal(cards.length,3);
  for(const card of cards){const box=await card.boundingBox();assert(box.height>=146,'Плитки имеют увеличенный размер');assert(box.y>=0 && box.y+box.height<navBounds.y,'Каждая плитка помещается над навигацией');}
  assert.deepEqual(await page.locator('.side-nav .nav-button').allTextContents(),['Обзор','DPIYouTube и Discord','TelegramЛокальный прокси','VPNСайты и приложения']);
  await nav(page,'lab');
  assert.equal(await page.locator('#open-repository').isVisible(),false);
  await page.locator('.topbar [data-page="settings"]').click();
  assert.equal(await page.locator('#open-repository').isVisible(),true);
  await page.locator('#back-settings').click();assert.equal(await page.locator('#page-title').textContent(),'DPI');
  await nav(page,'routes');await page.locator('#open-subscription').click();
  assert.equal(await page.locator('#subscription-dialog').isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#subscription-input').isVisible(),false);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('Android использует ту же страницу, порядок блоков и компактный обзор',async()=>{
  const initial=fixture();initial.platform='android';initial.dpiCommand='-s1';initial.appLibrary=[{name:'Chrome',process:'com.android.chrome'}];
  const page=await open(initial,{width:393,height:800});
  assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('platform-android')),true);
  const last=await page.locator('.component-card').last().boundingBox();const bottom=await page.locator('.sidebar').boundingBox();assert(last.y+last.height<bottom.y);
  for(const target of ['lab','telegram','routes']){
    await nav(page,target);
    const positions=await page.locator('[data-page-panel]:not(.hidden) .service-layout').evaluate(grid=>[...grid.children].map(node=>node.getBoundingClientRect().y));
    assert(positions[0]<positions[1] && positions[1]<positions[2]);
  }
  await nav(page,'lab');assert.equal(await page.locator('#android-dpi-profile').isVisible(),true);
  await page.locator('.topbar [data-page="settings"]').click();await page.locator('#back-settings').click();assert.equal(await page.locator('#page-title').textContent(),'DPI');
  assert.deepEqual(page.errors,[]);await page.close();
});

test('Мобильный индикатор операции виден и не перекрывает общую остановку',async()=>{
  const page=await open(fixture(),{width:393,height:800});
  await page.evaluate(()=>{mock.deferStartAll=true;});await page.locator('#start-all').click();
  await page.locator('#global-progress').waitFor({state:'visible'});
  const progress=await page.locator('#global-progress').boundingBox();const stop=await page.locator('#stop-all').boundingBox();const navBox=await page.locator('.sidebar').boundingBox();
  assert(progress.y>stop.y+stop.height);assert(progress.y+progress.height<navBox.y);
  await page.locator('#stop-all').click();await page.evaluate(()=>mock.finishStartAll());await idle(page);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('Android: отказ запускает следующий вариант, сохранение требует отдельного подтверждения',async()=>{
  const initial=fixture();initial.platform='android';initial.verifiedStrategy=null;
  const page=await open(initial,{width:393,height:800});await nav(page,'lab');
  await page.locator('[data-auto-select]').click();await idle(page);
  assert.equal(await page.evaluate(()=>mock.state.verifiedStrategy),null);
  assert.equal(await page.locator('#confirm-dpi').isEnabled(),true);
  await page.locator('#reject-dpi').click();await idle(page);
  assert.equal(await page.evaluate(()=>mock.state.dpiTrial.candidate),'second');
  assert.equal(await page.evaluate(()=>mock.state.verifiedStrategy),null);
  assert.match(await page.locator('#reject-dpi').textContent(),/остановить/);
  await page.locator('#confirm-dpi').click();await idle(page);
  assert.equal(await page.evaluate(()=>mock.state.verifiedStrategy),'second');
  assert.equal(await page.locator('#confirm-dpi').isDisabled(),true);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('Подписка импортируется, подпись экранируется, сервер выбирается без изменения маршрутов', async()=>{
  const page=await open(); await nav(page,'routes');
  await page.locator('#open-subscription').click();
  await page.locator('#subscription-input').fill('https://example.com/private-token');
  await page.locator('#import-subscription').click(); await idle(page);
  assert.equal(await page.locator('#subscription-input').inputValue(),'');
  assert.equal(await page.locator('#vless-servers img').count(),0);
  assert.match(await page.locator('#vless-servers').textContent(),/<img src=x> Тест/);
  await page.locator('.select-server').click(); await idle(page);
  assert.match(await page.locator('#vless-servers').textContent(),/Выбран/);
  assert.equal(await page.locator('.select-server').isDisabled(),true);
  assert.equal(await page.evaluate(()=>mock.state.vless.mode),'exclude');
  assert.deepEqual(page.errors,[]); await page.close();
});
async function idle(page) { await page.waitForFunction(() => document.querySelector('[data-page-panel]:not(.hidden)').getAttribute('aria-busy') === 'false'); }

test('all eight component combinations have consistent global and local status', async () => {
  const page = await open();
  for (let mask = 0; mask < 8; mask++) {
    await page.evaluate((value) => { mock.state.active = Boolean(value & 1); mock.state.vlessActive = Boolean(value & 2); mock.state.telegramActive = Boolean(value & 4); }, mask);
    await refreshOverview(page);
    await page.waitForFunction((value) => document.querySelector('#start-telegram').textContent === (value & 4 ? 'Остановить прокси' : 'Запустить прокси'), mask);
    const text = await page.locator('#engine-status').textContent();
    for (const [bit, label, id] of [[1, 'DPI', 'dpi'], [2, 'VPN', 'vless'], [4, 'Telegram', 'telegram']]) {
      assert.equal(text.includes(label), Boolean(mask & bit), `${mask}: ${label}`);
      assert.equal(await page.locator(`#${id}-run-state`).evaluate((badge) => badge.closest('.component-card').classList.contains('is-running')), Boolean(mask & bit), `${mask}: ${label} card highlight`);
    }
    assert.equal(await page.locator('#stop-all').isDisabled(), mask === 0);
  }
  assert.deepEqual(page.errors, []); await page.close();
});
test('VPN failures and an obsolete autostart path remain visible instead of a stale success',async()=>{
  const initial=fixture();
  initial.vlessError='VPN неожиданно отключён. Трафик может идти напрямую.';
  initial.autoStartWarning='Автозапуск указывает на другую версию.';
  const page=await open(initial);
  assert.match(await page.locator('#vless-detail').textContent(),/Трафик может идти напрямую/);
  assert.equal(await page.locator('#vless-run-state').textContent(),'VPN отключён');
  await nav(page,'routes');
  assert.match(await page.locator('#vpn-connection-status').textContent(),/Трафик может идти напрямую/);
  assert.equal(await page.locator('#vpn-connection-status').getAttribute('data-state'),'failure');
  await page.locator('.topbar [data-page="settings"]').click();
  assert.match(await page.locator('#autostart-description').textContent(),/другую версию/);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('VPN exclusion drafts survive application search, navigation and refresh', async () => {
  const page = await open(); await nav(page, 'routes');
  const saveBar = await page.locator('#save-vless').boundingBox();
  assert(saveBar.y >= 0 && saveBar.y + saveBar.height <= 1000, 'Save remains visible beside a long list of applications');
  await page.locator('.vless-service[value="avito"]').check();
  await page.locator('#vless-custom-domain').fill('https://example.org/path'); await page.locator('#vless-custom-domain').press('Enter');
  await page.locator('#app-search').fill('firefox'); await page.locator('.vless-app[value="firefox.exe"]').check();
  await page.locator('#app-search').fill('Chrome');
  assert.equal(await page.locator('.vless-app[value="chrome.exe"]').isChecked(), true);
  assert.equal(await page.locator('#vless-mode').getAttribute('type'), 'hidden');
  await nav(page, 'control'); await refreshOverview(page); await nav(page, 'routes');
  assert.equal(await page.locator('.vless-service[value="avito"]').isChecked(), true);
  assert.match(await page.locator('#vless-custom-domains').textContent(), /example.org/);
  assert.equal(await page.evaluate(() => mock.state.vless.mode), 'exclude');
  await page.locator('#save-vless').click(); await idle(page);
  const saved = await page.evaluate(() => mock.savedVless);
  assert.equal(saved.mode, 'exclude'); assert(saved.excludedApps.includes('firefox.exe')); assert(saved.excludedApps.includes('chrome.exe')); assert(saved.excludedDomains.includes('avito.ru')); assert.equal(saved.apps, undefined);
  assert(saved.excludedDomains.includes('example.org'));
  assert.equal(await page.locator('#save-vless').isDisabled(), true);
  assert.deepEqual(page.errors, []); await page.close();
});
test('legacy allowlists require an explicit save and never become exclusions implicitly', async () => {
  const initial = fixture(); initial.vless = createVlessProfile({mode:'selective',services:['chatgpt'],apps:['chrome.exe'],customDomains:['old.example']});
  const page = await open(initial); await nav(page,'routes');
  assert.equal(await page.locator('#vless-migration-note').isVisible(),true);
  assert.equal(await page.locator('.vless-app[value="chrome.exe"]').isChecked(),false);
  assert.equal(await page.locator('#toggle-vless').isDisabled(),true);
  assert.equal(await page.locator('#save-vless').isEnabled(),true);
  assert.equal(await page.evaluate(()=>mock.state.vless.mode),'selective');
  await page.locator('#save-vless').click(); await idle(page);
  const saved = await page.evaluate(()=>mock.savedVless);
  assert.equal(saved.mode,'exclude');
  assert.deepEqual(saved.excludedDomains,[]);
  assert.deepEqual(saved.excludedApps,[]);
  assert.equal(await page.locator('#vless-migration-note').isVisible(),false);
  assert.equal(await page.locator('#toggle-vless').isEnabled(),true);
  assert.deepEqual(page.errors,[]); await page.close();
});

test('exclusion shortcuts can be removed and draft reset restores saved exclusions', async () => {
  const initial = fixture(); initial.vless = createVlessProfile({mode:'exclude',excludedDomains:['avito.ru','avito.st'],excludedApps:['chrome.exe']});
  const page = await open(initial); await nav(page,'routes');
  assert.equal(await page.locator('.vless-service[value="avito"]').isChecked(),true);
  await page.locator('.vless-service[value="avito"]').uncheck();
  assert.equal(await page.locator('#vless-custom-domains .chip').count(),0);
  await page.locator('[data-reset-kind="vless"]').click();
  assert.equal(await page.locator('.vless-service[value="avito"]').isChecked(),true);
  assert.equal(await page.locator('#vless-custom-domains .chip').count(),2);
  assert.equal(await page.locator('#save-vless').isDisabled(),true);
  assert.deepEqual(page.errors,[]); await page.close();
});

test('first launch explains prerequisites while Telegram can start independently', async () => {
  const initial = fixture(); initial.verifiedStrategy = null; initial.vlessConfigured = false; initial.telegram.enabled = false;
  const page = await open(initial);
  assert.equal(await page.locator('#start-all').isDisabled(), true);
  assert.equal(await page.locator('#start-dpi').isDisabled(), true);
  assert.equal(await page.locator('#start-vless').isDisabled(), true);
  assert.equal(await page.locator('#start-telegram').isEnabled(), true);
  await page.locator('#start-telegram').click(); await idle(page);
  assert.equal(await page.locator('#engine-status').textContent(), 'Запущено: Telegram');
  assert.equal(await page.locator('#stop-all').isEnabled(), true);
  assert.deepEqual(page.errors, []); await page.close();
});
test('VPN checks the server without claiming verification of excluded sites and apps', async () => {
  const initial = fixture(); initial.vless = createVlessProfile({mode:'exclude',excludedDomains:['avito.ru'],excludedApps:['chrome.exe']});
  const page = await open(initial); await nav(page, 'routes');
  await page.locator('#test-vless').click(); await idle(page);
  const report = await page.locator('#vless-test-results').textContent();
  assert(report.includes('Соединение через сервер'));
  assert.match(report, /HTTP 200/);
  assert.match(report, /Исключения подключаются напрямую/);
  assert.equal(await page.locator('#vless-test-results .test-result').count(), 1);
  assert.equal(await page.locator('#app-error').isVisible(), false);
  assert.equal(await page.evaluate(() => mock.state.vlessActive), false);
  await page.screenshot({ path: path.join(output, 'routes-check-1440.png'), animations: 'disabled' });
  assert.deepEqual(page.errors, []); await page.close();
});
test('DPI services require explicit save and running profiles cannot be edited', async () => {
  const page = await open(); await nav(page, 'lab');
  await page.locator('#service-list input[value="discord"]').uncheck();
  assert.equal(await page.locator('[data-auto-select]').isDisabled(), true);
  assert.equal(await page.evaluate(() => mock.calls.some((call) => call.name === 'saveProfile')), false);
  await page.locator('#save-dpi').click(); await idle(page);
  assert.deepEqual(await page.evaluate(() => mock.state.profile.services), ['youtube']);
  assert.equal(await page.evaluate(() => mock.state.verifiedStrategy), null);
  await page.locator('[data-auto-select]').click(); await idle(page);
  assert.equal(await page.locator('#service-list input').first().isDisabled(), true);
  assert.equal(await page.locator('.stop-engine').isEnabled(), true);
  assert.deepEqual(page.errors, []); await page.close();
});
test('Telegram validates settings and exposes start, connect, copy and stop in sequence', async () => {
  const page = await open(); await nav(page, 'telegram');
  assert.equal(await page.locator('#telegram-connect').isDisabled(), true);
  await page.locator('#telegram-port').fill('80'); await page.locator('#telegram-save').click();
  assert.equal(await page.evaluate(() => mock.calls.some((call) => call.name === 'saveTelegram')), false);
  await page.locator('#telegram-port').fill('2443');
  await nav(page, 'control'); await refreshOverview(page); await nav(page, 'telegram');
  assert.equal(await page.locator('#telegram-port').inputValue(), '2443');
  assert.equal(await page.locator('#telegram-start').isDisabled(), true);
  await page.locator('#telegram-save').click(); await idle(page);
  assert.deepEqual(await page.evaluate(() => mock.state.telegram), { port: 2443 });
  await page.locator('#telegram-start').click(); await idle(page);
  assert.equal(await page.locator('#telegram-connect').isEnabled(), true);
  assert.equal(await page.locator('#telegram-copy').isEnabled(), true);
  assert.equal(await page.locator('#telegram-save').isDisabled(), true);
  assert.equal(await page.locator('#telegram-port').isDisabled(), true);
  await page.locator('#telegram-stop').click(); await idle(page);
  assert.equal(await page.locator('#telegram-start').isEnabled(), true);
  assert.deepEqual(page.errors, []); await page.close();
});
test('IPC failure restores controls and allows retry', async () => {
  const page = await open(); await page.evaluate(() => { mock.fault = 'startAll'; });
  await page.locator('#start-all').click(); await idle(page);
  assert.match(await page.locator('#app-error').textContent(), /Тестовая ошибка IPC/);
  assert.equal(await page.locator('#start-all').isEnabled(), true);
  await page.evaluate(() => { mock.fault = ''; });
  await page.locator('#start-all').click(); await idle(page);
  assert.match(await page.locator('#engine-status').textContent(), /DPI · VPN · Telegram/);
  await page.locator('#stop-all').click(); await idle(page);
  assert.equal(await page.locator('#stop-all').isDisabled(), true);
  assert.deepEqual(page.errors, []); await page.close();
});
test('cancelling a DPI check ignores late successful results', async () => {
  const page = await open(); await nav(page, 'lab');
  await page.evaluate(() => { mock.deferred = true; });
  await page.locator('[data-auto-select]').click();
  await page.waitForFunction(() => Boolean(mock.finish));
  await nav(page, 'control');
  await page.locator('#global-progress').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#global-progress').isVisible(), true);
  await page.locator('#stop-all').click(); await idle(page);
  await page.evaluate(() => mock.finish({ ok: true, state: { ...mock.state, active: true }, message: 'Устаревший результат' }));
  await nav(page, 'lab');
  assert.match(await page.locator('#test-results').textContent(), /DPI остановлен/);
  assert.equal(await page.locator('#engine-status').textContent(), 'Компоненты выключены');
  assert.deepEqual(page.errors, []); await page.close();
});
test('responsive layouts fill the window, scroll content independently, and have no horizontal overflow', async () => {
  const page = await open();
  for (const viewport of [{ width: 840, height: 620 }, { width: 1360, height: 768 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const target of ['control', 'lab', 'routes', 'telegram']) {
      await nav(page, target);
      const geometry = await page.evaluate(() => {
        const content = document.querySelector('#page-content'); const sidebar = document.querySelector('.sidebar');
        const before = sidebar.getBoundingClientRect().top; content.scrollTop = 10000;
        return { contentWidth: content.clientWidth, scrollWidth: content.scrollWidth, sidebarBefore: before, sidebarAfter: sidebar.getBoundingClientRect().top, bodyScroll: document.documentElement.scrollHeight, height: innerHeight, panelWidth: document.querySelector('[data-page-panel]:not(.hidden)').getBoundingClientRect().width, width: innerWidth, shell: document.querySelector('.shell').getBoundingClientRect().width };
      });
      assert(geometry.scrollWidth <= geometry.contentWidth + 1, `${viewport.width} ${target}: horizontal overflow`);
      assert.equal(geometry.sidebarBefore, geometry.sidebarAfter);
      assert.equal(geometry.bodyScroll, geometry.height, `${viewport.width} ${target}: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.shell, geometry.width);
      assert(geometry.panelWidth <= 1481, 'Readable maximum content width');
    }
  }
  assert.deepEqual(page.errors, []); await page.close();
});
test('the fixed mint accent ignores legacy preferences and color pairs meet text contrast', async () => {
  const page = await open();
  const contrast = (a, b) => {
    const luminance = (hex) => { const c = hex.match(/[a-f\d]{2}/gi).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
    const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (x + .05) / (y + .05);
  };
  await page.evaluate(() => localStorage.setItem('local-route-accent', 'lavender'));
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#page-content').inert);
  assert.equal(await page.locator('#accent-color').count(), 0);
  const roles = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return Object.fromEntries(['primary', 'on-primary', 'primary-container', 'on-primary-container', 'surface', 'surface-container', 'on-surface', 'on-surface-variant', 'success', 'success-container', 'error', 'error-container'].map((key) => [key, s.getPropertyValue(`--${key}`).trim()])); });
  assert.equal(roles.primary, '#8fd5bd');
  for (const [a, b] of [['primary', 'on-primary'], ['primary-container', 'on-primary-container'], ['primary-container', 'on-surface'], ['surface', 'on-surface'], ['surface-container', 'on-surface-variant'], ['success', 'success-container'], ['error', 'error-container']]) assert(contrast(roles[a], roles[b]) >= 4.5, `${a}/${b}`);
  assert.deepEqual(page.errors, []); await page.close();
});
test('connection comes first, settings second and feedback last at desktop and phone widths', async () => {
  const page=await open();
  for(const width of [390,620,840,1360,1920,2560]) {
    await page.setViewportSize({width,height:900});
    for(const [target,selector] of [['lab','.lab-grid'],['telegram','.telegram-layout'],['routes','.routes-grid']]) {
      await nav(page,target);
      const geometry=await page.locator(selector).evaluate(grid=>[...grid.children].map(node=>{const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,kind:node.className};}));
      assert(geometry[0].kind.includes('service-connection'));
      assert(geometry[1].kind.includes('service-settings'));
      assert(geometry[2].kind.includes('service-feedback'));
      {
        assert(geometry[1].y>=geometry[0].y+geometry[0].height,target+': settings follow connection');
        assert(geometry[2].y>=geometry[1].y+geometry[1].height,target+': feedback follows settings');
        if(target==='routes' && width<=1050){
          const save=await page.locator('.editor-save-bar').boundingBox();
          const settings=await page.locator('#vless-selective-settings').boundingBox();
          assert(save.y>=settings.y+settings.height,'Mobile save bar must follow settings without covering them');
        }
      }
    }
    await nav(page,'control');
    await page.locator('.topbar [data-page="settings"]').click();
    assert.equal(await page.locator('.autostart-panel').isVisible(),true);
    await page.locator('#back-settings').click();
  }
  assert.deepEqual(page.errors,[]);await page.close();
});

test('startup progress occupies the header without shifting content', async () => {
  for (const viewport of [{ width: 840, height: 620 }, { width: 1440, height: 1000 }]) {
    const page = await open(fixture(), viewport);
    await page.evaluate(() => { mock.deferStartAll = true; });
    const geometry = () => page.evaluate(() => ['.topbar', '#page-content', '.component-grid'].map((selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { y: r.y, width: r.width, height: r.height }; }));
    const before = await geometry();
    await page.locator('#start-all').click(); await page.waitForFunction(() => Boolean(mock.finishStartAll));
    await page.locator('#global-progress').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#global-progress').isVisible(), true);
    assert.deepEqual(await geometry(), before, 'Showing progress should not change the layout');
    if (viewport.width === 1440) await page.screenshot({ path: path.join(output, 'control-starting-1440.png'), animations: 'disabled' });
    await page.evaluate(() => mock.finishStartAll()); await idle(page);
    const after = await geometry();
    assert.equal(after[1].y, before[1].y, 'Hiding progress should not move the content');
    assert.equal(after[2].y, before[2].y, 'Hiding progress should not move the cards');
    assert.equal(await page.locator('.component-card.is-running').count(), 3);
    await page.locator('#stop-all').click(); await idle(page);
    assert.equal(await page.locator('.component-card.is-running').count(), 0);
    assert.deepEqual(page.errors, []); await page.close();
  }
});
test('quick VLESS save, connection check and refresh neither shift content nor flash progress', async () => {
  const page = await open(); await nav(page, 'routes');
  await page.evaluate(() => { mock.delays = { saveVless: 60, testVless: 60, readState: 60 }; });
  await page.locator('.vless-service[value="avito"]').check();
  for (const id of ['save-vless', 'test-vless']) {
    await page.evaluate(() => {
      mock.samples = []; mock.observing = true;
      const sample = () => {
        if (!mock.observing) return;
        const grid = document.querySelector('.routes-grid').getBoundingClientRect();
        mock.samples.push({ y: grid.y, scroll: document.querySelector('#page-content').scrollTop, progress: !document.querySelector('#global-progress').classList.contains('hidden') });
        requestAnimationFrame(sample);
      };
      sample();
    });
    // Use a physical pointer click: locator.click scrolls sticky elements to
    // their original flow position before clicking, unlike a user's click.
    const target = await page.locator(`#${id}`).boundingBox();
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2); await idle(page);
    const samples = await page.evaluate(() => { mock.observing = false; return mock.samples; });
    assert(samples.length >= 2);
    assert(samples.every((sample) => sample.y === samples[0].y), `${id}: content shifted: ${JSON.stringify(samples)}`);
    assert(samples.every((sample) => !sample.progress), `${id}: unnecessary spinner flashed`);
    await page.waitForFunction(() => mock.calls.filter((call) => call.name === 'readState').length === mock.readsCompleted);
  }
  await nav(page, 'control');
  const before = await page.locator('.component-grid').boundingBox();
  const reads = await page.evaluate(() => mock.readsCompleted);
  await refreshOverview(page);
  await page.waitForFunction((previous) => mock.readsCompleted > previous, reads);
  const after = await page.locator('.component-grid').boundingBox();
  assert.equal(after.y, before.y);
  assert.equal(await page.locator('#global-progress').isVisible(), false);
  assert.deepEqual(page.errors, []); await page.close();
});
test('capture all four redesigned pages for visual review', async () => {
  const page = await open();
  for (const target of ['control', 'lab', 'routes', 'telegram']) {
    await nav(page, target);
    await page.screenshot({ path: path.join(output, `${target}-1440.png`), animations: 'disabled' });
  }
  await page.setViewportSize({width:390,height:844});
  for (const target of ['control','lab','routes','telegram']) {
    await nav(page,target);await page.screenshot({path:path.join(output,`${target}-390.png`),animations:'disabled'});
  }
  await page.setViewportSize({ width: 840, height: 620 }); await nav(page, 'control');
  await page.screenshot({ path: path.join(output, 'control-840.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: path.join(output, 'control-1920.png'), animations: 'disabled' });
  await page.locator('#start-all').click(); await idle(page);
  await page.screenshot({ path: path.join(output, 'control-running-1920.png'), animations: 'disabled' });
  assert.deepEqual(page.errors, []); await page.close();
});

test('draft reset, application file picker, VLESS deletion and diagnostic export are reachable',async()=>{
  const page=await open();await nav(page,'routes');
  await page.locator('#vless-custom-domain').fill('example.org');await page.locator('#add-vless-domain').click();
  await page.locator('[data-reset-kind="vless"]').click();
  assert.equal(await page.locator('#vless-custom-domains .chip').count(),0);
  await page.locator('#pick-vless-app').click();await idle(page);
  assert.equal(await page.locator('.vless-app[value="sample-app.exe"]').isChecked(),true);
  await page.locator('[data-reset-kind="vless"]').click();
  await page.locator('#delete-vless').click();await idle(page);
  assert.equal(await page.evaluate(()=>mock.state.vlessConfigured),false);
  assert.equal(await page.locator('#toggle-vless').isDisabled(),true);
  await nav(page,'control');await page.locator('#export-diagnostics').click();await idle(page);
  assert(await page.evaluate(()=>mock.calls.some(call=>call.name==='exportDiagnostics')));
  assert.deepEqual(page.errors,[]);await page.close();
});

test('selector shows live strategy progress and all-start can be cancelled from the overview',async()=>{
  const page=await open();await nav(page,'lab');
  await page.evaluate(()=>{mock.deferred=true;});
  await page.locator('[data-auto-select]').click();
  await page.evaluate(()=>mock.progress({kind:'auto',progress:{strategy:'zapretAlt2',index:2,total:22}}));
  await page.locator('#global-progress').waitFor({state:'visible'});
  assert.match(await page.locator('#global-progress').textContent(),/Стратегия 2 из 22: Zapret ALT2/);
  await nav(page,'control');await page.locator('#stop-all').click();await idle(page);
  await page.evaluate(()=>mock.finish({ok:false,message:'Отменено'}));
  assert.equal(await page.locator('#engine-status').textContent(),'Компоненты выключены');
  assert.deepEqual(page.errors,[]);await page.close();
});

test('shared journal is at the bottom of overview and can be opened from a service page',async()=>{
  const initial=fixture();initial.logs=['23:32:29  YouTube: ECONNRESET','23:32:29  [winws] capture started'];
  const page=await open(initial);await nav(page,'lab');
  assert.equal(await page.locator('[data-page-panel="lab"] .technical-log').count(),0);
  await page.locator('[data-page-panel="lab"] [data-open-log]').click();
  assert.equal(await page.locator('#page-title').textContent(),'Обзор');
  assert.equal(await page.locator('#technical-log').evaluate(node=>node.open),true);
  assert.match(await page.locator('#engine-log').textContent(),/YouTube: ECONNRESET/);
  assert.equal(await page.locator('[data-page-panel="control"]').evaluate(panel=>panel.lastElementChild.id),'technical-log');
  assert.deepEqual(page.errors,[]);await page.close();
});

test('DNS errors show endpoint details and still allow the saved DPI strategy to start',async()=>{
  const page=await open();await nav(page,'lab');await page.evaluate(()=>{mock.dnsFailure=true;});
  await page.locator('[data-auto-select]').click();await idle(page);
  assert.match(await page.locator('#test-results').textContent(),/Ошибка DNS/);
  assert.equal(await page.locator('#start-saved-dpi').isEnabled(),true);
  await page.locator('#start-saved-dpi').click();await idle(page);
  assert.equal(await page.evaluate(()=>mock.state.active),true);
  assert.deepEqual(page.errors,[]);await page.close();
});

test('phone navigation stays at the bottom while only page content scrolls',async()=>{
  const page=await open(fixture(),{width:390,height:844});
  for(const target of ['control','lab','routes','telegram']){
    await nav(page,target);
    const before=await page.locator('.sidebar').boundingBox();
    assert.equal(Math.round(before.y+before.height),844);
    const content=await page.locator('#page-content').boundingBox();
    assert(content.y+content.height<=before.y+1,'Navigation does not cover content');
    await page.locator('#page-content').evaluate(node=>{node.scrollTop=100000;});
    assert.deepEqual(await page.locator('.sidebar').boundingBox(),before);
  }
  assert.deepEqual(page.errors,[]);await page.close();
});
