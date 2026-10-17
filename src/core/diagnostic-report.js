// Explicit allowlist: encrypted storage, UUID, URLs, domain lists and raw logs never enter exports.
function diagnosticReport(state, { version, network = {} } = {}) {
  return {
    format: 'local-route-diagnostics-v1', createdAt: new Date().toISOString(), version,
    errorCodes: [...new Set((state.logs || []).flatMap(line => String(line).match(/\b(?:EACCES|EPERM|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ABORT_ERR)\b/g) || []))],
    components: { dpi: Boolean(state.active), vless: Boolean(state.vlessActive), telegram: Boolean(state.telegramActive) },
    dpi: { strategy: /^[a-z0-9]+$/i.test(state.verifiedStrategy || '') ? state.verifiedStrategy : null, domainCount: state.profile?.domains?.length || 0 },
    vless: { configured: Boolean(state.vlessConfigured), mode: ['all','exclude'].includes(state.vless?.mode) ? state.vless.mode : 'selective', domainCount: state.vless?.domains?.length || 0, appCount: state.vless?.apps?.length || 0, excludedDomainCount: state.vless?.excludedDomains?.length || 0, excludedAppCount: state.vless?.excludedApps?.length || 0 },
    network: { systemProxyEnabled: Boolean(network.proxyEnabled), otherTunnelCount: network.tunnelNames?.length || 0, inspectionUnavailable: Boolean(network.unavailable) }
  };
}
module.exports = { diagnosticReport };
