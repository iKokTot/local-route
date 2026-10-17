const {test}=require('node:test');
const assert=require('node:assert/strict');
const {taskMatchesExecutable}=require('../src/core/autostart');
test('autostart validates the exact executable and arguments, not just the task name',()=>{
  const executable='C:\\Local & Route\\Local Route.exe';
  const xml='<Actions><Exec><Command>&quot;C:\\Local &amp; Route\\Local Route.exe&quot;</Command><Arguments>--autostart</Arguments></Exec></Actions>';
  assert.equal(taskMatchesExecutable(xml,executable),true);
  assert.equal(taskMatchesExecutable(xml,'C:\\Old\\Local Route.exe'),false);
  assert.equal(taskMatchesExecutable(xml.replace('--autostart','--other'),executable),false);
  assert.equal(taskMatchesExecutable('',executable),false);
});
