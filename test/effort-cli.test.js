'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const state = require('../src/state');

const PLO = path.join(__dirname, '..', 'bin', 'plo.js');

// Plans are built as arrays of lines so their headings never start a line in
// this file.
const EFFORT_PLAN = [
  '# Effort plan', '',
  '### Task 1: Alpha', '', '**Effort:** medium — troca mecânica', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] step', '',
  '### Task 2: Beta', '', '**Effort:**  HIGH', '', '- [ ] step', '',
  '### Task 3: Gamma', '', '- [ ] step', '',
  '### Task 4: Delta', '', '**Effort:** altissimo — demais', '', '- [ ] step', '',
  '### Task 5: Epsilon', '', '**Effort:** `xhigh`', '', '- [ ] step', '',
].join('\n');
const lineOf = (s) => EFFORT_PLAN.split('\n').findIndex((l) => l.includes(s)) + 1;

const GATE_PLAN = [
  '# Gate plan', '',
  '### Task 1: Alpha', '', '**Effort:** medium — troca mecânica', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] step', '',
  '### Task 2: Beta', '', '**Effort:** high', '',
  '**Files:**', '- Create: `src/b.js`', '', '- [ ] step', '',
  '### Task 3: Gamma', '',
  '**Files:**', '- Create: `src/c.js`', '', '- [ ] step', '',
  '### Task 4: Wrap', '', '**Effort:** medium', '',
  '**Files:**', '- Create: `src/d.js`', '',
  '**Interfaces:**', '- Consumes: Tasks 1-3', '', '- [ ] step', '',
].join('\n');

function plo(argv) {
  return spawnSync(process.execPath, [PLO, ...argv], { encoding: 'utf8' });
}

function writePlan(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-effort-'));
  const planPath = path.join(dir, 'plan.md');
  fs.writeFileSync(planPath, contents);
  return { dir, planPath };
}

// --no-infer: EFFORT_PLAN has tasks without Files, and semantic inference would
// chain them into a dependency cycle before the effort check is reached.
function analyze(contents) {
  const { planPath } = writePlan(contents);
  return plo(['analyze', '--plan', planPath, '--no-infer']);
}

test('analyze prints each task with its level, inherited when unmarked, and a count', () => {
  const r = analyze(GATE_PLAN);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T1 {2}Alpha {2}\[medium\] {2}troca mecânica/);
  assert.match(r.stdout, /T3 {2}Gamma {2}\[inherited\]/);
  assert.match(r.stdout, /BARRIERS[\s\S]*T4 {2}Wrap {2}\[medium\]/);
  assert.match(r.stdout, /Effort: 2 medium · 1 high · 1 inherited/);
});

test('analyze lists an invalid level and exits 3', () => {
  const r = analyze(EFFORT_PLAN);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /EFFORT ERRORS/);
  assert.ok(r.stdout.includes(`T4 (line ${lineOf('altissimo')}): "altissimo" — use one of low, medium, high, xhigh, max`));
});

test('init refuses a plan with an invalid level, and writes no state', () => {
  const { dir, planPath } = writePlan(EFFORT_PLAN);
  const r = plo(['init', '--plan', planPath]);
  assert.equal(r.status, 3);
  assert.ok(r.stderr.includes(`invalid **Effort:** in T4 (line ${lineOf('altissimo')}): "altissimo"`));
  assert.equal(fs.existsSync(path.join(dir, '.plan-state-plan.json')), false);
});

test('run and resume refuse an invalid level written after init', () => {
  const { planPath } = writePlan(GATE_PLAN);
  state.save(planPath, state.create({ planPath, planContents: GATE_PLAN, repoRoot: path.dirname(planPath), baseBranch: 'x', baseCommit: 'abc1234', maxLanes: 1, lanes: [{ id: 'A', tasks: [1, 2, 3], weight: 1 }], barriers: [4] }));
  fs.writeFileSync(planPath, GATE_PLAN.replace('**Effort:** high', '**Effort:** altissimo'));
  for (const cmd of ['run', 'resume']) {
    const r = plo([cmd, '--plan', planPath]);
    assert.equal(r.status, 3, cmd);
    assert.match(r.stderr, /invalid \*\*Effort:\*\* in T2/);
  }
});
