const SERVICES = { youtube: 'YouTube', discord: 'Discord' };
const STRATEGY_LABELS = { balanced: 'Сбалансированная', compatibility: 'Совместимость', split2: 'Split ×2', fakeSplit: 'Fake Split', fakeTls: 'Fake TLS' };
let state; let customDomains = []; let operationBusy = false;
const $ = (selector) => document.querySelector(selector);
const toast = (message) => { const node = $('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 3300); };
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
function render() {
  const selected = new Set(state.profile.services);
  $('#service-list').innerHTML = Object.entries(SERVICES).map(([key, label]) => `<label class="service"><input type="checkbox" value="${key}" ${selected.has(key) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  $('#custom-domains').innerHTML = customDomains.map((domain, index) => `<span class="chip">${domain}<button data-remove="${index}" title="Удалить">×</button></span>`).join('');
  $('#domain-count').textContent = `${state.profile.domains.length} доменов`;
  $('#engine-status').textContent = state.active ? `Включена · ${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy}` : 'Готово к подбору';
  $('#protection-title').textContent = state.active ? `Стратегия «${STRATEGY_LABELS[state.profile.strategy] || state.profile.strategy}» работает` : 'Выберите сервисы и запустите подбор';
  $('#status-dot').classList.toggle('active', state.active);
  document.querySelectorAll('[data-auto-select][data-save-profile]').forEach((button) => { button.textContent = state.active ? 'Подобрать заново' : 'Автоподбор и запуск'; });
  $('#diagnostics').innerHTML = state.diagnostics.map((item) => `<div class="diag ${item.level}"><div class="diag-label"><i></i>${item.label}</div><div class="diag-value">${item.value}</div></div>`).join('');
  const logs = state.logs || [];
  const activity = logs.filter((entry) => !entry.includes('[winws]'));
  const technical = logs.filter((entry) => entry.includes('[winws]'));
  $('#activity-log').innerHTML = activity.length
    ? activity.slice(0, 14).map((entry) => `<div class="activity-item">${escapeHtml(entry)}</div>`).join('')
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
  if (event.target.closest('.stop-engine')) { state = await window.localRoute.stopEngine(); operationBusy = false; document.querySelectorAll('[data-auto-select], .test-strategy').forEach((button) => { button.disabled = false; }); render(); toast('Подбор отменён, локальный драйвер остановлен.'); }
  if (event.target.dataset.strategy) {
    if (operationBusy) return;
    operationBusy = true;
    const strategy = event.target.dataset.strategy;
    document.querySelectorAll('[data-auto-select], .test-strategy').forEach((button) => { button.disabled = true; });
    $('#test-results').innerHTML = '<span class="muted">Тест выполняется. Локальный движок будет остановлен автоматически.</span>';
    const result = await window.localRoute.testStrategy(strategy);
    operationBusy = false;
    document.querySelectorAll('[data-auto-select], .test-strategy').forEach((button) => { button.disabled = false; });
    state = await window.localRoute.readState(); render();
    if (!result.ok) return toast(result.message);
    $('#test-results').innerHTML = result.results.map((item) => `<div class="test-result ${item.success ? 'ok' : 'fail'}"><strong>${item.label || SERVICES[item.service]}</strong> · ${item.success ? 'Успешно' : 'Ошибка'} · ${item.detail} · ${item.durationMs} мс<br><span>${item.url}</span></div>`).join('');
    toast(result.message);
  }
  if (event.target.closest('[data-auto-select]')) {
    if (operationBusy) return;
    operationBusy = true;
    const button = event.target.closest('[data-auto-select]');
    if (button.hasAttribute('data-save-profile')) {
      state = await window.localRoute.saveProfile(draft());
      customDomains = state.profile.customDomains;
      render();
    }
    document.querySelectorAll('[data-auto-select], .test-strategy').forEach((item) => { item.disabled = true; });
    $('#test-results').innerHTML = '<div class="test-result running"><strong>Автоподбор выполняется</strong><br><span>Стратегии проверяются по очереди. Кнопка остановки доступна.</span></div>';
    toast('Проверяю стратегии локально. Это может занять до 45 секунд.');
    const result = await window.localRoute.autoSelect();
    operationBusy = false;
    document.querySelectorAll('[data-auto-select], .test-strategy').forEach((item) => { item.disabled = false; });
    state = await window.localRoute.readState();
    customDomains = state.profile.customDomains;
    render();
    $('#test-results').innerHTML = `<div class="test-result ${result.ok ? 'ok' : 'fail'}"><strong>${result.ok ? 'Рабочая стратегия найдена' : 'Автоподбор завершён'}</strong><br><span>${result.message}</span></div>`;
    toast(result.message);
  }
  if (event.target.id === 'check-updates') { const result = await window.localRoute.checkUpdates(); toast(result.message); }
  if (event.target.id === 'about') window.localRoute.open('https://github.com/Flowseal/zapret-discord-youtube');
});
window.localRoute.readState().then((next) => { state = next; customDomains = state.profile.customDomains; render(); });
