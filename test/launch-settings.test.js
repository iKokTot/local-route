const {test}=require('node:test');
const assert=require('node:assert/strict');
const {launchSettings}=require('../src/core/launch-settings');

test('autostart and start-all selections are independent and explicitly disabled components persist',()=>{
  const value={auto:{dpi:false,telegram:false,vpn:true},all:{dpi:true,telegram:true,vpn:false}};
  assert.deepEqual(launchSettings(value),value);
  assert.deepEqual(launchSettings(JSON.parse(JSON.stringify(value))),value);
});

test('legacy Telegram launch preference migrates while fresh installs include all components',()=>{
  assert.deepEqual(launchSettings().auto,{dpi:true,telegram:true,vpn:true});
  assert.equal(launchSettings({},false).all.telegram,false);
  assert.equal(launchSettings({},false).auto.telegram,false);
  assert.deepEqual(launchSettings({auto:{dpi:false,telegram:false,vpn:false}}).auto,{dpi:false,telegram:false,vpn:false});
});
