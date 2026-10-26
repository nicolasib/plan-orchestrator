'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
// First: it points src/spawn at the fake agent before anything loads it.
const { makeRepo, cleanup, initRun, useSpec, seen, runLanesIn } = require('./helpers/run-repo');
const { integrate } = require('../src/integrate');

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

const argvOf = (repo, key, attempt) => seen(repo, key, attempt).argv;
const effortIn = (argv) => (argv.includes('--effort') ? argv[argv.indexOf('--effort') + 1] : null);

test('a barrier marked medium runs with --effort medium, the cross-lane review with none', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  assert.deepEqual(st.barriers, [3], 'fixture premise: T3 is a barrier');
  useSpec(repo, {
    1: { writes: { 'src/a.js': '1' } },
    2: { writes: { 'src/b.js': '2' } },
    3: { writes: { 'src/c.js': '3' } },
    review: { result: { text: 'CROSS-LANE VERDICT: CLEAN' } },
  });

  await runLanesIn(repo, st, plan, dag);
  await integrate(repo.planPath, st, plan, { log() {} });

  assert.equal(effortIn(argvOf(repo, 3, 1)), 'medium');
  assert.equal(effortIn(argvOf(repo, 'review', 1)), null);
  assert.equal(st.tasks['3'].effort, 'medium');
  assert.equal(st.integration.status, 'done');
});
