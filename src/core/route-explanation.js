const { domainToASCII } = require('node:url');
const { isIP } = require('node:net');
const { createVlessProfile } = require('./vless');

function siteDomain(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Введите домен или HTTPS-ссылку сайта.');
  const raw = input.trim();
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error('Некорректный адрес сайта.'); }
  const domain = domainToASCII(url.hostname.replace(/\.$/, '').toLowerCase());
  const labels=domain.split('.');
  const valid=domain.length<254 && labels.length>1 && labels.every(label=>/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) && /[a-z]/i.test(labels.at(-1));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || isIP(domain) || !valid) throw new Error('Нужен домен сайта без пароля, например avito.ru.');
  return domain;
}
function matchDomain(domain, rules) {
  return rules.filter(rule => domain === rule || domain.endsWith(`.${rule}`)).sort((a,b) => b.length-a.length)[0];
}
function explainRoute(input, { profile, vpnActive = false, dpiActive = false, dpiDomains = [] } = {}) {
  const domain = siteDomain(input);
  const normalized = createVlessProfile(profile);
  const dpi = dpiActive && matchDomain(domain, dpiDomains);
  const excluded = normalized.mode === 'exclude' && matchDomain(domain, normalized.excludedDomains);
  const selected = matchDomain(domain, normalized.domains);
  const route = !vpnActive || dpi || excluded || (normalized.mode === 'selective' && !selected) ? 'direct' : 'vpn';
  const reason = !vpnActive ? 'VPN выключен: его правила сейчас не применяются.' : dpi ? `Домен ${dpi} обслуживается включённым DPI и исключён из VPN.` : excluded ? `Совпало сохранённое исключение: ${excluded}.` : normalized.mode === 'selective' ? selected ? `Домен выбран для VPN: ${selected}.` : 'В прежнем выборочном режиме этот домен не выбран для VPN.' : 'Исключения не найдены: действует общее правило VPN.';
  return { domain, route, reason, rule: dpi || excluded || selected || null, caveat: 'Это расчёт по сохранённым правилам Local Route, не проверка фактического IP или доступности сайта. Правило приложения, локальный IP, другой VPN, DNS браузера и уже открытые соединения могут изменить результат.' };
}
module.exports = { siteDomain, explainRoute };
