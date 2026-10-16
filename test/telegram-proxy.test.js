const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { proxySettings, proxySecret, proxyLink, portAvailable, listenerReady } = require('../src/core/telegram-proxy');

test('Telegram proxy validates ports and generates persistent-compatible MTProto links', () => {
  const secret = proxySecret();
  assert.match(secret, /^[a-f0-9]{32}$/);
  assert.equal(proxyLink(1443, secret), `tg://proxy?server=127.0.0.1&port=1443&secret=dd${secret}`);
  assert.throws(() => proxySettings({ port: 0 }));
  assert.throws(() => proxySettings({ port: 70000 }));
  assert.throws(() => proxyLink(1443, 'invalid'));
});

test('Telegram port checks distinguish a busy listener from an available port', async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await portAvailable(port), false);
    assert.equal(await listenerReady(port), true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  assert.equal(await portAvailable(port), true);
  assert.equal(await listenerReady(port), false);
});
