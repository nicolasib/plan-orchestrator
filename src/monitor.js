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
const TEXT_MAX = 400;

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
          pending.delete(block.tool_use_id);
        } else {
          push({ kind: 'tool', at, sub, name: 'result', target: '', ok: !block.is_error, preview });
        }
      }
      stamp(at);
      continue;
    }

    if (ev.type === 'result') {
      d.result = {
        isError: Boolean(ev.is_error || ev.subtype === 'error_max_turns' || ev.subtype === 'error_during_execution'),
        subtype: ev.subtype || null,
        numTurns: typeof ev.num_turns === 'number' ? ev.num_turns : null,
        durationMs: typeof ev.duration_ms === 'number' ? ev.duration_ms : null,
        text: ev.result ? oneLine(ev.result, TEXT_MAX) : null,
      };
      if (typeof ev.total_cost_usd === 'number') d.costUsd = ev.total_cost_usd;
      if (ev.session_id) d.sessionId = ev.session_id;
      push({ kind: 'result', at, ok: !d.result.isError, label: ev.subtype || 'result', text: d.result.text });
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

function taskView(plan, st, n, { barrier = false, activityLimit = 8, logs = true } = {}) {
  const rec = st.tasks[String(n)] || {};
  const task = plan.tasks.find((t) => t.n === Number(n));
  const digest = logs && rec.logFile ? readTaskLog(rec.logFile, { activityLimit }) : null;

  // The checkpoint is authoritative for status; the log is authoritative for
  // what is happening inside a task that is still running.
  const live = rec.status === state.STATUS.RUNNING ? digest : null;
  const lastTool = live && [...live.activity].reverse().find((a) => a.kind === 'tool');

  return {
    n: Number(n),
    title: task ? task.title.replace(/`/g, '') : `Task ${n}`,
    status: rec.status || state.STATUS.PENDING,
    lane: rec.lane || null,
    barrier,
    attempts: rec.attempts || 0,
    turns: live ? live.turns : (rec.turns || 0),
    commits: rec.commits || [],
    costUsd: rec.costUsd ?? (live ? live.costUsd : null),
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
    activity: live ? live.activity : [],
  };
}

const isTerminal = (s) => s === state.STATUS.DONE;

/**
 * The whole dashboard payload.
 *
 * Deliberately free of anything derived from "now": every duration is sent as
 * a timestamp and rendered client-side. A payload containing elapsed time
 * differs on every tick, which would defeat the change detection the stream
 * uses to stay quiet.
 */
function snapshot(planPath, { activityLimit = 8, logs = true } = {}) {
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

  const lanes = st.lanes.map((lane) => ({
    id: lane.id,
    label: laneLabel(lane.id),
    branch: lane.branch,
    worktree: lane.worktree,
    weight: lane.weight,
    tasks: lane.tasks.map((n) => taskView(plan, st, n, { activityLimit, logs })),
  }));
  const barriers = st.barriers.map((n) => taskView(plan, st, n, { barrier: true, activityLimit, logs }));

  const all = [...lanes.flatMap((l) => l.tasks), ...barriers];
  const counts = {};
  for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;
  const costUsd = all.reduce((sum, t) => sum + (typeof t.costUsd === 'number' ? t.costUsd : 0), 0);
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
      firstStartedAt: startedAts[0] || null,
      active: (counts[state.STATUS.RUNNING] || 0) > 0,
    },
    rateLimit: limited[0] || null,
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
    outputTokens: digest ? digest.outputTokens : 0,
    truncated: digest ? digest.truncated : false,
    files: task ? { writes: task.writes || [], excluded: task.excludedPaths || [] } : null,
    steps: task ? task.steps : [],
    interfaces: task ? task.interfaces : null,
  };
}

module.exports = { snapshot, taskDetail, taskView, digestLog, readTaskLog, tailFile, toolTarget, shortPath };
