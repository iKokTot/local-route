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

module.exports = { TASK_NAME, taskAction, createTaskArgs, deleteTaskArgs, queryTaskArgs };
