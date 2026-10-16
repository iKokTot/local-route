const net = require('node:net');
const crypto = require('node:crypto');

function proxySettings(raw = {}) {
  const port = Number(raw.port ?? 1443);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Порт должен быть от 1024 до 65535.');
  return { enabled: Boolean(raw.enabled), port };
}
function proxySecret() { return crypto.randomBytes(16).toString('hex'); }
function proxyLink(port, secret) {
  if (!/^[a-f0-9]{32}$/i.test(secret)) throw new Error('Некорректный секрет Telegram.');
  return `tg://proxy?server=127.0.0.1&port=${proxySettings({ port }).port}&secret=dd${secret}`;
}
function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
function listenerReady(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; socket.destroy(); resolve(ok); } };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
module.exports = { proxySettings, proxySecret, proxyLink, portAvailable, listenerReady };
