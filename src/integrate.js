'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const state = require('./state');
const wt = require('./worktrees');
const { runAgent, newSessionId } = require('./spawn');
const { barrierTaskPrompt, crossLaneReviewPrompt } = require('./prompts');

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
    const sessionId = rec.sessionId || newSessionId();
    const logFile = path.join(path.dirname(planPath), '.plo-logs', `task-${n}.jsonl`);
    const baseBefore = wt.headCommit(st.repoRoot);

    state.updateTask(planPath, st, n, {
      status: state.STATUS.RUNNING, sessionId, logFile, baseBefore,
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
      permissionMode: opts.permissionMode || 'acceptEdits',
      maxTurns: opts.maxTurns,
      timeoutMs: opts.taskTimeoutMs,
      logFile,
      signal: opts.signal,
    });

    const commits = wt.laneCommits(st.repoRoot, baseBefore, 'HEAD').map((c) => c.sha);
    const blocked = /STATUS:\s*BLOCKED/i.test(outcome.result || '');
    // A barrier legitimately may produce no commits (a suite-run task that finds
    // nothing to change), so commits are not required here the way they are for
    // an implementation task.
    const ok = outcome.ok && !blocked;

    state.updateTask(planPath, st, n, {
      status: ok ? state.STATUS.DONE : blocked ? state.STATUS.BLOCKED : state.STATUS.FAILED,
      endedAt: new Date().toISOString(),
      commits,
      turns: outcome.turns,
      error: ok ? null : (outcome.result || outcome.stderr || '').slice(0, 500),
    });

    log(ok ? `T${n} (barrier): done — ${commits.length} commit(s)` : `T${n} (barrier): FAILED`);
    outcomes.push({ n, ok });
    if (!ok) return { ok: false, outcomes, failedAt: n };
  }

  return { ok: true, outcomes };
}

/** The full suite at the merge point. Not a lane's subset — the whole thing. */
function fullSuite(st, { log = () => {} } = {}) {
  const cmd = st.testCommand;
  if (!cmd) {
    return { ok: false, skipped: true, summary: 'no test command known — set one in the plan Global Constraints or pass --test-command' };
  }
  log(`full suite: running \`${cmd}\` in ${st.repoRoot}`);
  const res = run(cmd, st.repoRoot);
  const tail = res.out.split('\n').slice(-40).join('\n');
  return { ok: res.ok, code: res.code, summary: tail, command: cmd };
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
    sessionId: newSessionId(),
    // The review is a judgment task on a large diff — the one place worth the
    // most capable model available.
    model: opts.reviewModel || opts.model,
    permissionMode: 'plan',
    timeoutMs: opts.reviewTimeoutMs || opts.taskTimeoutMs,
    logFile,
    signal: opts.signal,
  });

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
  };
}

/** The whole phase, in order, checkpointing after each stage. */
async function integrate(planPath, st, plan, opts = {}) {
  const log = opts.log || (() => {});

  if (st.integration.status !== 'merged' && st.integration.status !== state.STATUS.DONE) {
    const m = mergeLanes(st, { log, noFf: opts.noFf !== false });
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

  const suite = fullSuite(st, { log });
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

module.exports = { integrate, mergeLanes, runBarriers, fullSuite, crossLaneReview, reviewPackage };
