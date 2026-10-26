'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const { once } = require('events');
const { processStamp, processAlive, killGroup } = require('../src/proc');

test('processStamp reads this process start, and processAlive accepts it', () => {
  const me = processStamp();
  assert.equal(me.pid, process.pid);
  assert.ok(Math.abs(Date.parse(me.startedAt) - (Date.now() - process.uptime() * 1000)) < 5000);
  assert.equal(processAlive(me.pid, me.startedAt), true);
});
test('a dead pid is not alive', () => {
  const { pid } = spawnSync(process.execPath, ['-e', '']);
  assert.equal(processAlive(pid, null), false);
});
test('a live pid with another start time is a reused pid', () => {
  const me = processStamp();
  assert.equal(processAlive(me.pid, new Date(Date.parse(me.startedAt) - 60000).toISOString()), false);
});
test('killGroup kills a detached process group', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  assert.equal(killGroup(child.pid, 'SIGKILL'), true);
  await once(child, 'exit');
  assert.equal(processAlive(child.pid, null), false);
});
