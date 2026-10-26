'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
// First: it points src/spawn at the fake agent before anything loads it.
const { makeRepo, cleanup, initRun, useSpec, seen, runLanesIn } = require('./helpers/run-repo');
const state = require('../src/state');
const { runTask } = require('../src/run');
const { integrate } = require('../src/integrate');
const { processStamp } = require('../src/proc');

// Built as an array of lines so its headings never start a line in this file.
// T1 and T2 are disjoint, so at --max-lanes 2 each gets a lane.
const RUN_PLAN = [
  '# Effort run plan', '',
  '### Task 1: Alpha', '', '**Effort:** medium', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] **Step 1: write a**', '',
  '### Task 2: Beta', '',
  '**Files:**', '- Create: `src/b.js`', '', '- [ ] **Step 1: write b**', '',
].join('\n');

// Built as an array of lines so its headings never start a line in this file.
// T1 and T2 write separate files; T3 consumes both, which makes it a barrier.
const BARRIER_PLAN = [
  '# Barrier plan', '',
  '### Task 1: Alpha', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] **Step 1: write a**', '',
  '### Task 2: Beta', '',
  '**Files:**', '- Create: `src/b.js`', '', '- [ ] **Step 1: write b**', '',
  '### Task 3: Wrap', '', '**Effort:** medium', '',
  '**Files:**', '- Create: `src/c.js`', '',
  '**Interfaces:**', '- Consumes: Tasks 1-2', '', '- [ ] **Step 1: write c**', '',
].join('\n');

const laneOf = (st, n) => st.lanes.find((l) => l.tasks.includes(n));

test('a running task records the pid of the plo that drives it', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2 });
  useSpec(repo, {
    1: { observe: [repo.statePath], writes: { 'src/a.js': '1' } },
    2: { writes: { 'src/b.js': '2' } },
  });
  await runLanesIn(repo, st, plan, dag);
  const saw = JSON.parse(seen(repo, 1).files[repo.statePath]);
  assert.equal(saw.tasks['1'].status, 'running');
  assert.equal(saw.tasks['1'].pid, process.pid);
  assert.equal(saw.tasks['1'].pidStartedAt, processStamp().startedAt);
});

test('cost is summed across attempts, and every finished attempt is a try', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2 });
  useSpec(repo, {
    1: [
      { result: { is_error: true, text: 'Tests failed', total_cost_usd: 0.5, output_tokens: 100 } },
      { writes: { 'src/a.js': '1' }, result: { total_cost_usd: 0.25, output_tokens: 50 } },
    ],
    2: { writes: { 'src/b.js': '2' } },
  });
  await runLanesIn(repo, st, plan, dag);
  const rec = state.load(repo.planPath).tasks['1'];
  assert.equal(rec.costUsd, 0.75);
  assert.equal(rec.outputTokens, 150);
  assert.deepEqual(rec.tries.map(({ effort, status }) => ({ effort, status })), [
    { effort: 'medium', status: 'failed' }, { effort: 'high', status: 'done' },
  ]);
  assert.ok(rec.tries.every((x) => !Number.isNaN(Date.parse(x.at))));
});

test('a prep failure and an interrupted attempt leave no try', async (t) => {
  // Prep: T1 is made to build on T2, so its prep merges T2 across lanes — the
  // step a missing worktree fails, before any agent exists.
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan } = initRun(repo, { maxLanes: 2 });
  const a = laneOf(st, 1);
  const b = laneOf(st, 2);
  useSpec(repo, { 1: { writes: { 'src/a.js': '1' } }, 2: { writes: { 'src/b.js': '2' } } });
  const opts = { log: () => {}, permissionMode: 'acceptEdits', dependencyEdges: [{ from: 2, to: 1 }] };
  await runTask(repo.planPath, st, plan, { n: 2, lane: b.id }, opts);
  a.worktree = `${repo.root}-missing`;
  const failed = await runTask(repo.planPath, st, plan, { n: 1, lane: a.id }, opts);
  assert.equal(failed.status, state.STATUS.FAILED);
  assert.equal((state.load(repo.planPath).tasks['1'].tries || []).length, 0);

  // Interrupted: the agent is still sleeping when the signal fires.
  const repo2 = makeRepo(RUN_PLAN); t.after(() => cleanup(repo2));
  const run2 = initRun(repo2, { maxLanes: 2 });
  useSpec(repo2, { 1: { sleepMs: 3000 }, 2: { writes: { 'src/b.js': '2' } } });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  await runTask(repo2.planPath, run2.st, run2.plan, { n: 1, lane: laneOf(run2.st, 1).id }, { log: () => {}, permissionMode: 'acceptEdits', signal: ac.signal });
  assert.equal((state.load(repo2.planPath).tasks['1'].tries || []).length, 0);
});

test('a barrier records its cost, output and tries', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, {
    1: { writes: { 'src/a.js': '1' } },
    2: { writes: { 'src/b.js': '2' } },
    3: { writes: { 'src/c.js': '3' }, observe: [repo.statePath], result: { total_cost_usd: 0.4, output_tokens: 70 } },
    review: { result: { text: 'CROSS-LANE VERDICT: CLEAN' } },
  });
  await runLanesIn(repo, st, plan, dag);
  await integrate(repo.planPath, st, plan, { log() {} });
  const rec3 = state.load(repo.planPath).tasks['3'];
  assert.equal(rec3.costUsd, 0.4);
  assert.equal(rec3.outputTokens, 70);
  assert.equal(rec3.tries.length, 1);
  const saw = JSON.parse(seen(repo, 3).files[repo.statePath]);
  assert.equal(saw.tasks['3'].pid, process.pid);
  assert.equal(saw.tasks['3'].pidStartedAt, processStamp().startedAt);
});
