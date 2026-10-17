const {serverId} = require('./subscriptions');

// Старый единственный список преобразуется без потери выбранного сервера.
function normalizeLibrary(raw = {}) {
  const groups = Array.isArray(raw.groups) ? raw.groups : raw.profiles?.length ? [{id:serverId('legacy'),name:'Подписка',source:raw.source || '',profiles:raw.profiles}] : [];
  const profiles = [...new Map(groups.flatMap(group => group.profiles).map(profile => [profile.id,profile])).values()];
  return {groups,profiles,source:groups.find(group => group.source)?.source || ''};
}
function addSubscription(raw, parsed, source = '') {
  const library = normalizeLibrary(raw);
  const id = serverId('group:' + (source || parsed.profiles.map(profile=>profile.uri).join('\n')));
  const previous = library.groups.find(group=>group.id===id || (source && group.source===source));
  const group = {id:previous?.id || id,name:parsed.name || previous?.name || (source ? new URL(source).hostname : 'Мои серверы'),source,profiles:parsed.profiles, usage:parsed.usage || previous?.usage || {},updatedAt:Date.now()};
  if (!previous && library.groups.length >= 16) throw new Error('Можно сохранить не более 16 подписок.');
  return normalizeLibrary({groups:previous ? library.groups.map(item=>item.id===previous.id?group:item) : [...library.groups,group]});
}
function removeSubscription(raw,id) {
  const library = normalizeLibrary(raw);
  if (!library.groups.some(group=>group.id===id)) throw new Error('Подписка не найдена.');
  return normalizeLibrary({groups:library.groups.filter(group=>group.id!==id)});
}
function reconcileSelectedServer(before, after, uri) {
  if (!uri) return {uri,changed:false,removed:false};
  const selectedId = serverId(uri);
  const oldLibrary = normalizeLibrary(before);
  const nextLibrary = normalizeLibrary(after);
  if (nextLibrary.profiles.some(item=>item.id===selectedId)) return {uri,changed:false,removed:false};
  const oldGroup = oldLibrary.groups.find(group=>group.profiles.some(item=>item.id===selectedId));
  if (!oldGroup) return {uri,changed:false,removed:false}; // Independent manually saved profile.
  const old = oldGroup.profiles.find(item=>item.id===selectedId);
  const candidates = (nextLibrary.groups.find(group=>group.id===oldGroup.id)?.profiles || []).filter(item=>item.supported!==false);
  const named = candidates.filter(item=>item.name===old.name && item.protocol===old.protocol);
  const endpoint = candidates.filter(item=>item.server===old.server && item.port===old.port && item.protocol===old.protocol);
  const match = named.length===1 ? named[0] : endpoint.length===1 ? endpoint[0] : null;
  return match ? {uri:match.uri,changed:true,removed:false} : {uri:'',changed:false,removed:true};
}
module.exports={normalizeLibrary,addSubscription,removeSubscription,reconcileSelectedServer};
