const test = require('node:test');
const assert = require('node:assert/strict');
const { TASK_NAME, taskAction, createTaskArgs, deleteTaskArgs } = require('../src/core/autostart');

test('Windows autostart task launches the packaged app hidden with highest privileges', () => {
  const executable = 'C:\\Local Route\\Local Route.exe';
  const args = createTaskArgs(executable);
  assert.equal(TASK_NAME, 'Local Route AutoStart');
  assert.equal(taskAction(executable), '"C:\\Local Route\\Local Route.exe" --autostart');
  assert.deepEqual(args.slice(0, 4), ['/Create', '/TN', TASK_NAME, '/TR']);
  assert.ok(args.includes('ONLOGON'));
  assert.ok(args.includes('HIGHEST'));
  assert.ok(args.includes('--autostart') === false);
  assert.match(args[4], /--autostart$/);
});

test('autostart task can be removed explicitly', () => {
  assert.deepEqual(deleteTaskArgs(), ['/Delete', '/TN', TASK_NAME, '/F']);
});
