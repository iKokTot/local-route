const TASK_NAME = 'Local Route AutoStart';

function taskAction(executable) {
  return `"${executable}" --autostart`;
}

function createTaskArgs(executable) {
  return ['/Create', '/TN', TASK_NAME, '/TR', taskAction(executable), '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/F'];
}

function deleteTaskArgs() {
  return ['/Delete', '/TN', TASK_NAME, '/F'];
}

function queryTaskArgs() {
  return ['/Query', '/TN', TASK_NAME];
}
function taskMatchesExecutable(xml, executable) {
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const command=decode(/<Command>([\s\S]*?)<\/Command>/i.exec(xml)?.[1] || '').trim().replace(/^"|"$/g,'');
  const args=decode(/<Arguments>([\s\S]*?)<\/Arguments>/i.exec(xml)?.[1] || '').trim();
  return command.replace(/\//g,'\\').toLowerCase()===executable.replace(/\//g,'\\').toLowerCase() && args==='--autostart';
}

module.exports = { TASK_NAME, taskAction, createTaskArgs, deleteTaskArgs, queryTaskArgs,taskMatchesExecutable };
