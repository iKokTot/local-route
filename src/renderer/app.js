const SERVICES = { youtube: 'YouTube', discord: 'Discord' };
const VLESS_SERVICES = { tiktok: 'TikTok', instagram: 'Instagram', x: 'X / Twitter', chatgpt: 'ChatGPT' };
const VLESS_APP_LIBRARY = [
  { name: 'Telegram Desktop', process: 'Telegram.exe' }, { name: 'Discord', process: 'Discord.exe' },
  { name: 'WhatsApp', process: 'WhatsApp.exe' }, { name: 'ChatGPT', process: 'ChatGPT.exe' },
  { name: 'Google Chrome', process: 'chrome.exe' }, { name: 'Microsoft Edge', process: 'msedge.exe' },
  { name: 'Firefox', process: 'firefox.exe' }, { name: 'Brave', process: 'brave.exe' },
  { name: 'Opera', process: 'opera.exe' }, { name: 'Яндекс Браузер', process: 'browser.exe' },
  { name: 'Steam', process: 'steam.exe' }, { name: 'Epic Games Launcher', process: 'EpicGamesLauncher.exe' },
  { name: 'Battle.net', process: 'Battle.net.exe' }, { name: 'Spotify', process: 'Spotify.exe' },
  { name: 'CapCut', process: 'CapCut.exe' }, { name: 'TikTok', process: 'TikTok.exe' }
];
const STRATEGY_LABELS = {
  zapretAlt: 'Zapret ALT', zapretAlt2: 'Zapret ALT2', zapretAlt3: 'Zapret ALT3', zapretAlt4: 'Zapret ALT4', zapretAlt5: 'Zapret ALT5', zapretAlt6: 'Zapret ALT6', zapretAlt7: 'Zapret ALT7', zapretAlt8: 'Zapret ALT8', zapretAlt9: 'Zapret ALT9', zapretAlt10: 'Zapret ALT10', zapretAlt11: 'Zapret ALT11', zapretAlt12: 'Zapret ALT12', zapretAlt13: 'Zapret ALT13',
  zapretFakeTlsAuto: 'FAKE TLS AUTO', zapretFakeTlsAutoAlt: 'FAKE TLS AUTO ALT', zapretFakeTlsAutoAlt2: 'FAKE TLS AUTO ALT2', zapretFakeTlsAutoAlt3: 'FAKE TLS AUTO ALT3', zapretSimpleFake: 'SIMPLE FAKE', zapretSimpleFakeAlt: 'SIMPLE FAKE ALT', zapretSimpleFakeAlt2: 'SIMPLE FAKE ALT2', zapretExp: 'Zapret EXP', zapretBase: 'Zapret Standard',
  alt12: 'Упрощённый ALT12', balanced: 'Сбалансированная', compatibility: 'Совместимость', split2: 'Split ×2', fakeSplit: 'Fake Split', fakeTls: 'Fake TLS'
};
const UPSTREAM_STRATEGY_IDS = Object.keys(STRATEGY_LABELS).filter((id) => id.startsWith('zapret'));
let state; let customDomains = []; let vlessCustomDomains = []; let vlessManualApps = []; let operationBusy = false; let vlessBusy = false; let toastTimer;
const $ = (selector) => document.querySelector(selector);
const toast = (message) => { const node = $('#toast'); clearTimeout(toastTimer); node.textContent = message; node.classList.add('show'); toastTimer = setTimeout(() => node.classList.remove('show'), 3300); };
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
function setOperationBusy(busy, message = 'Проверяю стратегии в фоновом режиме…') {
  operationBusy = busy;
  document.body.classList.toggle('operation-busy', busy);
  const progress = $('#operation-progress');
  if (progress) {
    progress.classList.toggle('hidden', !busy);
    progress.querySelector('span').textContent = message;
  }
  document.querySelectorAll('[data-auto-select], .test-strategy, #start-verified').forEach((button) => { button.disabled = busy; });
}
function setVlessBusy(busy, message = 'Подготавливаю VLESS в фоновом режиме…') {
  vlessBusy = busy;
  document.body.classList.toggle('vless-busy', busy);
  const progress = $('#vless-progress');
  if (progress) { progress.classList.toggle('hidden', !busy); progress.querySelector('span').textContent = message; }
  document.querySelectorAll('#save-vless, #toggle-vless, #test-vless, #vless-mode, .vless-service, .vless-app, #add-vless-domain, #add-vless-app').forEach((button) => { button.disabled = busy; });
}
function render() {
  $('#telegram-state').textContent = state.telegramBusy ? 'Запускается…' : (state.telegramActive ? 'Локальный порт готов' : (state.telegramError ? 'Ошибка' : 'Выключен'));
  $('#telegram-error').textContent = state.telegramError || '';
  $('#telegram-port').value = state.telegram?.port || 1443;
  $('#telegram-enabled').checked = Boolean(state.telegram?.enabled);
  let telegramChip = $('#telegram-run-state');
  if (!telegramChip) {
    telegramChip = document.createElement('span');
    telegramChip.id = 'telegram-run-state';
    $('#dpi-run-state').parentElement.appendChild(telegramChip);
  }
  telegramChip.textContent = state.telegramActive ? 'Telegram · прокси готов' : (state.telegramError ? 'Telegram · ошибка' : 'Telegram · выключен');
  telegramChip.className = state.telegramActive ? 'active' : '';
  const selected = new Set(state.profile.services);
  $('#service-list').innerHTML = Object.entries(SERVICES).map(([key, label]) => `<label class="service"><input type="checkbox" value="${key}" ${selected.has(key) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  $('#strategy-tests').innerHTML = UPSTREAM_STRATEGY_IDS.map((id) => `<button class="button secondary test-strategy" data-strategy="${id}">${STRATEGY_LABELS[id]}</button>`).join('');
  $('#custom-domains').innerHTML = customDomains.map((domain, index) => `<span class="chip">${domain}<button data-remove="${index}" title="Удалить">×</button></span>`).join('');
  const vlessSelected = new Set(state.vless?.services || []);
  $('#vless-service-list').innerHTML = Object.entries(VLESS_SERVICES).map(([key, label]) => `<label class="service"><input class="vless-service" type="checkbox" value="${key}" ${vlessSelected.has(key) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  $('#vless-custom-domains').innerHTML = vlessCustomDomains.map((domain, index) => `<span class="chip">${domain}<button data-vless-remove="${index}" title="Удалить">×</button></span>`).join('');
  const selectedApps = new Set(state.vless?.apps || []);
  const knownApps = [...VLESS_APP_LIBRARY, ...vlessManualApps, ...(state.vless?.apps || []).filter((process) => ![...VLESS_APP_LIBRARY, ...vlessManualApps].some((app) => app.process.toLowerCase() === process.toLowerCase())).map((process) => ({ name: process, process }))];
  $('#vless-app-list').innerHTML = knownApps.map((app) => `<label class="service"><input class="vless-app" type="checkbox" value="${escapeHtml(app.process)}" ${selectedApps.has(app.process) ? 'checked' : ''}><span>${escapeHtml(app.name)}<br><small>${escapeHtml(app.process)}</small></span></label>`).join('');
  $('#vless-domain-count').textContent = `${state.vless?.domains?.length || 0} доменов`;
  $('#vless-mode').value = state.vless?.mode || 'selective';
  $('#vless-selective-settings').classList.toggle('hidden', state.vless?.mode === 'all');
  $('#vless-state').textContent = state.vlessActive ? 'Включён' : (state.vlessConfigured ? 'Готов' : 'Не настроен');
  $('#vless-state').className = `route-state ${state.vlessActive ? 'active' : ''}`;
  $('#toggle-vless').textContent = state.vlessActive ? 'Остановить VLESS' : 'Включить VLESS';
  $('#route-mode-title').textContent = state.vless?.mode === 'all' ? 'Через VLESS' : 'Напрямую';
  $('#route-mode-description').textContent = state.vless?.mode === 'all'
    ? 'Весь внешний трафик идёт через VLESS. Локальная сеть остаётся прямой.'
    : 'Авито, WB, Ozon, VK, банки, локальная сеть и все невыбранные сайты не используют сервер.';
  $('#domain-count').textContent = `${state.profile.domains.length} доменов`;
  const runningCount = Number(state.active) + Number(state.vlessActive);
  $('#engine-status').textContent = runningCount === 2 ? 'DPI и VLESS включены' : (state.active ? `DPI включён · ${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy}` : (state.vlessActive ? 'VLESS включён' : 'Готово к запуску'));
  $('#protection-title').textContent = runningCount === 2 ? 'DPI и VLESS работают' : (state.active ? `DPI работает: «${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy}»` : (state.vlessActive ? 'VLESS-маршрутизация работает' : 'Защита не запущена'));
  $('#protection-description').textContent = runningCount
    ? 'Подключение активно. Остановить компоненты можно одной кнопкой.'
    : (state.verifiedStrategy ? `Есть подтверждённая DPI-стратегия: «${STRATEGY_LABELS[state.verifiedStrategy] || state.verifiedStrategy}».` : 'Сначала подтвердите стратегию DPI на вкладке проверки.');
  $('#dpi-run-state').textContent = state.active ? `DPI · включён (${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy})` : 'DPI · не запущен';
  $('#vless-run-state').textContent = state.vlessActive ? `VLESS · включён (${state.vless.mode === 'all' ? 'весь интернет' : 'выбранные маршруты'})` : (state.vlessConfigured ? 'VLESS · готов к запуску' : 'VLESS · не настроен');
  $('#dpi-run-state').className = state.active ? 'active' : '';
  $('#vless-run-state').className = state.vlessActive ? 'active' : '';
  $('#status-dot').classList.toggle('active', Boolean(runningCount));
  $('#autostart-toggle').checked = Boolean(state.autoStart);
  $('#autostart-description').textContent = state.autoStart
    ? (state.verifiedStrategy ? `Включён · стратегия «${STRATEGY_LABELS[state.verifiedStrategy] || state.verifiedStrategy}»` : 'Включён, но после изменения профиля нужен новый автоподбор.')
    : (state.verifiedStrategy ? 'При входе в Windows запустит подтверждённую стратегию и останется в трее.' : 'Сначала выполните автоподбор, затем автозапуск можно включить.');
  const verifiedLabel = STRATEGY_LABELS[state.verifiedStrategy] || state.verifiedStrategy;
  const canStartVerified = Boolean(state.verifiedStrategy && !state.active);
  const verifiedButton = $('#start-verified');
  if (verifiedButton) {
    verifiedButton.classList.toggle('hidden', !canStartVerified);
    verifiedButton.textContent = `▶ Запустить прошлую: «${verifiedLabel}»`;
  }
  document.querySelectorAll('[data-auto-select][data-save-profile]').forEach((button) => { button.textContent = state.active ? 'Подобрать заново' : (state.verifiedStrategy ? 'Подобрать заново' : 'Автоподбор и запуск'); });
  $('#diagnostics').innerHTML = state.diagnostics.map((item) => `<div class="diag ${item.level}"><div class="diag-label"><i></i>${item.label}</div><div class="diag-value">${item.value}</div></div>`).join('');
  const logs = state.logs || [];
  const activity = logs.filter((entry) => !entry.includes('[winws]') && !entry.includes('[vless]') && !/(YouTube|Discord (API|Gateway|CDN|Updates)):/i.test(entry));
  const technical = logs.filter((entry) => entry.includes('[winws]') || entry.includes('[vless]') || entry.includes('[tgws]'));
  $('#activity-log').innerHTML = activity.length
    ? activity.slice(0, 6).map((entry) => `<div class="activity-item">${escapeHtml(entry)}</div>`).join('')
    : '<span class="muted">Нет событий управления.</span>';
  $('#engine-log').textContent = technical.length ? technical.join('\n') : 'Нет технических событий.';
}
function draft() { return { services: [...document.querySelectorAll('#service-list .service input:checked')].map((input) => input.value), customDomains, strategy: state.profile.strategy }; }
function vlessDraft() { return { uri: $('#vless-uri').value.trim(), mode: $('#vless-mode').value, services: [...document.querySelectorAll('.vless-service:checked')].map((input) => input.value), apps: [...document.querySelectorAll('.vless-app:checked')].map((input) => input.value), customDomains: vlessCustomDomains }; }
async function save() { state = await window.localRoute.saveProfile(draft()); customDomains = state.profile.customDomains; render(); toast('Профиль сохранён локально.'); }
document.addEventListener('click', async (event) => {
  const telegramAction = event.target.closest('button[id^="telegram-"]');
  if (telegramAction) {
    const buttons = [...document.querySelectorAll('button[id^="telegram-"]')];
    buttons.forEach((button) => { button.disabled = true; });
    $('#telegram-state').textContent = 'Выполняется…';
    try {
      const id = telegramAction.id;
      const result = id === 'telegram-save' ? await window.localRoute.saveTelegram({ port: Number($('#telegram-port').value), enabled: $('#telegram-enabled').checked })
        : id === 'telegram-start' ? await window.localRoute.startTelegram()
          : id === 'telegram-stop' ? await window.localRoute.stopTelegram() : id === 'telegram-copy' ? await window.localRoute.copyTelegram() : await window.localRoute.connectTelegram();
      if (result.state) state = { ...state, ...result.state };
      $('#telegram-result').textContent = result.ok ? result.message : '';
      if (!result.ok) $('#telegram-error').textContent = result.message;
      render();
      if (!result.ok) $('#telegram-error').textContent = result.message;
    } catch (error) { $('#telegram-error').textContent = error.message; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
    return;
  }
  const navigation = event.target.closest('[data-page]');
  if (navigation) {
    document.querySelectorAll('[data-page-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.pagePanel !== navigation.dataset.page));
    document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button === navigation));
    $('#page-title').textContent = navigation.dataset.page === 'telegram' ? 'Telegram Desktop' : (navigation.dataset.page === 'lab' ? 'Проверка стратегий' : (navigation.dataset.page === 'routes' ? 'Маршруты VLESS' : 'Управление'));
  }
  if (event.target.id === 'add-domain') { const input = $('#custom-domain'); const value = input.value.trim(); if (!value) return; customDomains = [...new Set([...customDomains, value])]; input.value = ''; await save(); }
  if (event.target.dataset.remove !== undefined) { customDomains.splice(Number(event.target.dataset.remove), 1); await save(); }
  if (event.target.id === 'add-vless-domain') { const input = $('#vless-custom-domain'); const value = input.value.trim(); if (!value) return; vlessCustomDomains = [...new Set([...vlessCustomDomains, value])]; input.value = ''; render(); }
  if (event.target.id === 'add-vless-app') { const input = $('#manual-vless-app'); const value = input.value.trim(); if (!/^[a-z0-9][a-z0-9._ -]{0,120}\.exe$/i.test(value)) return toast('Введите имя исполняемого файла, например my-app.exe.'); vlessManualApps = [...vlessManualApps, { name: value, process: value }]; input.value = ''; render(); toast('Приложение добавлено в список. Сохраните VLESS-профиль.'); }
  if (event.target.dataset.vlessRemove !== undefined) { vlessCustomDomains.splice(Number(event.target.dataset.vlessRemove), 1); render(); }
  if (event.target.id === 'save-vless') {
    if (vlessBusy) return;
    setVlessBusy(true, 'Сохраняю и проверяю VLESS-профиль…');
    const result = await window.localRoute.saveVless(vlessDraft());
    setVlessBusy(false);
    if (!result.ok) return toast(result.message);
    state = result.state; vlessCustomDomains = state.vless.customDomains; $('#vless-uri').value = ''; render(); toast(result.message);
  }
  if (event.target.id === 'toggle-vless') {
    if (vlessBusy) return;
    setVlessBusy(true, state.vlessActive ? 'Останавливаю VLESS…' : 'Запускаю VLESS в фоне…');
    const result = await window.localRoute.toggleVless();
    setVlessBusy(false);
    if (!result.ok) return toast(result.message);
    state = result.state; vlessCustomDomains = state.vless.customDomains; render(); toast(result.message);
  }
  if (event.target.id === 'test-vless') {
    if (vlessBusy) return;
    setVlessBusy(true, 'Проверяю VLESS-маршрут…');
    const result = await window.localRoute.testVless();
    setVlessBusy(false);
    if (result.state) { state = result.state; vlessCustomDomains = state.vless.customDomains; render(); }
    toast(result.message);
  }
  if (event.target.id === 'start-all') {
    if (operationBusy || vlessBusy) return;
    setOperationBusy(true, 'Запускаю Zapret и VLESS в фоне…');
    const result = await window.localRoute.startAll();
    setOperationBusy(false);
    if (!result.ok) return toast(result.message);
    state = result.state; customDomains = state.profile.customDomains; vlessCustomDomains = state.vless.customDomains; render(); toast(result.message);
  }
  if (event.target.id === 'start-vless') {
    if (vlessBusy) return;
    setVlessBusy(true, 'Запускаю VLESS в фоне…');
    const result = await window.localRoute.startVless();
    setVlessBusy(false);
    if (!result.ok) return toast(result.message);
    state = result.state; render(); toast(result.message);
  }
  if (event.target.id === 'start-dpi') {
    if (operationBusy) return;
    setOperationBusy(true, 'Запускаю подтверждённую стратегию DPI…');
    const result = await window.localRoute.startVerified();
    setOperationBusy(false);
    if (!result.ok) return toast(result.message);
    state = result.state; render(); toast(result.message);
  }
  if (event.target.id === 'stop-all') { state = await window.localRoute.stopAll(); setOperationBusy(false); setVlessBusy(false); render(); toast('Zapret и VLESS остановлены.'); }
  if (event.target.id === 'run-check') { state = await window.localRoute.readState(); render(); toast('Локальная диагностика обновлена.'); }
  if (event.target.id === 'refresh-log') { state = await window.localRoute.readState(); render(); }
  if (event.target.closest('#start-verified')) {
    if (operationBusy) return;
    setOperationBusy(true, 'Запускаю сохранённую стратегию…');
    const result = await window.localRoute.startVerified();
    setOperationBusy(false);
    if (!result.ok) return toast(result.message);
    state = result.state; customDomains = state.profile.customDomains; render(); toast(result.message);
  }
  if (event.target.closest('.stop-engine')) { state = await window.localRoute.stopEngine(); setOperationBusy(false); render(); toast('Подбор отменён, локальный драйвер остановлен.'); }
  if (event.target.dataset.strategy) {
    if (operationBusy) return;
    const strategy = event.target.dataset.strategy;
    setOperationBusy(true, `Проверяю стратегию «${STRATEGY_LABELS[strategy] || strategy}»…`);
    document.querySelectorAll('[data-auto-select], .test-strategy').forEach((button) => { button.disabled = true; });
    $('#test-results').innerHTML = '<span class="muted">Тест выполняется. Локальный движок будет остановлен автоматически.</span>';
    const result = await window.localRoute.testStrategy(strategy);
    setOperationBusy(false);
    state = await window.localRoute.readState(); render();
    if (!result.ok) return toast(result.message);
    $('#test-results').innerHTML = result.results.map((item) => `<div class="test-result ${item.success ? 'ok' : 'fail'}"><strong>${item.label || SERVICES[item.service]}</strong> · ${item.success ? 'Успешно' : 'Ошибка'} · ${item.detail} · ${item.durationMs} мс<br><span>${item.url}</span></div>`).join('');
    toast(result.message);
  }
  if (event.target.closest('[data-auto-select]')) {
    if (operationBusy) return;
    setOperationBusy(true, 'Автоподбор идёт в фоновом режиме. Интерфейс остаётся доступен для прокрутки.');
    const button = event.target.closest('[data-auto-select]');
    if (button.hasAttribute('data-save-profile')) {
      state = await window.localRoute.saveProfile(draft());
      customDomains = state.profile.customDomains;
      render();
    }
    document.querySelectorAll('[data-auto-select], .test-strategy').forEach((item) => { item.disabled = true; });
    $('#test-results').innerHTML = '<div class="test-result running"><strong>Автоподбор выполняется</strong><br><span>Стратегии проверяются по очереди. Кнопка остановки доступна.</span></div>';
    toast('Проверяю стратегии локально. Полный поиск может занять несколько минут.');
    const result = await window.localRoute.autoSelect();
    setOperationBusy(false);
    state = await window.localRoute.readState();
    customDomains = state.profile.customDomains;
    render();
    $('#test-results').innerHTML = `<div class="test-result ${result.ok ? 'ok' : 'fail'}"><strong>${result.ok ? 'Рабочая стратегия найдена' : 'Автоподбор завершён'}</strong><br><span>${result.message}</span></div>`;
    toast(result.message);
  }
  if (event.target.closest('#open-release-channel')) window.localRoute.open('https://t.me/TheLocalRoute');
  if (event.target.closest('#open-max-channel')) window.localRoute.open('https://max.ru/channel_LocalRoute');
  if (event.target.closest('#open-repository')) window.localRoute.open('https://github.com/iKokTot/local-route');
});
$('#vless-mode').addEventListener('change', async () => {
  state.vless.mode = $('#vless-mode').value;
  render();
});
$('#autostart-toggle').addEventListener('change', async (event) => {
  const enabled = event.target.checked;
  event.target.disabled = true;
  const result = await window.localRoute.setAutoStart(enabled);
  event.target.disabled = false;
  if (!result.ok) {
    event.target.checked = Boolean(state.autoStart);
    return toast(result.message);
  }
  state = result.state;
  render();
  toast(result.message);
});
window.localRoute.readState().then((next) => { state = next; customDomains = state.profile.customDomains; vlessCustomDomains = state.vless.customDomains; render(); });
