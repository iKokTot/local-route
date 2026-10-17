const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
test('Android-мост выполняет команду и не заменяет API Electron',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/android-bridge.js'),'utf8');
  const calls=[];
  const context=vm.createContext({setTimeout,clearTimeout,Map,Promise,JSON,Error,window:{LocalRouteNative:{postMessage:raw=>calls.push(JSON.parse(raw))}}});
  vm.runInContext(source,context);
  const reply=vm.runInContext('window.localRoute.readState()',context);
  assert.equal(calls[0].method,'readState');
  vm.runInContext('window.localRouteReply(1,{appVersion:"0.24.1"})',context);
  assert.equal((await reply).appVersion,'0.24.1');
  const electron={readState(){}};
  const existing=vm.createContext({window:{localRoute:electron},Map,Promise});
  vm.runInContext(source,existing);
  assert.equal(existing.window.localRoute,electron);
});
