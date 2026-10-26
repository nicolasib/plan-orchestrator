'use strict';

const fs = require('fs');
const path = require('path');
const state = require('./state');
const wt = require('./worktrees');
const { runAgent, newSessionId, pool } = require('./spawn');
const { laneTaskPrompt } = require('./prompts');
const { effortFor, plannedEffort, shouldRaise } = require('./effort');

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

/**
 * One task's text, cut from the plan the way SDD's `task-brief` script cuts it:
 * from its `Task N` heading to the next task heading, headings inside a fenced
 * block not counting. Kept identical on purpose, so a brief already on disk can
 * be compared with the plan's current text byte for byte.
 */
function taskSection(contents, n) {
  const lines = contents.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const own = new RegExp(`^#+[ \\t]+Task[ \\t]+${n}([^0-9]|$)`);
  const out = [];
  let infence = false;
  let intask = false;
  for (const line of lines) {
    if (/^```/.test(line)) infence = !infence;
    if (!infence && /^#+[ \t]+Task[ \t]+[0-9]+/.test(line)) intask = own.test(line);
    if (intask) out.push(line);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

const realPath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * Every lane worktree holds its own copy of the plan, frozen at the commit the
 * lane branched from, and that copy is the one an agent in the lane reads. A
 * revision committed on the integration branch after `init` never reaches it:
 * a task was once built from the old text that way. So before each task the
 * lane's copy is overwritten with the plan as it is now — and marked
 * skip-worktree, so no `git add -A` turns the revision into lane work. It is
 * the lane's view of the plan, never the lane's output.
 *
 * Returns true when the copy had drifted and was rewritten.
 */
function syncLanePlan(st, lane, planPath, planNow) {
  const rel = path.relative(realPath(st.repoRoot), realPath(planPath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false; // outside the repo: there is one copy
  try {
    wt.git(lane.worktree, ['ls-files', '--error-unmatch', rel], { quiet: true });
  } catch {
    return false; // not tracked: the lane has no copy of its own to drift
  }
  const copy = path.join(lane.worktree, rel);
  if (fs.existsSync(copy) && fs.readFileSync(copy, 'utf8') === planNow) return false;
  wt.git(lane.worktree, ['update-index', '--skip-worktree', rel]);
  fs.writeFileSync(copy, planNow);
  return true;
}

/**
 * SDD keeps each task's brief in the worktree (`.superpowers/sdd/<plan>/task-N-brief.md`),
 * and a resumed controller that finds one can dispatch it as it is. A brief
 * whose text is no longer the task's text is deleted before the task starts, so
 * the next one is cut from the current plan. A brief that still matches stays.
 */
function dropStaleBriefs(lane, n, planPath, planNow) {
  const root = path.join(lane.worktree, '.superpowers', 'sdd');
  if (!fs.existsSync(root)) return [];
  const want = taskSection(planNow, n);
  const dropped = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    // A workspace that names another plan is that plan's business.
    const marker = path.join(root, dir.name, 'plan-path');
    if (fs.existsSync(marker) && path.basename(fs.readFileSync(marker, 'utf8').trim()) !== path.basename(planPath)) continue;
    const brief = path.join(root, dir.name, `task-${n}-brief.md`);
    if (!fs.existsSync(brief) || fs.readFileSync(brief, 'utf8') === want) continue;
    fs.rmSync(brief);
    dropped.push(brief);
  }
  return dropped;
}

/**
 * A cross-lane edge means the later task builds on the earlier one's code, not
 * only that it starts after it: every kind of edge that can cross lanes —
 * write-write, interface, override, docs-after-code — says the dependent needs
 * what the producer wrote. Waiting without merging left a task running in a
 * worktree that never received that code, and it sat blocked all night.
 *
 * So each producer in another lane is merged into this lane before the task
 * starts — up to the producer's own last commit (`commits` is newest first, as
 * git lists them), never the other lane's tip, which may hold a task still in
 * flight. Already merged is a no-op, which is what makes resume safe.
 */
function mergeProducers(st, n, lane, edges) {
  const merged = [];
  const producers = [...new Set(edges.filter((e) => e.to === n).map((e) => e.from))].sort((a, b) => a - b);
  for (const m of producers) {
    const rec = st.tasks[String(m)];
    if (!rec || !rec.lane || rec.lane === lane.id) continue; // same lane already has it; a barrier has no lane
    const tip = (rec.commits || [])[0];
    if (!tip || wt.isAncestor(lane.worktree, tip)) continue;
    const res = wt.mergeCommit(lane.worktree, tip, `merge: T${m} (lane ${rec.lane}) into lane ${lane.id} for T${n}`);
    if (!res.ok) {
      return {
        ok: false,
        merged,
        error: `merging T${m} (lane ${rec.lane}, ${shortSha(tip)}) into lane ${lane.id} conflicted in `
          + `${res.conflicts.join(', ') || `the worktree (${res.detail})`}. The merge was aborted and lane ${lane.id} is as it was. `
          + `Merge it by hand in ${lane.worktree} (\`git merge --no-ff ${tip}\`), then \`plo resume\`.`,
      };
    }
    merged.push({ m, lane: rec.lane, tip });
  }
  return { ok: true, merged };
}

/** Everything one spawned process needs to know, assembled from plan + state. */
function buildTaskPrompt(st, plan, taskNumber, lane, verify = null) {
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
    verify,
  });
}

/**
 * Run one task to completion in its lane's worktree, recording state on both
 * sides of the process.
 */
async function runTask(planPath, st, plan, { n, lane: laneId }, opts) {
  const lane = st.lanes.find((l) => l.id === laneId);
  const rec = st.tasks[String(n)] || {};
  // A fresh id per attempt, never `rec.sessionId ||` — the agent CLI refuses a
  // `--session-id` it has already seen, so reusing the id off the checkpoint
  // made any task that failed once permanently unretryable: every later attempt
  // died on "Session ID <uuid> is already in use" before the agent ran, and the
  // retry loop spun on it. Nothing resumes that session — a retry re-runs the
  // task from scratch — so the id is only a label for the log.
  const sessionId = newSessionId();
  const logFile = path.join(path.dirname(planPath), '.plo-logs', `task-${n}.jsonl`);
  const say = (msg) => opts.log(`T${n} (lane ${laneId}): ${msg}`);

  // Bring the lane up to what this task builds on before its base is taken:
  // the plan as it reads now, and the code of producers in other lanes.
  let prep;
  try {
    const planNow = fs.readFileSync(planPath, 'utf8');
    if (syncLanePlan(st, lane, planPath, planNow)) say(`the lane's copy of the plan differed from ${planPath} — synced (kept out of lane commits)`);
    for (const brief of dropStaleBriefs(lane, n, planPath, planNow)) say(`deleted a stale SDD brief, cut from an older text of the task: ${brief}`);
    prep = mergeProducers(st, n, lane, opts.dependencyEdges || opts.edges || []);
    for (const x of prep.merged) say(`merged T${x.m} from lane ${x.lane} (${shortSha(x.tip)}) — this task builds on it`);
  } catch (e) {
    prep = { ok: false, error: `could not prepare lane ${laneId} for T${n}: ${e.message}` };
  }
  if (!prep.ok) {
    // A failed attempt like any other, so the retry cap bounds it. Thrown
    // instead, it would leave the status untouched and the scheduler would
    // offer the task again on every pass.
    state.updateTask(planPath, st, n, {
      status: state.STATUS.FAILED, lane: laneId, attempts: (rec.attempts || 0) + 1, endedAt: new Date().toISOString(), error: prep.error,
    });
    say(`FAILED — ${prep.error}`);
    return { n, ok: false, status: state.STATUS.FAILED, error: prep.error, commits: [] };
  }

  // A task that committed but never reported done is verified, not redone. Its
  // base stays where the work started, so the commits it already made are
  // counted — and reviewed — as this task's.
  const verifying = rec.status === state.STATUS.NEEDS_VERIFY && Boolean(rec.baseBefore);
  const baseBefore = verifying ? rec.baseBefore : wt.headCommit(lane.worktree);
  const verify = verifying ? { baseBefore, commits: rec.commits || [], lastError: rec.error || null } : null;

  // The plan's level for this task, one step up for each time it stopped on
  // its own result in this invocation. Null leaves the agent's default.
  const used = effortFor(plannedEffort(plan.tasks.find((t) => t.n === n)), rec.raises || 0);

  state.updateTask(planPath, st, n, {
    status: state.STATUS.RUNNING,
    lane: laneId,
    sessionId,
    attempts: (rec.attempts || 0) + 1,
    startedAt: new Date().toISOString(),
    logFile,
    baseBefore,
    effort: used,
    error: null,
  });
  opts.log(`T${n} (lane ${laneId}): ${verifying ? 'verifying' : 'started'} — session ${sessionId.slice(0, 8)} — log ${logFile}`);

  let outcome;
  try {
    outcome = await runAgent({
      cwd: lane.worktree,
      prompt: buildTaskPrompt(st, plan, n, lane, verify),
      sessionId,
      model: opts.model,
      effort: used,
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

  const commits = wt.ownCommits(st.repoRoot, baseBefore, lane.branch).map((c) => c.sha);
  const blocked = /STATUS:\s*BLOCKED/i.test(outcome.result || '');

  // Trust git over the agent's self-report: commits are the evidence that work
  // landed. An agent claiming DONE with no commits has not done the task. And
  // the reverse: commits from a process that did not report done are work that
  // landed unverified — the next attempt verifies them instead of redoing them.
  const ok = outcome.ok && !blocked && commits.length > 0;
  const status = ok
    ? state.STATUS.DONE
    : blocked ? state.STATUS.BLOCKED : commits.length ? state.STATUS.NEEDS_VERIFY : state.STATUS.FAILED;

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
    // Counted only here, where the agent ran to the end: a lane that could not
    // be prepared or a binary that never opened above leave it as it was.
    raises: (rec.raises || 0) + (shouldRaise(status, outcome, { aborted: Boolean(opts.signal && opts.signal.aborted) }) ? 1 : 0),
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

module.exports = { runLanes, runTask, prepareLanes, buildTaskPrompt, taskSection, pool };
