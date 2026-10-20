'use strict';

/**
 * The scheduler end to end: a real git repository, real lane worktrees, and a
 * fake agent (test/fixtures/fake-agent.js) standing in for `claude -p`.
 *
 * Each test here reproduces a failure from a real two-lane run (the UI round of
 * 2026-10-20), which is why the fixtures are shaped like that plan: a task in
 * one lane that needs another lane's code, a plan revised mid-run, a session
 * aborted after the implementer committed, a lane merged into another by hand.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Must be set before src/spawn is loaded: it reads the binary once.
const FAKE_AGENT = path.join(__dirname, 'fixtures', 'fake-agent.js');
process.env.PLO_AGENT_BIN = FAKE_AGENT;

const { parsePlan } = require('../src/parse-plan');
const { buildDag } = require('../src/build-dag');
const state = require('../src/state');
const wt = require('../src/worktrees');
const { runLanes, prepareLanes } = require('../src/run');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Two disjoint tasks. At --max-lanes 1 they share a lane, one after the other.
const PAIR_PLAN = `# Plan

## Global Constraints

- Tests: \`npm test\`.

---

### Task 1: Alpha

**Files:**
- Create: \`src/alpha.js\`

- [ ] **Step 1: write alpha**

---

### Task 2: Beta

**Files:**
- Create: \`src/beta.js\`

- [ ] **Step 1: write beta**
`;

function makeRepo(planText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-run-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'src', 'keep.js'), '// keep\n');
  const planPath = path.join(root, 'docs', 'plan.md');
  fs.writeFileSync(planPath, planText);

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'run@test.local');
  git(root, 'config', 'user.name', 'Run');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial');
  git(root, 'checkout', '-q', '-b', 'feature/x');

  return { root, planPath, worktreeDir: `${root}-worktrees`, seenDir: `${root}-seen`, specFile: `${root}-spec.json` };
}

function cleanup(repo) {
  for (const p of [repo.root, repo.worktreeDir, repo.seenDir, repo.specFile]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** `plo init` + worktree preparation, in process. */
function initRun(repo, { maxLanes = 2 } = {}) {
  const contents = fs.readFileSync(repo.planPath, 'utf8');
  const plan = parsePlan(contents);
  const dag = buildDag(plan.tasks, { maxLanes });
  const st = state.create({
    planPath: repo.planPath,
    planContents: contents,
    repoRoot: wt.repoRoot(repo.root),
    baseBranch: 'feature/x',
    baseCommit: wt.headCommit(repo.root),
    maxLanes,
    lanes: dag.lanes,
    barriers: dag.barriers,
    testCommand: 'npm test',
  });
  state.save(repo.planPath, st);
  prepareLanes(repo.planPath, st, { worktreeDir: repo.worktreeDir });
  return { st, plan, dag };
}

function useSpec(repo, spec) {
  fs.writeFileSync(repo.specFile, JSON.stringify(spec));
  process.env.PLO_FAKE_SPEC = repo.specFile;
  process.env.PLO_FAKE_SEEN = repo.seenDir;
}

const seen = (repo, n, attempt = 1) => JSON.parse(fs.readFileSync(path.join(repo.seenDir, `task-${n}-${attempt}.json`), 'utf8'));
const subjects = (root, shas) => shas.map((s) => git(root, 'log', '-1', '--format=%s', s));

async function run(repo, st, plan, dag) {
  const lines = [];
  const res = await runLanes(repo.planPath, st, plan, {
    edges: dag.edges, dependencyEdges: dag.edges, maxLanes: st.maxLanes, log: (m) => lines.push(m),
  });
  return { res, log: lines.join('\n') };
}

// --- 3. a task that never reported done is verified, not trusted ----------

test('needs-verify: a failed attempt that committed is verified on the next attempt, from its original base', async (t) => {
  const repo = makeRepo(PAIR_PLAN);
  t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 1 });
  const baseBefore = wt.headCommit(st.lanes[0].worktree);

  useSpec(repo, {
    // Attempt 1: the implementer commits, then the session dies.
    // Attempt 2: review and smoke gate find nothing to change.
    1: [{ writes: { 'src/alpha.js': '// a\n' }, exit: 1 }, {}],
    2: { writes: { 'src/beta.js': '// b\n' } },
  });

  await run(repo, st, plan, dag);

  const rec = st.tasks['1'];
  assert.equal(rec.status, state.STATUS.DONE, rec.error || '');
  assert.equal(rec.attempts, 2);
  assert.equal(rec.baseBefore, baseBefore, 'the verifying attempt keeps the base the work started from');
  assert.deepEqual(subjects(repo.root, rec.commits), ['task 1'], 'the commits of the first attempt are the task\'s');

  const second = seen(repo, 1, 2).prompt;
  assert.match(second, /never reported done/);
  assert.match(second, new RegExp(`BASE = \`${baseBefore}\``));
  assert.match(second, /smoke gate/);
  assert.doesNotMatch(seen(repo, 1, 1).prompt, /never reported done/, 'a first attempt gets the ordinary prompt');
});
