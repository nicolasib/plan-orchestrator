'use strict';

const fs = require('fs');
const path = require('path');
const state = require('./state');
const { parsePlan } = require('./parse-plan');

/**
 * A read-only view of a run, assembled from the two things the CLI already
 * writes to disk: the checkpoint file and the per-task stream-json logs.
 *
 * Nothing here writes, spawns, or holds a lock. It runs in a separate process
 * from `plo run` and must stay harmless if it reads a file mid-write — the
 * checkpoint is written atomically, and a half-written log line is dropped
 * rather than reported as corruption.
 *
 * Two granularities exist and they are not interchangeable:
 *
 *  - the checkpoint moves only at task boundaries. On its own it can say
 *    "T3 running since 12 minutes ago" and nothing else.
 *  - the log moves on every agent event. That is the only place the current
 *    turn, the tool in flight, and a usage-limit signal exist.
 *
 * A monitor that reads only the first is a progress bar with no progress.
 */

/** Read the log's tail, not the log. A long task writes tens of MB. */
const TAIL_BYTES = 512 * 1024;
const ACTIVITY_LIMIT = 40;
/** How much of the run the merged feed keeps. Long enough to scroll back
 *  through the last few minutes, short enough to ship every second. */
const FEED_LIMIT = 60;
const TEXT_MAX = 400;
/** The panel's copy of an agent's report. `TEXT_MAX` is a feed line's budget;
 *  a report is a document and gets a document's. */
const REPORT_MAX = 8000;

function tailFile(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null; // no log yet: the task has not started, which is not an error
  }
  try {
    const stat = fs.fstatSync(fd);
    const start = Math.max(0, stat.size - bytes);
    const len = stat.size - start;
    const buf = Buffer.alloc(len);
    if (len) fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    // Reading from an offset almost always lands mid-line. That leading
    // fragment is not JSON and must be dropped, not parsed.
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return { text, size: stat.size, mtime: stat.mtimeMs, truncated: start > 0 };
  } finally {
    fs.closeSync(fd);
  }
}

const oneLine = (s, max = 120) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);

/** Last two path segments — enough to identify the file, short enough to fit. */
function shortPath(p) {
  const parts = String(p).split('/').filter(Boolean);
  return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`;
}

/**
 * What a tool call is actually pointed at. Generic key-guessing produces
 * "true" and "[object Object]" often enough to be worth naming the common
 * tools explicitly, with the guess kept only as a fallback.
 */
function toolTarget(name, input) {
  if (!input || typeof input !== 'object') return '';
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit':
      return input.file_path ? shortPath(input.file_path) : '';
    case 'Bash': case 'BashOutput':
      return oneLine(input.command || input.description || '', 100);
    case 'Grep':
      return oneLine([input.pattern, input.path && shortPath(input.path)].filter(Boolean).join(' in '), 100);
    case 'Glob':
      return oneLine(input.pattern || '', 100);
    case 'Task': case 'Agent':
      return oneLine(input.description || input.subagent_type || '', 100);
    case 'Skill':
      return oneLine(input.skill || '', 60);
    case 'WebFetch': case 'WebSearch':
      return oneLine(input.url || input.query || '', 100);
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} items` : '';
    default: {
      for (const k of ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description', 'prompt', 'name']) {
        if (typeof input[k] === 'string' && input[k]) return oneLine(input[k], 100);
      }
      return '';
    }
  }
}

/** tool_result content arrives as a string or as content blocks. */
function resultPreview(content) {
  if (typeof content === 'string') return oneLine(content, 140);
  if (Array.isArray(content)) {
    const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
    return oneLine(text, 140);
  }
  return '';
}

function emptyDigest() {
  return {
    sessionId: null,
    model: null,
    turns: 0,
    attempts: 0,
    toolCount: 0,
    outputTokens: 0,
    /** Only ever set from a result event: the spawn's own total, not a sum
     *  over whatever messages happened to fall inside the tail. */
    reportedTokens: null,
    costUsd: null,
    rateLimit: null,
    result: null,
    lastText: null,
    lastActivityAt: null,
    activity: [],
    truncated: false,
  };
}

/**
 * Fold a stream-json log into the few facts a dashboard shows.
 *
 * Unknown event types are ignored rather than thrown on: the agent's event
 * schema gains fields, and a monitor that breaks on an unrecognised line is
 * worse than one that shows slightly less.
 *
 * `spawn.js` appends to the same file across retries, separated by a
 * `=== <iso> :: …` header. Each header starts a new attempt and resets the
 * counters — the interesting run is the current one, not the sum of the
 * failed ones.
 */
function digestLog(text, { activityLimit = ACTIVITY_LIMIT } = {}) {
  const d = emptyDigest();
  const pending = new Map(); // tool_use_id -> activity entry awaiting its result
  const push = (entry) => {
    d.activity.push(entry);
    if (d.activity.length > activityLimit * 4) d.activity.splice(0, d.activity.length - activityLimit * 4);
    return entry;
  };
  const stamp = (at) => { if (at && (!d.lastActivityAt || at > d.lastActivityAt)) d.lastActivityAt = at; };

  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('===')) {
      // New attempt. Everything before it belongs to a run that already ended.
      const at = (line.match(/=== (\S+)/) || [])[1] || null;
      const attempts = d.attempts + 1;
      Object.assign(d, emptyDigest(), { attempts, truncated: d.truncated });
      pending.clear();
      push({ kind: 'run', at, label: attempts > 1 ? `attempt ${attempts}` : 'started' });
      stamp(at);
      continue;
    }

    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // partial or non-JSON line: not evidence of anything
    }
    if (!ev || typeof ev !== 'object') continue;

    const at = typeof ev.timestamp === 'string' ? ev.timestamp : null;
    const sub = Boolean(ev.parent_tool_use_id);

    if (ev.type === 'system' && ev.subtype === 'init') {
      d.sessionId = ev.session_id || d.sessionId;
      d.model = ev.model || d.model;
      continue;
    }

    if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
      d.rateLimit = ev.rate_limit_info;
      continue;
    }

    if (ev.type === 'assistant' && ev.message) {
      if (!sub) d.turns += 1;
      const usage = ev.message.usage || {};
      if (typeof usage.output_tokens === 'number') d.outputTokens += usage.output_tokens;
      d.model = ev.message.model || d.model;
      for (const block of ev.message.content || []) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use') {
          d.toolCount += 1;
          const entry = push({
            kind: 'tool', at, sub, id: block.id || null,
            name: block.name || 'tool', target: toolTarget(block.name, block.input),
            ok: null, preview: null,
          });
          if (block.id) pending.set(block.id, entry);
        } else if (block.type === 'text' && block.text && block.text.trim()) {
          const text2 = oneLine(block.text, TEXT_MAX);
          if (!sub) d.lastText = text2;
          push({ kind: 'text', at, sub, text: text2 });
        }
      }
      stamp(at);
      continue;
    }

    if (ev.type === 'user' && ev.message) {
      for (const block of ev.message.content || []) {
        if (!block || block.type !== 'tool_result') continue;
        const entry = pending.get(block.tool_use_id);
        const preview = resultPreview(block.content);
        if (entry) {
          entry.ok = !block.is_error;
          entry.preview = preview;
          // The call already carries when it started; this is when it came
          // back. A feed without it can say what ran, never that it took 11s.
          entry.doneAt = at;
          pending.delete(block.tool_use_id);
        } else {
          push({ kind: 'tool', at, sub, name: 'result', target: '', ok: !block.is_error, preview });
        }
      }
      stamp(at);
      continue;
    }

    if (ev.type === 'result') {
      // Two consumers, two shapes. A feed row is one line, so `text` collapses
      // whitespace and stops at 120 or 400 characters — right there, wrong
      // everywhere else. The panel renders the same field as Markdown, and
      // Markdown is made of line breaks: a heading, a list and a table all
      // stop existing the moment `\s+` becomes a space. The report the agent
      // wrote was arriving in the drawer as one run-on paragraph of pipes.
      const report = ev.result == null ? null : String(ev.result).trim();
      d.result = {
        isError: Boolean(ev.is_error || ev.subtype === 'error_max_turns' || ev.subtype === 'error_during_execution'),
        subtype: ev.subtype || null,
        numTurns: typeof ev.num_turns === 'number' ? ev.num_turns : null,
        durationMs: typeof ev.duration_ms === 'number' ? ev.duration_ms : null,
        text: report ? oneLine(report, TEXT_MAX) : null,
        body: report ? report.slice(0, REPORT_MAX) : null,
        // Never a silent cap: if it bit, the panel says so.
        clipped: Boolean(report && report.length > REPORT_MAX),
      };
      if (typeof ev.total_cost_usd === 'number') d.costUsd = ev.total_cost_usd;
      // The spawn's own total, which replaces the running sum rather than
      // adding to it. A finished task's log is tens of megabytes and this
      // digest sees its last half-megabyte, so adding up `usage` message by
      // message reports a fraction of the truth. The result event carries the
      // whole spawn, and it sits at the end of the file — inside the tail.
      if (ev.usage && typeof ev.usage.output_tokens === 'number') d.reportedTokens = ev.usage.output_tokens;
      if (ev.session_id) d.sessionId = ev.session_id;
      // A result event carries no timestamp, so in a feed six of them stack at
      // one instant reading the same polite sentence. What separates them is
      // the turn they closed: keep its length.
      push({
        kind: 'result', at, ok: !d.result.isError, label: ev.subtype || 'result',
        text: d.result.text, durationMs: d.result.durationMs,
      });
    }
  }

  d.activity = d.activity.slice(-activityLimit);
  return d;
}

/** Digest one task's log file, or null when it has not written one yet. */
function readTaskLog(logFile, opts = {}) {
  if (!logFile) return null;
  const tail = tailFile(logFile, opts.bytes);
  if (!tail) return null;
  const digest = digestLog(tail.text, opts);
  digest.truncated = tail.truncated;
  digest.logSize = tail.size;
  if (!digest.lastActivityAt && tail.mtime) digest.lastActivityAt = new Date(tail.mtime).toISOString();
  return digest;
}

const laneLabel = (id) => String(id).toUpperCase();

function taskView(plan, st, n, { barrier = false, activityLimit = 8, feedLimit = 0, logs = true } = {}) {
  const rec = st.tasks[String(n)] || {};
  const task = plan.tasks.find((t) => t.n === Number(n));
  // One read serves both granularities. The card wants the last few events of
  // a task that is running; the run feed wants many more, from every task,
  // finished ones included. Digesting twice would double the tail read for
  // every task on every poll.
  const limit = Math.max(activityLimit, feedLimit);
  const digest = logs && rec.logFile ? readTaskLog(rec.logFile, { activityLimit: limit }) : null;

  // The checkpoint is authoritative for status; the log is authoritative for
  // what is happening inside a task that is still running.
  const live = rec.status === state.STATUS.RUNNING ? digest : null;
  const lastTool = live && [...live.activity].reverse().find((a) => a.kind === 'tool');

  const view = {
    n: Number(n),
    title: task ? task.title.replace(/`/g, '') : `Task ${n}`,
    status: rec.status || state.STATUS.PENDING,
    lane: rec.lane || null,
    barrier,
    attempts: rec.attempts || 0,
    turns: live ? live.turns : (rec.turns || 0),
    commits: rec.commits || [],
    costUsd: rec.costUsd ?? (live ? live.costUsd : null),
    // The checkpoint first, because the CLI wrote it from the agent's own
    // report. The log second, and only the figure a result event carried, so
    // runs recorded before `plo` kept this still have a number.
    //
    // Never the digest's running sum: a task writes tens of megabytes and this
    // reads half of one, so adding up `usage` message by message reports a
    // fraction. Measured on a blocked barrier whose log has no result event in
    // its tail — the sum said 377 output tokens for 842 turns. Null, never
    // zero and never a fraction: a task that has not reported did not spend
    // nothing.
    outputTokens: rec.outputTokens ?? (digest ? digest.reportedTokens : null),
    error: rec.error || null,
    reconciled: Boolean(rec.reconciled),
    startedAt: rec.startedAt || null,
    endedAt: rec.endedAt || null,
    sessionId: rec.sessionId || null,
    logFile: rec.logFile || null,
    lastActivityAt: digest ? digest.lastActivityAt : null,
    lastTool: lastTool ? { name: lastTool.name, target: lastTool.target, ok: lastTool.ok } : null,
    lastText: live ? live.lastText : null,
    // Not gated on `live`: the run this most needs to report is the one that
    // already died of a usage limit, and a dead task is by definition not live.
    rateLimit: digest ? digest.rateLimit : null,
    activity: live ? live.activity.slice(-activityLimit) : [],
  };

  // Scaffolding for the run feed, not payload: `snapshot` merges these and
  // strips the field before the object is serialised.
  if (feedLimit && digest) view.recent = digest.activity.slice(-feedLimit);
  return view;
}

/**
 * One chronological feed for the whole run.
 *
 * Parallel lanes are the point of this tool and each writes its own log file,
 * so no single tail can answer "what happened, in what order". Entries are
 * tagged with the task they came from and merged on their own timestamps —
 * nothing here reads a clock, so two identical reads still compare equal.
 */
function buildFeed(tasks, limit) {
  if (!limit) return [];
  const out = [];
  for (const t of tasks) {
    // An event that carries no timestamp inherits the last one seen, so it
    // stays beside the call it belongs to instead of sorting to the very top.
    let at = t.startedAt || null;
    for (const a of t.recent || []) {
      at = a.at || at;
      out.push({ ...a, at, n: t.n, lane: t.lane, barrier: t.barrier });
    }
  }
  out.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return out.slice(-limit);
}

const isTerminal = (s) => s === state.STATUS.DONE;

/**
 * The run as a pipeline, in the one order it can happen.
 *
 * Integration is not a status field, it is five stages: lanes run, branches
 * merge, barrier tasks run in the merged tree, the full suite runs, the
 * cross-lane review reads the combined diff. Folded into the single word
 * `barrier-failed` inside a key-value row, the reader has to already know
 * that order to place the failure in it.
 */
function buildStages(lanes, barriers, integration) {
  const i = integration || {};
  const S = state.STATUS;

  // A group reports the worst thing in it before the liveliest. "Some
  // finished, none running" is a stage under way, not a pending one:
  // `pending` here means nothing in this stage has started.
  const fold = (tasks) => {
    if (tasks.some((t) => t.status === S.FAILED || t.status === S.BLOCKED)) return S.FAILED;
    if (tasks.some((t) => t.status === S.RUNNING)) return S.RUNNING;
    if (tasks.some((t) => t.status === S.INTERRUPTED)) return S.INTERRUPTED;
    if (tasks.every((t) => t.status === S.DONE)) return S.DONE;
    return tasks.some((t) => t.status === S.DONE) ? S.RUNNING : S.PENDING;
  };
  const count = (tasks) => `${tasks.filter((t) => t.status === S.DONE).length}/${tasks.length}`;

  const laneTasks = lanes.flatMap((l) => l.tasks);
  const merged = i.mergedLanes || [];
  // Every integration status other than these two means the merge is behind us.
  const mergeDone = Boolean(i.status) && i.status !== S.PENDING && i.status !== 'merge-failed';

  const stages = [
    { key: 'run', label: 'Run', status: fold(laneTasks), detail: `${count(laneTasks)} tasks` },
    {
      key: 'merge',
      label: 'Merge',
      status: i.status === 'merge-failed' ? S.FAILED : mergeDone ? S.DONE : S.PENDING,
      detail: merged.length ? `lanes ${merged.join(', ')}` : `${lanes.length} lanes`,
    },
  ];

  // A plan with no barrier tasks has four stages — not a fifth that is
  // permanently done, which reads as work that happened.
  if (barriers.length) {
    stages.push({
      key: 'barriers',
      label: 'Barriers',
      status: i.status === 'barrier-failed' ? S.FAILED : fold(barriers),
      detail: `${count(barriers)} tasks`,
    });
  }

  stages.push({
    key: 'suite',
    label: 'Full suite',
    status: i.suite ? (i.suite.ok ? S.DONE : S.FAILED) : S.PENDING,
    detail: i.suite ? (i.suite.skipped ? 'no test command' : i.suite.ok ? 'pass' : 'fail') : '',
  });
  stages.push({
    key: 'review',
    label: 'Cross-lane review',
    status: i.review ? (i.review.clean ? S.DONE : S.FAILED) : S.PENDING,
    detail: i.review ? (i.review.verdict || (i.review.clean ? 'clean' : 'findings')) : '',
  });

  return stages;
}

/**
 * The run on one clock.
 *
 * `plo` exists to run tasks concurrently and the page has never once shown
 * whether that happened. `Lane plan` drew each lane as `T1 → T2 → T3`, which
 * is the order they were scheduled in — it cannot say that A and B overlapped
 * for eleven minutes, that four minutes passed between the last lane and the
 * barrier with nothing running, or that the serial barrier at the end cost
 * more than the parallel part saved. "Did the parallelism pay?" and "who held
 * the run up?" are the two questions this tool is judged by, and both are
 * questions about time.
 *
 * Offsets in seconds, not instants: the page has to divide by the run's span
 * to place a block, and sending the offset lets that arithmetic happen in one
 * CSS custom property instead of a layout pass per frame.
 *
 * The axis has no end while anything is running. Sending `now` would be one
 * line shorter and would make every read differ from the last — a frame
 * pushed every second down a stream whose whole design is to stay quiet. The
 * page extends the axis against its own clock instead.
 */
function buildTimeline(lanes, barriers) {
  const S = state.STATUS;
  const at = (iso) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  };

  const all = [...lanes.flatMap((l) => l.tasks), ...barriers];
  const starts = all.map((t) => at(t.startedAt)).filter((ms) => ms != null);
  // Nothing has run: there is no clock to draw one against yet.
  if (!starts.length) return null;

  const origin = Math.min(...starts);
  const secs = (ms) => Math.round((ms - origin) / 1000);
  // A task that stopped without recording an end still stopped. Its last
  // logged activity is the closest honest right edge; with neither, it is a
  // moment rather than a span.
  const endOf = (t) => {
    if (t.status === S.RUNNING) return null;
    return at(t.endedAt) ?? at(t.lastActivityAt) ?? at(t.startedAt);
  };

  const blocks = (tasks) => tasks
    .filter((t) => at(t.startedAt) != null)
    .map((t) => {
      const end = endOf(t);
      return {
        n: t.n,
        title: t.title,
        status: t.status,
        startedAt: t.startedAt,
        from: secs(at(t.startedAt)),
        to: end == null ? null : secs(end),
      };
    })
    .sort((a, b) => a.from - b.from);

  // A task that has not started has no place on a time axis, and inventing
  // one for it would be a lie told in the one language this chart speaks.
  // It waits beside the axis instead, which is also where it is in the run.
  const queued = (tasks) => tasks
    .filter((t) => at(t.startedAt) == null)
    .map((t) => ({ n: t.n, title: t.title, status: t.status }));

  const rows = lanes.map((l) => ({
    key: `lane-${l.id}`, label: l.label, kind: 'lane', blocks: blocks(l.tasks), queued: queued(l.tasks),
  }));
  if (barriers.length) {
    rows.push({ key: 'barriers', label: 'Barriers', kind: 'barrier', blocks: blocks(barriers), queued: queued(barriers) });
  }

  const live = all.some((t) => t.status === S.RUNNING);
  const ends = all.map(endOf).filter((ms) => ms != null);
  return {
    origin: new Date(origin).toISOString(),
    live,
    // Never zero: the page divides by this.
    span: live || !ends.length ? null : Math.max(1, secs(Math.max(...ends))),
    rows,
  };
}

/**
 * The whole dashboard payload.
 *
 * Deliberately free of anything derived from "now": every duration is sent as
 * a timestamp and rendered client-side. A payload containing elapsed time
 * differs on every tick, which would defeat the change detection the stream
 * uses to stay quiet.
 */
function snapshot(planPath, { activityLimit = 8, feedLimit = FEED_LIMIT, logs = true } = {}) {
  const abs = path.resolve(planPath);
  const contents = fs.readFileSync(abs, 'utf8');
  const plan = parsePlan(contents);
  const st = state.load(abs);

  const head = {
    plan: abs,
    title: plan.title || path.basename(abs),
    statePath: state.statePathFor(abs),
  };

  if (!st) {
    return { ...head, ready: false, message: 'No state file yet — run `plo analyze`, then `plo init`.' };
  }

  const lanes = st.lanes.map((lane) => {
    const tasks = lane.tasks.map((n) => taskView(plan, st, n, { activityLimit, feedLimit, logs }));
    return {
      id: lane.id,
      label: laneLabel(lane.id),
      branch: lane.branch,
      worktree: lane.worktree,
      weight: lane.weight,
      // A lane with nothing left to do has nothing left to watch. Saying so
      // here rather than in the page keeps the rule testable.
      settled: tasks.every((t) => isTerminal(t.status)),
      tasks,
    };
  });
  const barriers = st.barriers.map((n) => taskView(plan, st, n, { barrier: true, activityLimit, feedLimit, logs }));

  // During integration every lane is finished and the only live work is a
  // barrier. Naming it lets the page give it a lane's worth of attention
  // instead of one thin row under three cards saying "lane complete".
  const activeBarrier = barriers.find((t) => t.status !== state.STATUS.PENDING && !isTerminal(t.status));

  const all = [...lanes.flatMap((l) => l.tasks), ...barriers];
  const feed = buildFeed(all, feedLimit);
  for (const t of all) delete t.recent;
  const counts = {};
  for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;
  const costUsd = all.reduce((sum, t) => sum + (typeof t.costUsd === 'number' ? t.costUsd : 0), 0);
  const outputTokens = all.reduce((sum, t) => sum + (typeof t.outputTokens === 'number' ? t.outputTokens : 0), 0);
  const startedAts = all.map((t) => t.startedAt).filter(Boolean).sort();

  // Any lane reporting a non-"allowed" limit is the single fact most likely to
  // explain a stalled run, so it is hoisted to the top level.
  const limited = all.map((t) => t.rateLimit).filter((r) => r && r.status && r.status !== 'allowed');

  return {
    ...head,
    ready: true,
    repoRoot: st.repoRoot,
    base: st.base,
    testCommand: st.testCommand,
    maxLanes: st.maxLanes,
    createdAt: st.createdAt,
    updatedAt: st.updatedAt,
    planChanged: state.hashPlan(contents) !== st.planHash,
    totals: {
      total: all.length,
      done: counts[state.STATUS.DONE] || 0,
      running: counts[state.STATUS.RUNNING] || 0,
      failed: counts[state.STATUS.FAILED] || 0,
      blocked: counts[state.STATUS.BLOCKED] || 0,
      interrupted: counts[state.STATUS.INTERRUPTED] || 0,
      pending: counts[state.STATUS.PENDING] || 0,
      costUsd,
      outputTokens,
      firstStartedAt: startedAts[0] || null,
      active: (counts[state.STATUS.RUNNING] || 0) > 0,
    },
    rateLimit: limited[0] || null,
    activeBarrier: activeBarrier ? activeBarrier.n : null,
    stages: buildStages(lanes, barriers, st.integration),
    timeline: buildTimeline(lanes, barriers),
    feed,
    lanes,
    barriers,
    integration: st.integration,
  };
}

/** One task in full: the drawer's payload, with a much longer activity list. */
function taskDetail(planPath, n, { activityLimit = 200 } = {}) {
  const abs = path.resolve(planPath);
  const plan = parsePlan(fs.readFileSync(abs, 'utf8'));
  const st = state.load(abs);
  if (!st) return null;
  const rec = st.tasks[String(n)];
  if (!rec) return null;

  const view = taskView(plan, st, n, { barrier: st.barriers.includes(Number(n)), activityLimit });
  const digest = rec.logFile ? readTaskLog(rec.logFile, { activityLimit }) : null;
  const task = plan.tasks.find((t) => t.n === Number(n));

  return {
    ...view,
    // For a finished task the live view is empty by design; the drawer is the
    // one place where its history is what you came for.
    activity: digest ? digest.activity : [],
    lastText: digest ? digest.lastText : null,
    result: digest ? digest.result : null,
    model: digest ? digest.model : null,
    outputTokens: digest ? digest.reportedTokens : null,
    truncated: digest ? digest.truncated : false,
    files: task ? { writes: task.writes || [], excluded: task.excludedPaths || [] } : null,
    steps: task ? task.steps : [],
    interfaces: task ? task.interfaces : null,
  };
}

module.exports = { snapshot, taskDetail, taskView, buildFeed, buildStages, buildTimeline, digestLog, readTaskLog, tailFile, toolTarget, shortPath };
