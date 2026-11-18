'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const state = require('../src/state');

const PLO = path.join(__dirname, '..', 'bin', 'plo.js');

// Built as an array of lines so its headings never start a line in this file.
// Neither task declares writes, so the wrap-up heuristic makes each gate on the
// other: a cycle with inference on, two independent tasks with it off.
const CYCLE_PLAN = [
  '# No-infer plan', '',
  '### Task 1: Alpha', '', '- [ ] step', '',
  '### Task 2: Beta', '', '- [ ] step', '',
].join('\n');

const plo = (argv) => spawnSync(process.execPath, [PLO, ...argv], { encoding: 'utf8' });

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-noinfer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planPath = path.join(root, 'plan.md');
  fs.writeFileSync(planPath, CYCLE_PLAN);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'noinfer@test.local');
  git('config', 'user.name', 'NoInfer');
  git('add', '-A');
  git('commit', '-q', '-m', 'plan');
  return planPath;
}

test('premise: without --no-infer the plan is a cycle and init refuses it', (t) => {
  const planPath = makeRepo(t);
  const r = plo(['init', '--plan', planPath]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /dependency cycle/);
});

test('init honours --no-infer', (t) => {
  const planPath = makeRepo(t);
  const r = plo(['init', '--plan', planPath, '--no-infer']);
  assert.equal(r.status, 0, r.stderr);
  const st = state.load(planPath);
  assert.deepEqual(st.lanes.flatMap((l) => l.tasks).sort(), [1, 2]);
});

test('run honours --no-infer when it has to init first', (t) => {
  const planPath = makeRepo(t);
  const r = plo(['run', '--plan', planPath, '--no-infer', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
});

test('run and resume keep the --no-infer that init was given', (t) => {
  const planPath = makeRepo(t);
  assert.equal(plo(['init', '--plan', planPath, '--no-infer']).status, 0);

  const run = plo(['run', '--plan', planPath, '--dry-run']);
  assert.equal(run.status, 0, run.stderr);
  const resume = plo(['resume', '--plan', planPath, '--dry-run']);
  assert.equal(resume.status, 0, resume.stderr);
});
