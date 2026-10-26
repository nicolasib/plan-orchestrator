'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processStamp } = require('../src/proc');
const monitor = require('../src/monitor');
const { writeScenarios } = require('../smoke/fixture');

test('every scenario reads back through the monitor with the numbers the smoke gate expects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-fixture-'));
  const plans = writeScenarios(dir, { now: Date.now(), live: processStamp() });
  const mid = monitor.snapshot(plans.mid);
  assert.equal(mid.totals.done, 2);
  assert.equal(mid.totals.total, 8);
  assert.equal(Math.round(mid.totals.costUsd * 100), 620);
  const t = (s, n) => [...s.lanes.flatMap((l) => l.tasks), ...s.barriers].find((x) => x.n === n);
  assert.deepEqual(t(mid, 5).effort, { planned: 'medium', used: 'xhigh', raised: true, reason: 'fixture' });
  assert.equal(t(mid, 2).lastTest.ok, true);
  assert.equal(t(mid, 2).status, 'running');
  assert.equal(mid.usage5h.utilization, 0.84);
  assert.equal(mid.edges.length, 11);
  const barrier = monitor.snapshot(plans.barrier);
  assert.equal(barrier.runOver, true);
  assert.equal(t(barrier, 8).children.find((c) => c.id === 'tu_orph').status, 'interrupted');
  assert.ok(monitor.snapshot(plans.suite).suiteLive.lines.length > 0);
  assert.equal(monitor.snapshot(plans.review).reviewer.status, 'running');
  const idle = monitor.snapshot(plans.idle);
  assert.equal(idle.usage5h, null);
  assert.deepEqual(idle.edges, []);
  assert.equal(monitor.snapshot(plans.empty).ready, false);
});
