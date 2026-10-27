'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
// First: it points src/spawn at the fake agent before anything loads it.
const { makeRepo, cleanup, initRun, useSpec, seen, runLanesIn } = require('./helpers/run-repo');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const state = require('../src/state');
const { integrate, markInterrupted, fullSuite } = require('../src/integrate');
const { processStamp, processAlive, killGroup } = require('../src/proc');

const PLO = path.join(__dirname, '..', 'bin', 'plo.js');

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

const CLEAN = 'CROSS-LANE VERDICT: CLEAN';
const LANE_SPEC = {
  1: { writes: { 'src/a.js': '1' } },
  2: { writes: { 'src/b.js': '2' } },
  3: { writes: { 'src/c.js': '3' } },
};

async function waitFor(fn, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: timed out');
}

test('integrate stamps every stage with start and end, and the review with its log and cost', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { ...LANE_SPEC, review: { result: { text: CLEAN, total_cost_usd: 0.42, output_tokens: 900 } } });

  await runLanesIn(repo, st, plan, dag);
  await integrate(repo.planPath, st, plan, { log() {} });

  const i = state.load(repo.planPath).integration;
  assert.ok(i.stages.merge.startedAt <= i.stages.merge.endedAt);
  assert.match(i.stages.review.logFile, /cross-lane-review\.jsonl$/);
  assert.equal(typeof i.stages.review.sessionId, 'string');
  assert.equal(i.stages.review.costUsd, 0.42);
  assert.equal(i.stages.review.outputTokens, 900);
  assert.equal(i.pid, process.pid);
});

test('the review stage is on disk before the reviewer starts', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { ...LANE_SPEC, review: { observe: [repo.statePath], result: { text: CLEAN } } });

  await runLanesIn(repo, st, plan, dag);
  await integrate(repo.planPath, st, plan, { log() {} });

  const saw = JSON.parse(seen(repo, 'review').files[repo.statePath]).integration;
  assert.equal(saw.status, 'reviewing');
  assert.ok(saw.stages.review.startedAt);
  assert.equal(saw.stages.review.endedAt, undefined);
  assert.ok(saw.stages.merge.endedAt, 'the merge had already closed');
});

test('markInterrupted closes the open stage and the running barrier', (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  st.integration.stages = { merge: { startedAt: 'a', endedAt: 'b' }, review: { startedAt: 'c' } };
  st.integration.status = 'reviewing';
  state.updateTask(repo.planPath, st, 3, { status: state.STATUS.RUNNING });

  assert.equal(markInterrupted(repo.planPath, st), 'review');
  assert.equal(st.integration.stages.review.interrupted, true);
  assert.ok(st.integration.stages.review.endedAt);
  assert.equal(st.integration.stages.merge.interrupted, undefined);
  assert.equal(st.integration.status, 'interrupted');
  assert.equal(st.tasks['3'].status, 'interrupted');
  assert.equal(state.load(repo.planPath).integration.status, 'interrupted', 'saved');
});

test('markInterrupted on a running barrier alone leaves the integration status', (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  st.integration.status = 'merged';
  state.updateTask(repo.planPath, st, 3, { status: state.STATUS.RUNNING });

  assert.equal(markInterrupted(repo.planPath, st), null);
  assert.equal(st.tasks['3'].status, 'interrupted');
  assert.equal(st.integration.status, 'merged');
});

test('integrate after an interrupted barrier skips the merge and redoes the barrier', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  // The second attempt writes a different body: an identical rewrite would
  // leave nothing to commit.
  useSpec(repo, {
    ...LANE_SPEC,
    3: [{ writes: { 'src/c.js': '3' } }, { writes: { 'src/c.js': '3 again' } }],
    review: { result: { text: CLEAN } },
  });
  await runLanesIn(repo, st, plan, dag);

  // The merge is done and the barrier died mid-edit, leaving a half-written
  // file (untracked) that its next attempt overwrites.
  const first = await integrate(repo.planPath, st, plan, { log() {} });
  assert.equal(first.ok, true);
  fs.writeFileSync(path.join(repo.root, 'src', 'c.js'), 'half');
  st.integration.status = 'merged';
  state.updateTask(repo.planPath, st, 3, { status: state.STATUS.RUNNING });
  markInterrupted(repo.planPath, st);

  const res = await integrate(repo.planPath, st, plan, { log() {} });

  assert.notEqual(res.stage, 'merge');
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 600));
  assert.equal(st.tasks['3'].status, 'done');
  assert.equal(st.tasks['3'].attempts, 2);
  assert.equal(state.load(repo.planPath).integration.status, 'done');
});

test('a new integrate redoes a stage left running',async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { ...LANE_SPEC, review: { result: { text: CLEAN } } });
  await runLanesIn(repo, st, plan, dag);

  const OLD = '2000-01-01T00:00:00.000Z';
  st.integration.status = 'reviewing';
  st.integration.stages = { review: { startedAt: OLD } };
  state.save(repo.planPath, st);

  await integrate(repo.planPath, st, plan, { log() {} });

  const i = state.load(repo.planPath).integration;
  assert.notEqual(i.stages.review.startedAt, OLD);
  assert.ok(i.stages.review.endedAt);
  assert.equal(i.stages.review.interrupted, undefined);
  assert.equal(i.status, 'done');
});

test('SIGTERM stops plo integrate, marks the review interrupted and exits 130', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { ...LANE_SPEC, review: { sleepMs: 10000, result: { text: CLEAN } } });
  await runLanesIn(repo, st, plan, dag);

  const child = spawn(process.execPath, [PLO, 'integrate', '--plan', repo.planPath], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

  await waitFor(() => {
    const s = state.load(repo.planPath);
    return s && s.integration.status === 'reviewing';
  });
  child.kill('SIGTERM');

  assert.equal(await exited, 130);
  const i = state.load(repo.planPath).integration;
  assert.equal(i.status, 'interrupted');
  assert.equal(i.stages.review.interrupted, true);
  assert.ok(i.stages.review.endedAt);
});

test('Ctrl-C in a barrier signals no group an older suite record names, and interrupts only the barrier', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { ...LANE_SPEC, 3: { sleepMs: 10000, writes: { 'src/c.js': '3' } }, review: { result: { text: CLEAN } } });
  await runLanesIn(repo, st, plan, dag);

  // The suite stage an integrate that died left open. Its pid now belongs to
  // an unrelated process leading its own group: same pid, a later start.
  const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  t.after(() => killGroup(victim.pid, 'SIGKILL'));
  const stamp = processStamp(victim.pid);
  const before = new Date(Date.parse(stamp.startedAt) - 10 * 60 * 1000).toISOString();
  st.integration.stages = { suite: { startedAt: before, command: 'npm test', pid: victim.pid, pidStartedAt: before } };
  state.save(repo.planPath, st);

  const child = spawn(process.execPath, [PLO, 'integrate', '--plan', repo.planPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  await waitFor(() => {
    const s = state.load(repo.planPath);
    return Boolean(s && s.tasks['3'] && s.tasks['3'].status === 'running');
  });
  child.kill('SIGINT');

  assert.equal(await exited, 130);
  assert.match(err, /barrier T3 marked interrupted/);
  assert.equal(processAlive(victim.pid, stamp.startedAt), true, 'the reused pid was left alone');
  const s = state.load(repo.planPath);
  assert.equal(s.tasks['3'].status, 'interrupted');
  assert.equal(s.integration.status, 'merged', 'a barrier alone leaves the status');
  assert.equal(s.integration.stages.suite, undefined);
});

for (const left of ['interrupted', 'open']) {
  test(`a new integrate drops the review an earlier one left ${left}, and runs its suite without it`, async (t) => {
    const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
    const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
    useSpec(repo, { ...LANE_SPEC, review: { result: { text: CLEAN } } });
    await runLanesIn(repo, st, plan, dag);
    assert.equal((await integrate(repo.planPath, st, plan, { log() {} })).ok, true);

    // An integrate stopped in its review: by Ctrl-C (closed as interrupted)
    // or killed outright (left open).
    const OLD = '2000-01-01T00:00:00.000Z';
    st.integration.stages.review = { startedAt: OLD, logFile: st.integration.stages.review.logFile, sessionId: 'old' };
    st.integration.status = 'reviewing';
    if (left === 'interrupted') markInterrupted(repo.planPath, st);
    // The next suite copies the checkpoint as it stands while the suite runs.
    const during = path.join(path.dirname(repo.planPath), '.plo-logs', 'state-during-suite.json');
    st.testCommand = `node -e "require('fs').copyFileSync(process.argv[1], process.argv[2])" ${JSON.stringify(repo.statePath)} ${JSON.stringify(during)}`;
    state.save(repo.planPath, st);

    const res = await integrate(repo.planPath, st, plan, { log() {} });

    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 600));
    const seenThen = JSON.parse(fs.readFileSync(during, 'utf8')).integration;
    assert.equal(seenThen.status, 'suite-running');
    assert.equal(seenThen.stages.review, undefined, 'no review from an earlier integrate while this one runs its suite');
    const i = state.load(repo.planPath).integration;
    assert.notEqual(i.stages.review.startedAt, OLD);
    assert.equal(i.stages.review.interrupted, undefined);
    assert.equal(i.status, 'done');
  });
}

test('a new integrate keeps the record of the merge it skips', async (t) => {
  const repo = makeRepo(BARRIER_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { ...LANE_SPEC, review: { result: { text: CLEAN } } });
  await runLanesIn(repo, st, plan, dag);
  assert.equal((await integrate(repo.planPath, st, plan, { log() {} })).ok, true);
  const merge = { ...st.integration.stages.merge };

  const res = await integrate(repo.planPath, st, plan, { log() {} });

  assert.equal(res.ok, true);
  assert.deepEqual(state.load(repo.planPath).integration.stages.merge, merge);
});

/** A checkpoint in a bare tmpdir, which is also the repo root: all `fullSuite` needs. */
function suiteFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-suite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const planPath = path.join(dir, 'plan.md');
  fs.writeFileSync(planPath, '# Suite plan\n');
  const st = state.create({
    planPath,
    planContents: '# Suite plan\n',
    repoRoot: dir,
    baseBranch: 'feature/x',
    baseCommit: 'abc1234',
    maxLanes: 1,
    lanes: [],
    barriers: [],
    testCommand: null,
  });
  state.save(planPath, st);
  return { planPath, st };
}

test('the suite output reaches full-suite.log while the suite runs', async (t) => {
  const { planPath, st } = suiteFixture(t);
  // The words are spelled in halves: the log's header line echoes the command,
  // and must not already contain what the test waits for.
  st.testCommand = `node -e "console.log('fi' + 'rst'); setTimeout(() => console.log('sec' + 'ond'), 600)"`;
  const run = fullSuite(planPath, st, {});
  const log = path.join(path.dirname(planPath), '.plo-logs', 'full-suite.log');
  await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('first'));
  const mid = fs.readFileSync(log, 'utf8');
  assert.match(mid.split('\n')[0], /^# \d{4}-\d\d-\d\dT\S+ \$ node -e/);
  assert.equal(mid.includes('second'), false);
  const onDisk = state.load(planPath).integration;
  assert.equal(onDisk.status, 'suite-running');
  assert.equal(typeof onDisk.stages.suite.pid, 'number');
  const res = await run;
  assert.equal(res.ok, true);
  assert.match(res.summary, /first\nsecond/);
  assert.ok(state.load(planPath).integration.stages.suite.endedAt);
});

test('a test command that does not exist fails with 127, not a crash', async (t) => {
  const { planPath, st } = suiteFixture(t);
  st.testCommand = 'plo-no-such-command-xyz';
  const res = await fullSuite(planPath, st, {});
  assert.equal(res.ok, false);
  assert.equal(res.code, 127);
});

test('a write error on full-suite.log stops the log, not plo: the suite settles and the summary says why', (t) => {
  const { planPath, st } = suiteFixture(t);
  // More than the 16-block file-size limit below, then one last line.
  st.testCommand = `node -e "process.stdout.write('x'.repeat(200000) + '\\n'); console.log('la' + 'st')"`;
  state.save(planPath, st);
  // `ulimit -f` turns the log's writes into EFBIG, the same 'error' path as
  // ENOSPC or EIO. It needs a process of its own: the limit cannot be lifted.
  const driver = [
    `const state = require(${JSON.stringify(require.resolve('../src/state'))});`,
    `const { fullSuite } = require(${JSON.stringify(require.resolve('../src/integrate'))});`,
    'const planPath = process.argv[1];',
    'fullSuite(planPath, state.load(planPath), {}).then((r) => process.stdout.write(JSON.stringify(r)));',
  ].join('\n');
  const run = spawnSync('bash', ['-c', 'ulimit -f 16; exec "$@"', 'bash', process.execPath, '-e', driver, planPath], { encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  const res = JSON.parse(run.stdout);
  assert.equal(res.ok, true);
  assert.equal(res.code, 0);
  assert.match(res.summary, /\nlast\n/, 'the tail in memory outlives the log');
  assert.match(res.summary, /full-suite\.log.*EFBIG/);
  assert.ok(state.load(planPath).integration.stages.suite.endedAt, 'the stage closed');
});

test('a suite still alive from a dead integrate is killed before the log is truncated', async (t) => {
  const { planPath, st } = suiteFixture(t);
  const stale = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  t.after(() => killGroup(stale.pid, 'SIGKILL'));
  const stamp = processStamp(stale.pid);
  st.integration.stages = { suite: { startedAt: new Date().toISOString(), pid: stamp.pid, pidStartedAt: stamp.startedAt } };
  st.testCommand = 'node -e ""';
  await fullSuite(planPath, st, {});
  await waitFor(() => !processAlive(stamp.pid, null), 3000);
});

const groupGone = (pid) => {
  try { process.kill(-pid, 0); return false; } catch { return true; }
};

test('a dead suite whose leader exited while its workers run on is killed as a group', async (t) => {
  const { planPath, st } = suiteFixture(t);
  // Spawned the way fullSuite spawns; the leader leaves a worker behind and
  // exits, as a runner killed by SIGPIPE does while its workers stay quiet.
  const old = spawn('sleep 30 & exit 0', { shell: true, detached: true, stdio: 'ignore' });
  t.after(() => { if (!groupGone(old.pid)) killGroup(old.pid, 'SIGKILL'); });
  const stamp = processStamp(old.pid);
  await new Promise((resolve) => old.once('exit', resolve));
  assert.equal(processAlive(old.pid, null), false, 'premise: the leader is gone');
  assert.equal(groupGone(old.pid), false, 'premise: its group lives on');
  // What a SIGKILLed integrate leaves: the suite stage open, with its pid.
  st.integration.status = 'suite-running';
  st.integration.stages = { suite: { startedAt: new Date().toISOString(), pid: stamp.pid, pidStartedAt: stamp.startedAt } };
  st.testCommand = 'node -e ""';

  const lines = [];
  await fullSuite(planPath, st, { log: (m) => lines.push(m) });

  assert.ok(lines.some((l) => l.includes('killed the suite')), lines.join('\n'));
  await waitFor(() => groupGone(old.pid), 3000);
});

test('a live pid that fails the stamp was reused: its group is never killed', async (t) => {
  const { planPath, st } = suiteFixture(t);
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  t.after(() => killGroup(other.pid, 'SIGKILL'));
  const stamp = processStamp(other.pid);
  // The same pid with an earlier start: the suite that held it is gone.
  const before = new Date(Date.parse(stamp.startedAt) - 10 * 60 * 1000).toISOString();
  st.integration.stages = { suite: { startedAt: before, pid: other.pid, pidStartedAt: before } };
  st.testCommand = 'node -e ""';

  await fullSuite(planPath, st, {});

  assert.equal(processAlive(other.pid, stamp.startedAt), true);
});

// BARRIER_PLAN without its barrier: `integrate` goes from the merge straight
// to the suite.
const LANES_ONLY_PLAN = [
  '# Lanes-only plan', '',
  '### Task 1: Alpha', '',
  '**Files:**', '- Create: `src/a.js`', '', '- [ ] **Step 1: write a**', '',
  '### Task 2: Beta', '',
  '**Files:**', '- Create: `src/b.js`', '', '- [ ] **Step 1: write b**', '',
].join('\n');

test('SIGTERM to plo integrate kills the suite group and marks the stage interrupted', async (t) => {
  const repo = makeRepo(LANES_ONLY_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  assert.deepEqual(st.barriers, [], 'fixture premise: no barrier');
  useSpec(repo, { 1: LANE_SPEC[1], 2: LANE_SPEC[2] });
  await runLanesIn(repo, st, plan, dag);
  st.testCommand = `node -e "setInterval(() => console.log('tick'), 200)"`;
  state.save(repo.planPath, st);

  const child = spawn(process.execPath, [PLO, 'integrate', '--plan', repo.planPath], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  // The suite is in its own group: killing plo does not kill it.
  let suitePid = null;
  t.after(() => { if (suitePid) killGroup(suitePid, 'SIGKILL'); });

  await waitFor(() => {
    const i = (state.load(repo.planPath) || {}).integration;
    if (i && i.stages && i.stages.suite && i.stages.suite.pid) suitePid = i.stages.suite.pid;
    return Boolean(i && i.status === 'suite-running' && suitePid);
  });
  child.kill('SIGTERM');

  assert.equal(await exited, 130);
  assert.equal(state.load(repo.planPath).integration.stages.suite.interrupted, true);
  await waitFor(() => !processAlive(suitePid, null), 3000);
});

test('a closed terminal (SIGHUP) stops plo integrate the way Ctrl-C does', async (t) => {
  const repo = makeRepo(LANES_ONLY_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2, testCommand: 'node -e ""' });
  useSpec(repo, { 1: LANE_SPEC[1], 2: LANE_SPEC[2] });
  await runLanesIn(repo, st, plan, dag);
  // Quiet until it ends: no write, so no SIGPIPE ends it once plo is gone.
  st.testCommand = `node -e "setTimeout(() => console.log('end'), 15000)"`;
  state.save(repo.planPath, st);

  const child = spawn(process.execPath, [PLO, 'integrate', '--plan', repo.planPath], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal)));
  let suitePid = null;
  t.after(() => { if (suitePid) killGroup(suitePid, 'SIGKILL'); });

  await waitFor(() => {
    const i = (state.load(repo.planPath) || {}).integration;
    if (i && i.stages && i.stages.suite && i.stages.suite.pid) suitePid = i.stages.suite.pid;
    return Boolean(i && i.status === 'suite-running' && suitePid);
  });
  child.kill('SIGHUP');

  assert.equal(await exited, 130);
  const i = state.load(repo.planPath).integration;
  assert.equal(i.status, 'interrupted');
  assert.equal(i.stages.suite.interrupted, true);
  await waitFor(() => !processAlive(suitePid, null), 3000);
});
