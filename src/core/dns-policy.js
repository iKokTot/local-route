// Never bootstrap TUN DNS through the Windows resolver: it may already point
// at our own inbound. Diagnostic and full-TUN modes share this policy.
function dnsServers() {
  return [
    {type:'https',tag:'vless-dns',server:'1.1.1.1',server_port:443,path:'/dns-query',detour:'vless-out'},
    {type:'https',tag:'local-dns',server:'1.1.1.1',server_port:443,path:'/dns-query',detour:'direct'}
  ];
}
module.exports={dnsServers};
