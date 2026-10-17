const { SERVICE_CATALOG, ENABLED_SERVICE_IDS, STRATEGIES } = require('./profile');
const { VLESS_SERVICE_CATALOG } = require('./vless');
function publicCatalog() {
  return {
    dpiServices: Object.fromEntries([...ENABLED_SERVICE_IDS].map((id) => [id, SERVICE_CATALOG[id].label])),
    vlessServices: Object.fromEntries(Object.entries(VLESS_SERVICE_CATALOG).map(([id, value]) => [id, value.label])),
    vpnExclusions: require('../renderer/vpn-exclusions.json'),
    strategies: STRATEGIES.filter(({id}) => id !== 'auto').map(({id,label}) => ({id,label})),
    autoStrategyIds: STRATEGIES.filter(({id}) => id.startsWith('zapret')).map(({id}) => id)
  };
}
module.exports = { publicCatalog };
