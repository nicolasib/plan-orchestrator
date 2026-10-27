'use strict';

/**
 * A real git repository with lane worktrees, driven by the fake agent
 * (test/fixtures/fake-agent.js) — the setup of test/run-lanes.test.js, shared
 * so other suites can run the scheduler and the integration end to end.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Must be set before src/spawn is loaded: it reads the binary once.
const FAKE_AGENT = path.join(__dirname, '..', 'fixtures', 'fake-agent.js');
process.env.PLO_AGENT_BIN = FAKE_AGENT;

const { parsePlan } = require('../../src/parse-plan');
const { buildDag } = require('../../src/build-dag');
const state = require('../../src/state');
const wt = require('../../src/worktrees');
const { runLanes, prepareLanes } = require('../../src/run');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function makeRepo(planText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-run-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'src', 'keep.js'), '// keep\n');
  // The state and the logs live beside the plan, inside the repo. Ignored, so
  // `integrate` finds the feature checkout clean and a barrier's `add -A`
  // leaves them out of its commit.
  fs.writeFileSync(path.join(root, '.gitignore'), '.plan-state-*.json\n.plo-logs/\n');
  const planPath = path.join(root, 'docs', 'plan.md');
  fs.writeFileSync(planPath, planText);

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'run@test.local');
  git(root, 'config', 'user.name', 'Run');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial');
  git(root, 'checkout', '-q', '-b', 'feature/x');

  return {
    root,
    planPath,
    statePath: state.statePathFor(planPath),
    worktreeDir: `${root}-worktrees`,
    seenDir: `${root}-seen`,
    specFile: `${root}-spec.json`,
  };
}

function cleanup(repo) {
  for (const p of [repo.root, repo.worktreeDir, repo.seenDir, repo.specFile]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** `plo init` + worktree preparation, in process. */
function initRun(repo, { maxLanes = 2, testCommand = 'npm test' } = {}) {
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
    testCommand,
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

/** What the fake agent saw on one attempt: `key` is a task number or 'review'. */
const seen = (repo, key, attempt = 1) => JSON.parse(fs.readFileSync(
  path.join(repo.seenDir, key === 'review' ? `review-${attempt}.json` : `task-${key}-${attempt}.json`),
  'utf8',
));

async function runLanesIn(repo, st, plan, dag, opts = {}) {
  const lines = [];
  const res = await runLanes(repo.planPath, st, plan, {
    edges: dag.edges, dependencyEdges: dag.edges, maxLanes: st.maxLanes, log: (m) => lines.push(m), ...opts,
  });
  return { res, log: lines.join('\n') };
}

module.exports = { makeRepo, cleanup, initRun, useSpec, seen, runLanesIn };
