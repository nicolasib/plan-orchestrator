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
  assert.deepEqual(snap.lanes[0].tasks[1].activity, [], 'a settled task still shows no live feed');
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
