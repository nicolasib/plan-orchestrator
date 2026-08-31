'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const state = require('../src/state');

function tmpPlan(name = 'plan.md') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-state-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, '# Plan\n');
  return p;
}

const mkState = (planPath, over = {}) => state.create({
  planPath,
  planContents: '# Plan\n',
  repoRoot: '/repo',
  baseBranch: 'feature/x',
  baseCommit: 'abc123',
  maxLanes: 3,
  lanes: [{ id: 'A', tasks: [1, 2], weight: 10 }, { id: 'B', tasks: [3], weight: 5 }],
  barriers: [4],
  testCommand: 'npm test',
  ...over,
});

test('create seeds every lane task and barrier as pending', () => {
  const st = mkState(tmpPlan());
  assert.deepEqual(Object.keys(st.tasks).sort(), ['1', '2', '3', '4']);
  assert.equal(st.tasks['1'].lane, 'A');
  assert.equal(st.tasks['3'].lane, 'B');
  assert.equal(st.tasks['4'].barrier, true);
  assert.ok(Object.values(st.tasks).every((t) => t.status === state.STATUS.PENDING));
});

test('save is atomic and load round-trips', () => {
  const p = tmpPlan();
  const st = mkState(p);
  const written = state.save(p, st);
  assert.equal(written, state.statePathFor(p));
  const back = state.load(p);
  assert.equal(back.base.branch, 'feature/x');
  assert.equal(back.testCommand, 'npm test');
  // No tmp files left behind.
  const stray = fs.readdirSync(path.dirname(p)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(stray, []);
});

test('load rejects a corrupt state file with an actionable message', () => {
  const p = tmpPlan();
  fs.writeFileSync(state.statePathFor(p), '{not json');
  assert.throws(() => state.load(p), /corrupt/i);
});

test('updateTask persists immediately — no window of unrecorded work', () => {
  const p = tmpPlan();
  const st = mkState(p);
  state.save(p, st);
  state.updateTask(p, st, 1, { status: state.STATUS.RUNNING, sessionId: 'sess-1' });
  const onDisk = state.load(p);
  assert.equal(onDisk.tasks['1'].status, state.STATUS.RUNNING);
  assert.equal(onDisk.tasks['1'].sessionId, 'sess-1');
});

test('reconcile: a task left running becomes interrupted', () => {
  const st = mkState(tmpPlan());
  st.tasks['1'].status = state.STATUS.RUNNING;
  const notes = state.reconcile(st, {});
  assert.equal(st.tasks['1'].status, state.STATUS.INTERRUPTED);
  assert.match(notes.map((n) => n.message).join(' '), /Task 1 was running/);
});

test('reconcile: commits in git outrank a state file that missed them', () => {
  const st = mkState(tmpPlan());
  st.tasks['1'].status = state.STATUS.RUNNING;
  const notes = state.reconcile(st, { gitCommitsFor: (n) => (n === 1 ? ['sha1', 'sha2'] : []) });
  assert.equal(st.tasks['1'].status, state.STATUS.DONE, 'a process that died after committing still finished the task');
  assert.deepEqual(st.tasks['1'].commits, ['sha1', 'sha2']);
  assert.equal(st.tasks['1'].reconciled, true);
  assert.match(notes.map((n) => n.message).join(' '), /reconciled from git/);
});

test('reconcile: a changed plan file raises a warning rather than silently resuming', () => {
  const st = mkState(tmpPlan());
  const notes = state.reconcile(st, { planContents: '# Plan\n\n### Task 9: new\n' });
  assert.ok(notes.some((n) => n.level === 'warn' && /plan file changed/i.test(n.message)));
});

test('readyTasks: only the first unsettled task of each lane is offered', () => {
  const st = mkState(tmpPlan());
  const ready = state.readyTasks(st, []);
  assert.deepEqual(ready.map((r) => r.n).sort(), [1, 3], 'T2 waits behind T1 in lane A');
});

test('readyTasks: a lane task waits on a cross-lane dependency', () => {
  const st = mkState(tmpPlan());
  const edges = [{ from: 3, to: 1 }]; // lane B's T3 gates lane A's T1
  const ready = state.readyTasks(st, edges);
  assert.deepEqual(ready.map((r) => r.n), [3], 'T1 is not ready until T3 is done');
});

test('readyTasks: a running task blocks its own lane but not others', () => {
  const st = mkState(tmpPlan());
  st.tasks['1'].status = state.STATUS.RUNNING;
  const ready = state.readyTasks(st, []);
  assert.deepEqual(ready.map((r) => r.n), [3]);
});

test('readyTasks: barriers wait for every lane task, then run in order', () => {
  const st = mkState(tmpPlan());
  assert.deepEqual(state.readyTasks(st, []).filter((r) => r.barrier), [], 'barrier not ready while lanes pending');

  for (const n of [1, 2, 3]) st.tasks[String(n)].status = state.STATUS.DONE;
  const ready = state.readyTasks(st, []);
  assert.deepEqual(ready.map((r) => r.n), [4]);
  assert.equal(ready[0].barrier, true);
});

// The runaway this exists to stop: before MAX_ATTEMPTS the scheduler re-offered
// a failed task on every pass, so a task failing identically each time spun
// without limit — 24,827 relaunches in the incident that motivated the cap.
test('readyTasks: a task that has spent its attempts stalls its lane', () => {
  const st = mkState(tmpPlan());
  st.tasks['1'].status = state.STATUS.FAILED;

  st.tasks['1'].attempts = state.MAX_ATTEMPTS - 1;
  assert.ok(state.readyTasks(st, []).some((r) => r.n === 1), 'one attempt left — still offered');

  st.tasks['1'].attempts = state.MAX_ATTEMPTS;
  assert.ok(!state.readyTasks(st, []).some((r) => r.n === 1), 'budget spent — not offered');
  assert.ok(!state.readyTasks(st, []).some((r) => r.n === 2), 'and nothing behind it starts');
});

// A lane stalling must not stall the others: the cap is per task, and lane B
// has no stake in lane A's failure.
test('readyTasks: an exhausted task stalls only its own lane', () => {
  const st = mkState(tmpPlan());
  Object.assign(st.tasks['1'], { status: state.STATUS.FAILED, attempts: state.MAX_ATTEMPTS });
  assert.deepEqual(state.readyTasks(st, []).map((r) => r.n), [3], "lane B is unaffected");
});

test('reconcile: resume returns the attempt budget to an exhausted task', () => {
  const st = mkState(tmpPlan());
  Object.assign(st.tasks['1'], { status: state.STATUS.FAILED, attempts: state.MAX_ATTEMPTS });

  const notes = state.reconcile(st, {});

  assert.equal(st.tasks['1'].attempts, 0, 'budget restored');
  assert.ok(state.readyTasks(st, []).some((r) => r.n === 1), 'and the task runs again');
  assert.ok(notes.some((x) => /spent its/.test(x.message)), 'and it says so');
});

test('reconcile: a task with attempts left keeps its count', () => {
  const st = mkState(tmpPlan());
  Object.assign(st.tasks['1'], { status: state.STATUS.FAILED, attempts: 1 });
  state.reconcile(st, {});
  assert.equal(st.tasks['1'].attempts, 1, 'only an exhausted budget is reset');
});

test('readyTasks: a failed task is offered again on resume', () => {
  const st = mkState(tmpPlan());
  st.tasks['1'].status = state.STATUS.FAILED;
  assert.ok(state.readyTasks(st, []).some((r) => r.n === 1), 'failed tasks are resumable');
  st.tasks['1'].status = state.STATUS.DONE;
  assert.ok(!state.readyTasks(st, []).some((r) => r.n === 1), 'done tasks are never re-run');
  assert.ok(state.readyTasks(st, []).some((r) => r.n === 2), 'and the lane advances');
});

test('summarize counts by status', () => {
  const st = mkState(tmpPlan());
  st.tasks['1'].status = state.STATUS.DONE;
  st.tasks['2'].status = state.STATUS.FAILED;
  const s = state.summarize(st);
  assert.equal(s.total, 4);
  assert.equal(s.done, 1);
  assert.equal(s.counts[state.STATUS.FAILED], 1);
});

// --- state files are per plan, not per directory -------------------------
//
// Plans conventionally share one folder. A directory-scoped checkpoint made
// `plo run --plan b.md` read plan A's state and report A's finished task
// numbers as B's "already complete" — silently skipping B's work.

function tmpPlansDir(...names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-multi-'));
  return names.map((n) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, `# ${n}\n`);
    return p;
  });
}

test('two plans in one directory get separate state files', () => {
  const [a, b] = tmpPlansDir('plan-a.md', 'plan-b.md');
  assert.notEqual(state.statePathFor(a), state.statePathFor(b));

  state.save(a, mkState(a));
  assert.equal(state.load(b), null, 'plan B must not see plan A state');

  const stB = mkState(b);
  stB.tasks['1'].status = state.STATUS.DONE;
  state.save(b, stB);

  assert.equal(state.load(a).tasks['1'].status, state.STATUS.PENDING);
  assert.equal(state.load(b).tasks['1'].status, state.STATUS.DONE);
});

test('load refuses a state file belonging to a different plan', () => {
  const [a, b] = tmpPlansDir('plan-a.md', 'plan-b.md');
  // A state file carrying plan A, sitting where plan B's would live.
  fs.writeFileSync(state.statePathFor(b), JSON.stringify(mkState(a)));
  assert.throws(() => state.load(b), /belongs to plan-a\.md, not plan-b\.md/);
});

test('a legacy .plan-state.json migrates when it is this plan\'s', () => {
  const [a] = tmpPlansDir('plan-a.md');
  const legacy = state.legacyStatePathFor(a);
  const st = mkState(a);
  st.tasks['2'].status = state.STATUS.DONE;
  fs.writeFileSync(legacy, JSON.stringify(st));

  const loaded = state.load(a);
  assert.equal(loaded.tasks['2'].status, state.STATUS.DONE, 'checkpoint survives migration');
  assert.ok(fs.existsSync(state.statePathFor(a)), 'moved to the per-plan name');
  assert.ok(!fs.existsSync(legacy), 'legacy file is gone, not duplicated');
});

test('a legacy .plan-state.json is never adopted by another plan', () => {
  const [a, b] = tmpPlansDir('plan-a.md', 'plan-b.md');
  fs.writeFileSync(state.legacyStatePathFor(a), JSON.stringify(mkState(a)));
  assert.throws(() => state.load(b), /belongs to plan-a\.md/);
  assert.ok(fs.existsSync(state.legacyStatePathFor(a)), 'plan A checkpoint left intact');
});

test('the state path survives a moved repo but not a renamed plan', () => {
  const [a] = tmpPlansDir('plan-a.md');
  const st = mkState('/somewhere/else/plan-a.md'); // same plan, different absolute dir
  fs.writeFileSync(state.statePathFor(a), JSON.stringify(st));
  assert.ok(state.load(a), 'directory may differ — repo moved, worktree, clone');
});
