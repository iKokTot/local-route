const {test}=require('node:test');
const assert=require('node:assert/strict');
const {siteDomain,explainRoute}=require('../src/core/route-explanation');
const {createSingBoxConfig}=require('../src/core/vless');
test('Site input normalizes URLs and IDN without exposing path or credentials',()=>{
  assert.equal(siteDomain('https://WWW.Avito.ru./item?q=secret'),'www.avito.ru');
  assert.equal(siteDomain('пример.рф'),'xn--e1afmkfd.xn--p1ai');
  for(const input of ['https://user:secret@avito.ru','file:///etc/passwd','127.0.0.1','https://[::1]','bad','avito.ru@evil.com',null,'x'.repeat(2049)]) assert.throws(()=>siteDomain(input));
});
test('Direct exclusions match domain boundaries and active DPI takes priority',()=>{
  const settings={vpnActive:true,profile:{mode:'exclude',excludedDomains:['avito.ru','www.avito.ru']},dpiActive:true,dpiDomains:['youtube.com']};
  assert.equal(explainRoute('www.avito.ru',settings).rule,'www.avito.ru');
  assert.equal(explainRoute('evilavito.ru',settings).route,'vpn');
  assert.equal(explainRoute('avito.ru.evil.com',settings).route,'vpn');
  assert.equal(explainRoute('m.youtube.com',settings).route,'direct');
  assert.equal(explainRoute('youtube.com',{...settings,dpiActive:false}).route,'vpn');
  assert.equal(explainRoute('example.com',{...settings,vpnActive:false}).route,'direct');
});
test('Prediction agrees with generated domain rules for all supported routing modes',()=>{
  const uri='vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls';
  for(const mode of ['exclude','all','selective']) {
    const profile={mode,excludedDomains:['avito.ru'],customDomains:['example.org'],services:[]};
    const config=createSingBoxConfig(uri,profile,{dpiDomains:['youtube.com']});
    for(const domain of ['avito.ru','www.avito.ru','example.org','youtube.com','other.org']) {
      const matched=config.route.rules.find(rule=>rule.domain_suffix?.some(suffix=>domain===suffix || domain.endsWith('.'+suffix)));
      const actual=matched?.outbound || config.route.final;
      assert.equal(explainRoute(domain,{profile,vpnActive:true,dpiActive:true,dpiDomains:['youtube.com']}).route,actual==='direct'?'direct':'vpn');
    }
  }
});
