const path=require('node:path');
const registry=require('../config/flowseal-1.10.4.json');
const byId=new Map(registry.strategies.map(strategy=>[strategy.id,strategy]));
function buildFlowsealArgs({engineRoot,hostListPath,googleHostListPath=hostListPath,generalHostListPath=hostListPath,profile}) {
  const strategy=byId.get(profile.strategy);
  if(!strategy)return null;
  const youtube=profile.services.includes('youtube'),discord=profile.services.includes('discord');
  const tcp=['80','443',...(discord?['2053','2083','2087','2096','8443']:[])].join(',');
  const args=[`--wf-tcp=${tcp}`,`--wf-udp=${discord?'443,19294-19344,50000-50100':'443'}`];
  const groups=['quic',...(discord?['discord','media']:[]),...(youtube?['google']:[]),...(discord||profile.customDomains.length?['general']:[])];
  const values={'@ALL@':hostListPath,'@GOOGLE@':googleHostListPath,'@GENERAL@':generalHostListPath};
  for(const [index,kind] of groups.entries()){
    if(index)args.push('--new');
    for(const token of strategy.groups[kind]){
      const expanded=token.replace(/@BIN@\/([\w.-]+)/g,(_match,file)=>path.join(engineRoot,'bin',file)).replace(/@(?:ALL|GOOGLE|GENERAL)@/g,key=>values[key]);
      args.push(expanded);
    }
  }
  return args;
}
module.exports={registry,buildFlowsealArgs};
