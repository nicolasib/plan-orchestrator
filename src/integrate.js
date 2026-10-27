'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync, spawn } = require('child_process');
const state = require('./state');
const wt = require('./worktrees');
const { runAgent, newSessionId } = require('./spawn');
const { barrierTaskPrompt, crossLaneReviewPrompt } = require('./prompts');
const { effortFor, plannedEffort, shouldRaise } = require('./effort');
const { processStamp, processAlive, orphanedGroup, killGroup } = require('./proc');

/**
 * The integration phase — the part that only exists because execution was
 * parallel.
 *
 * Order matters and is not negotiable:
 *
 *   merge lanes  ->  barrier tasks  ->  FULL suite  ->  cross-lane review
 *
 * Barriers (docs, PR prep) run after the merge because their inputs are the
 * combined contracts of every lane, not any one lane's view. The full suite
 * runs after them because a barrier task can itself change code. The cross-lane
 * review runs last because it reviews the final tree, and because a reviewer
 * given a red suite spends its attention re-deriving the failure instead of
 * hunting the defects only it can find.
 */

function run(cmd, cwd, { capture = true } = {}) {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out: out || '', code: 0 };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status ?? 1 };
  }
}

/**
 * Merge every lane branch into the feature base, in lane order.
 *
 * A conflict stops the merge immediately and leaves the tree in the conflicted
 * state on purpose: resolving it needs a human or an agent with full context,
 * and silently aborting would discard the evidence of what collided.
 */
function mergeLanes(st, { log = () => {}, noFf = true } = {}) {
  const root = st.repoRoot;
  const merged = [];

  const current = wt.currentBranch(root);
  if (current !== st.base.branch) {
    return {
      ok: false,
      stage: 'precondition',
      error: `expected the primary checkout to be on \`${st.base.branch}\`, found \`${current}\`. `
        + 'Switch to the feature branch and re-run — plo will not switch branches under you.',
      merged,
    };
  }
  if (wt.isDirty(root)) {
    return { ok: false, stage: 'precondition', error: 'the feature checkout has uncommitted changes; commit or stash them first.', merged };
  }

  for (const lane of st.lanes) {
    if (!lane.branch) continue;
    const commits = wt.laneCommits(root, st.base.commit, lane.branch);
    if (!commits.length) {
      log(`lane ${lane.id}: no commits — nothing to merge`);
      continue;
    }

    const args = ['merge', ...(noFf ? ['--no-ff'] : []), '-m', `merge: lane ${lane.id} (tasks ${lane.tasks.join(', ')})`, lane.branch];
    try {
      execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
      merged.push(lane.id);
      log(`lane ${lane.id}: merged ${commits.length} commit(s)`);
    } catch (e) {
      const conflicts = run('git diff --name-only --diff-filter=U', root).out.trim().split('\n').filter(Boolean);
      return {
        ok: false,
        stage: 'merge',
        lane: lane.id,
        conflicts,
        error: `merge of lane ${lane.id} (\`${lane.branch}\`) conflicted in ${conflicts.length} file(s): ${conflicts.join(', ')}.\n`
          + 'The conflicted tree is left in place deliberately. Resolve it, commit, then re-run `plo integrate`.\n'
          + 'A conflict here means the DAG was wrong — two lanes wrote a file the analyzer thought was disjoint. '
          + 'Worth correcting the lane plan before the next run.',
        merged,
        detail: String(e.stderr || e.message).slice(0, 800),
      };
    }
  }

  return { ok: true, merged };
}

/** Run the barrier tasks, sequentially, in the merged base checkout. */
async function runBarriers(planPath, st, plan, opts = {}) {
  const log = opts.log || (() => {});
  const outcomes = [];

  for (const n of st.barriers) {
    const rec = st.tasks[String(n)] || {};
    if (rec.status === state.STATUS.DONE) {
      log(`T${n} (barrier): already done — skipping`);
      continue;
    }

    const task = plan.tasks.find((t) => t.n === n);
    // A fresh id per attempt, never `rec.sessionId ||` — the agent CLI refuses a
    // `--session-id` it has already seen, so reusing the id off the checkpoint
    // made any task that failed once permanently unretryable: every later attempt
    // died on "Session ID <uuid> is already in use" before the agent ran, and the
    // retry loop spun on it. Nothing resumes that session — a retry re-runs the
    // task from scratch — so the id is only a label for the log.
    const sessionId = newSessionId();
    const logFile = path.join(path.dirname(planPath), '.plo-logs', `task-${n}.jsonl`);
    const baseBefore = wt.headCommit(st.repoRoot);
    // A barrier obeys its own `**Effort:**` line and climbs like a lane task.
    // `integrate` never reconciles, so a raise stands until the next run/resume.
    const used = effortFor(plannedEffort(task), rec.raises || 0);
    const stamp = processStamp();

    state.updateTask(planPath, st, n, {
      status: state.STATUS.RUNNING, sessionId, logFile, baseBefore, effort: used,
      pid: stamp.pid, pidStartedAt: stamp.startedAt,
      attempts: (rec.attempts || 0) + 1, startedAt: new Date().toISOString(), error: null,
    });
    log(`T${n} (barrier): started — ${task ? task.title : ''}`);

    const outcome = await runAgent({
      cwd: st.repoRoot,
      prompt: barrierTaskPrompt({
        planPath: st.plan,
        taskNumber: n,
        taskTitle: task ? task.title : `Task ${n}`,
        branch: st.base.branch,
        worktree: st.repoRoot,
        testCommand: st.testCommand,
        globalConstraints: plan.constraints.raw,
        mergedLanes: st.integration.mergedLanes,
      }),
      sessionId,
      model: opts.model,
      effort: used,
      permissionMode: opts.permissionMode || 'acceptEdits',
      maxTurns: opts.maxTurns,
      timeoutMs: opts.taskTimeoutMs,
      logFile,
      signal: opts.signal,
      onEvent: (ev) => { if (ev.kind === 'rate_limit') state.recordUsage(planPath, st, ev.info); },
    });

    const commits = wt.laneCommits(st.repoRoot, baseBefore, 'HEAD').map((c) => c.sha);
    const blocked = /STATUS:\s*BLOCKED/i.test(outcome.result || '');
    // A barrier legitimately may produce no commits (a suite-run task that finds
    // nothing to change), so commits are not required here the way they are for
    // an implementation task.
    const ok = outcome.ok && !blocked;
    const status = ok ? state.STATUS.DONE : blocked ? state.STATUS.BLOCKED : state.STATUS.FAILED;

    const endedAt = new Date().toISOString();
    state.updateTask(planPath, st, n, {
      status,
      endedAt,
      commits,
      turns: outcome.turns,
      // Summed across attempts; null only when no attempt reported.
      costUsd: outcome.costUsd == null && rec.costUsd == null
        ? null
        : (rec.costUsd || 0) + (outcome.costUsd || 0),
      outputTokens: outcome.outputTokens == null && rec.outputTokens == null
        ? null
        : (rec.outputTokens || 0) + (outcome.outputTokens || 0),
      // An attempt interrupted by the operator is not a try of the task.
      tries: opts.signal && opts.signal.aborted
        ? rec.tries || []
        : [...(rec.tries || []), { effort: used, status, at: endedAt }],
      raises: (rec.raises || 0) + (shouldRaise(status, outcome, { aborted: Boolean(opts.signal && opts.signal.aborted) }) ? 1 : 0),
      error: ok ? null : (outcome.result || outcome.stderr || '').slice(0, 500),
    });

    log(ok ? `T${n} (barrier): done — ${commits.length} commit(s)` : `T${n} (barrier): FAILED`);
    outcomes.push({ n, ok });
    if (!ok) return { ok: false, outcomes, failedAt: n };
  }

  return { ok: true, outcomes };
}

// The summary is the last 40 lines; this much of the output's tail holds them.
const SUITE_TAIL_BYTES = 256 * 1024;

/** Kill the suite a dead integrate left running, if its stage names one. */
function killStaleSuite(st, log) {
  // A leader still in use must match its stamp: one that fails it is a reused
  // pid, never signalled. A leader gone while its group lives on, for a stage
  // still open, is the runner dead and its workers still running.
  const prev = (st.integration.stages || {}).suite;
  if (prev && prev.pid && (processAlive(prev.pid, prev.pidStartedAt) || (!prev.endedAt && orphanedGroup(prev.pid)))) {
    killGroup(prev.pid, 'SIGKILL');
    log(`full suite: killed the suite a previous integrate left running (pid ${prev.pid})`);
  }
}

/**
 * The full suite at the merge point. Not a lane's subset — the whole thing.
 *
 * Streamed, not buffered: stdout and stderr land in `.plo-logs/full-suite.log`
 * as they arrive, so a long suite can be followed while it runs. It runs in a
 * process group of its own, which a signal to plo never reaches — so whoever
 * stops plo kills that group (the abort signal here, the signal handler in
 * `cmdIntegrate`), and the next integrate kills one a dead plo left behind.
 */
async function fullSuite(planPath, st, { log = () => {}, signal } = {}) {
  // First, before the log is truncated under it: a suite still running from a
  // dead integrate would keep appending to this run's log. `integrate` has
  // already done this before dropping the stage; a direct call has not.
  killStaleSuite(st, log);

  const cmd = st.testCommand;
  if (!cmd) {
    return { ok: false, skipped: true, summary: 'no test command known — set one in the plan Global Constraints or pass --test-command' };
  }

  const logFile = path.join(path.dirname(planPath), '.plo-logs', 'full-suite.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, `# ${new Date().toISOString()} $ ${cmd}\n`);
  log(`full suite: running \`${cmd}\` in ${st.repoRoot} — output in ${logFile}`);

  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    // A full disk (ENOSPC), a file-size limit (EFBIG) or EIO on the log must
    // not take plo down with the suite still running: the log stops, the tail
    // in memory carries on, and the summary says why the file is short.
    let logError = null;
    out.on('error', (err) => { logError = logError || err; });
    let tail = Buffer.alloc(0);
    const keep = (chunk) => {
      if (!logError) out.write(chunk);
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > SUITE_TAIL_BYTES) tail = tail.subarray(tail.length - SUITE_TAIL_BYTES);
    };
    // A read error on a pipe ends that pipe, not the suite.
    const pipeError = (err) => keep(Buffer.from(`${err.message}\n`));

    // detached: a group of its own, so killing the group takes the runner's workers too.
    const child = spawn(cmd, { cwd: st.repoRoot, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // A spawn that hit EMFILE/ENFILE never got its pipes.
    if (child.stdout) child.stdout.on('data', keep).on('error', pipeError);
    if (child.stderr) child.stderr.on('data', keep).on('error', pipeError);

    // A failed spawn has no pid, and processStamp() without one stamps plo itself.
    const stamp = child.pid ? processStamp(child.pid) : { pid: null, startedAt: null };
    st.integration.stages = st.integration.stages || {};
    st.integration.stages.suite = {
      startedAt: new Date().toISOString(), logFile, command: cmd, pid: stamp.pid, pidStartedAt: stamp.startedAt,
    };
    st.integration.status = 'suite-running';
    state.save(planPath, st);

    const onAbort = () => { if (child.pid) killGroup(child.pid, 'SIGTERM'); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    // A failed spawn emits 'error' and then 'close'; only the first counts.
    let settled = false;
    const settle = (code) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      st.integration.stages.suite = { ...st.integration.stages.suite, endedAt: new Date().toISOString() };
      state.save(planPath, st);
      const summary = tail.toString('utf8').split('\n').slice(-40).join('\n');
      // Resolved once the log is flushed: the file is whole when the caller reads it.
      // A write that fails during that flush reaches this callback too.
      out.end((err) => {
        const failed = logError || err;
        resolve({
          ok: code === 0,
          code,
          summary: failed ? `${summary}\n[plo] ${logFile} stopped: ${failed.message}` : summary,
          command: cmd,
        });
      });
    };

    child.on('error', (err) => {
      keep(Buffer.from(`${err.message}\n`));
      settle(1);
    });
    // Killed by a signal, the suite has no exit code.
    child.on('close', (code) => settle(code ?? 1));
  });
}

/**
 * Build the whole-branch review package. Prefers superpowers' own
 * review-package script so the reviewer sees the format it was trained on;
 * falls back to producing an equivalent file directly.
 */
function reviewPackage(st, planPath, { log = () => {} } = {}) {
  const outDir = path.join(path.dirname(planPath), '.plo-logs');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'cross-lane-review-package.md');
  const range = `${st.base.commit}..HEAD`;

  const commits = run(`git log --oneline ${range}`, st.repoRoot).out;
  const stat = run(`git diff --stat ${range}`, st.repoRoot).out;
  const diff = run(`git diff -U10 ${range}`, st.repoRoot).out;

  fs.writeFileSync(out, [
    `# Cross-lane review package`,
    ``,
    `Plan: ${st.plan}`,
    `Branch: ${st.base.branch}`,
    `Range: ${range}`,
    ``,
    `## Lanes`,
    ...st.lanes.map((l) => `- Lane ${l.id} (\`${l.branch}\`): tasks ${l.tasks.join(', ')}`),
    ``,
    `## Commits`,
    '```',
    commits.trim(),
    '```',
    ``,
    `## Stat`,
    '```',
    stat.trim(),
    '```',
    ``,
    `## Diff (-U10)`,
    '```diff',
    diff,
    '```',
    ``,
  ].join('\n'));

  log(`review package: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  return out;
}

/** Dispatch the reviewer that hunts specifically for cross-lane damage. */
async function crossLaneReview(planPath, st, opts = {}) {
  const log = opts.log || (() => {});
  const pkg = reviewPackage(st, planPath, { log });
  const logFile = path.join(path.dirname(planPath), '.plo-logs', 'cross-lane-review.jsonl');

  // On disk before the reviewer starts, so a monitor (or an interrupt) sees the
  // stage running. Overwrites the whole object: that is what redoes a stage
  // a dead `plo integrate` left running.
  const sessionId = newSessionId();
  st.integration.stages = st.integration.stages || {};
  st.integration.stages.review = { startedAt: new Date().toISOString(), logFile, sessionId };
  st.integration.status = 'reviewing';
  state.save(planPath, st);

  log('cross-lane review: dispatching');
  const outcome = await runAgent({
    cwd: st.repoRoot,
    prompt: crossLaneReviewPrompt({
      planPath: st.plan,
      branch: st.base.branch,
      worktree: st.repoRoot,
      reviewPackage: pkg,
      lanes: st.lanes,
      testCommand: st.testCommand,
      suiteResult: st.integration.suite ? (st.integration.suite.ok ? 'PASS' : 'FAIL') : null,
    }),
    sessionId,
    // The review is a judgment task on a large diff — the one place worth the
    // most capable model available.
    model: opts.reviewModel || opts.model,
    permissionMode: 'plan',
    timeoutMs: opts.reviewTimeoutMs || opts.taskTimeoutMs,
    logFile,
    signal: opts.signal,
    onEvent: (ev) => { if (ev.kind === 'rate_limit') state.recordUsage(planPath, st, ev.info); },
  });

  st.integration.stages.review = {
    ...st.integration.stages.review,
    endedAt: new Date().toISOString(),
    costUsd: outcome.costUsd ?? null,
    outputTokens: outcome.outputTokens ?? null,
  };

  const text = outcome.result || '';
  const verdictMatch = text.match(/CROSS-LANE VERDICT:\s*(.+)/i);
  const reportFile = path.join(path.dirname(planPath), '.plo-logs', 'cross-lane-review.md');
  fs.writeFileSync(reportFile, text || '(no output)');

  return {
    ok: outcome.ok,
    clean: /CLEAN/i.test(verdictMatch ? verdictMatch[1] : ''),
    verdict: verdictMatch ? verdictMatch[1].trim() : null,
    reportFile,
    package: pkg,
    costUsd: outcome.costUsd ?? null,
    outputTokens: outcome.outputTokens ?? null,
  };
}

/**
 * Close whatever an interrupt caught mid-flight: the open stage (started, not
 * ended) and any barrier still `running`. Returns the closed stage's name, or
 * null when only a barrier (or nothing) was open; only a closed stage sets
 * `integration.status` to `interrupted`. Synchronous on purpose — it
 * runs inside a signal handler that exits right after.
 */
function markInterrupted(planPath, st) {
  const now = new Date().toISOString();
  let closed = null;
  for (const [name, s] of Object.entries(st.integration.stages || {})) {
    if (s && s.startedAt && !s.endedAt) {
      st.integration.stages[name] = { ...s, endedAt: now, interrupted: true };
      closed = closed || name;
    }
  }
  for (const n of st.barriers || []) {
    const rec = st.tasks[String(n)];
    if (rec && rec.status === state.STATUS.RUNNING) rec.status = state.STATUS.INTERRUPTED;
  }
  // Only a closed stage flips the status. A barrier alone leaves it (e.g.
  // `merged`) so the next `integrate` skips the merge — the barrier may have
  // left edits behind, and `mergeLanes` refuses a dirty tree.
  if (closed) st.integration.status = 'interrupted';
  state.save(planPath, st);
  return closed;
}

/** The whole phase, in order, checkpointing after each stage. */
async function integrate(planPath, st, plan, opts = {}) {
  const log = opts.log || (() => {});

  // Stamped before the merge guard so the owner is on disk even when the merge
  // is skipped. Old state files predate `stages`.
  const stamp = processStamp();
  st.integration.pid = stamp.pid;
  st.integration.pidStartedAt = stamp.startedAt;
  st.integration.stages = st.integration.stages || {};
  // While its stage still names it: the record goes next.
  killStaleSuite(st, log);
  // A stage an earlier integrate left open (it died) or interrupted (Ctrl-C)
  // is redone by this one: an open or interrupted merge leaves the status
  // short of `merged`, so the merge runs again, and the suite and the review
  // run whenever this integrate reaches them. Kept, the old record reads as
  // this run's — a review "interrupted" while this one is in its suite — and
  // a Ctrl-C here would close it again and name it. A closed, finished record
  // stays: the merge this run skips is still done.
  for (const [name, s] of Object.entries(st.integration.stages)) {
    if (s && (s.interrupted || (s.startedAt && !s.endedAt))) delete st.integration.stages[name];
  }
  state.save(planPath, st);

  if (st.integration.status !== 'merged' && st.integration.status !== state.STATUS.DONE) {
    st.integration.stages.merge = { startedAt: new Date().toISOString() };
    st.integration.status = 'merging';
    state.save(planPath, st);
    const m = mergeLanes(st, { log, noFf: opts.noFf !== false });
    st.integration.stages.merge.endedAt = new Date().toISOString();
    st.integration.mergedLanes = m.merged;
    st.integration.status = m.ok ? 'merged' : 'merge-failed';
    st.integration.mergeError = m.ok ? null : m.error;
    state.save(planPath, st);
    if (!m.ok) return { ok: false, stage: 'merge', ...m };
  } else {
    log(`merge: already done (lanes ${st.integration.mergedLanes.join(', ') || 'none'}) — skipping`);
  }

  const bar = await runBarriers(planPath, st, plan, opts);
  if (!bar.ok) {
    st.integration.status = 'barrier-failed';
    state.save(planPath, st);
    return { ok: false, stage: 'barriers', ...bar };
  }

  const suite = await fullSuite(planPath, st, { log, signal: opts.signal });
  st.integration.suite = suite;
  st.integration.status = suite.ok ? 'suite-passed' : 'suite-failed';
  state.save(planPath, st);
  if (!suite.ok) {
    return {
      ok: false,
      stage: 'suite',
      suite,
      error: suite.skipped
        ? suite.summary
        : 'the full suite failed at the merge point. This is the signal the per-lane runs could not produce: '
          + 'each lane passed its own tests in isolation. Fix before the cross-lane review — a reviewer reading a red tree '
          + 'spends its attention on the failure instead of on cross-lane defects.',
    };
  }

  const review = await crossLaneReview(planPath, st, opts);
  st.integration.review = { clean: review.clean, verdict: review.verdict, reportFile: review.reportFile };
  st.integration.status = review.clean ? state.STATUS.DONE : 'review-findings';
  state.save(planPath, st);

  return { ok: true, stage: 'complete', merged: st.integration.mergedLanes, suite, review };
}

module.exports = { integrate, markInterrupted,mergeLanes, runBarriers, fullSuite, crossLaneReview, reviewPackage };
