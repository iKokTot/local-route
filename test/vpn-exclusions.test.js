const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createVlessProfile, createSingBoxConfig, vlessProbeTargets } = require('../src/core/vless');
const { runWithInput } = require('../src/platform/windows');
const uri = 'vless://11111111-1111-4111-8111-111111111111@server.example:443?security=tls';

test('recommended VPN exclusions default on but explicitly empty exclusions remain empty', () => {
  const profile = createVlessProfile({mode:'exclude'});
  assert(profile.excludedDomains.includes('avito.ru'));
  assert(profile.excludedDomains.includes('ozon.ru'));
  assert.deepEqual(profile.excludedApps, []);
  assert.deepEqual(profile.services, []);
  const config = createSingBoxConfig(uri, profile);
  assert.equal(config.route.final, 'vless-out');
  assert.equal(config.dns.final, 'vless-dns');
  assert(config.route.rules.some(rule => rule.domain_suffix?.includes('avito.ru')));
  assert.deepEqual(createVlessProfile({mode:'exclude',excludedDomains:[]}).excludedDomains,[]);
});

test('excluded domains and apps use direct routes and excluded DNS goes to local resolver', () => {
  const config = createSingBoxConfig(uri, {mode:'exclude',excludedDomains:['https://Avito.ru/item','*.avito.ru','ozon.ru','bad:443'],excludedApps:['chrome.exe','CHROME.EXE','not-an-app']},{dpiDomains:['youtube.com']});
  const domains = config.route.rules.find(rule => rule.domain_suffix);
  assert.equal(domains.outbound, 'direct');
  assert.deepEqual(domains.domain_suffix, ['youtube.com','avito.ru','ozon.ru']);
  assert.deepEqual(config.dns.rules[0].domain_suffix, domains.domain_suffix);
  assert.equal(config.dns.rules[0].server, 'local-dns');
  assert.equal(config.route.rules.find(rule => rule.process_name?.includes('CHROME.EXE')).outbound, 'direct');
  assert.equal(config.route.final, 'vless-out');
  assert.equal(config.route.rules.find(rule => rule.ip_is_private).outbound, 'direct');
  assert.equal(config.route.rules.find(rule => rule.process_name?.includes('local-route-tg.exe')).outbound, 'direct');
});

test('old selected sites are never inverted into bypass sites during migration', () => {
  const legacy = createVlessProfile({mode:'selective',services:['chatgpt'],customDomains:['example.org'],apps:['ChatGPT.exe']});
  assert.deepEqual(legacy.excludedDomains, []);
  assert.deepEqual(legacy.excludedApps, []);
  assert.equal(createSingBoxConfig(uri, legacy).route.final, 'direct');
  const migrated = createVlessProfile({...legacy,mode:'exclude'});
  assert.deepEqual(migrated.excludedDomains, []);
  assert.deepEqual(migrated.excludedApps, []);
  assert.equal(createSingBoxConfig(uri, migrated).route.final, 'vless-out');
});

test('exclusions persist across repeated profile normalization without becoming VPN targets', () => {
  const raw = {mode:'exclude',excludedDomains:['avito.ru'],excludedApps:['Avito.exe']};
  const profile = createVlessProfile(raw);
  assert.deepEqual(createVlessProfile(profile), profile);
  assert.deepEqual(vlessProbeTargets(profile).map(item => item.kind), ['server']);
  assert(!JSON.stringify(vlessProbeTargets(profile)).includes('avito'));
});

test('bundled sing-box accepts exclusion configurations for VLESS and Hysteria2 offline', {skip:process.platform!=='win32'}, async () => {
  const executable = path.resolve(__dirname,'../engine/sing-box/sing-box-1.14.2-windows-amd64/sing-box.exe');
  for(const input of [uri,'hy2://password@server.example:443?sni=server.example']) {
    const config = createSingBoxConfig(input,{mode:'exclude',excludedDomains:['avito.ru','ozon.ru'],excludedApps:['chrome.exe']},{ipv6:true,dpiDomains:['youtube.com']});
    const result = await runWithInput(executable,['check','-c','stdin'],{input:JSON.stringify(config)});
    assert(result.ok,result.output);
  }
});
