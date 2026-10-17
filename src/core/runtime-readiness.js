const {setTimeout: delay} = require('node:timers/promises');
const {listenerReady} = require('./telegram-proxy');
async function waitForListener(child, port, {signal,timeoutMs=3000,probe=listenerReady}={}) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    signal?.throwIfAborted();
    if(child.exitCode!==null || child.killed) throw new Error('VPN-движок завершился до готовности.');
    if(await probe(port,150)) { signal?.throwIfAborted(); return; }
    await delay(40,undefined,{signal});
  }
  throw new Error('VPN не подтвердил готовность за отведённое время.');
}
module.exports={waitForListener};
