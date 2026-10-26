'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// First: it points src/spawn at the fake agent before anything loads it.
const { makeRepo, cleanup, initRun, useSpec, seen, runLanesIn } = require('./helpers/run-repo');
const state = require('../src/state');
const { runTask } = require('../src/run');
const { effortFor, isApiFailure, shouldRaise } = require('../src/effort');

test('effortFor climbs one level per raise and stops at xhigh', () => {
  assert.deepEqual([0, 1, 2, 3].map((r) => effortFor('medium', r)), ['medium', 'high', 'xhigh', 'xhigh']);
  assert.equal(effortFor('low', 1), 'medium');
  assert.equal(effortFor('max', 2), 'max');
  assert.equal(effortFor(null, 2), null);
});
test('a usage limit or a 529 is the API failing, not the task', () => {
  assert.equal(isApiFailure({ ok: false, result: 'API Error: 529 {"type":"overloaded_error"}', stderr: '' }), true);
  assert.equal(isApiFailure({ ok: false, result: null, stderr: 'Claude AI usage limit reached|1793138400' }), true);
  assert.equal(isApiFailure({ ok: false, result: 'Tests failed: 3', stderr: '' }), false);
  assert.equal(isApiFailure({ ok: true, result: 'the PR talks about rate limits', stderr: '' }), false);
});
test('shouldRaise only when the agent ran and the task stopped on its own result', () => {
  const ran = { ok: false, result: 'Tests failed', stderr: '' };
  for (const s of ['failed', 'blocked', 'needs-verify']) assert.equal(shouldRaise(s, ran, { aborted: false }), true, s);
  assert.equal(shouldRaise('done', { ok: true }, { aborted: false }), false);
  assert.equal(shouldRaise('failed', ran, { aborted: true }), false);
  assert.equal(shouldRaise('failed', { ok: false, result: 'API Error: 529', stderr: '' }, { aborted: false }), false);
});

// --- the level reaches the agent, and climbs on a retry --------------------

// Built as an array of lines so its headings never start a line in this file.
// T1 and T2 are disjoint, so at --max-lanes 2 each gets a lane.
const RUN_PLAN = [
  '# Effort run plan', '',
  '### Task 1: Alpha', '', '**Effort:** medium', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] **Step 1: write a**', '',
  '### Task 2: Beta', '',
  '**Files:**', '- Create: `src/b.js`', '', '- [ ] **Step 1: write b**', '',
].join('\n');

const argvOf = (repo, key, attempt) => seen(repo, key, attempt).argv;
const effortIn = (argv) => (argv.includes('--effort') ? argv[argv.indexOf('--effort') + 1] : null);
const laneOf = (st, n) => st.lanes.find((l) => l.tasks.includes(n));

test('a task marked medium runs with --effort medium; an unmarked one carries no --effort', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2 });
  useSpec(repo, { 1: { writes: { 'src/a.js': '1' } }, 2: { writes: { 'src/b.js': '2' } } });
  await runLanesIn(repo, st, plan, dag);
  assert.equal(effortIn(argvOf(repo, 1, 1)), 'medium');
  assert.equal(effortIn(argvOf(repo, 2, 1)), null);
  assert.equal(st.tasks['1'].effort, 'medium');
  assert.equal(st.tasks['2'].effort, null);
});

test('a medium task that fails comes back at high, then xhigh, and resume returns it to medium', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2 });

  // Every attempt dies on its own result: three attempts, one level up each.
  useSpec(repo, { 1: { exit: 1 }, 2: { writes: { 'src/b.js': '2' } } });
  await runLanesIn(repo, st, plan, dag);
  assert.deepEqual([1, 2, 3].map((a) => effortIn(argvOf(repo, 1, a))), ['medium', 'high', 'xhigh']);
  assert.equal(st.tasks['1'].status, state.STATUS.FAILED);
  assert.equal(st.tasks['1'].attempts, 3, 'the lane stalls on its attempt budget');
  assert.equal(st.tasks['1'].raises, 3);
  assert.equal(st.tasks['1'].effort, 'xhigh');

  state.reconcile(st); // what resume does
  assert.equal(st.tasks['1'].raises, 0);
  useSpec(repo, { 1: { writes: { 'src/a.js': '1' } }, 2: { writes: { 'src/b.js': '2' } } });
  await runLanesIn(repo, st, plan, dag);
  assert.equal(effortIn(argvOf(repo, 1, 4)), 'medium', 'resume starts back at the planned level');
  assert.equal(st.tasks['1'].status, state.STATUS.DONE, st.tasks['1'].error || '');
  assert.equal(st.tasks['1'].raises, 0);
});

test('a lane that failed in prep comes back at its planned level', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan } = initRun(repo, { maxLanes: 2 });
  const a = laneOf(st, 1);
  const b = laneOf(st, 2);
  assert.notEqual(a.id, b.id, 'fixture premise: T1 and T2 sit in different lanes');
  useSpec(repo, { 1: { writes: { 'src/a.js': '1' } }, 2: { writes: { 'src/b.js': '2' } } });

  // T1 is made to build on T2, so its prep merges T2 across lanes — the step
  // a missing worktree fails, before any agent exists.
  const opts = { log: () => {}, permissionMode: 'acceptEdits', dependencyEdges: [{ from: 2, to: 1 }] };
  await runTask(repo.planPath, st, plan, { n: 2, lane: b.id }, opts);
  assert.equal(st.tasks['2'].status, state.STATUS.DONE, st.tasks['2'].error || '');

  const real = a.worktree;
  a.worktree = `${repo.root}-missing`;
  const failed = await runTask(repo.planPath, st, plan, { n: 1, lane: a.id }, opts);
  assert.equal(failed.status, state.STATUS.FAILED);
  assert.match(st.tasks['1'].error, /merging T2/);
  assert.ok(!fs.existsSync(path.join(repo.seenDir, 'task-1-1.json')), 'no agent ran');
  assert.equal(st.tasks['1'].raises || 0, 0, 'a lane that could not be prepared is not the task failing');

  a.worktree = real;
  await runTask(repo.planPath, st, plan, { n: 1, lane: a.id }, opts);
  assert.equal(effortIn(argvOf(repo, 1, 1)), 'medium');
  assert.equal(st.tasks['1'].status, state.STATUS.DONE, st.tasks['1'].error || '');
  assert.equal(st.tasks['1'].raises, 0);
});

test('an API failure does not raise the level', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2 });
  useSpec(repo, {
    1: [
      { result: { is_error: true, subtype: 'error_during_execution', text: 'API Error: 529 overloaded' } },
      { writes: { 'src/a.js': '1' } },
    ],
    2: { writes: { 'src/b.js': '2' } },
  });
  await runLanesIn(repo, st, plan, dag);
  assert.equal(effortIn(argvOf(repo, 1, 1)), 'medium');
  assert.equal(effortIn(argvOf(repo, 1, 2)), 'medium', 'a 529 says nothing about the task');
  assert.equal(st.tasks['1'].status, state.STATUS.DONE, st.tasks['1'].error || '');
  assert.equal(st.tasks['1'].raises, 0);
});
