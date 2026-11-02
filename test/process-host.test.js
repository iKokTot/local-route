const {test}=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const {once}=require('node:events');
const path=require('node:path');
const {buildHost}=require('../scripts/build-process-host');
const windows={skip:process.platform!=='win32',timeout:15000};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function dead(pids){for(let i=0;i<100 && pids.some(alive);i++)await pause(30);assert(pids.every(pid=>!alive(pid)),'Fixture descendants must exit');}
async function line(stream){let buffer='';return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stream.off('data',read);reject(new Error('Fixture did not report PID'));},6000);function read(chunk){buffer+=chunk;if(buffer.includes('\n')){clearTimeout(timer);stream.off('data',read);try{resolve(JSON.parse(buffer.split('\n')[0]));}catch(error){reject(error);}}}stream.on('data',read);});}
test('guard preserves stdin, Unicode/quoted arguments and exit code',windows,async()=>{
  const args=['кириллица с пробелом','C:\\with space\\','a"b',''];
  const child=spawn(buildHost(),[String(process.pid),process.execPath,'-e',"let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({data,args:process.argv.slice(1)}));process.exitCode=7;});",...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const closed=once(child,'close');const result=line(child.stdout);child.stdin.end('synthetic input');
  try{assert.deepEqual(await result,{data:'synthetic input',args});assert.equal((await closed)[0],7);}finally{if(child.exitCode===null)child.kill();}
});
test('killing a guard terminates only its fixture target and grandchild',windows,async()=>{
  const target="const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(JSON.stringify({pids:[process.pid,c.pid]}));setInterval(()=>{},1000);";
  const child=spawn(buildHost(),[String(process.pid),process.execPath,'-e',target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');let pids=[];
  try{({pids}=await line(child.stdout));child.kill();await closed;await dead(pids);assert(alive(process.pid));}
  finally{if(child.exitCode===null)child.kill();}
});
test('owner crash also closes the guarded process tree',windows,async()=>{
  const host=buildHost();
  const target="const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(JSON.stringify({pids:[process.pid,c.pid]}));setInterval(()=>{},1000);";
  const ownerCode="const {spawn}=require('node:child_process');const c=spawn(process.argv[1],[String(process.pid),process.execPath,'-e',process.argv[2]],{windowsHide:true,stdio:['ignore','inherit','inherit']});c.once('exit',()=>process.exit());setInterval(()=>{},1000);";
  const owner=spawn(process.execPath,['-e',ownerCode,host,target],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const closed=once(owner,'close');let pids=[];
  try{({pids}=await line(owner.stdout));owner.kill();await closed;await dead(pids);assert(alive(process.pid));}
  finally{if(owner.exitCode===null)owner.kill();}
});
