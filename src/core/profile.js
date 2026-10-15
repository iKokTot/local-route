const SERVICE_CATALOG = Object.freeze({
  youtube: {
    label: 'YouTube',
    domains: [
      'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'youtubekids.com',
      'googlevideo.com', 'ytimg.com', 'ggpht.com', 'youtube.googleapis.com',
      'youtubei.googleapis.com', 'youtubeembeddedplayer.googleapis.com'
    ]
  },
  discord: {
    label: 'Discord',
    domains: [
      'discord.com', 'gateway.discord.gg', 'cdn.discordapp.com', 'updates.discord.com',
      'discord.gg', 'discord.media', 'discordapp.com', 'discordapp.net',
      'discordcdn.com', 'discordstatus.com', 'discord-activities.com',
      'discordactivities.com', 'discord.gift', 'discord.gifts', 'discord.new',
      'discord.store', 'discord.dev', 'discord.co', 'dis.gd'
    ]
  },
  telegram: {
    label: 'Telegram',
    domains: [
      'telegram.org', 'web.telegram.org', 'pluto.web.telegram.org',
      'venus.web.telegram.org', 'aurora.web.telegram.org',
      'vesta.web.telegram.org', 'flora.web.telegram.org',
      't.me', 'telegram.me', 'telegra.ph', 'telesco.pe'
    ]
  }
});
// Telegram is intentionally held back until its dedicated transport is production-ready.
const ENABLED_SERVICE_IDS = new Set(['youtube', 'discord']);
const UPSTREAM_STRATEGIES = Object.freeze([
  { id: 'zapretAlt', label: 'Zapret ALT' },
  { id: 'zapretAlt2', label: 'Zapret ALT2' },
  { id: 'zapretAlt3', label: 'Zapret ALT3' },
  { id: 'zapretAlt4', label: 'Zapret ALT4' },
  { id: 'zapretAlt5', label: 'Zapret ALT5' },
  { id: 'zapretAlt6', label: 'Zapret ALT6' },
  { id: 'zapretAlt7', label: 'Zapret ALT7' },
  { id: 'zapretAlt8', label: 'Zapret ALT8' },
  { id: 'zapretAlt9', label: 'Zapret ALT9' },
  { id: 'zapretAlt10', label: 'Zapret ALT10' },
  { id: 'zapretAlt11', label: 'Zapret ALT11' },
  { id: 'zapretAlt12', label: 'Zapret ALT12' },
  { id: 'zapretAlt13', label: 'Zapret ALT13' },
  { id: 'zapretFakeTlsAuto', label: 'Zapret FAKE TLS AUTO' },
  { id: 'zapretFakeTlsAutoAlt', label: 'Zapret FAKE TLS AUTO ALT' },
  { id: 'zapretFakeTlsAutoAlt2', label: 'Zapret FAKE TLS AUTO ALT2' },
  { id: 'zapretFakeTlsAutoAlt3', label: 'Zapret FAKE TLS AUTO ALT3' },
  { id: 'zapretSimpleFake', label: 'Zapret SIMPLE FAKE' },
  { id: 'zapretSimpleFakeAlt', label: 'Zapret SIMPLE FAKE ALT' },
  { id: 'zapretSimpleFakeAlt2', label: 'Zapret SIMPLE FAKE ALT2' },
  { id: 'zapretExp', label: 'Zapret EXP' },
  { id: 'zapretBase', label: 'Zapret Standard' }
]);
const STRATEGIES = Object.freeze([
  { id: 'auto', label: 'Автоподбор — все профили' },
  ...UPSTREAM_STRATEGIES,
  { id: 'alt12', label: 'Упрощённый ALT12' },
  { id: 'balanced', label: 'Сбалансированная' },
  { id: 'compatibility', label: 'Совместимость' },
  { id: 'split2', label: 'Split ×2' },
  { id: 'fakeSplit', label: 'Fake Split' },
  { id: 'fakeTls', label: 'Fake TLS' }
]);
const STRATEGY_IDS = new Set(STRATEGIES.map((strategy) => strategy.id));
const AUTO_STRATEGIES = Object.freeze(UPSTREAM_STRATEGIES.map((strategy) => strategy.id));

function orderedAutoStrategies(preferredStrategy) {
  if (!preferredStrategy || !STRATEGY_IDS.has(preferredStrategy) || preferredStrategy === 'auto') return [...AUTO_STRATEGIES];
  return [preferredStrategy, ...AUTO_STRATEGIES.filter((strategy) => strategy !== preferredStrategy)];
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '');
}

function isDomain(value) {
  const domain = normalizeDomain(value);
  return domain.length < 254 && /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain);
}

function createProfile({ services = [], customDomains = [], strategy = 'auto' } = {}) {
  const selected = [...new Set(services)].filter((service) => SERVICE_CATALOG[service] && ENABLED_SERVICE_IDS.has(service));
  const domains = [
    ...selected.flatMap((service) => SERVICE_CATALOG[service].domains),
    ...customDomains.map(normalizeDomain).filter(isDomain)
  ];
  return {
    services: selected,
    customDomains: [...new Set(domains.filter((domain) => !Object.values(SERVICE_CATALOG).flatMap((service) => service.domains).includes(domain)))],
    strategy: STRATEGY_IDS.has(strategy) ? strategy : 'auto',
    domains: [...new Set(domains)].sort()
  };
}

function createEnginePlan(profile) {
  const normalized = createProfile(profile);
  return {
    protocol: 'v1',
    mode: normalized.strategy,
    targets: normalized.domains,
    scope: 'selected-domains-only'
  };
}

module.exports = { SERVICE_CATALOG, ENABLED_SERVICE_IDS, STRATEGIES, AUTO_STRATEGIES, STRATEGY_IDS, orderedAutoStrategies, normalizeDomain, isDomain, createProfile, createEnginePlan };
