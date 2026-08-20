'use strict';

const path = require('path');
const state = require('./state');
const wt = require('./worktrees');
const { runAgent, newSessionId, pool } = require('./spawn');
const { laneTaskPrompt } = require('./prompts');

/**
 * The lane scheduler.
 *
 * Invariants it maintains, in order of importance:
 *
 *  1. A task's status is written to disk before its process starts and again
 *     the moment it exits. There is no window in which work is in flight and
 *     unrecorded.
 *  2. At most `maxLanes` agent processes exist at once.
 *  3. A lane is sequential: task k+1 in a lane never starts until task k in
 *     that lane is done.
 *  4. One lane dying never stops another. Failure is recorded and scheduling
 *     continues with whatever remains runnable.
 */

const shortSha = (s) => (s || '').slice(0, 7);

/** Prepare every lane's worktree. Idempotent, so resume re-enters safely. */
function prepareLanes(planPath, st, { worktreeDir, extraSeed, log = () => {} }) {
  const planSlug = path.basename(planPath, '.md');

  for (const lane of st.lanes) {
    const res = wt.ensureLaneWorktree({
      root: st.repoRoot,
      planSlug,
      laneId: lane.id,
      baseCommit: st.base.commit,
      baseBranch: st.base.branch,
      worktreeDir,
      extraSeed,
    });
    lane.branch = res.branch;
    lane.worktree = res.path;

    if (res.created) {
      const seeded = res.seeded.map((s) => `${s.name}(${s.mode})`).join(', ') || 'nothing to seed';
      log(`lane ${lane.id}: worktree ${res.adoptedBranch ? 'adopted branch' : 'created'} at ${res.path} — seeded ${seeded}`);
    } else {
      log(`lane ${lane.id}: reusing worktree ${res.path}`);
    }
  }
  state.save(planPath, st);
  return st;
}

/** Everything one spawned process needs to know, assembled from plan + state. */
function buildTaskPrompt(st, plan, taskNumber, lane) {
  const task = plan.tasks.find((t) => t.n === taskNumber);
  const settled = Object.entries(st.tasks)
    .filter(([, r]) => r.status === state.STATUS.DONE)
    .map(([n]) => Number(n));

  // Hand forward only the interface blocks of already-merged tasks. This is the
  // context a fresh process genuinely cannot derive, and nothing more — pasting
  // accumulated history is what makes dispatch prompts balloon.
  const priorInterfaces = plan.tasks
    .filter((t) => settled.includes(t.n) && (t.interfaces.produces || '').trim())
    .map((t) => `**Task ${t.n} — ${t.title}**\n${t.interfaces.produces.trim()}`)
    .join('\n\n');

  return laneTaskPrompt({
    planPath: st.plan,
    taskNumber,
    taskTitle: task ? task.title : `Task ${taskNumber}`,
    laneId: lane.id,
    laneTasks: lane.tasks,
    branch: lane.branch,
    worktree: lane.worktree,
    testCommand: st.testCommand,
    globalConstraints: plan.constraints.raw,
    priorInterfaces,
  });
}

/**
 * Run one task to completion in its lane's worktree, recording state on both
 * sides of the process.
 */
async function runTask(planPath, st, plan, { n, lane: laneId }, opts) {
  const lane = st.lanes.find((l) => l.id === laneId);
  const rec = st.tasks[String(n)] || {};
  const sessionId = rec.sessionId || newSessionId();
  const logFile = path.join(path.dirname(planPath), '.plo-logs', `task-${n}.jsonl`);
  const baseBefore = wt.headCommit(lane.worktree);

  state.updateTask(planPath, st, n, {
    status: state.STATUS.RUNNING,
    lane: laneId,
    sessionId,
    attempts: (rec.attempts || 0) + 1,
    startedAt: new Date().toISOString(),
    logFile,
    baseBefore,
    error: null,
  });
  opts.log(`T${n} (lane ${laneId}): started — session ${sessionId.slice(0, 8)} — log ${logFile}`);

  let outcome;
  try {
    outcome = await runAgent({
      cwd: lane.worktree,
      prompt: buildTaskPrompt(st, plan, n, lane),
      sessionId,
      model: opts.model,
      permissionMode: opts.permissionMode,
      maxTurns: opts.maxTurns,
      timeoutMs: opts.taskTimeoutMs,
      logFile,
      signal: opts.signal,
    });
  } catch (e) {
    // Could not launch at all — a config problem, not a task failure.
    state.updateTask(planPath, st, n, {
      status: state.STATUS.FAILED, endedAt: new Date().toISOString(), error: e.message,
    });
    opts.log(`T${n} (lane ${laneId}): could not start — ${e.message}`);
    return { n, ok: false, fatal: true, error: e.message };
  }

  const commits = wt.laneCommits(st.repoRoot, baseBefore, lane.branch).map((c) => c.sha);
  const blocked = /STATUS:\s*BLOCKED/i.test(outcome.result || '');

  // Trust git over the agent's self-report: commits are the evidence that work
  // landed. An agent claiming DONE with no commits has not done the task.
  const ok = outcome.ok && !blocked && commits.length > 0;
  const status = ok
    ? state.STATUS.DONE
    : blocked ? state.STATUS.BLOCKED : state.STATUS.FAILED;

  let error = null;
  if (!ok) {
    if (blocked) error = (outcome.result || '').slice(0, 500);
    else if (outcome.timedOut) error = `timed out after ${opts.taskTimeoutMs}ms`;
    else if (outcome.isError) error = `agent error (${outcome.subtype || 'unknown'}): ${(outcome.result || '').slice(0, 300)}`;
    else if (outcome.exitCode !== 0) error = `exit ${outcome.exitCode}${outcome.signal ? ` (${outcome.signal})` : ''}: ${outcome.stderr.slice(0, 300)}`;
    else if (!commits.length) error = 'agent reported success but produced no commits';
  }

  state.updateTask(planPath, st, n, {
    status,
    endedAt: new Date().toISOString(),
    commits,
    turns: outcome.turns,
    costUsd: outcome.costUsd,
    // Summed across attempts, unlike `costUsd` beside it: a task the fix loop
    // ran five times spent five spawns' worth, and this is the number the page
    // reports as what the run consumed. Stays null when nothing reported, so
    // "not measured" never renders as zero.
    outputTokens: outcome.outputTokens == null && rec.outputTokens == null
      ? null
      : (rec.outputTokens || 0) + (outcome.outputTokens || 0),
    error,
  });

  opts.log(
    ok
      ? `T${n} (lane ${laneId}): done — ${commits.length} commit(s) ${commits.map(shortSha).join(' ')} — ${outcome.turns} turns`
      : `T${n} (lane ${laneId}): ${status.toUpperCase()} — ${error}`,
  );

  return { n, ok, status, error, commits };
}

/**
 * Drive all lane tasks to completion (or to a standstill).
 * Barrier tasks are deliberately NOT run here — they need the merged tree, so
 * they belong to the integration phase.
 */
async function runLanes(planPath, st, plan, opts = {}) {
  const options = {
    log: () => {},
    maxLanes: st.maxLanes || 3,
    permissionMode: 'acceptEdits',
    ...opts,
  };
  const edges = opts.edges || [];
  const barrierSet = new Set(st.barriers);

  /** n -> promise resolving {n, ...} exactly once */
  const inFlight = new Map();
  const results = [];

  for (;;) {
    const ready = state
      .readyTasks(st, edges)
      .filter((r) => !r.barrier && !barrierSet.has(r.n) && !inFlight.has(r.n));

    while (inFlight.size < options.maxLanes && ready.length) {
      const item = ready.shift();
      const p = runTask(planPath, st, plan, item, options)
        .then((v) => ({ ...v, n: item.n }), (e) => ({ n: item.n, ok: false, error: e.message }));
      inFlight.set(item.n, p);
    }

    if (!inFlight.size) break;

    const finished = await Promise.race([...inFlight.values()]);
    inFlight.delete(finished.n);
    results.push(finished);

    if (finished.fatal) {
      options.log('fatal: agent binary unavailable — stopping. No further tasks will be started.');
      await Promise.allSettled([...inFlight.values()]);
      break;
    }
  }

  const summary = state.summarize(st);
  const stuck = Object.entries(st.tasks)
    .filter(([n, r]) => !barrierSet.has(Number(n)) && r.status !== state.STATUS.DONE)
    .map(([n, r]) => ({ n: Number(n), status: r.status, error: r.error }));

  return { results, summary, stuck, allLanesDone: stuck.length === 0 };
}

module.exports = { runLanes, runTask, prepareLanes, buildTaskPrompt, pool };
