const crypto = require('node:crypto');
const { parseProxyInput } = require('./vless');
const LIMIT = 2 * 1024 * 1024;
function parseSubscription(body) {
  let text = String(body).trim();
  if (Buffer.byteLength(text) > LIMIT) throw new Error('Подписка больше 2 МБ.');
  if (!/^[\[{]/.test(text) && !text.includes('://')) text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8').trim();
  let entries;
  if (/^[\[{]/.test(text)) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('Некорректный JSON подписки. Нужен формат sing-box.'); }
    entries = Array.isArray(json) ? json.flatMap((item) => item.outbounds || [item]) : (json.outbounds || [json]);
    entries = entries.filter((item) => item?.server).map((item) => ({ input: JSON.stringify(item), name: item.tag || item.remarks || item.type }));
  } else entries = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((input) => {
    let name = 'Сервер'; try { const url = new URL(input); name = decodeURIComponent(url.hash.slice(1)) || url.hostname; } catch {}
    return { input, name };
  });
  const seen = new Set();
  const servers = [];
  for (const item of entries.slice(0, 500)) {
    if (!item.input.startsWith('{') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(item.input)) continue;
    const id = crypto.createHash('sha256').update(item.input).digest('hex').slice(0, 20);
    if (seen.has(id)) continue;
    seen.add(id);
    let outbound; let error = '';
    try { outbound = parseProxyInput(item.input); } catch (cause) { error = cause.message.includes('Транспорт') ? 'XHTTP или другой транспорт не поддерживается этим ядром' : 'Формат подключения не поддерживается'; }
    servers.push({ id, name: String(item.name || 'Сервер').slice(0, 120), protocol: outbound?.type || 'unsupported', supported: Boolean(outbound), error, input: item.input });
  }
  if (!servers.length) throw new Error('В подписке не найдены серверы. Поддерживаются списки ссылок, Base64 и sing-box JSON.');
  return servers;
}
function subscriptionUsage(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const [key, value] = part.trim().split('=');
    if (['upload', 'download', 'total', 'expire'].includes(key) && /^\d+$/.test(value || '')) result[key] = Number(value);
  }
  return result;
}
function fetchSubscription(address) {
  // Compatibility wrapper: all downloads use the same redirect/size/deadline policy.
  return Promise.resolve().then(()=>require('./subscriptions').downloadSubscription(address,{metadata:true}))
    .then(({text,usage})=>({servers:parseSubscription(text),usage,title:new URL(address).hostname}));
}
module.exports = { parseSubscription, subscriptionUsage, fetchSubscription };
