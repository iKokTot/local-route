const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubscription, subscriptionUsage, fetchSubscription } = require('../src/core/subscription-formats');
const { createSingBoxConfig, parseProxyInput } = require('../src/core/vless');
const link = 'vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls&type=ws#Germany';

test('plain and base64 subscriptions preserve stable identities and deduplicate', () => {
  const plain = parseSubscription(`${link}\n${link}\nhy2://password@example.org:443?sni=example.org#Finland`);
  const encoded = parseSubscription(Buffer.from(`${link}\nhy2://password@example.org:443?sni=example.org#Finland`).toString('base64'));
  assert.equal(plain.length, 2);
  assert.equal(plain[0].name, 'Germany');
  assert.equal(plain[1].protocol, 'hysteria2');
  assert.deepEqual(plain.map((server) => server.id), encoded.map((server) => server.id));
});
test('unsupported XHTTP remains visible and cannot create a tunnel config', () => {
  const xhttp = link.replace('type=ws', 'type=xhttp');
  assert.equal(parseSubscription(xhttp)[0].supported, false);
  assert.throws(() => createSingBoxConfig(xhttp, {}));
});
test('sing-box JSON imports only remote outbounds and strips local paths and routing', () => {
  const payload = { outbounds: [{ type: 'direct' }, { type: 'vless', tag: 'Netherlands', server: 'example.com', server_port: 443, uuid: 'test', detour: 'unexpected', tls: { enabled: true, server_name: 'example.com', certificate_path: 'C:/private.pem' } }], inbounds: [{ listen: '0.0.0.0' }] };
  const servers = parseSubscription(JSON.stringify(payload));
  assert.equal(servers.length, 1);
  const outbound = parseProxyInput(servers[0].input);
  assert.equal(outbound.detour, undefined);
  assert.equal(outbound.tls.certificate_path, undefined);
});
test('provider usage is parsed numerically, including missing or unlimited quota', () => {
  assert.deepEqual(subscriptionUsage('upload=2; download=3; total=100; expire=1790000000'), { upload: 2, download: 3, total: 100, expire: 1790000000 });
  assert.deepEqual(subscriptionUsage('token=secret; download=invalid; total=0'), { total: 0 });
});
test('subscription download rejects insecure schemes without network requests', async () => {
  await assert.rejects(fetchSubscription('http://example.com/token'), /HTTPS/);
  await assert.rejects(fetchSubscription('file:///C:/private'), /HTTPS/);
});
test('hysteria2 imports credentials and obfuscation without changing default direct routing', () => {
  const config = createSingBoxConfig('hy2://user:pass@example.org:443?obfs=salamander&obfs-password=opaque&sni=example.org', {});
  assert.equal(config.outbounds[0].password, 'user:pass');
  assert.equal(config.outbounds[0].obfs.password, 'opaque');
  assert.equal(config.route.final, 'direct');
});
