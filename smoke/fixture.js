'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { spawnSync } = require('child_process');
const state = require('../src/state');
const { parsePlan } = require('../src/parse-plan');
const { processStamp } = require('../src/proc');
const { createServer, listen } = require('../src/serve');

/**
 * Seven fake runs for the smoke gate to drive the dashboard against.
 *
 * Every number here is one an assertion checks, so nothing is random and
 * nothing reads the real clock except through `now`. Each scenario is a plan
 * plus the checkpoint and logs a real `plo` would have written at that moment,
 * read by the real monitor through the real server: the page under test never
 * knows it is looking at a fixture.
 *
 * `repoRoot` is the repository root in every state, so the commands the page
 * builds read `plo <verb> --plan smoke/.artifacts/fixtures/<name>/plan.md`.
 *
 *   node smoke/fixture.js up   — write every scenario and serve each on its port
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(__dirname, '.artifacts', 'fixtures');
const HOST = '127.0.0.1';

// Printed in this order on the READY line.
const PORTS = { mid: 7411, suite: 7412, review: 7413, barrier: 7414, empty: 7415, drop: 7416, idle: 7417 };

const SEC = 1000;
const MIN = 60 * SEC;
const SUITE_LINE_MS = 700;
// `mid` and `review` are rewritten on this clock so "20 s ago" stays true for
// as long as the gate runs, instead of only for the first 20 seconds.
const REWRITE_MS = 30 * SEC;
const DROP_MS = 8 * SEC;
const SUITE_CASES = 6;

const MODEL = 'claude-opus-5';
const SUB_MODEL = 'claude-sonnet-5';
const BASE = { branch: 'feature/fixture', commit: 'abc1234' };
const TEST_COMMAND = 'npm test';

const TASKS = [
  { n: 1, title: 'Core types', lane: 'A', effort: 'medium' },
  { n: 2, title: 'Panel shell', lane: 'A', effort: 'high', steps: ['Write the failing test', 'Implement the shell', 'Commit'] },
  { n: 3, title: 'Panel wiring', lane: 'A', effort: 'medium' },
  { n: 4, title: 'Data layer', lane: 'B', effort: 'xhigh' },
  { n: 5, title: 'Counts per team', lane: 'B', effort: 'medium' },
  { n: 6, title: 'Icons', lane: 'C', effort: 'high' },
  { n: 7, title: 'Team page', lane: 'D', effort: 'high' },
  { n: 8, title: 'Docs and PR prep', lane: null, effort: 'medium' },
];
const TASK = Object.fromEntries(TASKS.map((t) => [t.n, t]));

const PLAN = [
  '# Operator fixture',
  '',
  'A fake plan for the smoke gate. Nothing in it is ever run.',
  '',
  '## Global Constraints',
  '',
  `- Branch \`${BASE.branch}\`, test command \`${TEST_COMMAND}\`.`,
  '',
  ...TASKS.flatMap((t) => [
    `### Task ${t.n}: ${t.title}`,
    '',
    `**Effort:** ${t.effort} — fixture`,
    '',
    ...(t.steps || [`Build ${t.title.toLowerCase()}`]).map((s, i) => `- [ ] **Step ${i + 1}: ${s}**`),
    '',
  ]),
].join('\n');

const PARSED = parsePlan(PLAN);
const weightOf = (n) => PARSED.tasks.find((t) => t.n === n).weight;
const LANES = ['A', 'B', 'C', 'D'].map((id) => {
  const tasks = TASKS.filter((t) => t.lane === id).map((t) => t.n);
  return { id, tasks, weight: tasks.reduce((s, n) => s + weightOf(n), 0) };
});
const BARRIERS = [8];
const EDGES = [[1, 2], [2, 3], [4, 3], [4, 5], ...[1, 2, 3, 4, 5, 6, 7].map((n) => [n, 8])]
  .map(([from, to]) => ({ from, to }));

// What T5 died of, exactly. The markup is the point: the page must show it
// as text, never parse it.
const T5_ERROR = 'Expected 4 teams, got 3.\n\n<img src=x onerror="window.__xss=1">\n\n    AssertionError: counts per team';

// Cost and output tokens of a finished task, the same in every scenario.
const COST = { 1: 0.80, 2: 1.40, 3: 0.70, 4: 3.10, 5: 2.30, 6: 0.90, 7: 1.10, 8: 0.40 };
const TOKENS = { 1: 21000, 2: 38000, 3: 15000, 4: 64000, 5: 52000, 6: 19000, 7: 27000, 8: 9000 };
// [started, ended] in minutes before `now`, for a run whose lanes are all done.
const DONE_SPANS = { 1: [40, 31], 2: [30, 18], 3: [17, 6], 4: [40, 30], 5: [29, 12], 6: [40, 25], 7: [40, 22] };

const sha = (n) => `${n}${n}a5c0d`;
const laneSlug = (id) => String(id).toLowerCase();
const worktreeOf = (laneId) => (laneId
  ? path.join(path.dirname(REPO_ROOT), '.plo-worktrees', `plan-lane-${laneSlug(laneId)}`)
  : REPO_ROOT);

/** The ISO instant of an epoch-ms time. */
const iso = (ms) => new Date(ms).toISOString();

/**
 * An open stage's start: its nominal time, or the live stamp's when that is
 * later. The monitor reads an open stage that started before the integrate
 * that owns it as a leftover of an earlier one, and the live owner here is
 * this process, which started seconds ago.
 */
function openedAt(nominalMs, live) {
  const liveMs = Date.parse(live && live.startedAt);
  return iso(Number.isFinite(liveMs) ? Math.max(nominalMs, liveMs) : nominalMs);
}

/** A pid that existed and no longer does: a child that ran and exited. */
function deadStamp(now) {
  const { pid } = spawnSync(process.execPath, ['-e', '']);
  return { pid, startedAt: iso(Math.floor((now - 45 * MIN) / SEC) * SEC) };
}

/** tmp + rename: the server polls these files every second and must never
 *  read one half-written. */
function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// --- stream-json lines, in the shape src/spawn.js writes and digestLog reads ---

const line = (o) => `${JSON.stringify(o)}\n`;
const header = (ms, laneId) => `\n=== ${iso(ms)} :: claude -p … (cwd=${worktreeOf(laneId)})\n`;
const init = (sessionId, model = MODEL) => line({ type: 'system', subtype: 'init', session_id: sessionId, model });
const parentOf = (parent) => (parent ? { parent_tool_use_id: parent } : {});

function say(ms, text, { parent = null, model = parent ? SUB_MODEL : MODEL } = {}) {
  return line({
    type: 'assistant', timestamp: iso(ms), ...parentOf(parent),
    message: { model, role: 'assistant', content: [{ type: 'text', text }], usage: { output_tokens: 120 } },
  });
}

function call(ms, id, name, input, { parent = null, model = parent ? SUB_MODEL : MODEL } = {}) {
  return line({
    type: 'assistant', timestamp: iso(ms), ...parentOf(parent),
    message: { model, role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage: { output_tokens: 60 } },
  });
}

function reply(ms, id, content, { isError = false, parent = null } = {}) {
  return line({
    type: 'user', timestamp: iso(ms), ...parentOf(parent),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  });
}

/** A spawn's closing event. It carries no timestamp, as the real one does not. */
function finish({ sessionId, text, costUsd, outputTokens, turns = 12, error = false }) {
  return line({
    type: 'result', subtype: error ? 'error_during_execution' : 'success', is_error: error,
    num_turns: turns, duration_ms: 420000, result: text, session_id: sessionId,
    total_cost_usd: costUsd, usage: { output_tokens: outputTokens },
  });
}

const PANEL_TEST_OUTPUT = [
  '> operator-fixture@0.0.0 test',
  '> node --test "test/**/*.test.js" panel',
  '',
  '✔ panel renders the shell (4ms)',
  '✔ panel keeps its tabs (2ms)',
  '✔ panel restores the last tab (3ms)',
  '',
  'Test Files 3 passed',
  'Tests 12 passed',
].join('\n');

const COUNTS_TEST_OUTPUT = [
  '> operator-fixture@0.0.0 test',
  '> node --test "test/**/*.test.js" counts',
  '',
  '✖ counts per team (6ms)',
  '  Expected 4 teams, got 3.',
  '',
  'Tests 1 failed | 11 passed',
].join('\n');

const caseLine = (k) => `\x1b[32m✓\x1b[39m test/case-${k}.test.js (3 tests) 12ms\n`;

/** The suite's log as `fullSuite` starts it, plus what a runner prints first. */
function suiteLog(startedAt, { finished = false } = {}) {
  let text = `# ${startedAt} $ ${TEST_COMMAND}\n`;
  for (let k = 1; k <= SUITE_CASES; k += 1) text += caseLine(k);
  text += 'progress 10%\rprogress 100%\n';
  if (finished) text += '\nTest Files  24 passed (24)\n     Tests  72 passed (72)\n';
  return text;
}

// --- states ---

/** The checkpoint `plo init` writes for the fixture plan, lanes already placed. */
function baseState(planPath, now, { oldForm = false } = {}) {
  const st = state.create({
    planPath,
    planContents: PLAN,
    repoRoot: REPO_ROOT,
    baseBranch: BASE.branch,
    baseCommit: BASE.commit,
    maxLanes: 4,
    lanes: LANES,
    barriers: BARRIERS,
    testCommand: TEST_COMMAND,
  });
  st.createdAt = iso(now - 45 * MIN);
  for (const lane of st.lanes) {
    lane.branch = `${BASE.branch}-lane-${laneSlug(lane.id)}`;
    lane.worktree = worktreeOf(lane.id);
  }
  if (oldForm) {
    // A checkpoint from a plo that predates stages, pids, effort and the graph.
    delete st.integration.stages;
  } else {
    st.edges = EDGES.map((e) => ({ ...e }));
    st.usage5h = { utilization: 0.84, resetsAt: Math.floor(now / SEC) + 2 * 60 * 60, at: iso(now) };
  }
  return st;
}

/** One finished attempt of task `n`, record and log both. */
function finishTask(st, n, ctx, { from, to, logFile, oldForm = false }) {
  const t = TASK[n];
  const sessionId = `sess-t${n}`;
  put(logFile, [
    header(from, t.lane),
    init(sessionId),
    say(from + 20 * SEC, `Implementing Task ${n}: ${t.title}.`),
    say(to - 5 * SEC, 'Tests pass and the work is committed.'),
    finish({ sessionId, text: 'STATUS: DONE', costUsd: COST[n], outputTokens: TOKENS[n] }),
  ].join(''));
  Object.assign(st.tasks[n], {
    status: state.STATUS.DONE,
    attempts: 1,
    commits: [sha(n)],
    sessionId,
    startedAt: iso(from),
    endedAt: iso(to),
    logFile,
    turns: 12,
    costUsd: COST[n],
    outputTokens: TOKENS[n],
  });
  if (!oldForm) {
    Object.assign(st.tasks[n], {
      effort: t.effort,
      raises: 0,
      pid: ctx.dead.pid,
      pidStartedAt: ctx.dead.startedAt,
      tries: [{ effort: t.effort, status: state.STATUS.DONE, at: iso(to) }],
    });
  }
}

/** A task the live process is working on right now. */
function runTask(st, n, ctx, { from, logFile, lines }) {
  put(logFile, [header(from, TASK[n].lane), init(`sess-t${n}`), ...lines].join(''));
  Object.assign(st.tasks[n], {
    status: state.STATUS.RUNNING,
    attempts: 1,
    sessionId: `sess-t${n}`,
    startedAt: iso(from),
    logFile,
    baseBefore: BASE.commit,
    effort: TASK[n].effort,
    raises: 0,
    pid: ctx.live.pid,
    pidStartedAt: ctx.live.startedAt,
    costUsd: null,
    outputTokens: null,
    tries: [],
  });
}

/** Every lane task done the same way, for the scenarios past the run. */
function finishLanes(st, s, ctx, opts = {}) {
  for (const [n, [from, to]] of Object.entries(DONE_SPANS)) {
    finishTask(st, Number(n), ctx, { from: ctx.now - from * MIN, to: ctx.now - to * MIN, logFile: s.log(`task-${n}.jsonl`), ...opts });
  }
}

/** The scenario's folder with its plan written; logs go under `.plo-logs/`. */
function prepare(dir, name) {
  const base = path.join(dir, name);
  const planPath = path.join(base, 'plan.md');
  put(planPath, PLAN);
  return { planPath, log: (file) => path.join(base, '.plo-logs', file) };
}

// --- the scenarios ---

/** The run halfway: two done, three live, one failed three times, two waiting. */
function writeMid(dir, ctx) {
  const { now } = ctx;
  const s = prepare(dir, 'mid');
  const st = baseState(s.planPath, now);

  finishTask(st, 1, ctx, { from: now - 26 * MIN, to: now - 15 * MIN, logFile: s.log('task-1.jsonl') });
  finishTask(st, 4, ctx, { from: now - 26 * MIN, to: now - 16 * MIN, logFile: s.log('task-4.jsonl') });

  // T2: its implementer ran the panel tests 40 s ago, and they passed.
  const t2 = now - 14 * MIN - 30 * SEC;
  runTask(st, 2, ctx, {
    from: t2,
    logFile: s.log('task-2.jsonl'),
    lines: [
      say(t2 + 15 * SEC, 'Reading the brief for Task 2 and dispatching the implementer.'),
      call(t2 + 40 * SEC, 'tu_impl', 'Agent', {
        description: 'Implement Task 2: Panel shell', subagent_type: 'implementer', prompt: 'Implement Task 2 of the plan.',
      }),
      call(now - 6 * MIN, 'tu_impl_w', 'Write', { file_path: path.join(worktreeOf('A'), 'src', 'panel.js') }, { parent: 'tu_impl' }),
      reply(now - 6 * MIN + SEC, 'tu_impl_w', 'File created successfully', { parent: 'tu_impl' }),
      call(now - 40 * SEC, 'tu_impl_test', 'Bash', { command: 'npm test -- panel', description: 'Run the panel tests' }, { parent: 'tu_impl' }),
      reply(now - 31 * SEC, 'tu_impl_test', PANEL_TEST_OUTPUT, { parent: 'tu_impl' }),
      say(now - 20 * SEC, 'The panel tests pass. Committing the shell.', { parent: 'tu_impl' }),
    ],
  });

  // T5: three attempts, one level higher each time, every one failed.
  const attempts = [
    { effort: 'medium', from: now - 15 * MIN - 30 * SEC, to: now - 10 * MIN - 5 * SEC, costUsd: 0.70 },
    { effort: 'high', from: now - 10 * MIN, to: now - 5 * MIN - 35 * SEC, costUsd: 0.75 },
    { effort: 'xhigh', from: now - 5 * MIN - 30 * SEC, to: now - 2 * MIN, costUsd: 0.85 },
  ];
  const t5Log = s.log('task-5.jsonl');
  put(t5Log, attempts.map((a, i) => [
    header(a.from, 'B'),
    init(`sess-t5-${i + 1}`),
    call(a.from + 3 * MIN, `tu_t5_test${i + 1}`, 'Bash', { command: 'npm test -- counts', description: 'Run the counts tests' }),
    reply(a.from + 3 * MIN + 9 * SEC, `tu_t5_test${i + 1}`, COUNTS_TEST_OUTPUT, { isError: true }),
    finish({ sessionId: `sess-t5-${i + 1}`, text: 'Counts per team still fails: expected 4 teams, got 3.', costUsd: a.costUsd, outputTokens: 17000 }),
  ].join('')).join(''));
  Object.assign(st.tasks[5], {
    status: state.STATUS.FAILED,
    attempts: 3,
    raises: 2,
    effort: 'xhigh',
    tries: attempts.map((a) => ({ effort: a.effort, status: state.STATUS.FAILED, at: iso(a.to) })),
    sessionId: 'sess-t5-3',
    startedAt: iso(attempts[2].from),
    endedAt: iso(attempts[2].to),
    logFile: t5Log,
    baseBefore: BASE.commit,
    pid: ctx.dead.pid,
    pidStartedAt: ctx.dead.startedAt,
    turns: 14,
    costUsd: COST[5],
    outputTokens: TOKENS[5],
    error: T5_ERROR,
  });

  // T6: alive, silent for 8 minutes inside one call.
  const t6 = now - 26 * MIN;
  runTask(st, 6, ctx, {
    from: t6,
    logFile: s.log('task-6.jsonl'),
    lines: [
      say(t6 + 20 * SEC, 'Optimising the icon set.'),
      call(t6 + 2 * MIN, 'tu_t6_read', 'Read', { file_path: path.join(worktreeOf('C'), 'icons', 'index.js') }),
      reply(t6 + 2 * MIN + SEC, 'tu_t6_read', 'export const icons = {};'),
      call(now - 8 * MIN, 'tu_t6_svgo', 'Bash', { command: 'npx svgo --folder icons', description: 'Optimise the icons' }),
    ],
  });

  // T7: alive, silent for 20 minutes.
  const t7 = now - 26 * MIN;
  runTask(st, 7, ctx, {
    from: t7,
    logFile: s.log('task-7.jsonl'),
    lines: [
      say(t7 + 30 * SEC, 'Starting the team page.'),
      call(now - 20 * MIN, 'tu_t7_dev', 'Bash', { command: 'npm run dev', description: 'Start the dev server' }),
    ],
  });

  state.save(s.planPath, st);
  return s.planPath;
}

/** Every task done, merged, and the full suite running with its log growing. */
function writeSuite(dir, ctx) {
  const { now, live } = ctx;
  const s = prepare(dir, 'suite');
  const st = baseState(s.planPath, now);
  finishLanes(st, s, ctx);
  finishTask(st, 8, ctx, { from: now - 3 * MIN - 25 * SEC, to: now - 3 * MIN - 5 * SEC, logFile: s.log('task-8.jsonl') });

  const startedAt = openedAt(now - 3 * MIN, live);
  const logFile = s.log('full-suite.log');
  put(logFile, suiteLog(startedAt));
  Object.assign(st.integration, {
    status: 'suite-running',
    mergedLanes: ['A', 'B', 'C', 'D'],
    pid: live.pid,
    pidStartedAt: live.startedAt,
    stages: {
      merge: { startedAt: iso(now - 4 * MIN), endedAt: iso(now - 3 * MIN - 30 * SEC) },
      suite: { startedAt, logFile, command: TEST_COMMAND, pid: live.pid, pidStartedAt: live.startedAt },
    },
  });
  state.save(s.planPath, st);
  return s.planPath;
}

/** The suite passed; the cross-lane reviewer is running a subagent of its own. */
function writeReview(dir, ctx) {
  const { now, live, dead } = ctx;
  const s = prepare(dir, 'review');
  const st = baseState(s.planPath, now);
  finishLanes(st, s, ctx);
  finishTask(st, 8, ctx, { from: now - 3 * MIN - 25 * SEC, to: now - 3 * MIN - 5 * SEC, logFile: s.log('task-8.jsonl') });

  const suiteFile = s.log('full-suite.log');
  const suiteText = suiteLog(iso(now - 3 * MIN), { finished: true });
  put(suiteFile, suiteText);

  // The review's events never predate the review: on a fresh start its clock
  // is the live stamp's, seconds ago, and they bunch up at that instant.
  const startedAt = openedAt(now - 2 * MIN, live);
  const startMs = Date.parse(startedAt);
  const ago = (ms) => Math.max(startMs, now - ms);
  const reviewFile = s.log('cross-lane-review.jsonl');
  put(reviewFile, [
    header(startMs, null),
    init('sess-review'),
    say(ago(100 * SEC), 'Reading the cross-lane review package.'),
    call(ago(95 * SEC), 'tu_pkg', 'Read', { file_path: s.log('cross-lane-review-package.md') }),
    reply(ago(94 * SEC), 'tu_pkg', '# Cross-lane review package'),
    call(ago(80 * SEC), 'tu_rv', 'Agent', {
      description: 'Hunt orphaned imports across lanes', subagent_type: 'code-reviewer', prompt: 'Review the combined diff.',
    }),
    call(ago(60 * SEC), 'tu_rv_grep', 'Grep', { pattern: 'require\\(', path: path.join(REPO_ROOT, 'src') }, { parent: 'tu_rv' }),
    reply(ago(58 * SEC), 'tu_rv_grep', 'src/panel.js:3: require(\'./data\')', { parent: 'tu_rv' }),
    say(ago(12 * SEC), 'Checking src/panel.js against the data layer.', { parent: 'tu_rv' }),
  ].join(''));

  Object.assign(st.integration, {
    status: 'reviewing',
    mergedLanes: ['A', 'B', 'C', 'D'],
    pid: live.pid,
    pidStartedAt: live.startedAt,
    suite: { ok: true, code: 0, summary: suiteText.split('\n').slice(-40).join('\n'), command: TEST_COMMAND },
    stages: {
      merge: { startedAt: iso(now - 4 * MIN), endedAt: iso(now - 3 * MIN - 30 * SEC) },
      suite: {
        startedAt: iso(now - 3 * MIN), endedAt: iso(now - 2 * MIN), logFile: suiteFile, command: TEST_COMMAND,
        pid: dead.pid, pidStartedAt: dead.startedAt,
      },
      review: { startedAt, logFile: reviewFile, sessionId: 'sess-review' },
    },
  });
  state.save(s.planPath, st);
  return s.planPath;
}

/** The barrier failed with a subagent still out, and its integrate is gone. */
function writeBarrier(dir, ctx) {
  const { now, dead } = ctx;
  const s = prepare(dir, 'barrier');
  const st = baseState(s.planPath, now);
  finishLanes(st, s, ctx);

  const from = now - 3 * MIN - 25 * SEC;
  const to = now - MIN;
  const logFile = s.log('task-8.jsonl');
  put(logFile, [
    header(from, null),
    init('sess-t8'),
    say(from + 15 * SEC, 'Writing the docs for the merged branch.'),
    call(from + 25 * SEC, 'tu_orph', 'Agent', {
      description: 'Write the docs and the PR description', subagent_type: 'implementer', prompt: 'Do Task 8 of the plan.',
    }),
    call(from + 70 * SEC, 'tu_orph_read', 'Read', { file_path: path.join(REPO_ROOT, 'README.md') }, { parent: 'tu_orph' }),
    reply(from + 71 * SEC, 'tu_orph_read', '# plan-orchestrator', { parent: 'tu_orph' }),
    say(from + 2 * MIN, 'Drafting the PR description.', { parent: 'tu_orph' }),
    finish({ sessionId: 'sess-t8', text: 'The agent stopped before its subagent returned.', costUsd: COST[8], outputTokens: TOKENS[8], error: true }),
  ].join(''));
  Object.assign(st.tasks[8], {
    status: state.STATUS.FAILED,
    attempts: 1,
    raises: 1,
    effort: TASK[8].effort,
    tries: [{ effort: TASK[8].effort, status: state.STATUS.FAILED, at: iso(to) }],
    sessionId: 'sess-t8',
    startedAt: iso(from),
    endedAt: iso(to),
    logFile,
    baseBefore: BASE.commit,
    pid: dead.pid,
    pidStartedAt: dead.startedAt,
    turns: 9,
    costUsd: COST[8],
    outputTokens: TOKENS[8],
    error: 'agent error (error_during_execution): The agent stopped before its subagent returned.',
  });

  Object.assign(st.integration, {
    status: 'barrier-failed',
    mergedLanes: ['A', 'B', 'C', 'D'],
    pid: dead.pid,
    pidStartedAt: dead.startedAt,
    stages: { merge: { startedAt: iso(now - 4 * MIN), endedAt: iso(now - 3 * MIN - 30 * SEC) } },
  });
  state.save(s.planPath, st);
  return s.planPath;
}

/** The plan alone: nothing has been analysed yet. */
function writeEmpty(dir) {
  return prepare(dir, 'empty').planPath;
}

/** A checkpoint from an older plo, lanes done and integration never started. */
function writeIdle(dir, ctx) {
  const s = prepare(dir, 'idle');
  const st = baseState(s.planPath, ctx.now, { oldForm: true });
  finishLanes(st, s, ctx, { oldForm: true });
  state.save(s.planPath, st);
  return s.planPath;
}

const WRITERS = { mid: writeMid, suite: writeSuite, review: writeReview, barrier: writeBarrier, empty: writeEmpty, idle: writeIdle };

/**
 * Write the scenarios under `dir`, one folder each, and return their plan
 * paths by name. `live` is the stamp of the process that serves them (its
 * running tasks and open stages read as alive); `dead` defaults to a child
 * that has already exited. `only` rewrites a subset in place.
 */
function writeScenarios(dir, { now, live, dead = deadStamp(now), only = Object.keys(WRITERS) } = {}) {
  const ctx = { now, live, dead };
  const plans = {};
  for (const name of only) plans[name] = WRITERS[name](dir, ctx);
  return plans;
}

/**
 * A pass-through to `target` that can pull the plug. `GET /__fixture/drop`
 * destroys every open connection — the dashboard's stream included — and for
 * the next 8 s destroys each new one on arrival, so the page has to notice it
 * lost the stream and come back on its own.
 */
function dropProxy(target) {
  const sockets = new Set();
  let dropUntil = 0;
  const dropping = () => Date.now() < dropUntil;

  const proxy = http.createServer((req, res) => {
    // A kept-alive socket can carry a new request into the window.
    if (dropping()) { req.socket.destroy(); return; }

    let pathname = null;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch { /* not ours to judge: forwarded as it came */ }

    if (req.method === 'GET' && pathname === '/__fixture/drop') {
      dropUntil = Date.now() + DROP_MS;
      let dropped = 0;
      for (const sock of sockets) {
        if (sock !== req.socket) { sock.destroy(); dropped += 1; }
      }
      const body = JSON.stringify({ dropped, until: iso(dropUntil) });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      res.end(body);
      return;
    }

    // No pooled agent: each request gets its own upstream connection, which
    // dies with the client's.
    const upstream = http.request({
      host: HOST, port: target, method: req.method, path: req.url, agent: false,
      headers: { ...req.headers, host: `${HOST}:${target}` },
    }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (e) => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `upstream ${target}: ${e.message}` }));
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });

  proxy.on('connection', (sock) => {
    if (dropping()) { sock.destroy(); return; }
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });

  const shutdown = () => new Promise((resolve) => {
    for (const sock of sockets) sock.destroy();
    proxy.close(() => resolve());
  });
  return { proxy, shutdown };
}

/**
 * Bind every port first, write second. A port already taken is an error, not
 * a reason to step to the next one: the gate's specs name these ports. And a
 * second `up` that fails to bind must leave the first one's files alone.
 */
async function up() {
  const plans = Object.fromEntries(Object.keys(WRITERS).map((name) => [name, path.join(ARTIFACTS, name, 'plan.md')]));
  const stops = [];
  const stopAll = () => Promise.all(stops.map((stop) => stop()));

  try {
    for (const name of Object.keys(WRITERS)) {
      const server = createServer({ planPath: plans[name] });
      await listen(server, { port: PORTS[name], host: HOST, attempts: 1 });
      stops.push(() => server.plo.shutdown());
    }
    const { proxy, shutdown } = dropProxy(PORTS.mid);
    await listen(proxy, { port: PORTS.drop, host: HOST, attempts: 1 });
    stops.push(shutdown);
  } catch (e) {
    console.error(`fixture: cannot bind (${e.message})`);
    await stopAll();
    process.exitCode = 1;
    return;
  }

  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  const live = processStamp();
  const dead = deadStamp(Date.now());
  writeScenarios(ARTIFACTS, { now: Date.now(), live, dead });

  const suiteFile = path.join(ARTIFACTS, 'suite', '.plo-logs', 'full-suite.log');
  let k = SUITE_CASES;
  const grow = setInterval(() => {
    k += 1;
    fs.appendFileSync(suiteFile, caseLine(k));
  }, SUITE_LINE_MS);
  const rewrite = setInterval(() => {
    try {
      writeScenarios(ARTIFACTS, { now: Date.now(), live, dead, only: ['mid', 'review'] });
    } catch (e) {
      console.error(`fixture: rewrite failed (${e.message})`);
    }
  }, REWRITE_MS);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(grow);
    clearInterval(rewrite);
    stopAll().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  console.log(`READY ${Object.keys(PORTS).map((name) => `${name}=http://${HOST}:${PORTS[name]}`).join(' ')}`);
}

if (require.main === module && process.argv[2] === 'up') up();

module.exports = { writeScenarios };
