const EXPECTED=new Map([
  ['www.youtube.com/generate_204',[204]],
  ['discord.com/api/v10/gateway',[200]],
  ['gateway.discord.gg/',[404]],
  ['cdn.discordapp.com/',[403]],
  ['updates.discord.com/',[404]]
]);
function dpiResponse(url,status){
  const target=new URL(url);
  const expected=EXPECTED.get(target.hostname+target.pathname);
  const success=expected?expected.includes(status):status>=200 && status<400;
  return {success,statusCode:status,reachable:true,detail:`HTTP ${status}${success && status>=400?' · ожидаемый ответ диагностического адреса':!success?' · неожиданный ответ':''}`};
}
module.exports={dpiResponse};
