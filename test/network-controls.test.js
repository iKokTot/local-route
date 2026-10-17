const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const mainPath = path.join(__dirname, '../src/main.js');
const mainRequire = createRequire(mainPath);
function load({ vlessCheck, commands, networkDetect, spawnChild, checkInput, mockFs, httpsMock, prepareDpi, subscriptionDownload } = {}) {
  const handlers = new Map();
  const appEvents = new Map();
  const tasks = [];
  const electron = {
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value), decryptString: value => value.toString().replace(/^encrypted:/, '') },
    app: { isPackaged: true, getPath: () => 'C:\\Mock', requestSingleInstanceLock: () => true, on: (name, callback) => appEvents.set(name,callback), quit: () => tasks.push('quit'), whenReady: () => ({ then: () => ({ catch() {} }) }) },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : name === './core/subscriptions' && subscriptionDownload ? {...mainRequire(name),downloadSubscription:subscriptionDownload} : name === './core/runtime-readiness' ? {waitForListener:async()=>{}} : name === './core/dpi-check' ? { ...mainRequire(name),prepareProbeSession:prepareDpi || (async()=>({errors:[],lookupFor:()=>undefined})) } : name === 'node:https' && httpsMock ? httpsMock : name === 'node:fs' && mockFs ? mockFs : name === './core/network' && networkDetect ? {detectVlessNetwork:networkDetect} : name === './core/vless-check' && vlessCheck ? {...mainRequire(name), runVlessCheck: vlessCheck } : name === './platform/windows' ? {
      runCommand: commands || (async (...args) => { tasks.push(args); return ''; }), runWithInput: checkInput || (async () => ({ok:true})),
      inspectNetworkConflicts: async () => ({proxyEnabled:false,tunnelNames:[]}), terminateChild: async child => { if(child) child.exitCode=0; }
    } : name === 'node:child_process' ? { spawn: spawnChild || (() => { throw new Error('No real processes in tests'); }) } : mainRequire(name),
    process: { platform: 'win32', argv: [], resourcesPath: 'C:\\Mock\\resources', execPath: 'C:\\Mock\\Local Route.exe' }, __dirname: path.dirname(mainPath), Buffer, AbortController, AbortSignal, setTimeout, clearTimeout, console
  });
  vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context);
  vm.runInContext(`
    globalThis.originalStartVless=startVless;
    globalThis.originalTrustedEvent=trustedEvent;
    trustedEvent = () => true;
    publishProgress = () => {};
    globalThis.fixture = { ...defaults, profile: createProfile({services: ['youtube']}), telegram: {enabled: true, port: 1443} };
    globalThis.calls = [];
    readState = () => fixture;
    writeState = (next) => { fixture = next; };
    pushLog = () => {};
    readLogs = () => [];
    diagnostics = () => [];
    startEngine = async () => { calls.push('dpi'); return {ok: false, message: 'Ошибка DPI'}; };
    startVless = async () => { calls.push('vless'); vlessProcess = {exitCode: null, killed: false}; return {ok: true}; };
    startTelegram = async () => { calls.push('telegram'); telegramProcess = {exitCode: null, killed: false}; return {ok: true}; };
  `, context);
  return { handlers, context, tasks, appEvents };
}

test('Подписка зашифрована; выбор сервера сохраняет маршруты; ошибка не заменяет рабочие данные', async () => {
  let valid = true;
  const {handlers, context} = load({checkInput:async()=>({ok:valid})});
  const first = 'vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls#First';
  const second = first.replace('example.com','other.example').replace('#First','#Second');
  const imported = await handlers.get('vless:import')(null,{input:first+'\n'+second});
  assert.equal(imported.ok,true);
  assert.equal(imported.state.vlessServers.length,2);
  assert.equal(imported.state.vlessLibrarySecret,undefined);
  assert.ok(!JSON.stringify(imported.state).includes('00000000-0000-4000-8000-000000000000'));
  const selected = await handlers.get('vless:select')(null,imported.state.vlessServers[1].id);
  assert.equal(selected.ok,true);
  assert.equal(selected.state.vlessConfigured,true);
  assert.equal(selected.state.vlessServers[1].selected,true);
  const previous = vm.runInContext('JSON.stringify(fixture)',context);
  valid = false;
  assert.equal((await handlers.get('vless:select')(null,imported.state.vlessServers[0].id)).ok,false);
  assert.equal((await handlers.get('vless:import')(null,{input:'invalid'})).ok,false);
  assert.equal(vm.runInContext('JSON.stringify(fixture)',context),previous);
  await handlers.get('vless:delete')();
  assert.equal(vm.runInContext('fixture.vlessLibrarySecret',context),undefined);
});

test('refresh updates selected credentials atomically and rejects an invalid replacement',async()=>{
  let text='vless://11111111-1111-4111-8111-111111111111@old.example:443?security=tls#Server';let valid=true;
  const {handlers,context}=load({subscriptionDownload:async()=>({text,usage:{}}),checkInput:async()=>({ok:valid})});
  const imported=await handlers.get('vless:import')(null,{input:'https://provider.example/sub'});
  await handlers.get('vless:select')(null,imported.state.vlessServers[0].id);
  text=text.replace('old.example','new.example');
  const refreshed=await handlers.get('vless:import')(null,{refresh:true});
  assert.equal(refreshed.ok,true);assert.equal(refreshed.state.vlessServers[0].selected,true);
  assert(vm.runInContext('decodeVlessUri(fixture)',context).includes('new.example'));
  const previous=vm.runInContext('JSON.stringify(fixture)',context);valid=false;text=text.replace('new.example','bad.example');
  assert.equal((await handlers.get('vless:import')(null,{refresh:true})).ok,false);
  assert.equal(vm.runInContext('JSON.stringify(fixture)',context),previous);
});

test('a stop-VPN command is idempotent and never starts a stopped VPN',async()=>{
  const {handlers,context}=load();
  assert.equal((await handlers.get('vless:stop')()).ok,true);
  assert.equal(vm.runInContext('calls.length',context),0);
});

test('Подбор выбирает сервер только после ответа HTTPS и сохраняет правила VPN', async()=>{
  let attempts=0;
  const {handlers,context}=load({vlessCheck:async()=>({ok:++attempts===2})});
  const first='vless://00000000-0000-4000-8000-000000000000@first.example:443?security=tls';
  const second=first.replace('first.example','second.example');
  await handlers.get('vless:import')(null,{input:first+'\n'+second});
  const rules=vm.runInContext('JSON.stringify(fixture.vless)',context);
  const result=await handlers.get('vless:autoSelect')();
  assert.equal(result.ok,true);
  assert.equal(attempts,2);
  assert.equal(result.state.vlessServers[1].selected,true);
  assert.equal(vm.runInContext('JSON.stringify(fixture.vless)',context),rules);
});

test('Остановка во время подбора не меняет активный профиль и не запускает VPN позже',async()=>{
  let release;
  const {handlers,context}=load({vlessCheck:()=>new Promise(resolve=>{release=()=>resolve({ok:true});})});
  const link='vless://00000000-0000-4000-8000-000000000000@example.com:443?security=tls';
  await handlers.get('vless:import')(null,{input:link});
  const before=vm.runInContext('fixture.vlessSecret',context);
  const selection=handlers.get('vless:autoSelect')();
  const stopping=handlers.get('network:stopAll')();
  release();
  assert.equal((await selection).ok,false); await stopping;
  assert.equal(vm.runInContext('fixture.vlessSecret',context),before);
  assert.equal(vm.runInContext('vlessIsRunning()',context),false);
});
test('start all reports Telegram-only success and skipped DPI accurately', async () => {
  const { handlers } = load();
  const result = await handlers.get('network:startAll')();
  assert.equal(result.ok, true);
  assert.equal(result.state.telegramActive, true);
  assert.equal(result.state.active, false);
  assert.match(result.message, /Запущено: Telegram-прокси/);
  assert.match(result.message, /DPI — нужен подбор/);
});

test('cancelled VLESS startup cannot spawn after its network detection completes', async()=>{
  let release; let spawned=0;
  const mockFs=Object.create(fs);mockFs.existsSync=()=>true;mockFs.mkdirSync=()=>{};
  const {handlers,context}=load({mockFs,networkDetect:()=>new Promise(resolve=>{release=()=>resolve({ipv6:false});}),spawnChild:()=>{spawned++;throw Error('Should not spawn');}});
  vm.runInContext(`fixture.vlessConfigured=true;decodeVlessUri=()=>'vless://11111111-1111-4111-8111-111111111111@server.example:443?security=tls';startVless=originalStartVless;stopVless=async()=>fixture;stopEngine=async()=>fixture;stopTelegram=async()=>{};`,context);
  const start=handlers.get('vless:start')();
  const stop=handlers.get('network:stopAll')();
  release();
  assert.equal((await start).ok,false);await stop;
  assert.equal(spawned,0);
});

test('finishing VLESS startup preserves newer settings and sends credentials only through stdin', async()=>{
  const {EventEmitter}=require('node:events');
  let release;let input='';let argsUsed;
  const mockFs=Object.create(fs);mockFs.existsSync=()=>true;mockFs.mkdirSync=()=>{};
  mockFs.writeFileSync=()=>{throw Error('No plaintext config writes');};
  const {handlers,context}=load({mockFs,networkDetect:()=>new Promise(resolve=>{release=()=>resolve({ipv6:false});}),spawnChild:(_exe,args)=>{
    argsUsed=args;const child=new EventEmitter();child.exitCode=null;child.killed=false;child.stdin=new EventEmitter();child.stdin.end=text=>{input=text;};return child;
  }});
  vm.runInContext(`fixture.vlessConfigured=true;decodeVlessUri=()=>'vless://11111111-1111-4111-8111-111111111111@server.example:443?security=tls';startVless=originalStartVless;waitForEarlyExit=async()=>null;`,context);
  const start=handlers.get('vless:start')();
  vm.runInContext('fixture={...fixture,telegram:{enabled:false,port:1555}};',context);
  release();
  assert.equal((await start).ok,true);
  assert.equal(vm.runInContext('fixture.telegram.port',context),1555);
  assert.deepEqual(Array.from(argsUsed),['run','-c','stdin']);
  assert.equal(JSON.parse(input).outbounds[0].uuid,'11111111-1111-4111-8111-111111111111');
});
test('start-all respects selected components independently from Windows autostart', async()=>{
  const {handlers,context}=load();
  vm.runInContext(`fixture.vlessConfigured=true;fixture.verifiedStrategy='zapretAlt';fixture.launchSettings={auto:{dpi:true,telegram:false,vpn:false},all:{dpi:false,telegram:false,vpn:true}};`,context);
  assert.equal((await handlers.get('network:startAll')()).ok,true);
  assert.equal(vm.runInContext('calls.join(",")',context),'vless');
});

test('Windows startup can keep only the app in the tray without starting a network engine',async()=>{
  const {handlers,context}=load();
  vm.runInContext(`fixture.telegram.enabled=false;fixture.launchSettings={auto:{dpi:false,telegram:false,vpn:false},all:{dpi:true,telegram:true,vpn:true}};`,context);
  assert.equal((await handlers.get('autostart:set')(null,true)).ok,true);
  const result=await vm.runInContext(`startAllComponents(beginOperation('autostart'),'auto')`,context);
  assert.equal(result.ok,true);
  assert.equal(vm.runInContext('calls.length',context),0);
});

test('launch selection saves without starting or stopping components',async()=>{
  const {handlers,context}=load();
  const selected={auto:{dpi:false,telegram:true,vpn:false},all:{dpi:true,telegram:false,vpn:false}};
  const result=await handlers.get('launch:save')(null,selected);
  assert.equal(result.ok,true);
  assert.equal(vm.runInContext('calls.length',context),0);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(fixture.launchSettings)',context)),selected);
});

test('an unreadable old server vault cannot crash the UI or erase the original ciphertext',async()=>{
  const {context}=load();
  vm.runInContext(`fixture.serverVault=Buffer.from('encrypted:not-json').toString('base64');`,context);
  const original=vm.runInContext('fixture.serverVault',context);
  const result=await vm.runInContext('publicState(fixture)',context);
  assert.match(result.storageWarning,/Исходные данные сохранены/);
  assert.equal(result.vlessServers.length,0);
  assert.equal(vm.runInContext('fixture.serverVault',context),original);
});

test('an enabled autostart task migrates to the current executable without enabling a disabled preference',async()=>{
  for(const enabled of [false,true]) {
    const commands=[];
    const {context}=load({commands:async(exe,args)=>{commands.push(args);return '<Command>C:\\Old\\Local Route.exe</Command><Arguments>--autostart</Arguments>';}});
    vm.runInContext(`fixture.autoStart=${enabled}`,context);
    await vm.runInContext('scheduledTaskExists()',context);
    assert.equal(commands.filter(args=>args.includes('/Create')).length,enabled?1:0);
  }
});

test('VPN starts without waiting for Telegram, but the operation waits for both',async()=>{
  const {handlers,context}=load();
  vm.runInContext(`fixture.vlessConfigured=true;fixture.launchSettings={all:{dpi:false,telegram:true,vpn:true},auto:{dpi:false,telegram:false,vpn:false}};
    startTelegram=()=>new Promise(resolve=>{globalThis.releaseTelegram=()=>resolve({ok:true});});`,context);
  let settled=false;
  const start=handlers.get('network:startAll')().then(result=>{settled=true;return result;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(vm.runInContext('vlessIsRunning()',context),true);
  assert.equal(settled,false);
  vm.runInContext('releaseTelegram()',context);await start;
});

test('a failed DPI start does not prevent independent components from starting', async () => {
  const { handlers, context } = load();
  vm.runInContext(`fixture.verifiedStrategy = 'zapretAlt'; fixture.vlessConfigured = true;`, context);
  const result = await handlers.get('network:startAll')();
  assert.equal(result.ok, false);
  assert.equal(result.state.telegramActive, true);
  assert.equal(result.state.vlessActive, true);
  assert.match(result.message, /Ошибка DPI/);
  assert.equal(vm.runInContext('calls.join(",")', context), 'dpi,telegram,vless');
});
test('autostart accepts Telegram or VLESS without requiring DPI', async () => {
  for (const component of ['telegram', 'vless']) {
    const { handlers, context, tasks } = load();
    vm.runInContext(`fixture.telegram.enabled = ${component === 'telegram'}; fixture.vlessConfigured = ${component === 'vless'};`, context);
    const result = await handlers.get('autostart:set')(null, true);
    assert.equal(result.ok, true, component);
    assert.equal(result.state.autoStart, true);
    assert.equal(tasks[0][0], 'schtasks.exe');
  }
});
test('app-only autostart does not require a configured network component', async () => {
  const { handlers, context, tasks } = load();
  vm.runInContext('fixture.telegram.enabled = false;', context);
  const result = await handlers.get('autostart:set')(null, true);
  assert.equal(result.ok, true); assert.equal(tasks[0][0], 'schtasks.exe');
});

test('stop all cancels pending startup and prevents later components from launching', async () => {
  const {handlers,context}=load();
  vm.runInContext(`
    fixture.verifiedStrategy='zapretAlt'; fixture.vlessConfigured=true;
    startEngine=()=>new Promise(resolve=>{globalThis.release=()=>resolve({ok:true});});
    stopEngine=async()=>fixture; stopVless=async()=>fixture; stopTelegram=async()=>{};
  `,context);
  const start=handlers.get('network:startAll')();
  const stop=handlers.get('network:stopAll')();
  vm.runInContext('release()',context);
  assert.equal((await start).ok,false);
  await stop;
  assert.equal(vm.runInContext('calls.length',context),0);
  assert.equal(vm.runInContext('activeOperation',context),null);
});

test('parallel starts are rejected at the IPC boundary', async () => {
  const {handlers,context}=load();
  vm.runInContext(`startTelegram=()=>new Promise(resolve=>{globalThis.release=()=>resolve({ok:true});});`,context);
  const first=handlers.get('telegram:start')();
  const second=await handlers.get('vless:start')();
  assert.equal(second.ok,false);
  vm.runInContext('release()',context); await first;
});

test('VLESS deletion removes encrypted secret from both generations of settings', async () => {
  const {handlers,context}=load();
  vm.runInContext(`fixture.vlessSecret='encrypted-synthetic'; cleanupLegacyVlessFiles=()=>{}; writeState=(next,options)=>{fixture=next;globalThis.writeOptions=options;};`,context);
  const result=await handlers.get('vless:delete')();
  assert.equal(result.ok,true);
  assert.equal(vm.runInContext('fixture.vlessSecret',context),undefined);
  assert.equal(vm.runInContext('writeOptions.rewriteBackup',context),true);
});

test('IPC rejects untrusted windows and external protocols', async () => {
  const {handlers,context}=load();
  assert.equal((await handlers.get('external:open')(null,'file:///C:/Windows/notepad.exe')).ok,false);
  vm.runInContext('trustedEvent=()=>false;',context);
  await assert.rejects(handlers.get('telegram:start')(),/источник/);
});

test('trusted IPC accepts the local page fragment and rejects remote or child frames',()=>{
  const {context}=load();
  vm.runInContext(`
    globalThis.frame={url:rendererUrl+'#page-content'};globalThis.contents={mainFrame:frame};mainWindow={webContents:contents};
  `,context);
  assert.equal(vm.runInContext('originalTrustedEvent({sender:contents,senderFrame:frame})',context),true);
  assert.equal(vm.runInContext('originalTrustedEvent({sender:contents,senderFrame:{url:rendererUrl}})',context),false);
  vm.runInContext("frame.url='https://example.invalid/';",context);
  assert.equal(vm.runInContext('originalTrustedEvent({sender:contents,senderFrame:frame})',context),false);
});

test('DPI deliberately retains the accepted Flowseal-style HTTP 200-499 policy',async()=>{
  const {EventEmitter}=require('node:events');
  let statusCode=200;
  const {context}=load({httpsMock:{get(_url,_options,callback){const request=new EventEmitter();request.destroy=()=>{};setImmediate(()=>callback({statusCode,resume(){}}));return request;}}});
  for(const code of [200,403,429,499,500]){
    statusCode=code;const result=await vm.runInContext("probe('https://fixture.invalid')",context);
    assert.equal(result.success,code<500);
  }
});

test('repeated quit requests still wait for process cleanup before exiting',async()=>{
  const {context,tasks,appEvents}=load();let prevented=0;
  vm.runInContext(`cancelAndStop=()=>new Promise(resolve=>{globalThis.releaseQuit=resolve;});flushLogs=async()=>{};`,context);
  appEvents.get('before-quit')({preventDefault:()=>prevented++});
  appEvents.get('before-quit')({preventDefault:()=>prevented++});
  assert.equal(prevented,2);assert(!tasks.includes('quit'));
  vm.runInContext('releaseQuit()',context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(tasks.filter(task=>task==='quit').length,1);
});

test('DNS failure does not stop working DPI or erase the saved strategy',async()=>{
  for(const channel of ['engine:autoSelect','engine:testStrategy']){
    const {handlers,context}=load({prepareDpi:async()=>({errors:[{label:'YouTube',success:false,stage:'dns',code:'ENOTFOUND'}]})});
    vm.runInContext(`fixture.verifiedStrategy='zapretAlt11';engineProcess={exitCode:null,killed:false};otherWinwsPids=async()=>[];stopEngine=async()=>{calls.push('stop');};`,context);
    const result=await handlers.get(channel)(null,'zapretAlt12');
    assert.equal(result.ok,false);assert.equal(result.diagnosticKind,'dns');
    assert.equal(result.state.active,true);assert.equal(result.state.verifiedStrategy,'zapretAlt11');
    assert.equal(vm.runInContext('calls.length',context),0);
  }
});

test('failed automatic checks preserve a previously working saved strategy and return endpoint errors',async()=>{
  const {handlers,context}=load();
  vm.runInContext(`fixture.verifiedStrategy='zapretAlt12';otherWinwsPids=async()=>[];startEngine=async()=>({ok:true});stopEngine=async()=>{};probeTargets=async targets=>targets.map(target=>({...target,success:false,code:'ECONNRESET',detail:'reset'}));`,context);
  const result=await handlers.get('engine:autoSelect')();
  assert.equal(result.ok,false);assert.equal(result.state.verifiedStrategy,'zapretAlt12');assert(result.results.length>0);
});
test('DPI strategy trials keep identical VPN bypass routes without restarting the tunnel for every candidate',async()=>{
  const {context}=load();
  vm.runInContext(`
    activeOperation=beginOperation('auto');activeOperation.dpiRouteDomains=[...fixture.profile.domains];
    vlessProcess={exitCode:null,killed:false};engineProcess=null;
    vlessRoutingDomainsKey=JSON.stringify([...fixture.profile.domains].sort());
    stopVless=async()=>{calls.push('stop-vless');vlessProcess=null;};
    startVless=async()=>{calls.push('start-vless');return {ok:true};};
  `,context);
  for(let i=0;i<22;i++)await vm.runInContext('refreshVlessRouting()',context);
  assert.equal(vm.runInContext('calls.length',context),0);
  vm.runInContext('delete activeOperation.dpiRouteDomains;',context);
  await vm.runInContext('refreshVlessRouting(null)',context);
  assert.equal(vm.runInContext('calls.join(",")',context),'stop-vless,start-vless');
});

test('VLESS check returns every service and does not start or stop the user tunnel', async () => {
  const report = { ok: false, results: [{ label: 'TikTok', success: true }, { label: 'Instagram', success: false, level: 'warning' }], message: 'Проверено два адреса' };
  const { handlers, context } = load({ vlessCheck: async () => report });
  vm.runInContext(`fixture.vlessConfigured = true; decodeVlessUri = () => 'synthetic-uri';`, context);
  const result = await handlers.get('vless:test')();
  assert.equal(result.results.length, 2); assert.equal(result.ok, false);
  assert.equal(vm.runInContext('calls.length', context), 0);
  assert.equal(vm.runInContext('activeOperation', context), null);
});
test('failed VLESS diagnostics releases the operation lock for a later retry', async () => {
  let attempts = 0;
  const { handlers, context } = load({ vlessCheck: async () => { if (++attempts === 1) throw new Error('Тестовая ошибка'); return { ok: true, results: [], message: 'Готово' }; } });
  vm.runInContext(`fixture.vlessConfigured = true; decodeVlessUri = () => 'synthetic-uri';`, context);
  assert.equal((await handlers.get('vless:test')()).ok, false);
  assert.equal((await handlers.get('vless:test')()).ok, true);
});
