const { URL } = require('node:url');

const VLESS_SERVICE_CATALOG = Object.freeze({
  tiktok: { label: 'TikTok', domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'ibytedtos.com', 'byteoversea.com', 'musical.ly'], probe: 'https://www.tiktok.com/' },
  instagram: { label: 'Instagram', domains: ['instagram.com', 'cdninstagram.com', 'fbcdn.net'], probe: 'https://www.instagram.com/' },
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
  if (['https:', 'http:'].includes(url.protocol)) throw new Error('Это ссылка подписки. Сейчас добавьте отдельную ссылку vless://; импорт подписок пока не поддерживается.');
  if (url.protocol !== 'vless:' || !url.hostname || !url.port || !url.username) throw new Error('Нужна полная ссылка vless:// с адресом, портом и UUID.');
  const type = url.searchParams.get('type') || 'tcp';
  const security = url.searchParams.get('security') || 'none';
  if (!['tcp', 'ws', 'grpc', 'httpupgrade'].includes(type)) throw new Error(`Транспорт ${type} пока не поддерживается.`);
  if (!['none', 'tls', 'reality'].includes(security)) throw new Error(`Защита ${security} пока не поддерживается.`);
  const entry = { server: url.hostname, server_port: Number(url.port), uuid: decodeURIComponent(url.username) };
  if (security !== 'none') {
    entry.tls = { enabled: true, server_name: url.searchParams.get('sni') || url.searchParams.get('host') || url.hostname, insecure: url.searchParams.get('allowInsecure') === '1' };
    const fingerprint = url.searchParams.get('fp');
    if (security === 'reality' || fingerprint) {
      const supported = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized'];
      if (fingerprint && !supported.includes(fingerprint)) throw new Error('TLS fingerprint из ссылки пока не поддерживается.');
      entry.tls.utls = { enabled: true, fingerprint: fingerprint || 'chrome' };
    }
    const alpn = url.searchParams.get('alpn');
    if (alpn) entry.tls.alpn = alpn.split(',').map((value) => value.trim()).filter(Boolean);
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
function createVlessProfile({ services = ['tiktok', 'instagram'], customDomains = [], apps = [], mode = 'selective', excludedDomains, excludedApps = [] } = {}) {
  excludedDomains ??= mode === 'exclude' ? Object.values(require('../renderer/vpn-exclusions.json')).flatMap(item => item.domains) : [];
  const selected = [...new Set(services)].filter((service) => VLESS_SERVICE_IDS.has(service));
  const domains = [...selected.flatMap((service) => VLESS_SERVICE_CATALOG[service].domains), ...customDomains.map(normalizeDomain).filter(isDomain)];
  const exclusions = mode === 'exclude';
  return { mode: exclusions ? 'exclude' : mode === 'all' ? 'all' : 'selective', services: exclusions ? [] : selected, customDomains: exclusions ? [] : [...new Set(customDomains.map(normalizeDomain).filter(isDomain))], apps: exclusions ? [] : [...new Set(apps.map(normalizeProcessName).filter(Boolean))].sort(), domains: exclusions ? [] : [...new Set(domains)].sort(), excludedDomains: [...new Set(excludedDomains.map(normalizeDomain).filter(isDomain))].sort(), excludedApps: [...new Map(excludedApps.map(normalizeProcessName).filter(Boolean).map(name => [name.toLowerCase(), name])).values()].sort() };
}
function createSingBoxConfig(uri, rawProfile, { ipv6 = false, dpiDomains = [], diagnosticPort } = {}) {
  const outbound = { ...parseProxyInput(uri), tag: 'vless-out' };
  const profile = createVlessProfile(rawProfile);
  const selective = profile.mode === 'selective';
  const directDomains = [...new Set([...dpiDomains, ...(profile.mode === 'exclude' ? profile.excludedDomains : [])])];
  return {
    log: { level: 'warn', timestamp: true },
    dns: {
      reverse_mapping: true,
      servers: [
        { type: 'https', tag: 'vless-dns', server: '1.1.1.1', server_port: 443, path: '/dns-query', detour: 'vless-out' },
        { type: 'local', tag: 'local-dns' }
      ],
      rules: [...(directDomains.length ? [{ domain_suffix: directDomains, action: 'route', server: 'local-dns' }] : []), ...(selective && profile.domains.length ? [{ domain_suffix: profile.domains, action: 'route', server: 'vless-dns' }] : [])],
      final: selective ? 'local-dns' : 'vless-dns'
    },
    // Do not use 172.16/12 here: Docker, WSL and several VPN clients commonly
    // reserve it, causing Windows to reject the TUN address as already present.
    // 198.18/15 is the benchmarking range and is safe as an internal TUN subnet.
    inbounds: [{ type: 'tun', tag: 'local-route-tun', interface_name: 'LocalRouteVless', address: ['198.18.0.1/30', ...(ipv6 ? ['fdfe:dcba:9876::1/126'] : [])], auto_route: true, strict_route: true, stack: 'mixed', mtu: 1400 }, ...(diagnosticPort ? [{type:'http',tag:'local-route-health',listen:'127.0.0.1',listen_port:diagnosticPort}] : [])],
    outbounds: [outbound, { type: 'direct', tag: 'direct' }],
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'local-dns',
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        ...(diagnosticPort ? [{inbound:['local-route-health'],outbound:'vless-out'}] : []),
        // Control probes must not validate DPI through our own VPN tunnel.
        { process_name: ['Local Route.exe'], outbound: 'direct' },
        // TGWs is an independent direct connection, including full-tunnel mode.
        { process_name: ['local-route-tg.exe'], outbound: 'direct' },
        { ip_is_private: true, outbound: 'direct' },
        // Локальные домены DPI имеют приоритет даже перед правилом целого приложения.
        ...(directDomains.length ? [{ domain_suffix: directDomains, outbound: 'direct' }] : []),
        ...(profile.mode === 'exclude' && profile.excludedApps.length ? [{ process_name: profile.excludedApps, outbound: 'direct' }] : []),
        ...(selective && profile.domains.length ? [{ domain_suffix: profile.domains, outbound: 'vless-out' }] : []),
        ...(selective && profile.apps.length ? [{ process_name: profile.apps, outbound: 'vless-out' }] : [])
      ],
      final: selective ? 'direct' : 'vless-out'
    }
  };
}

function parseProxyInput(input) {
  const raw = String(input).trim();
  if (raw.startsWith('{')) {
    const source = JSON.parse(raw);
    if (!['vless', 'hysteria2'].includes(source.type)) throw new Error('JSON: поддерживаются VLESS и Hysteria2 в формате sing-box.');
    const result = {};
    for (const key of ['type', 'server', 'server_port', 'uuid', 'flow', 'password']) if (source[key] !== undefined) result[key] = source[key];
    if (!result.server || !Number.isInteger(result.server_port) || result.server_port < 1 || result.server_port > 65535) throw new Error('Некорректный адрес сервера.');
    if (source.tls) {
      result.tls = { enabled: source.tls.enabled !== false, server_name: source.tls.server_name || result.server, insecure: Boolean(source.tls.insecure) };
      if (source.tls.alpn !== undefined) {
        if (!Array.isArray(source.tls.alpn) || source.tls.alpn.some(value => typeof value !== 'string' || !value || value.length > 255)) throw new Error('Некорректный TLS ALPN.');
        result.tls.alpn = [...source.tls.alpn];
      }
      if (source.tls.utls) result.tls.utls = { enabled: source.tls.utls.enabled !== false, fingerprint: source.tls.utls.fingerprint || 'chrome' };
      if (source.tls.reality) result.tls.reality = { enabled: source.tls.reality.enabled !== false, public_key: source.tls.reality.public_key, short_id: source.tls.reality.short_id || '' };
    }
    if (source.transport) {
      if (!['ws', 'grpc', 'httpupgrade'].includes(source.transport.type)) throw new Error(`Транспорт ${source.transport.type} не поддерживается ядром.`);
      result.transport = { type: source.transport.type };
      for (const key of ['path', 'host', 'service_name']) if (typeof source.transport[key] === 'string') result.transport[key] = source.transport[key];
      if (source.transport.headers?.Host) result.transport.headers = { Host: String(source.transport.headers.Host) };
    }
    if (source.obfs) {
      if (source.obfs.type !== 'salamander') throw new Error('Тип обфускации не поддерживается.');
      result.obfs = { type: 'salamander', password: String(source.obfs.password || '') };
    }
    return result;
  }
  if (/^(hysteria2|hy2):\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!url.hostname || !url.username) throw new Error('Hysteria2: нужен адрес и пароль.');
    const result = { type: 'hysteria2', server: url.hostname.replace(/^\[|\]$/g, ''), server_port: Number(url.port || 443), password: decodeURIComponent(url.username) + (url.password ? `:${decodeURIComponent(url.password)}` : ''), tls: { enabled: true, server_name: url.searchParams.get('sni') || url.hostname, insecure: url.searchParams.get('insecure') === '1' } };
    if (url.searchParams.get('obfs')) {
      if (url.searchParams.get('obfs') !== 'salamander') throw new Error('Hysteria2: неизвестный obfs.');
      result.obfs = { type: 'salamander', password: url.searchParams.get('obfs-password') || '' };
    }
    return result;
  }
  const result = { type: 'vless', ...parseVlessUri(raw) };
  const url = new URL(raw);
  if (result.tls && (url.searchParams.get('fp') || result.tls.reality)) result.tls.utls = { enabled: true, fingerprint: url.searchParams.get('fp') || 'chrome' };
  return result;
}

function vlessProbeTargets(profile) {
  const normalized = createVlessProfile(profile);
  // Excluded destinations are deliberately NOT probed through the VPN.
  const services = normalized.mode === 'exclude' ? [] : normalized.mode === 'all' ? Object.keys(VLESS_SERVICE_CATALOG) : normalized.services;
  return [
    { kind: 'server', label: 'Соединение через сервер', url: 'https://www.cloudflare.com/cdn-cgi/trace' },
    ...services.map((id) => ({ kind: 'service', service: id, label: VLESS_SERVICE_CATALOG[id].label, url: VLESS_SERVICE_CATALOG[id].probe })),
    ...normalized.customDomains.map((domain) => ({ kind: 'domain', label: domain, url: `https://${domain}/` }))
  ];
}

function createVlessCheckConfig(uri, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Некорректный порт проверки.');
  return {
    log: { level: 'error' },
    dns: { servers: [{ type: 'local', tag: 'local-dns' }], final: 'local-dns' },
    inbounds: [{ type: 'http', tag: 'diagnostics', listen: '127.0.0.1', listen_port: port }],
    outbounds: [{ ...parseProxyInput(uri), tag: 'vless-out' }],
    route: { auto_detect_interface: true, default_domain_resolver: 'local-dns', final: 'vless-out' }
  };
}

module.exports = { VLESS_SERVICE_CATALOG, VLESS_SERVICE_IDS, parseVlessUri, parseProxyInput, createVlessProfile, createSingBoxConfig, vlessProbeTargets, createVlessCheckConfig };
