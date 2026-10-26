'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// First: it points src/spawn at the fake agent before anything loads it.
const { makeRepo, cleanup, initRun, useSpec, runLanesIn } = require('./helpers/run-repo');
const { integrate } = require('../src/integrate');
const { parsePlan } = require('../src/parse-plan');
const { buildDag } = require('../src/build-dag');
const state = require('../src/state');

const PLO = path.join(__dirname, '..', 'bin', 'plo.js');

const rate = (five) => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed_warning', resetsAt: 1793138400, rateLimitType: 'seven_day', utilization: 0.38,
    unifiedWindows: { five_hour: { utilization: five, resetsAt: 1792623600 }, seven_day: { utilization: 0.38, resetsAt: 1793138400 } },
  },
});

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

const EDGE_PLAN = [
  '# Edge plan', '',
  '### Task 1: Alpha', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] **Step 1: write a**', '',
  '### Task 2: Beta', '',
  '**Files:**', '- Create: `src/b.js`', '', '- [ ] **Step 1: write b**', '',
  '### Task 3: Gamma', '',
  '**Files:**', '- Create: `src/c.js`', '',
  '**Interfaces:**', '- Consumes: Task 1', '', '- [ ] **Step 1: write c**', '',
].join('\n');

test('a lane task records the five-hour window its agent reported', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, {
    1: { events: [rate(0.16)], writes: { 'src/a.js': '1' } },
    2: { writes: { 'src/b.js': '2' } },
    3: { writes: { 'src/c.js': '3' } },
    review: { result: { text: 'CROSS-LANE VERDICT: CLEAN' } },
  });

  await runLanesIn(repo, st, plan, dag);

  assert.equal(state.load(repo.planPath).usage5h.utilization, 0.16);
});

test('the barrier and the reviewer record it too', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, {
    1: { writes: { 'src/a.js': '1' } },
    2: { writes: { 'src/b.js': '2' } },
    3: { events: [rate(0.3)], writes: { 'src/c.js': '3' } },
    review: { events: [rate(0.42)], result: { text: 'CROSS-LANE VERDICT: CLEAN' } },
  });

  await runLanesIn(repo, st, plan, dag);
  assert.equal(state.load(repo.planPath).usage5h, undefined, 'fixture premise: lane tasks report nothing');
  await integrate(repo.planPath, st, plan, { log() {} });

  assert.equal(state.load(repo.planPath).usage5h.utilization, 0.42);
});

test('plo run writes the dependency edges into the state, and --dry-run does not', (t) => {
  const repo = makeRepo(EDGE_PLAN); t.after(() => cleanup(repo));
  useSpec(repo, {
    1: { writes: { 'src/a.js': '1' } },
    2: { writes: { 'src/b.js': '2' } },
    3: { writes: { 'src/c.js': '3' } },
  });
  const env = {
    ...process.env,
    PLO_AGENT_BIN: process.env.PLO_AGENT_BIN,
    PLO_FAKE_SPEC: repo.specFile,
    PLO_FAKE_SEEN: repo.seenDir,
  };
  const base = ['--plan', repo.planPath, '--worktree-dir', repo.worktreeDir];

  // A fresh repo has no state, so the dry run goes through `init` first.
  const dry = spawnSync(process.execPath, [PLO, 'run', ...base, '--dry-run'], { env, cwd: repo.root, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(state.load(repo.planPath).edges, undefined);

  const run = spawnSync(process.execPath, [PLO, 'run', ...base], { env, cwd: repo.root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);

  const plan = parsePlan(fs.readFileSync(repo.planPath, 'utf8'));
  const expected = buildDag(plan.tasks, { done: [], maxLanes: 3, overrides: {} }).edges.map(({ from, to }) => ({ from, to }));
  assert.ok(expected.length > 0, 'fixture premise: Task 3 consumes Task 1');
  assert.deepEqual(state.load(repo.planPath).edges, expected);
});
