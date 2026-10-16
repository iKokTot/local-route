const { URL } = require('node:url');

const VLESS_SERVICE_CATALOG = Object.freeze({
  tiktok: { label: 'TikTok', domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'ibytedtos.com', 'byteoversea.com', 'musical.ly'], probe: 'https://www.tiktok.com/' },
  instagram: { label: 'Instagram', domains: ['instagram.com', 'cdninstagram.com', 'instagram.fiev', 'fbcdn.net'], probe: 'https://www.instagram.com/' },
  x: { label: 'X / Twitter', domains: ['x.com', 'twitter.com', 'twimg.com', 't.co'], probe: 'https://x.com/' },
  chatgpt: { label: 'ChatGPT', domains: ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'], probe: 'https://chatgpt.com/' }
});
const VLESS_SERVICE_IDS = new Set(Object.keys(VLESS_SERVICE_CATALOG));

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '');
}
function isDomain(value) {
  const domain = normalizeDomain(value);
  return domain.length < 254 && /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain);
}
function parseVlessUri(value) {
  const raw = String(value || '').trim();
  const url = new URL(raw);
  if (url.protocol !== 'vless:' || !url.hostname || !url.port || !url.username) throw new Error('Нужна полная ссылка vless:// с адресом, портом и UUID.');
  const type = url.searchParams.get('type') || 'tcp';
  const security = url.searchParams.get('security') || 'none';
  if (!['tcp', 'ws', 'grpc', 'httpupgrade'].includes(type)) throw new Error(`Транспорт ${type} пока не поддерживается.`);
  if (!['none', 'tls', 'reality'].includes(security)) throw new Error(`Защита ${security} пока не поддерживается.`);
  const entry = { server: url.hostname, server_port: Number(url.port), uuid: decodeURIComponent(url.username) };
  if (security !== 'none') {
    entry.tls = { enabled: true, server_name: url.searchParams.get('sni') || url.searchParams.get('host') || url.hostname, insecure: url.searchParams.get('allowInsecure') === '1' };
    if (security === 'reality') {
      const publicKey = url.searchParams.get('pbk');
      if (!publicKey) throw new Error('Для VLESS Reality не найден ключ pbk.');
      entry.tls.reality = { enabled: true, public_key: publicKey, short_id: url.searchParams.get('sid') || '' };
    }
  }
  if (url.searchParams.get('flow')) entry.flow = url.searchParams.get('flow');
  if (type === 'ws') entry.transport = { type: 'ws', path: url.searchParams.get('path') || '/', headers: url.searchParams.get('host') ? { Host: url.searchParams.get('host') } : undefined };
  if (type === 'grpc') entry.transport = { type: 'grpc', service_name: url.searchParams.get('serviceName') || '' };
  if (type === 'httpupgrade') entry.transport = { type: 'httpupgrade', host: url.searchParams.get('host') || undefined, path: url.searchParams.get('path') || '/' };
  return entry;
}
function normalizeProcessName(value) {
  const name = String(value || '').trim();
  return /^[a-z0-9][a-z0-9._ -]{0,120}\.exe$/i.test(name) ? name : '';
}
function createVlessProfile({ services = ['tiktok', 'instagram'], customDomains = [], apps = [], mode = 'selective' } = {}) {
  const selected = [...new Set(services)].filter((service) => VLESS_SERVICE_IDS.has(service));
  const domains = [...selected.flatMap((service) => VLESS_SERVICE_CATALOG[service].domains), ...customDomains.map(normalizeDomain).filter(isDomain)];
  return { mode: mode === 'all' ? 'all' : 'selective', services: selected, customDomains: [...new Set(customDomains.map(normalizeDomain).filter(isDomain))], apps: [...new Set(apps.map(normalizeProcessName).filter(Boolean))].sort(), domains: [...new Set(domains)].sort() };
}
function createSingBoxConfig(uri, rawProfile) {
  const outbound = { type: 'vless', tag: 'vless-out', ...parseVlessUri(uri) };
  const profile = createVlessProfile(rawProfile);
  const selective = profile.mode === 'selective';
  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        { type: 'https', tag: 'vless-dns', server: '1.1.1.1', server_port: 443, path: '/dns-query', detour: 'vless-out' },
        { type: 'local', tag: 'local-dns' }
      ],
      rules: selective && profile.domains.length ? [{ domain_suffix: profile.domains, action: 'route', server: 'vless-dns' }] : [],
      final: selective ? 'local-dns' : 'vless-dns'
    },
    // Do not use 172.16/12 here: Docker, WSL and several VPN clients commonly
    // reserve it, causing Windows to reject the TUN address as already present.
    // 198.18/15 is the benchmarking range and is safe as an internal TUN subnet.
    inbounds: [{ type: 'tun', tag: 'local-route-tun', interface_name: 'LocalRouteVless', address: ['198.18.0.1/30'], auto_route: true, strict_route: true, stack: 'mixed', mtu: 1400 }],
    outbounds: [outbound, { type: 'direct', tag: 'direct' }],
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'local-dns',
      rules: [
        { protocol: 'dns', action: 'hijack-dns' },
        // TGWs is an independent direct connection, including full-tunnel mode.
        { process_name: ['local-route-tg.exe'], outbound: 'direct' },
        ...(selective && profile.domains.length ? [{ domain_suffix: profile.domains, outbound: 'vless-out' }] : []),
        ...(selective && profile.apps.length ? [{ process_name: profile.apps, outbound: 'vless-out' }] : []),
        { ip_is_private: true, outbound: 'direct' }
      ],
      final: selective ? 'direct' : 'vless-out'
    }
  };
}

function vlessProbe(profile) {
  const normalized = createVlessProfile(profile);
  if (normalized.mode === 'all') return { label: 'VLESS', url: 'https://www.cloudflare.com/cdn-cgi/trace' };
  const service = normalized.services.find((id) => VLESS_SERVICE_CATALOG[id]?.probe);
  return service ? { label: VLESS_SERVICE_CATALOG[service].label, url: VLESS_SERVICE_CATALOG[service].probe } : null;
}

module.exports = { VLESS_SERVICE_CATALOG, VLESS_SERVICE_IDS, parseVlessUri, createVlessProfile, createSingBoxConfig, vlessProbe };
