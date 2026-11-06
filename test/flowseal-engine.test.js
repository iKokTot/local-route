const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {buildEngineArgs}=require('../src/core/engine');
const {createProfile,AUTO_STRATEGIES}=require('../src/core/profile');
const {registry}=require('../src/core/flowseal-engine');
const bin=path.resolve(__dirname,'../engine/bin');
function splitGroups(tokens){const out=[[]];for(const t of tokens){if(t==='--new')out.push([]);else if(!t.startsWith('--wf-'))out.at(-1).push(t);}return out;}
test('Versioned strategies preserve upstream parameter order in each scoped primary group',()=>{
  assert.equal(registry.strategies.length,21);
  for(const strategy of registry.strategies){
    const source=fs.readFileSync(path.join(__dirname,'fixtures/flowseal-1.10.4',strategy.file),'utf8').replace(/\r\n/g,'\n');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'),strategy.sourceSha256);
    const primary=source.slice(source.indexOf('--wf-tcp=')).replace(/\^!/g,'!').split('--new').filter(part=>!part.includes('--ipset=')&&!part.includes('--filter-tcp=%GameFilter')&&!part.includes('--filter-udp=%GameFilter'));
    const expected=primary.map((part,index)=>{
      const flags=(part.match(/--(?:[^\s"^]|"[^"]*")+/g)||[]).map(t=>t.replaceAll('"',''));
      let keptUserList=false;
      const tokens=flags.filter(t=>!t.startsWith('--wf-')&&!t.startsWith('--hostlist-exclude=')&&!t.startsWith('--ipset-exclude=')).flatMap(t=>{
        if(t.startsWith('--hostlist=')){
          if(keptUserList)return [];keptUserList=true;
          return ['--hostlist='+(index===0?'ALL':t.includes('list-google.txt')?'GOOGLE':'GENERAL')];
        }
        return [t.replace(/%BIN%([\w.-]+)/g,(_m,file)=>path.join(bin,file))];
      });
      if(index===0&&!tokens.includes('--filter-udp=443'))tokens.unshift('--filter-udp=443');
      return tokens;
    });
    const actual=splitGroups(buildEngineArgs({engineRoot:path.dirname(bin),hostListPath:'ALL',googleHostListPath:'GOOGLE',generalHostListPath:'GENERAL',profile:{services:['youtube','discord'],strategy:strategy.id}}));
    assert.deepEqual(actual,expected,strategy.file);
    assert(!actual.flat().some(t=>t.includes('GameFilter')||t.startsWith('--ipset=')));
  }
});
test('ALT12 media, ALT13 ip-id, EXP UDP and literal fake-TLS marker retain separate source rules',()=>{
  const args=id=>buildEngineArgs({engineRoot:'ENGINE',hostListPath:'ALL',profile:{services:['youtube','discord'],strategy:id}});
  const groups=splitGroups(args('fs1104Alt12'));
  assert(groups[2].includes('--dpi-desync-split-seqovl=681'));
  assert(groups[4].some(t=>t.endsWith('tls_clienthello_www_sferum_ru.bin')));
  assert(!args('fs1104Alt13').includes('--ip-id=zero'));
  assert(args('fs1104Alt13').includes('--dpi-desync-repeats=5'));
  assert(args('fs1104Exp').includes('--filter-l7=discord,stun,unknown'));
  assert(args('fs1104FakeTlsAuto').includes('--dpi-desync-fake-tls=!'));
  assert.equal(AUTO_STRATEGIES.length,22);assert.equal(AUTO_STRATEGIES.at(-1),'zapretAlt5');
});
test('Legacy strategy IDs still produce legacy commands; upgraded domain catalog is explicit',()=>{
  const legacy=createProfile({services:['youtube','discord'],strategy:'zapretAlt12',catalogVersion:1});
  const updated=createProfile({...legacy,strategy:'fs1104Alt12',catalogVersion:2});
  assert(!legacy.domains.includes('jnn-pa.googleapis.com'));
  assert(updated.domains.includes('jnn-pa.googleapis.com'));
  assert(updated.domains.includes('discord-attachments-uploads-prd.storage.googleapis.com'));
  assert.deepEqual(createProfile(legacy),legacy);
  const old=buildEngineArgs({engineRoot:'ENGINE',hostListPath:'ALL',profile:legacy});
  assert(old.some(t=>t.endsWith('tls_clienthello_max_ru.bin')));
  assert(!old.some(t=>t.endsWith('tls_clienthello_www_sferum_ru.bin')));
});
test('Updated YouTube-only scope does not include Discord ports and voice groups',()=>{
  for(const strategy of registry.strategies){
    const args=buildEngineArgs({engineRoot:'ENGINE',hostListPath:'ALL',profile:{services:['youtube'],strategy:strategy.id}});
    assert(args.includes('--wf-tcp=80,443'));
    assert(!args.some(t=>t.includes('19294')||t.includes('discord.media')));
    for(const arg of args)if(arg.includes('ENGINE'+path.sep+'bin'+path.sep))assert(fs.existsSync(path.join(bin,path.basename(arg.split('=')[1]))));
  }
});
test('Bundled winws accepts every updated strategy in dry-run without packet capture',{skip:process.platform!=='win32',timeout:30000},async t=>{
  const os=require('node:os');
  const {promisify}=require('node:util');
  const run=promisify(require('node:child_process').execFile);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-route-dpi-check-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const hosts=path.join(dir,'hosts.txt');fs.writeFileSync(hosts,'youtube.com\ndiscord.com\n');
  for(const strategy of registry.strategies){
    const args=buildEngineArgs({engineRoot:path.dirname(bin),hostListPath:hosts,profile:{services:['youtube','discord'],strategy:strategy.id}});
    let result;
    try{result=await run(path.join(bin,'winws.exe'),['--dry-run',...args],{windowsHide:true,timeout:5000,maxBuffer:1024*1024});}
    catch(error){if(['EACCES','EPERM'].includes(error.code)){t.skip('Windows denied starting winws; dry-run needs a permitted elevated test environment.');return;}throw error;}
    assert(!/capture is started/i.test(result.stdout+result.stderr),strategy.id);
  }
});
