'use strict';

/**
 * Regression tests for the lane-sequencing rule.
 *
 * The original implementation skipped past a non-resumable task instead of
 * stopping at it, which would have scheduled two processes into one worktree.
 * These pin every status a lane's head task can hold.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const state = require('../src/state');

function mkState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-lane-'));
  const p = path.join(dir, 'plan.md');
  fs.writeFileSync(p, '# Plan\n');
  return state.create({
    planPath: p,
    planContents: '# Plan\n',
    repoRoot: '/repo',
    baseBranch: 'feature/x',
    baseCommit: 'abc',
    maxLanes: 3,
    lanes: [{ id: 'A', tasks: [1, 2, 3], weight: 30 }, { id: 'B', tasks: [4], weight: 10 }],
    barriers: [],
    testCommand: 'npm test',
  });
}

const readyNums = (st) => state.readyTasks(st, []).map((r) => r.n).sort((a, b) => a - b);

test('a RUNNING head task blocks everything behind it in its lane', () => {
  const st = mkState();
  st.tasks['1'].status = state.STATUS.RUNNING;
  assert.deepEqual(readyNums(st), [4], 'lane A is busy; lane B is unaffected');
});

test('a BLOCKED head task stalls its lane instead of skipping ahead', () => {
  const st = mkState();
  st.tasks['1'].status = state.STATUS.BLOCKED;
  assert.deepEqual(readyNums(st), [4],
    'T2 must not start — it may depend on work T1 never finished');
});

test('a DONE head task lets the lane advance exactly one step', () => {
  const st = mkState();
  st.tasks['1'].status = state.STATUS.DONE;
  assert.deepEqual(readyNums(st), [2, 4]);
});

test('an INTERRUPTED head task is re-offered, not skipped', () => {
  const st = mkState();
  st.tasks['1'].status = state.STATUS.INTERRUPTED;
  assert.deepEqual(readyNums(st), [1, 4]);
});

test('a FAILED head task is re-offered on resume', () => {
  const st = mkState();
  st.tasks['1'].status = state.STATUS.FAILED;
  assert.deepEqual(readyNums(st), [1, 4]);
});

test('no lane ever offers two tasks at once', () => {
  const st = mkState();
  for (const combo of [
    [state.STATUS.PENDING, state.STATUS.PENDING, state.STATUS.PENDING],
    [state.STATUS.DONE, state.STATUS.PENDING, state.STATUS.PENDING],
    [state.STATUS.DONE, state.STATUS.DONE, state.STATUS.PENDING],
    [state.STATUS.DONE, state.STATUS.FAILED, state.STATUS.PENDING],
    [state.STATUS.RUNNING, state.STATUS.PENDING, state.STATUS.PENDING],
  ]) {
    combo.forEach((s, i) => { st.tasks[String(i + 1)].status = s; });
    const fromLaneA = state.readyTasks(st, []).filter((r) => r.lane === 'A');
    assert.ok(fromLaneA.length <= 1, `lane A offered ${fromLaneA.length} tasks for ${combo.join('/')}`);
  }
});

test('a fully done lane offers nothing and does not block other lanes', () => {
  const st = mkState();
  for (const n of [1, 2, 3]) st.tasks[String(n)].status = state.STATUS.DONE;
  assert.deepEqual(readyNums(st), [4]);
});
