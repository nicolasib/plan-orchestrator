'use strict';

/**
 * End-to-end against a real git repository.
 *
 * Everything here is filesystem and git truth: worktree creation, dependency
 * seeding, lane branch isolation, and the crash-recovery path. Nothing is
 * mocked, and no agent process is spawned.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { parsePlan } = require('../src/parse-plan');
const { buildDag } = require('../src/build-dag');
const state = require('../src/state');
const wt = require('../src/worktrees');
const { prepareLanes } = require('../src/run');

const PLAN = `# E2E Plan

## Global Constraints

- Worktree: \`/tmp/x\`, branch \`feature/e2e\` (base \`main\`).
- Testes: \`npm test\`, da raiz do worktree.

---

### Task 1: Alpha

**Files:**
- Modify: \`src/alpha.js\`
- Test: \`tests/alpha.test.js\` (novo)

- [ ] **Step 1: implement**

---

### Task 2: Beta

**Files:**
- Modify: \`src/beta.js\`

- [ ] **Step 1: implement**

---

### Task 3: Gamma

**Files:**
- Modify: \`src/gamma.js\`

- [ ] **Step 1: implement**

---

### Task 4: Suite completa e PR

- [ ] **Step 1: run everything**
`;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-e2e-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'src', 'alpha.js'), '// alpha\n');
  fs.writeFileSync(path.join(root, 'src', 'beta.js'), '// beta\n');
  fs.writeFileSync(path.join(root, 'src', 'gamma.js'), '// gamma\n');

  // An untracked dependency dir + env file: exactly what must be COPIED, since
  // a symlink would make lanes share mutable state.
  fs.mkdirSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=shh\n');

  const planPath = path.join(root, 'docs', 'plan.md');
  fs.writeFileSync(planPath, PLAN);

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'e2e@test.local');
  git(root, 'config', 'user.name', 'E2E');
  git(root, 'add', 'src', 'docs');
  git(root, 'commit', '-q', '-m', 'initial');
  git(root, 'checkout', '-q', '-b', 'feature/e2e');

  // Each fixture gets its own worktree dir. Sharing the default would let one
  // test's lane-A collide with another's, which is a test bug, not a tool bug.
  const worktreeDir = `${root}-worktrees`;

  return { root, planPath, worktreeDir };
}

function cleanup(root, worktreeDir) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  if (worktreeDir) {
    try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test('e2e: analyze -> init -> worktrees -> lane isolation -> crash recovery', (t) => {
  const { root, planPath, worktreeDir } = makeRepo();
  t.after(() => cleanup(root, worktreeDir));

  // --- analyze -----------------------------------------------------------
  const contents = fs.readFileSync(planPath, 'utf8');
  const plan = parsePlan(contents);
  assert.equal(plan.tasks.length, 4);
  assert.equal(plan.constraints.testCommand, 'npm test');

  const dag = buildDag(plan.tasks, { maxLanes: 3 });
  assert.deepEqual(dag.barriers, [4], 'the no-writes wrap-up task is a barrier');
  assert.equal(dag.lanes.length, 3, 'three disjoint tasks fan out to three lanes');
  assert.deepEqual(dag.lanes.flatMap((l) => l.tasks).sort(), [1, 2, 3]);

  // --- init --------------------------------------------------------------
  const st = state.create({
    planPath,
    planContents: contents,
    repoRoot: root,
    baseBranch: 'feature/e2e',
    baseCommit: wt.headCommit(root),
    maxLanes: 3,
    lanes: dag.lanes,
    barriers: dag.barriers,
    testCommand: plan.constraints.testCommand,
  });
  state.save(planPath, st);
  assert.ok(fs.existsSync(state.statePathFor(planPath)));

  // --- worktrees ---------------------------------------------------------
  prepareLanes(planPath, st, { worktreeDir });

  for (const lane of st.lanes) {
    assert.ok(fs.existsSync(lane.worktree), `lane ${lane.id} worktree exists`);
    assert.equal(lane.branch, `feature/e2e-lane-${lane.id.toLowerCase()}`);

    // Dependencies copied, not symlinked — the whole point of seeding.
    const nm = path.join(lane.worktree, 'node_modules');
    assert.ok(fs.existsSync(nm), `lane ${lane.id} has node_modules`);
    assert.ok(!fs.lstatSync(nm).isSymbolicLink(), `lane ${lane.id} node_modules must be a real copy, not a symlink`);
    assert.ok(fs.existsSync(path.join(nm, 'left-pad', 'index.js')));
    assert.equal(fs.readFileSync(path.join(lane.worktree, '.env'), 'utf8'), 'SECRET=shh\n');
  }

  const paths = st.lanes.map((l) => l.worktree);
  assert.equal(new Set(paths).size, paths.length, 'every lane has a distinct directory');

  // --- lane isolation ----------------------------------------------------
  const [laneA, laneB] = st.lanes;
  fs.writeFileSync(path.join(laneA.worktree, 'src', 'alpha.js'), '// alpha done\n');
  git(laneA.worktree, 'add', '-A');
  git(laneA.worktree, 'commit', '-q', '-m', 'feat: alpha');

  assert.equal(fs.readFileSync(path.join(laneB.worktree, 'src', 'alpha.js'), 'utf8'), '// alpha\n',
    "lane B must not see lane A's uncommitted or committed work");
  assert.equal(fs.readFileSync(path.join(root, 'src', 'alpha.js'), 'utf8'), '// alpha\n',
    'the primary checkout is untouched while lanes run');

  const aCommits = wt.laneCommits(root, st.base.commit, laneA.branch);
  assert.equal(aCommits.length, 1);
  assert.equal(wt.laneCommits(root, st.base.commit, laneB.branch).length, 0);

  // --- crash recovery ----------------------------------------------------
  // Simulate: the process for lane A's task committed, then was killed before
  // it could report. State still says "running".
  const taskA = laneA.tasks[0];
  state.updateTask(planPath, st, taskA, { status: state.STATUS.RUNNING, baseBefore: st.base.commit });

  const reloaded = state.load(planPath);
  const notes = state.reconcile(reloaded, {
    planContents: contents,
    gitCommitsFor: (n, rec) => {
      const lane = reloaded.lanes.find((l) => l.id === rec.lane);
      if (!lane || !rec.baseBefore) return [];
      return wt.laneCommits(root, rec.baseBefore, lane.branch).map((c) => c.sha);
    },
  });

  assert.equal(reloaded.tasks[String(taskA)].status, state.STATUS.DONE,
    'a task whose process died after committing is recovered from git, not lost');
  assert.equal(reloaded.tasks[String(taskA)].commits.length, 1);
  assert.ok(notes.some((n) => /reconciled from git/.test(n.message)));

  // The other lanes are untouched by the recovery.
  assert.equal(reloaded.tasks[String(laneB.tasks[0])].status, state.STATUS.PENDING);

  // --- resume picks up exactly where it stopped --------------------------
  const ready = state.readyTasks(reloaded, dag.edges).map((r) => r.n).sort();
  assert.ok(!ready.includes(taskA), 'the recovered task is not re-run');
  assert.deepEqual(ready, [laneB.tasks[0], st.lanes[2].tasks[0]].sort());

  // --- clean -------------------------------------------------------------
  for (const lane of st.lanes) {
    wt.removeLaneWorktree({ root, dest: lane.worktree, branch: lane.branch, deleteBranch: false });
    assert.ok(!fs.existsSync(lane.worktree), `lane ${lane.id} worktree removed`);
  }
  assert.equal(wt.laneCommits(root, st.base.commit, laneA.branch).length, 1,
    'removing a worktree must not destroy the branch that holds its commits');
});

test('e2e: ensureLaneWorktree adopts an existing lane branch instead of clobbering it', (t) => {
  const { root, planPath, worktreeDir } = makeRepo();
  t.after(() => cleanup(root, worktreeDir));

  const baseCommit = wt.headCommit(root);
  const first = wt.ensureLaneWorktree({
    root, planSlug: 'plan', laneId: 'A', baseCommit, baseBranch: 'feature/e2e', worktreeDir,
  });
  fs.writeFileSync(path.join(first.path, 'src', 'alpha.js'), '// work\n');
  git(first.path, 'add', '-A');
  git(first.path, 'commit', '-q', '-m', 'feat: partial work');
  const sha = wt.laneCommits(root, baseCommit, first.branch)[0].sha;

  // A crash removes the worktree but leaves the branch.
  wt.removeLaneWorktree({ root, dest: first.path, branch: first.branch, deleteBranch: false });

  const second = wt.ensureLaneWorktree({
    root, planSlug: 'plan', laneId: 'A', baseCommit, baseBranch: 'feature/e2e', worktreeDir,
  });
  assert.equal(second.adoptedBranch, true, 'the existing lane branch is adopted');
  assert.equal(wt.laneCommits(root, baseCommit, second.branch)[0].sha, sha,
    'work committed before the crash survives re-preparation');

  wt.removeLaneWorktree({ root, dest: second.path, branch: second.branch, deleteBranch: true });
});

test('e2e: preparing lanes twice is idempotent', (t) => {
  const { root, planPath, worktreeDir } = makeRepo();
  t.after(() => cleanup(root, worktreeDir));

  const contents = fs.readFileSync(planPath, 'utf8');
  const plan = parsePlan(contents);
  const dag = buildDag(plan.tasks, { maxLanes: 2 });
  const st = state.create({
    planPath, planContents: contents, repoRoot: root,
    baseBranch: 'feature/e2e', baseCommit: wt.headCommit(root),
    maxLanes: 2, lanes: dag.lanes, barriers: dag.barriers, testCommand: 'npm test',
  });
  state.save(planPath, st);

  prepareLanes(planPath, st, { worktreeDir });
  const firstPaths = st.lanes.map((l) => l.worktree);
  assert.doesNotThrow(() => prepareLanes(planPath, st, { worktreeDir }), 're-preparing must not throw');
  assert.deepEqual(st.lanes.map((l) => l.worktree), firstPaths);

  for (const lane of st.lanes) {
    wt.removeLaneWorktree({ root, dest: lane.worktree, branch: lane.branch, deleteBranch: true });
  }
});
