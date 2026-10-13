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
const STRATEGIES = Object.freeze([
  { id: 'auto', label: 'Автоподбор — все профили' },
  { id: 'balanced', label: 'Сбалансированная' },
  { id: 'compatibility', label: 'Совместимость' },
  { id: 'split2', label: 'Split ×2' },
  { id: 'fakeSplit', label: 'Fake Split' },
  { id: 'fakeTls', label: 'Fake TLS' }
]);
const STRATEGY_IDS = new Set(STRATEGIES.map((strategy) => strategy.id));
const AUTO_STRATEGIES = Object.freeze(STRATEGIES.filter((strategy) => strategy.id !== 'auto').map((strategy) => strategy.id));

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

module.exports = { SERVICE_CATALOG, ENABLED_SERVICE_IDS, STRATEGIES, AUTO_STRATEGIES, normalizeDomain, isDomain, createProfile, createEnginePlan };
