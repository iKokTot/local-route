const COMPONENTS = ['dpi', 'telegram', 'vpn'];
function launchSettings(raw = {}, legacyTelegram = true) {
  const fallback = {dpi:true,telegram:Boolean(legacyTelegram),vpn:true};
  const group = value => Object.fromEntries(COMPONENTS.map(key => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback[key]]));
  return {auto:group(raw?.auto),all:group(raw?.all)};
}
module.exports = { COMPONENTS, launchSettings };
