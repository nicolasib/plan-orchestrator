'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const state = require('../src/state');
const monitor = require('../src/monitor');

const PLAN = `# Auth refactor

**Test command:** \`npm test\`

### Task 1: Repo helpers

**Files:**
- Modify: \`src/repo.js\`

- [x] step one

### Task 2: POST /v1/requests

**Files:**
- Modify: \`src/routes/requests.js\`
- Test: \`tests/requests.test.js\` (novo)

**Interfaces:**
- Produces: \`makeRequestsRouter({ ... })\` used by Task 3.

- [ ] step one

### Task 3: Wrap-up

- [ ] docs
`;

const ev = (o) => `${JSON.stringify(o)}\n`;

const assistantTool = (name, input, id, at) => ev({
  type: 'assistant',
  timestamp: at,
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage: { output_tokens: 20 } },
});
const toolResult = (id, content, isError, at) => ev({
  type: 'user',
  timestamp: at,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: Boolean(isError) }] },
});

const SAMPLE_LOG = [
  '\n=== 2026-08-19T12:00:00.000Z :: claude -p … (cwd=/wt/lane-a)\n',
  ev({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5' }),
  assistantTool('Edit', { file_path: '/repo/src/routes/external/requests.js' }, 'tu_1', '2026-08-19T12:00:10.000Z'),
  toolResult('tu_1', 'applied', false, '2026-08-19T12:00:11.000Z'),
  assistantTool('Bash', { command: 'npm test -- requests' }, 'tu_2', '2026-08-19T12:00:20.000Z'),
  toolResult('tu_2', 'FAIL 1 test failed', true, '2026-08-19T12:00:31.000Z'),
  ev({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1787211000, rateLimitType: 'five_hour' } }),
  ev({ type: 'assistant', timestamp: '2026-08-19T12:00:40.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixing the failing assertion.' }], usage: { output_tokens: 12 } } }),
].join('');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plo-monitor-'));
}

/** A plan + checkpoint + logs on disk, shaped like a real half-finished run. */
function fixture({ withLog = true } = {}) {
  const dir = tmpdir();
  const planPath = path.join(dir, 'auth-refactor.md');
  fs.writeFileSync(planPath, PLAN);

  const st = state.create({
    planPath,
    planContents: PLAN,
    repoRoot: dir,
    baseBranch: 'feature/auth',
    baseCommit: 'abc1234',
    maxLanes: 2,
    lanes: [{ id: 'A', tasks: [1, 2], weight: 12 }],
    barriers: [3],
    testCommand: 'npm test',
  });
  st.lanes[0].branch = 'plo/auth-lane-a';
  st.lanes[0].worktree = path.join(dir, 'wt-a');

  st.tasks['1'] = { ...st.tasks['1'], status: state.STATUS.DONE, attempts: 1, turns: 9, commits: ['a'.repeat(40)], costUsd: 1.5, startedAt: '2026-08-19T11:00:00.000Z', endedAt: '2026-08-19T11:20:00.000Z' };

  const logFile = path.join(dir, '.plo-logs', 'task-2.jsonl');
  if (withLog) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, SAMPLE_LOG);
  }
  st.tasks['2'] = { ...st.tasks['2'], status: state.STATUS.RUNNING, attempts: 1, sessionId: 'sess-1', startedAt: '2026-08-19T12:00:00.000Z', logFile };

  state.save(planPath, st);
  return { dir, planPath, logFile };
}

// ---------------------------------------------------------------- digest

test('digestLog folds tool calls, results, turns and tokens', () => {
  const d = monitor.digestLog(SAMPLE_LOG);
  assert.equal(d.sessionId, 'sess-1');
  assert.equal(d.model, 'claude-opus-5');
  assert.equal(d.turns, 3);
  assert.equal(d.toolCount, 2);
  assert.equal(d.outputTokens, 52);
  assert.equal(d.attempts, 1);
  assert.equal(d.lastText, 'Fixing the failing assertion.');
  assert.equal(d.lastActivityAt, '2026-08-19T12:00:40.000Z');
});

test('digestLog pairs each tool_result back onto its tool call', () => {
  const d = monitor.digestLog(SAMPLE_LOG);
  const tools = d.activity.filter((a) => a.kind === 'tool');
  assert.equal(tools[0].name, 'Edit');
  assert.equal(tools[0].target, '…/external/requests.js');
  assert.equal(tools[0].ok, true);
  assert.equal(tools[1].name, 'Bash');
  assert.equal(tools[1].target, 'npm test -- requests');
  assert.equal(tools[1].ok, false, 'an is_error result must mark the call failed');
  assert.match(tools[1].preview, /FAIL/);
});

test("digestLog keeps the report's line breaks for the panel and collapses them only for the feed", () => {
  const report = ['# Head', '', '| Fase | Resultado |', '|---|---|', '| Review | ok |'].join('\n');
  const log = JSON.stringify({ type: 'result', subtype: 'success', num_turns: 2, result: report }) + '\n';
  const d = monitor.digestLog(log);

  // The feed row is one line and stays one line.
  assert.ok(!d.result.text.includes('\n'), 'the feed line must not carry newlines');
  assert.match(d.result.text, /# Head \| Fase \| Resultado \|/);

  // The panel renders Markdown, and Markdown is made of line breaks.
  assert.equal(d.result.body, report, 'the panel copy is the report as written');
  assert.equal(d.result.clipped, false);
});

test('digestLog reports it when a report is longer than the panel budget', () => {
  const long = 'x'.repeat(9000);
  const d = monitor.digestLog(JSON.stringify({ type: 'result', subtype: 'success', result: long }) + '\n');
  assert.equal(d.result.body.length, 8000);
  assert.equal(d.result.clipped, true, 'a cap the reader cannot see is a cap that lies');
});

test('digestLog surfaces the rate limit event verbatim', () => {
  const d = monitor.digestLog(SAMPLE_LOG);
  assert.equal(d.rateLimit.rateLimitType, 'five_hour');
  assert.equal(d.rateLimit.status, 'allowed');
});

test('digestLog resets counters at each attempt header', () => {
  const second = [
    SAMPLE_LOG,
    '\n=== 2026-08-19T13:00:00.000Z :: claude -p … (cwd=/wt/lane-a)\n',
    assistantTool('Read', { file_path: 'src/repo.js' }, 'tu_9', '2026-08-19T13:00:05.000Z'),
  ].join('');
  const d = monitor.digestLog(second);
  assert.equal(d.attempts, 2);
  assert.equal(d.turns, 1, 'the previous attempt must not inflate the current one');
  assert.equal(d.toolCount, 1);
  assert.equal(d.activity.filter((a) => a.kind === 'tool').length, 1);
});

test('digestLog ignores partial lines and unknown event types', () => {
  const noisy = `{"type":"system","subtype":"hook_started"}\n{"type":"assistant","message":{"content":[{"typ\n${SAMPLE_LOG}`;
  const d = monitor.digestLog(noisy);
  assert.equal(d.toolCount, 2, 'a truncated line is dropped, not counted');
});

test('digestLog attributes subagent events without inflating the turn count', () => {
  const withSub = SAMPLE_LOG + ev({
    type: 'assistant',
    parent_tool_use_id: 'tu_parent',
    timestamp: '2026-08-19T12:01:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_s1', name: 'Grep', input: { pattern: 'foo' } }], usage: { output_tokens: 5 } },
  });
  const d = monitor.digestLog(withSub);
  assert.equal(d.turns, 3, 'subagent turns belong to the subagent, not the lane process');
  const sub = d.activity.filter((a) => a.sub);
  assert.equal(sub.length, 1);
  assert.equal(sub[0].name, 'Grep');
});

/** A task that dispatches one subagent, which works and comes back. */
const DISPATCH_LOG = [
  '\n=== 2026-08-19T12:00:00.000Z :: claude -p … (cwd=/wt/lane-a)\n',
  ev({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5' }),
  assistantTool('Task', { description: 'review the token diff', subagent_type: 'code-reviewer' }, 'tu_task', '2026-08-19T12:00:05.000Z'),
  ev({
    type: 'assistant',
    parent_tool_use_id: 'tu_task',
    timestamp: '2026-08-19T12:00:08.000Z',
    message: { model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'tool_use', id: 'tu_k1', name: 'Grep', input: { pattern: 'useTheme' } }], usage: { output_tokens: 40 } },
  }),
  toolResult('tu_k1', 'three hits', false, '2026-08-19T12:00:09.000Z'),
  toolResult('tu_task', 'looks clean', false, '2026-08-19T12:00:30.000Z'),
].join('');

test('a Task call and everything under it becomes one subagent node', () => {
  const d = monitor.digestLog(DISPATCH_LOG);
  const kids = monitor.buildChildren(d.activity, d.subs);
  assert.equal(kids.length, 1);
  const [k] = kids;
  assert.equal(k.id, 'tu_task');
  assert.equal(k.agentType, 'code-reviewer', 'the description says what it was asked; this says who it is');
  assert.equal(k.title, 'review the token diff');
  assert.equal(k.status, state.STATUS.DONE, 'the tool_result is when a subagent stops');
  assert.equal(k.endedAt, '2026-08-19T12:00:30.000Z');
  assert.equal(k.model, 'claude-sonnet-5', 'a subagent runs on its own model');
  assert.equal(k.turns, 1);
  assert.equal(k.outputTokens, 40);
  assert.equal(k.activity.length, 1);
  assert.equal(k.activity[0].name, 'Grep');
  assert.equal(k.activity[0].sub, false, 'inside its own row, its calls are its own — the arrow points at nothing');
  assert.equal(d.model, 'claude-opus-5', "and the task keeps the model it started on, not its subagent's");
});

test('a subagent with no result yet is one that is still working', () => {
  const open = DISPATCH_LOG.replace(toolResult('tu_task', 'looks clean', false, '2026-08-19T12:00:30.000Z'), '');
  const d = monitor.digestLog(open);
  const [k] = monitor.buildChildren(d.activity, d.subs);
  assert.equal(k.status, state.STATUS.RUNNING);
  assert.equal(k.endedAt, null);
});

test('a dispatch that scrolled out of the tail still gets its node', () => {
  const d = monitor.digestLog(DISPATCH_LOG);
  // Only the subagent's own events survive the window; the `Task` call that
  // named it does not. Dropping the node would hide a live subagent for the
  // sole reason that it started a while ago.
  const orphaned = d.activity.filter((a) => a.parentId);
  const [k] = monitor.buildChildren(orphaned, {});
  assert.equal(k.id, 'tu_task');
  assert.equal(k.agentType, null);
  assert.equal(k.startedAt, '2026-08-19T12:00:08.000Z', 'it starts at the first thing it is known to have done');
  assert.equal(k.activity.length, 1);
});

test('the task keeps its own calls and hands the rest to its children', () => {
  const dir = tmpdir();
  const planPath = path.join(dir, 'auth-refactor.md');
  fs.writeFileSync(planPath, PLAN);
  const st = state.create({
    planPath, planContents: PLAN, repoRoot: dir, baseBranch: 'feature/auth', baseCommit: 'abc1234',
    maxLanes: 1, lanes: [{ id: 'A', tasks: [1, 2], weight: 4 }], barriers: [3], testCommand: 'npm test',
  });
  const logFile = path.join(dir, '.plo-logs', 'task-2.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, DISPATCH_LOG);
  st.tasks['2'] = { ...st.tasks['2'], status: state.STATUS.RUNNING, startedAt: '2026-08-19T12:00:00.000Z', logFile };
  state.save(planPath, st);

  const t2 = monitor.snapshot(planPath).lanes[0].tasks[1];
  assert.equal(t2.model, 'claude-opus-5', 'the list says which model is doing the work, not only the record');
  assert.equal(t2.children.length, 1);
  assert.equal(t2.activity.some((a) => a.sub), false, "a subagent's calls hang off the subagent");
  assert.equal(t2.activity.some((a) => a.name === 'Task'), true, 'the dispatch itself is the task\u2019s own doing');
});

test('toolTarget names the thing each tool points at', () => {
  assert.equal(monitor.toolTarget('Read', { file_path: 'a/b/c/d.js' }), '…/c/d.js');
  assert.equal(monitor.toolTarget('Bash', { command: 'npm  test\n--watch' }), 'npm test --watch');
  assert.equal(monitor.toolTarget('Grep', { pattern: 'TODO', path: 'src/x.js' }), 'TODO in src/x.js');
  assert.equal(monitor.toolTarget('Task', { description: 'review lane' }), 'review lane');
  assert.equal(monitor.toolTarget('Unknown', { prompt: 'hello' }), 'hello');
  assert.equal(monitor.toolTarget('Read', null), '');
});

// ---------------------------------------------------------------- tail

test('tailFile returns null for a log that does not exist yet', () => {
  assert.equal(monitor.tailFile(path.join(tmpdir(), 'nope.jsonl')), null);
});

test('tailFile drops the partial first line when it reads from an offset', () => {
  const f = path.join(tmpdir(), 'big.jsonl');
  const line = `${JSON.stringify({ type: 'user', message: { content: [] } })}\n`;
  fs.writeFileSync(f, line.repeat(500));
  const tail = monitor.tailFile(f, 1000);
  assert.equal(tail.truncated, true);
  assert.ok(tail.text.split('\n').filter(Boolean).every((l) => l.startsWith('{')));
});

// ---------------------------------------------------------------- snapshot

test('snapshot merges checkpoint status with live log activity', () => {
  const { planPath } = fixture();
  const snap = monitor.snapshot(planPath);

  assert.equal(snap.ready, true);
  assert.equal(snap.title, 'Auth refactor');
  assert.equal(snap.totals.total, 3);
  assert.equal(snap.totals.done, 1);
  assert.equal(snap.totals.running, 1);
  assert.equal(snap.totals.active, true);
  assert.equal(snap.planChanged, false);

  const [t1, t2] = snap.lanes[0].tasks;
  assert.equal(t1.status, state.STATUS.DONE);
  assert.deepEqual(t1.lastTool, null, 'a settled task shows no live tool');
  assert.equal(t2.status, state.STATUS.RUNNING);
  assert.equal(t2.turns, 3, 'turns for a running task come from the log, not the checkpoint');
  assert.equal(t2.lastTool.name, 'Bash');
  assert.equal(t2.lastText, 'Fixing the failing assertion.');
  assert.equal(snap.barriers[0].n, 3);
});

test('snapshot totals sum cost across settled and in-flight tasks', () => {
  const { planPath } = fixture();
  const snap = monitor.snapshot(planPath);
  assert.equal(snap.totals.costUsd, 1.5);
});

test('snapshot survives a task whose log has not appeared yet', () => {
  const { planPath } = fixture({ withLog: false });
  const snap = monitor.snapshot(planPath);
  const t2 = snap.lanes[0].tasks[1];
  assert.equal(t2.status, state.STATUS.RUNNING);
  assert.deepEqual(t2.activity, []);
  assert.equal(t2.lastTool, null);
});

test('snapshot reports a missing state file instead of throwing', () => {
  const dir = tmpdir();
  const planPath = path.join(dir, 'fresh.md');
  fs.writeFileSync(planPath, PLAN);
  const snap = monitor.snapshot(planPath);
  assert.equal(snap.ready, false);
  assert.match(snap.message, /plo init/);
});

test('snapshot flags a plan edited after init', () => {
  const { planPath } = fixture();
  fs.appendFileSync(planPath, '\n### Task 4: sneaked in\n');
  assert.equal(monitor.snapshot(planPath).planChanged, true);
});

test('a rate limit on a task that already died is still reported', () => {
  const { planPath, logFile } = fixture();
  fs.appendFileSync(logFile, ev({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } }));
  const st = state.load(planPath);
  st.tasks['2'].status = state.STATUS.FAILED;
  st.tasks['2'].error = 'agent error: usage limit reached';
  state.save(planPath, st);

  const snap = monitor.snapshot(planPath);
  assert.equal(snap.rateLimit.status, 'rejected', 'the limit that killed a lane is exactly the one worth showing');
  assert.ok(
    snap.lanes[0].tasks[1].activity.length > 0,
    'what a task was doing when it died is the answer to why it died, so it outlives it',
  );
});

test('a task that finished cleanly carries no tail, and one that stopped does', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  st.tasks['2'].status = state.STATUS.DONE;
  state.save(planPath, st);
  assert.deepEqual(
    monitor.snapshot(planPath).lanes[0].tasks[1].activity, [],
    'a done task collapses to a chip nobody opens — sending its tail is weight for no reader',
  );

  st.tasks['2'].status = state.STATUS.BLOCKED;
  state.save(planPath, st);
  assert.ok(monitor.snapshot(planPath).lanes[0].tasks[1].activity.length > 0);
});

test('snapshot hoists a non-allowed rate limit to the top level', () => {
  const { planPath, logFile } = fixture();
  fs.appendFileSync(logFile, ev({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1787211000 } }));
  const snap = monitor.snapshot(planPath);
  assert.equal(snap.rateLimit.status, 'rejected');
});

test('the payload carries no wall-clock value, so equal reads compare equal', () => {
  const { planPath } = fixture();
  const a = JSON.stringify(monitor.snapshot(planPath));
  const b = JSON.stringify(monitor.snapshot(planPath));
  assert.equal(a, b, 'an elapsed-time field here would make every tick look like a change');
});

test('a lane whose every task is done is marked settled', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  assert.equal(monitor.snapshot(planPath).lanes[0].settled, false, 'T2 is still running');

  st.tasks['2'].status = state.STATUS.DONE;
  state.save(planPath, st);
  assert.equal(monitor.snapshot(planPath).lanes[0].settled, true);
});

test('the barrier in flight is named, because during integration it is the only live work', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);

  // Nothing to promote while a barrier is merely waiting its turn.
  assert.equal(monitor.snapshot(planPath).activeBarrier, null);

  st.tasks['2'].status = state.STATUS.DONE;
  st.tasks['3'].status = state.STATUS.RUNNING;
  state.save(planPath, st);
  assert.equal(monitor.snapshot(planPath).activeBarrier, 3);

  st.tasks['3'].status = state.STATUS.FAILED;
  state.save(planPath, st);
  assert.equal(monitor.snapshot(planPath).activeBarrier, 3, 'a barrier that died still deserves the attention');

  st.tasks['3'].status = state.STATUS.DONE;
  state.save(planPath, st);
  assert.equal(monitor.snapshot(planPath).activeBarrier, null);
});

// ---------------------------------------------------------------- feed

/** A second log, older than the fixture's, so a merge has something to merge. */
function withEarlierLog(dir, planPath) {
  const st = state.load(planPath);
  const logFile = path.join(dir, '.plo-logs', 'task-1.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, [
    '\n=== 2026-08-19T11:00:00.000Z :: claude -p … (cwd=/wt/lane-a)\n',
    assistantTool('Read', { file_path: 'src/repo.js' }, 'tu_a', '2026-08-19T11:00:05.000Z'),
    toolResult('tu_a', 'ok', false, '2026-08-19T11:00:06.000Z'),
  ].join(''));
  st.tasks['1'].logFile = logFile;
  state.save(planPath, st);
  return logFile;
}

test('the feed merges every task log into one chronological list', () => {
  const { dir, planPath } = fixture();
  withEarlierLog(dir, planPath);
  const snap = monitor.snapshot(planPath);

  const ats = snap.feed.map((a) => a.at);
  assert.deepEqual([...ats].sort(), ats, 'a run feed out of order is not a run feed');

  const tasks = [...new Set(snap.feed.map((a) => a.n))];
  assert.deepEqual(tasks, [1, 2], 'the settled task is exactly the one a per-card tail cannot show');
  assert.equal(snap.feed[0].lane, 'A', 'each entry names where it came from');

  const read = snap.feed.find((a) => a.name === 'Read');
  assert.equal(read.n, 1);
  assert.equal(read.target, 'src/repo.js');
});

test('a tool entry records when its result came back, so the feed can time it', () => {
  const d = monitor.digestLog(SAMPLE_LOG);
  const bash = d.activity.find((a) => a.name === 'Bash');
  assert.equal(bash.at, '2026-08-19T12:00:20.000Z');
  assert.equal(bash.doneAt, '2026-08-19T12:00:31.000Z', '11 seconds is the fact the feed is for');
});

test('the feed keeps the tail of the run, not its opening', () => {
  const { planPath } = fixture();
  const snap = monitor.snapshot(planPath, { feedLimit: 2 });
  assert.equal(snap.feed.length, 2);
  assert.equal(snap.feed[snap.feed.length - 1].text, 'Fixing the failing assertion.', 'the newest event must survive the cut');
});

test('feedLimit 0 turns the feed off without disturbing the cards', () => {
  const { planPath } = fixture();
  const snap = monitor.snapshot(planPath, { feedLimit: 0 });
  assert.deepEqual(snap.feed, []);
  assert.equal(snap.lanes[0].tasks[1].activity.length > 0, true, 'the running card still has its own tail');
});

test('the merge scaffolding never reaches the payload', () => {
  const { planPath } = fixture();
  const snap = monitor.snapshot(planPath);
  const all = [...snap.lanes.flatMap((l) => l.tasks), ...snap.barriers];
  assert.equal(all.some((t) => 'recent' in t), false, 'a per-task copy of the feed would double the frame');
  assert.equal(JSON.stringify(monitor.snapshot(planPath)), JSON.stringify(snap), 'the feed must not make two equal reads differ');
});

// ---------------------------------------------------------------- stages

const byKey = (planPath) => Object.fromEntries(monitor.snapshot(planPath).stages.map((x) => [x.key, x]));

test('the pipeline is the five stages of a run, in the order they can happen', () => {
  const { planPath } = fixture();
  const s = monitor.snapshot(planPath);

  assert.deepEqual(s.stages.map((x) => x.key), ['run', 'merge', 'barriers', 'suite', 'review']);
  assert.equal(s.stages[0].status, 'running', 'one task done and one running is a run under way');
  assert.equal(s.stages[0].detail, '1/2 tasks');
  assert.equal(s.stages[1].status, 'pending', 'nothing merges while a lane is still working');
});

test('a failure lands on the stage that owns it', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  st.tasks['2'].status = state.STATUS.DONE;
  st.integration = { status: 'barrier-failed', mergedLanes: ['A'], suite: null, review: null };
  state.save(planPath, st);

  const by = byKey(planPath);
  assert.equal(by.run.status, 'done');
  assert.equal(by.merge.status, 'done', 'a barrier only ever runs in a merged tree');
  assert.equal(by.merge.detail, 'lanes A');
  assert.equal(by.barriers.status, 'failed');
  assert.equal(by.suite.status, 'pending', 'the suite never got to run, and must not read as passed');
});

test('a merge that failed leaves every later stage pending', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  st.tasks['2'].status = state.STATUS.DONE;
  st.integration = { status: 'merge-failed', mergedLanes: [], suite: null, review: null };
  state.save(planPath, st);

  const by = byKey(planPath);
  assert.equal(by.merge.status, 'failed');
  assert.equal(by.barriers.status, 'pending');
  assert.equal(by.review.status, 'pending');
});

test('the suite and the review carry their own verdicts', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  st.tasks['2'].status = state.STATUS.DONE;
  st.tasks['3'].status = state.STATUS.DONE;
  st.integration = {
    status: 'review-findings', mergedLanes: ['A'],
    suite: { ok: true }, review: { clean: false, verdict: 'FINDINGS' },
  };
  state.save(planPath, st);

  const by = byKey(planPath);
  assert.equal(by.suite.status, 'done');
  assert.equal(by.suite.detail, 'pass');
  assert.equal(by.review.status, 'failed');
  assert.equal(by.review.detail, 'FINDINGS');
});

test('a suite with no test command failed — it did not pass quietly', () => {
  const stages = monitor.buildStages(
    [{ tasks: [{ status: 'done' }] }], [],
    { status: 'merged', mergedLanes: ['A'], suite: { ok: false, skipped: true }, review: null },
  );
  const suite = stages.find((x) => x.key === 'suite');
  assert.equal(suite.status, 'failed');
  assert.equal(suite.detail, 'no test command');
});

test('a plan with no barrier tasks has four stages, not a fifth that is always done', () => {
  const stages = monitor.buildStages([{ tasks: [{ status: 'pending' }] }], [], { status: 'pending' });
  assert.deepEqual(stages.map((x) => x.key), ['run', 'merge', 'suite', 'review']);
  assert.equal(stages[0].status, 'pending', 'a run where nothing started has not started');
});

// ---------------------------------------------------------------- tokens

test('a token count comes from what the agent reported, never from a running sum', () => {
  const { planPath, logFile } = fixture();

  // The sample log accumulates 52 output tokens across its assistant
  // messages and never closes with a result event — exactly the shape of a
  // task that died mid-stream. A digest reads a tail, so that sum is a
  // fraction of a log that can be tens of megabytes.
  assert.equal(monitor.digestLog(SAMPLE_LOG).outputTokens, 52);
  assert.equal(monitor.digestLog(SAMPLE_LOG).reportedTokens, null);
  assert.equal(monitor.snapshot(planPath).lanes[0].tasks[1].outputTokens, null, 'a fraction is worse than nothing');

  fs.appendFileSync(logFile, ev({
    type: 'result', subtype: 'success', total_cost_usd: 1.25,
    usage: { output_tokens: 12864, input_tokens: 60, cache_read_input_tokens: 2219083 },
  }));
  assert.equal(monitor.snapshot(planPath).lanes[0].tasks[1].outputTokens, 12864, 'the spawn reports its own total');
});

test('the checkpoint outranks the log, and the totals add up the run', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  // What `run.js` writes: summed across attempts, so a retried task counts
  // every spawn it took.
  st.tasks['1'].outputTokens = 40000;
  st.tasks['2'].outputTokens = 17760;
  state.save(planPath, st);

  const s = monitor.snapshot(planPath);
  assert.equal(s.lanes[0].tasks[0].outputTokens, 40000);
  assert.equal(s.lanes[0].tasks[1].outputTokens, 17760, 'the checkpoint wins over anything read from the log');
  assert.equal(s.totals.outputTokens, 57760);
  assert.equal(s.barriers[0].outputTokens, null, 'a task that never ran reported nothing');
});

// -------------------------------------------------------------- timeline

// The fixture's clock: T1 ran 11:00–11:20, T2 started at 12:00, T3 never did.
const OFFSET_T2 = 3600;

test('the timeline is one axis, and every block is an offset from the first start', () => {
  const { planPath } = fixture();
  const tl = monitor.snapshot(planPath).timeline;

  assert.equal(tl.origin, '2026-08-19T11:00:00.000Z', 'the run starts when its first task does');
  assert.deepEqual(tl.rows.map((r) => r.label), ['A', 'Barriers']);
  assert.deepEqual(tl.rows[0].blocks.map((b) => [b.n, b.from, b.to]), [[1, 0, 1200], [2, OFFSET_T2, null]]);
});

test('while a task is running the axis has no end — and two reads stay identical', () => {
  const { planPath } = fixture();
  const snap = monitor.snapshot(planPath);

  assert.equal(snap.timeline.live, true);
  assert.equal(snap.timeline.span, null, 'sending `now` here would push a frame every second');
  assert.equal(
    JSON.stringify(monitor.snapshot(planPath).timeline),
    JSON.stringify(snap.timeline),
    'the timeline must not make two equal reads differ',
  );
});

test('a settled run measures its own span, from first start to last end', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  st.tasks['2'] = { ...st.tasks['2'], status: state.STATUS.DONE, endedAt: '2026-08-19T12:30:00.000Z' };
  st.tasks['3'] = {
    ...st.tasks['3'], status: state.STATUS.DONE,
    startedAt: '2026-08-19T12:40:00.000Z', endedAt: '2026-08-19T13:00:00.000Z',
  };
  state.save(planPath, st);

  const tl = monitor.snapshot(planPath).timeline;
  assert.equal(tl.live, false);
  assert.equal(tl.span, 7200, 'two hours from 11:00 to 13:00');
  assert.deepEqual(tl.rows[1].blocks.map((b) => [b.n, b.from, b.to]), [[3, 6000, 7200]]);
  assert.deepEqual(tl.rows[1].queued, []);
});

test('a task that never started waits beside the axis, not on it', () => {
  const { planPath } = fixture();
  const tl = monitor.snapshot(planPath).timeline;

  assert.deepEqual(tl.rows[1].blocks, [], 'no start time is not a zero-length bar at the origin');
  assert.deepEqual(tl.rows[1].queued.map((q) => q.n), [3]);
});

test('a task that stopped without recording an end closes at its last activity', () => {
  const { planPath } = fixture();
  const st = state.load(planPath);
  st.tasks['2'] = { ...st.tasks['2'], status: state.STATUS.INTERRUPTED };
  state.save(planPath, st);

  const tl = monitor.snapshot(planPath).timeline;
  const t2 = tl.rows[0].blocks.find((b) => b.n === 2);
  assert.equal(tl.live, false, 'an interrupted task is not running');
  // The log's last event is 12:00:40 — forty seconds after the task started.
  assert.equal(t2.to, OFFSET_T2 + 40);
  assert.equal(tl.span, OFFSET_T2 + 40, 'and that is where the axis ends');
});

test('a run where nothing has started has no clock to draw', () => {
  const tl = monitor.buildTimeline([{ id: 'A', label: 'A', tasks: [{ n: 1, status: 'pending' }] }], []);
  assert.equal(tl, null);
});

// ---------------------------------------------------------------- detail

test('taskDetail returns full history for a finished task', () => {
  const { planPath } = fixture();
  const detail = monitor.taskDetail(planPath, 2);
  assert.equal(detail.n, 2);
  assert.equal(detail.title, 'POST /v1/requests');
  assert.ok(detail.activity.length >= 3);
  assert.deepEqual(detail.files.writes, ['src/routes/requests.js', 'tests/requests.test.js']);
  assert.equal(detail.model, 'claude-opus-5');
});

test('taskDetail returns null for a task that is not in the plan', () => {
  const { planPath } = fixture();
  assert.equal(monitor.taskDetail(planPath, 99), null);
});
