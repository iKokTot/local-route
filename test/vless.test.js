const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVlessUri, createVlessProfile, createSingBoxConfig } = require('../src/core/vless');

const LINK = 'vless://00000000-0000-4000-8000-000000000000@example.com:443?type=ws&security=tls&path=%2Fvless&host=cdn.example.com&sni=cdn.example.com#test';

test('parses TLS WebSocket VLESS without retaining the human-readable fragment', () => {
  const outbound = parseVlessUri(LINK);
  assert.equal(outbound.server, 'example.com');
  assert.equal(outbound.server_port, 443);
  assert.equal(outbound.transport.type, 'ws');
  assert.equal(outbound.transport.path, '/vless');
  assert.equal(outbound.tls.server_name, 'cdn.example.com');
});

test('selective VLESS profile sends only selected service domains into the tunnel', () => {
  const profile = createVlessProfile({ services: ['tiktok', 'instagram'], customDomains: ['https://Example.org/path'] });
  assert.ok(profile.domains.includes('tiktok.com'));
  assert.ok(profile.domains.includes('instagram.com'));
  assert.ok(profile.domains.includes('example.org'));
  assert.equal(profile.domains.includes('avito.ru'), false);
});

test('sing-box config keeps all unmatched traffic direct', () => {
  const config = createSingBoxConfig(LINK, { services: ['tiktok'] });
  assert.equal(config.route.final, 'direct');
  assert.equal(config.route.rules.find((rule) => rule.outbound === 'vless-out').domain_suffix.includes('tiktok.com'), true);
  assert.equal(config.inbounds[0].type, 'tun');
  assert.equal(config.inbounds[0].interface_name, 'LocalRouteVless');
  assert.deepEqual(config.inbounds[0].address, ['198.18.0.1/30']);
  assert.equal(config.outbounds[0].type, 'vless');
});

test('whole-internet VLESS mode keeps private networks direct and tunnels the rest', () => {
  const config = createSingBoxConfig(LINK, { mode: 'all', services: [] });
  assert.equal(config.route.final, 'vless-out');
  assert.equal(config.dns.final, 'vless-dns');
  assert.equal(config.route.rules.find((rule) => rule.ip_is_private).outbound, 'direct');
});

test('selected Windows process names can use selective VLESS routing', () => {
  const config = createSingBoxConfig(LINK, { services: [], apps: ['Discord.exe', 'not-an-exe'] });
  const rule = config.route.rules.find((item) => item.process_name);
  assert.deepEqual(rule.process_name, ['Discord.exe']);
  assert.equal(rule.outbound, 'vless-out');
});
