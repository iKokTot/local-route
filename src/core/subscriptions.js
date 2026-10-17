const https = require('node:https');
const { createHash } = require('node:crypto');
const { parseVlessUri } = require('./vless');

const MAX_BYTES = 2 * 1024 * 1024;
function serverId(uri) { return createHash('sha256').update(uri).digest('hex').slice(0, 24); }
function parseSubscription(raw) {
  const entries = require("./subscription-formats").parseSubscription(raw);
  return { profiles: entries.map(item => {
    let endpoint;
    try { endpoint = require("./vless").parseProxyInput(item.input); } catch {}
    return { id: serverId(item.input), name: item.name, uri: item.input, server: endpoint?.server || "", port: endpoint?.server_port || 0, protocol: item.protocol, supported: item.supported, error: item.error };
  }), skipped: 0 };
}
function subscriptionUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Нужна HTTPS-ссылка на подписку.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error('Нужна HTTPS-ссылка без логина и фрагмента.');
  return url;
}
// Ошибки загрузки не содержат адрес подписки: он может включать секретный токен.
function downloadSubscription(address, { signal, request = https.get, timeoutMs = 15000, metadata = false } = {}) {
  const url = subscriptionUrl(address);
  return new Promise((resolve, reject) => {
    let req, timer, done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { req?.destroy(); reject(error); } else resolve(value);
    };
    const abort = () => finish(Object.assign(new Error('Загрузка отменена.'), { code: 'ABORT_ERR' }));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('Источник не ответил вовремя.')), timeoutMs);
    const load = (current, redirects = 0) => { try {
      req = request(current, { headers: { Accept: 'text/plain, application/json', 'User-Agent': 'LocalRoute' } }, response => {
        if ([301,302,303,307,308].includes(response.statusCode)) {
          response.resume();
          let next;
          try { if(!response.headers?.location)throw new Error();next=subscriptionUrl(new URL(response.headers.location,current).href); } catch { return finish(new Error('Некорректное перенаправление подписки.')); }
          if (redirects>=3) return finish(new Error('Слишком много перенаправлений подписки.'));
          if (next.origin!==url.origin) return finish(new Error('Подписка перенаправляет на другой сервер. Добавьте конечную HTTPS-ссылку вручную.'));
          return load(next,redirects+1);
        }
        if (response.statusCode !== 200) { response.resume(); return finish(new Error('Источник не вернул список серверов (нужен прямой HTTPS-адрес).')); }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BYTES) { response.destroy(); finish(new Error('Список серверов слишком большой.')); }
          else chunks.push(chunk);
        });
        response.on('error', () => finish(new Error('Загрузка списка прервана.')));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const usage = require('./subscription-formats').subscriptionUsage(response.headers?.['subscription-userinfo']);
          finish(null, metadata ? { text, usage } : text);
        });
      });
      req.on('error', () => finish(new Error('Не удалось загрузить подписку. Проверьте ссылку и сеть.')));
    } catch { finish(new Error('Не удалось загрузить подписку.')); } };
    load(url);
  });
}
module.exports = { parseSubscription, downloadSubscription, subscriptionUrl, serverId };
