const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseSubscription}=require('../src/core/subscriptions');
const {normalizeLibrary,addSubscription,removeSubscription}=require('../src/core/server-library');
const first=parseSubscription('vless://00000000-0000-4000-8000-000000000000@first.example:443?security=tls');
const second=parseSubscription('vless://00000000-0000-4000-8000-000000000000@second.example:443?security=tls');
test('Добавление и удаление подписки сохраняет другие группы',()=>{
  const one=addSubscription({},first,'https://first.example/token');
  const both=addSubscription(one,second,'https://second.example/token');
  assert.equal(both.groups.length,2);assert.equal(both.profiles.length,2);
  const left=removeSubscription(both,one.groups[0].id);
  assert.equal(left.groups.length,1);assert.equal(left.profiles[0].id,second.profiles[0].id);
  assert.throws(()=>removeSubscription(left,'unknown'));
});
test('Обновление меняет свою группу; миграция старого списка не создаёт дубликат',()=>{
  const old={profiles:first.profiles,source:'https://first.example/token'};
  const converted=normalizeLibrary(old);
  const updated=addSubscription(converted,second,old.source);
  assert.equal(updated.groups.length,1);assert.equal(updated.groups[0].id,converted.groups[0].id);
  assert.equal(updated.profiles[0].id,second.profiles[0].id);
});
