const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfile, createEnginePlan, isDomain, AUTO_STRATEGIES } = require('../src/core/profile');
const { buildEngineArgs } = require('../src/core/engine');

test('profile expands selected services and removes duplicate domains', () => {
  const profile = createProfile({ services: ['youtube', 'discord', 'youtube'], customDomains: ['https://Example.org/path', 'example.org'] });
  assert.deepEqual(profile.services, ['youtube', 'discord']);
  assert.ok(profile.domains.includes('youtube.com'));
  assert.ok(profile.domains.includes('example.org'));
  assert.equal(profile.customDomains.length, 1);
});

test('unsafe or malformed custom targets are ignored', () => {
  const profile = createProfile({ customDomains: ['localhost', 'https://', 'exa mple.com', '*.valid-site.dev'] });
  assert.deepEqual(profile.customDomains, ['valid-site.dev']);
  assert.equal(isDomain('localhost'), false);
});

test('engine plan is constrained to enabled services only', () => {
  const plan = createEnginePlan({ services: ['telegram', 'youtube'], strategy: 'balanced' });
  assert.equal(plan.scope, 'selected-domains-only');
  assert.equal(plan.mode, 'balanced');
  assert.ok(plan.targets.includes('youtube.com'));
  assert.equal(plan.targets.some((target) => target.includes('telegram')), false);
});

test('engine command only adds Discord voice filters when Discord is selected', () => {
  const root = 'C:\\Local Route\\engine';
  const youtube = buildEngineArgs({ engineRoot: root, hostListPath: 'C:\\Temp\\hosts.txt', profile: { services: ['youtube'] } });
  const discord = buildEngineArgs({ engineRoot: root, hostListPath: 'C:\\Temp\\hosts.txt', profile: { services: ['discord'] } });
  assert.equal(youtube.includes('--filter-l7=discord,stun'), false);
  assert.equal(discord.includes('--filter-l7=discord,stun'), true);
  assert.ok(discord.some((value) => value.includes('ACTIVE_DISCORD_UDP.bin')));
});

test('all fallback strategies are accepted and produce an engine command', () => {
  for (const strategy of AUTO_STRATEGIES) {
    const profile = createProfile({ services: ['youtube'], strategy });
    const args = buildEngineArgs({ engineRoot: 'C:\\Engine', hostListPath: 'C:\\hosts.txt', profile });
    assert.equal(profile.strategy, strategy);
    assert.ok(args.some((arg) => arg.startsWith('--dpi-desync=')));
  }
});

test('engine command starts with a real filter and preserves shell-independent fake TLS marker', () => {
  const args = buildEngineArgs({ engineRoot: 'C:\\Engine', hostListPath: 'C:\\hosts.txt', profile: { services: ['youtube'], strategy: 'fakeTls' } });
  assert.equal(args.indexOf('--new') > args.indexOf('--filter-udp=443'), true);
  assert.ok(args.includes('--dpi-desync-fake-tls=!'));
  assert.equal(args.includes('--dpi-desync-fake-tls=^!'), false);
});

test('YouTube and Discord receive separate upstream-style TCP rules', () => {
  const args = buildEngineArgs({
    engineRoot: 'C:\\Engine',
    hostListPath: 'C:\\all.txt',
    googleHostListPath: 'C:\\youtube.txt',
    generalHostListPath: 'C:\\general.txt',
    profile: { services: ['youtube', 'discord'], strategy: 'balanced' }
  });
  assert.ok(args.includes('--hostlist=C:\\youtube.txt'));
  assert.ok(args.includes('--hostlist=C:\\general.txt'));
  assert.ok(args.includes('--ip-id=zero'));
  assert.ok(args.includes('--filter-tcp=2053,2083,2087,2096,8443'));
});

test('ALT12 mirrors the current upstream profile for selected YouTube and Discord traffic', () => {
  const args = buildEngineArgs({
    engineRoot: 'C:\\Engine',
    hostListPath: 'C:\\all.txt',
    googleHostListPath: 'C:\\youtube.txt',
    generalHostListPath: 'C:\\general.txt',
    profile: { services: ['youtube', 'discord'], strategy: 'alt12' }
  });
  assert.ok(args.includes('--dpi-desync=hostfakesplit'));
  assert.ok(args.includes('--dpi-desync-hostfakesplit-mod=host=www.google.com'));
  assert.ok(args.includes('--dpi-desync-split-seqovl=664'));
  assert.ok(args.includes('--dpi-desync-fake-discord=C:\\Engine\\bin\\stun.bin'));
  assert.ok(args.includes('--dpi-desync-repeats=3'));
});

test('Telegram cannot create an engine command while it is held back', () => {
  const profile = createProfile({ services: ['telegram'], strategy: 'fakeTls' });
  const args = buildEngineArgs({ engineRoot: 'C:\\Engine', hostListPath: 'C:\\all.txt', profile });
  assert.equal(profile.services.includes('telegram'), false);
  assert.equal(args.includes('--filter-tcp=80,443,5222'), false);
  assert.equal(args.some((value) => value.includes('telegram-ipset')), false);
});

test('Discord profile includes desktop gateway, CDN and updater domains', () => {
  const profile = createProfile({ services: ['discord'] });
  assert.ok(profile.domains.includes('gateway.discord.gg'));
  assert.ok(profile.domains.includes('cdn.discordapp.com'));
  assert.ok(profile.domains.includes('updates.discord.com'));
});

test('Telegram is held back and cannot be added to a current profile', () => {
  const profile = createProfile({ services: ['youtube', 'telegram'] });
  assert.deepEqual(profile.services, ['youtube']);
  assert.equal(profile.domains.some((domain) => domain.includes('telegram')), false);
});
