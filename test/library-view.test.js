const {test}=require('node:test');const assert=require('node:assert/strict');const {createLibraryView}=require('../src/core/library-view');
function library(){const profile={id:'id',name:'Server',uri:'secret-uri',server:'fixture.invalid',port:443,check:{success:true,detail:'HTTP 200',checkedAt:1,uri:'secret'}};return {profiles:[profile],groups:[{id:'group',name:'Subscription',source:'https://private/token',profiles:[profile],usage:{total:10}}],source:'https://private/token'};}
test('public library projection avoids repeated decryption and invalidates on credentials or selection changes',()=>{
  let calls=0;const project=createLibraryView({readLibrary:()=>{calls++;return library();}});
  const state={vlessLibrarySecret:'encrypted-a'};const first=project(state,'id');
  for(let i=0;i<100;i++)assert.equal(project({...state},'id'),first);
  assert.equal(calls,1);assert(first.servers[0].selected);
  assert.equal(project(state,'other').servers[0].selected,false);assert.equal(calls,2);
  project({vlessLibrarySecret:'encrypted-b'},'other');assert.equal(calls,3);
  assert(!JSON.stringify(first).includes('secret'));assert(!JSON.stringify(first).includes('token'));
  assert(Object.isFrozen(first.servers));assert(Object.isFrozen(first.servers[0].check));
});
test('failed decryption is retried, never converted to a cached empty library',()=>{
  let calls=0;const project=createLibraryView({readLibrary:()=>{if(++calls===1)throw Error('decode failed');return library();}});
  assert.throws(()=>project({},'id'));assert.equal(project({},'id').servers.length,1);assert.equal(calls,2);
});
