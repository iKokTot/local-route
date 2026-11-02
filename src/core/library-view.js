// Cache only an allowlisted public projection, never decrypted URIs/tokens.
// IPC serializes these frozen objects; renderer edits cannot mutate the cache.
function createLibraryView({readLibrary}){
  let key,selectedId,view;
  return function project(state,currentId){
    const nextKey=[state.vlessLibrarySecret || '',state.serverVault || ''];
    if(view && key[0]===nextKey[0] && key[1]===nextKey[1] && selectedId===currentId)return view;
    const library=readLibrary(state); // Failures are not cached: recovery can retry.
    const servers=library.profiles.map(({id,name,server,port,protocol,supported,error,check})=>Object.freeze({id,name,server,port,protocol,supported,error,
      check:check?Object.freeze({success:check.success,latency:check.latency,detail:check.detail,checkedAt:check.checkedAt}):undefined,selected:id===currentId}));
    const subscriptions=library.groups.map(({id,name,source,profiles,usage,updatedAt})=>Object.freeze({id,name,
      usage:Object.freeze(Object.fromEntries(['upload','download','total','expire'].filter(key=>Number.isFinite(usage?.[key])).map(key=>[key,usage[key]]))),updatedAt,canRefresh:Boolean(source),serverIds:Object.freeze(profiles.map(item=>item.id))}));
    const result=Object.freeze({servers:Object.freeze(servers),subscriptions:Object.freeze(subscriptions),hasSource:Boolean(library.source)});
    key=nextKey;selectedId=currentId;view=result;return result;
  };
}
module.exports={createLibraryView};
