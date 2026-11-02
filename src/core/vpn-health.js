// Process readiness and external reachability are deliberately different.
// A generation token prevents late results from reviving a stopped/replaced VPN.
function createVpnHealth({check,changed=()=>{},canCheck=()=>true,networkKey=()=>'',now=Date.now,
  schedule=(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;},unschedule=clearTimeout}={}) {
  let epoch=0,timer,controller,port,failures=0,key='',state={status:'off'};
  function fingerprint(){try{return networkKey();}catch{return 'inspection-unavailable';}}
  function emit(next){state=next;changed();}
  function cancel(){epoch++;if(timer)unschedule(timer);timer=null;controller?.abort();controller=null;}
  function queue(ms){const generation=epoch;timer=schedule(()=>{timer=null;if(generation===epoch)void tick(generation);},ms);}
  async function tick(generation){
    if(generation!==epoch)return;
    if(!canCheck()){queue(5000);return;}
    const currentKey=fingerprint();
    if(key!==currentKey){key=currentKey;emit({status:'unchecked',reason:'network-changed'});}
    controller=new AbortController();
    if(!state.checkedAt)emit({...state,status:'checking'});
    let result;
    try {result=await check(port,controller.signal);} catch {result={success:false,detail:'Проверка соединения не завершена'};}
    if(generation!==epoch)return;
    controller=null;
    const ok=Boolean(result.success);
    failures=ok?0:failures+1;
    emit({status:ok?'healthy':'degraded',checkedAt:new Date(now()).toISOString(),latency:result.durationMs,detail:result.detail,failures});
    queue(ok?30000:Math.min(300000,15000*2**Math.min(failures-1,5)));
  }
  return {
    start(value){cancel();port=value;failures=0;key=fingerprint();emit({status:'unchecked'});queue(800);},
    stop(){cancel();port=null;emit({status:'off'});},
    invalidate(reason='resume'){if(!port)return;cancel();emit({status:'unchecked',reason});queue(800);},
    snapshot(){return {...state,...(state.status==='healthy' && now()-Date.parse(state.checkedAt)>90000?{status:'stale'}:{})};}
  };
}
module.exports={createVpnHealth};
