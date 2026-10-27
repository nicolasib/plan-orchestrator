'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processStamp, processAlive, killGroup, orphanedGroup } = require('../src/proc');

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
test('processStamp of another pid asks ps again instead of reading the cache', (t) => {
  // A fake `ps` that answers a different start time on every call.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-fake-ps-'));
  const counter = path.join(dir, 'n');
  fs.writeFileSync(counter, '0');
  fs.writeFileSync(path.join(dir, 'ps'), `#!/bin/sh\nn=$(($(cat ${counter}) + 1))\necho $n > ${counter}\necho "Mon Oct 26 14:03:0$n 2026"\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; fs.rmSync(dir, { recursive: true, force: true }); });

  // The parent is alive, so processAlive reads (and caches) the first answer.
  processAlive(process.ppid, new Date(Date.parse('Mon Oct 26 14:03:01 2026')).toISOString());
  const stamp = processStamp(process.ppid);
  assert.equal(stamp.startedAt, new Date(Date.parse('Mon Oct 26 14:03:02 2026')).toISOString());
});
test('killGroup kills a detached process group', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  assert.equal(killGroup(child.pid, 'SIGKILL'), true);
  await once(child, 'exit');
  assert.equal(processAlive(child.pid, null), false);
});
test('a group whose leader exited is still found while a worker lives in it', async (t) => {
  // The leader backgrounds a worker and exits, the way a runner dies and
  // leaves the workers of its group running.
  const leader = spawn('sleep 30 & exit 0', { shell: true, detached: true, stdio: 'ignore' });
  t.after(() => { try { killGroup(leader.pid, 'SIGKILL'); } catch { /* gone */ } });
  await once(leader, 'exit');
  assert.equal(processAlive(leader.pid, null), false, 'premise: the leader is gone');
  assert.equal(orphanedGroup(leader.pid), true);

  killGroup(leader.pid, 'SIGKILL');
  const until = Date.now() + 3000;
  while (orphanedGroup(leader.pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  assert.equal(orphanedGroup(leader.pid), false, 'no group once its last member is gone');
});
test('a pid in use is never an orphaned group, whoever holds it', () => {
  assert.equal(orphanedGroup(process.pid), false);
});
