const SERVICES = { youtube: 'YouTube', discord: 'Discord' };
const STRATEGY_LABELS = {
  zapretAlt: 'Zapret ALT', zapretAlt2: 'Zapret ALT2', zapretAlt3: 'Zapret ALT3', zapretAlt4: 'Zapret ALT4', zapretAlt5: 'Zapret ALT5', zapretAlt6: 'Zapret ALT6', zapretAlt7: 'Zapret ALT7', zapretAlt8: 'Zapret ALT8', zapretAlt9: 'Zapret ALT9', zapretAlt10: 'Zapret ALT10', zapretAlt11: 'Zapret ALT11', zapretAlt12: 'Zapret ALT12', zapretAlt13: 'Zapret ALT13',
  zapretFakeTlsAuto: 'FAKE TLS AUTO', zapretFakeTlsAutoAlt: 'FAKE TLS AUTO ALT', zapretFakeTlsAutoAlt2: 'FAKE TLS AUTO ALT2', zapretFakeTlsAutoAlt3: 'FAKE TLS AUTO ALT3', zapretSimpleFake: 'SIMPLE FAKE', zapretSimpleFakeAlt: 'SIMPLE FAKE ALT', zapretSimpleFakeAlt2: 'SIMPLE FAKE ALT2', zapretExp: 'Zapret EXP', zapretBase: 'Zapret Standard',
  alt12: 'Упрощённый ALT12', balanced: 'Сбалансированная', compatibility: 'Совместимость', split2: 'Split ×2', fakeSplit: 'Fake Split', fakeTls: 'Fake TLS'
};
const UPSTREAM_STRATEGY_IDS = Object.keys(STRATEGY_LABELS).filter((id) => id.startsWith('zapret'));
let state; let customDomains = []; let operationBusy = false; let toastTimer;
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
function render() {
  const selected = new Set(state.profile.services);
  $('#service-list').innerHTML = Object.entries(SERVICES).map(([key, label]) => `<label class="service"><input type="checkbox" value="${key}" ${selected.has(key) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  $('#strategy-tests').innerHTML = UPSTREAM_STRATEGY_IDS.map((id) => `<button class="button secondary test-strategy" data-strategy="${id}">${STRATEGY_LABELS[id]}</button>`).join('');
  $('#custom-domains').innerHTML = customDomains.map((domain, index) => `<span class="chip">${domain}<button data-remove="${index}" title="Удалить">×</button></span>`).join('');
  $('#domain-count').textContent = `${state.profile.domains.length} доменов`;
  $('#engine-status').textContent = state.active ? `Включена · ${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy}` : 'Готово к подбору';
  $('#protection-title').textContent = state.active ? `Стратегия «${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy}» работает` : 'Выберите сервисы и запустите подбор';
  $('#protection-description').textContent = state.active
    ? 'Защита остаётся включённой до остановки вручную.'
    : (state.verifiedStrategy ? `Есть подтверждённая стратегия: «${STRATEGY_LABELS[state.verifiedStrategy] || state.verifiedStrategy}».` : 'Подбор проверит доступность и оставит включённой подходящую стратегию.');
  $('#status-dot').classList.toggle('active', state.active);
  $('#autostart-toggle').checked = Boolean(state.autoStart);
  $('#autostart-description').textContent = state.autoStart
    ? (state.verifiedStrategy ? `Включён · стратегия «${STRATEGY_LABELS[state.verifiedStrategy] || state.verifiedStrategy}»` : 'Включён, но после изменения профиля нужен новый автоподбор.')
    : (state.verifiedStrategy ? 'При входе в Windows запустит подтверждённую стратегию и останется в трее.' : 'Сначала выполните автоподбор, затем автозапуск можно включить.');
  const verifiedLabel = STRATEGY_LABELS[state.verifiedStrategy] || state.verifiedStrategy;
  const canStartVerified = Boolean(state.verifiedStrategy && !state.active);
  $('#start-verified').classList.toggle('hidden', !canStartVerified);
  $('#start-verified').textContent = `▶ Запустить прошлую: «${verifiedLabel}»`;
  document.querySelectorAll('[data-auto-select][data-save-profile]').forEach((button) => { button.textContent = state.active ? 'Подобрать заново' : (state.verifiedStrategy ? 'Подобрать заново' : 'Автоподбор и запуск'); });
  $('#diagnostics').innerHTML = state.diagnostics.map((item) => `<div class="diag ${item.level}"><div class="diag-label"><i></i>${item.label}</div><div class="diag-value">${item.value}</div></div>`).join('');
  const logs = state.logs || [];
  const activity = logs.filter((entry) => !entry.includes('[winws]') && !/(YouTube|Discord (API|Gateway|CDN|Updates)):/i.test(entry));
  const technical = logs.filter((entry) => entry.includes('[winws]'));
  $('#activity-log').innerHTML = activity.length
    ? activity.slice(0, 6).map((entry) => `<div class="activity-item">${escapeHtml(entry)}</div>`).join('')
    : '<span class="muted">Нет событий управления.</span>';
  $('#engine-log').textContent = technical.length ? technical.join('\n') : 'Нет технических событий.';
}
function draft() { return { services: [...document.querySelectorAll('.service input:checked')].map((input) => input.value), customDomains, strategy: state.profile.strategy }; }
async function save() { state = await window.localRoute.saveProfile(draft()); customDomains = state.profile.customDomains; render(); toast('Профиль сохранён локально.'); }
document.addEventListener('click', async (event) => {
  const navigation = event.target.closest('[data-page]');
  if (navigation) {
    document.querySelectorAll('[data-page-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.pagePanel !== navigation.dataset.page));
    document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button === navigation));
    $('#page-title').textContent = navigation.dataset.page === 'lab' ? 'Проверка стратегий' : 'Управление';
  }
  if (event.target.id === 'add-domain') { const input = $('#custom-domain'); const value = input.value.trim(); if (!value) return; customDomains = [...new Set([...customDomains, value])]; input.value = ''; await save(); }
  if (event.target.dataset.remove !== undefined) { customDomains.splice(Number(event.target.dataset.remove), 1); await save(); }
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
  if (event.target.closest('#open-repository')) window.localRoute.open('https://github.com/iKokTot/local-route');
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
window.localRoute.readState().then((next) => { state = next; customDomains = state.profile.customDomains; render(); });
