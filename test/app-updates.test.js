const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {compareVersions,selectRelease,fetchReleases,createUpdateChecker}=require('../src/core/app-updates');
const release=(tag,extra={})=>({tag_name:tag,draft:false,prerelease:true,assets:[{name:`Local-Route-Setup-${tag.replace(/^v/,'')}-x64.exe`,state:'uploaded',size:100}],...extra});
test('Update versions compare numerically, including prerelease ordering',()=>{
  assert(compareVersions('0.10.0','0.9.9')>0);assert.equal(compareVersions('v0.29.0','0.29.0'),0);
  assert(compareVersions('1.0.0','1.0.0-beta.10')>0);assert(compareVersions('1.0.0-beta.10','1.0.0-beta.2')>0);
  assert(compareVersions('1.0.0-alpha','1.0.0-beta')<0);
  for(const bad of ['1.0','v1.0.0/../../evil','01.0.0','1.0.0-beta.01',{},'9'.repeat(80)+'.0.0'])assert.throws(()=>compareVersions(bad,'0.29.0'));
});
test('Only published newer Windows releases qualify; URL is built from a fixed repository',()=>{
  const entries=[release('v0.31.0',{draft:true}),release('v0.32.0',{assets:[]}),release('v0.30.0',{html_url:'https://evil.example',body:'<script>bad</script>'}),release('v0.9.0'),release('v0.29.0')];
  const selected=selectRelease(entries,'0.29.0');
  assert.deepEqual(selected,{version:'0.30.0',prerelease:true,url:'https://github.com/iKokTot/local-route/releases/tag/v0.30.0'});
  assert.equal(selectRelease(entries,'0.30.0'),null);
  assert.equal(selectRelease([release('v0.31.0',{assets:[{name:'Local-Route-Setup-0.31.0-x64.exe',state:'new',size:1}]})],'0.29.0'),null);
  assert.throws(()=>selectRelease({},'0.29.0'));
});
test('Concurrent checks share one request; manual and background checks are rate limited',async()=>{
  let time=100,calls=0,resolve;
  const checker=createUpdateChecker({currentVersion:'0.29.0',now:()=>time,load:()=>{calls++;return new Promise(r=>resolve=r);}});
  const first=checker.check();assert.equal(checker.check({manual:true}),first);
  await Promise.resolve();resolve([release('v0.30.0')]);assert.equal((await first).status,'available');
  await checker.check({manual:true});assert.equal(calls,1);
  time+=60001;const second=checker.check({manual:true});await Promise.resolve();resolve([]);await second;assert.equal(calls,2);
  time+=60001;await checker.check();assert.equal(calls,2);
});
test('Failures preserve a known update; cancellation discards late responses',async()=>{
  let time=1,fail=false,resolve;
  const checker=createUpdateChecker({currentVersion:'0.29.0',now:()=>time,load:async()=>{if(fail)throw Error('offline');return [release('v0.30.0')];}});
  await checker.check();fail=true;time+=60001;
  const failed=await checker.check({manual:true});assert.equal(failed.status,'error');assert.equal(failed.latest.version,'0.30.0');
  const cancelled=createUpdateChecker({currentVersion:'0.29.0',load:()=>new Promise(r=>resolve=r)});
  const pending=cancelled.check();await Promise.resolve();cancelled.cancel();resolve([release('v9.0.0')]);await pending;
  assert.equal(cancelled.snapshot().latest,null);
});
function requestFixture(status=200,body='[]',headers={'content-type':'application/json'}){
  return (_url,options,callback)=>{
    assert.equal(options.headers.Authorization,undefined);
    const request=new EventEmitter();request.destroy=()=>{};
    queueMicrotask(()=>{const response=new PassThrough();response.statusCode=status;response.headers=headers;callback(response);response.end(body);});
    return request;
  };
}
test('Update transport rejects redirects, rate limits, invalid JSON and oversized bodies',async()=>{
  assert.deepEqual(await fetchReleases({request:requestFixture()}),[]);
  for(const status of [301,302,403,429,500])await assert.rejects(fetchReleases({request:requestFixture(status)}));
  await assert.rejects(fetchReleases({request:requestFixture(200,'{')}));
  await assert.rejects(fetchReleases({request:requestFixture(200,'[]',{'content-type':'text/html'})}));
  await assert.rejects(fetchReleases({request:requestFixture(200,' '.repeat(100)),maxBytes:10}));
});
test('Update requests have an overall deadline and can be cancelled',async()=>{
  const request=()=>{const r=new EventEmitter();r.destroy=()=>{};return r;};
  // Keep the fixture alive while the production deadline timer is unref'ed.
  const hold=setTimeout(()=>{},1000);
  try{await assert.rejects(fetchReleases({request,timeoutMs:15}),/timeout/);
    const controller=new AbortController();const pending=fetchReleases({request,signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'ABORT_ERR'});
  }finally{clearTimeout(hold);}
});
