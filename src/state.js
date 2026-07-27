'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * The durable checkpoint. Everything needed to resume lives here — never in a
 * transcript, never in an agent's context.
 *
 * Two properties matter more than the schema:
 *
 *  1. The CLI writes it, not the agent. A lane process killed mid-task cannot
 *     corrupt or forget its own status, because it was never the author.
 *  2. Writes are atomic (tmp + rename). A crash during a write leaves the
 *     previous good state, not a truncated file.
 */

const SCHEMA = 1;

const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  INTERRUPTED: 'interrupted',
};

/** Terminal for scheduling purposes: don't re-run these. */
const isSettled = (s) => s === STATUS.DONE;
/** Re-runnable on resume: the work is unfinished and nothing is holding it. */
const isResumable = (s) => s === STATUS.PENDING || s === STATUS.INTERRUPTED || s === STATUS.FAILED;

const statePathFor = (planPath) => path.join(path.dirname(planPath), '.plan-state.json');

const hashPlan = (contents) => crypto.createHash('sha256').update(contents).digest('hex').slice(0, 16);

function nowIso() {
  return new Date().toISOString();
}

function create({ planPath, planContents, repoRoot, baseBranch, baseCommit, maxLanes, lanes, barriers, testCommand }) {
  const tasks = {};
  for (const lane of lanes) {
    for (const n of lane.tasks) {
      tasks[n] = { status: STATUS.PENDING, lane: lane.id, attempts: 0, commits: [], sessionId: null, error: null };
    }
  }
  for (const n of barriers) {
    tasks[n] = { status: STATUS.PENDING, lane: null, barrier: true, attempts: 0, commits: [], sessionId: null, error: null };
  }

  return {
    schema: SCHEMA,
    plan: planPath,
    planHash: hashPlan(planContents),
    repoRoot,
    testCommand: testCommand || null,
    base: { branch: baseBranch, commit: baseCommit },
    maxLanes,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lanes: lanes.map((l) => ({ id: l.id, tasks: l.tasks, branch: null, worktree: null, weight: l.weight })),
    barriers,
    tasks,
    integration: { status: STATUS.PENDING, mergedLanes: [], suite: null, review: null },
  };
}

function load(planPath) {
  const p = statePathFor(planPath);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    throw new Error(`.plan-state.json is corrupt (${e.message}). Move it aside and re-run \`plo analyze\`.`);
  }
  if (state.schema !== SCHEMA) {
    throw new Error(`.plan-state.json schema ${state.schema} != ${SCHEMA}. This CLI cannot read it.`);
  }
  return state;
}

/** Atomic: a crash mid-write leaves the previous good file intact. */
function save(planPath, state) {
  const p = statePathFor(planPath);
  state.updatedAt = nowIso();
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, p);
  return p;
}

/** Mutate one task's record and persist immediately. Called after every event. */
function updateTask(planPath, state, n, patch) {
  const key = String(n);
  state.tasks[key] = { ...(state.tasks[key] || {}), ...patch };
  save(planPath, state);
  return state.tasks[key];
}

/**
 * Bring state back in line with reality after an unclean stop.
 *
 * - A task left `running` had its process killed: it is `interrupted`, and its
 *   partial work (if any) is visible in git.
 * - A task with commits on its lane branch that state calls pending was
 *   completed by a process that died before reporting. `gitCommitsFor` lets the
 *   caller supply that lookup so this stays testable without a repo.
 */
function reconcile(state, { gitCommitsFor, planContents } = {}) {
  const notes = [];

  if (planContents && hashPlan(planContents) !== state.planHash) {
    notes.push({
      level: 'warn',
      message: 'The plan file changed since this state was created. Task numbering may have shifted — '
        + 're-run `plo analyze` and review the lane plan before resuming.',
    });
  }

  for (const [n, rec] of Object.entries(state.tasks)) {
    if (rec.status === STATUS.RUNNING) {
      rec.status = STATUS.INTERRUPTED;
      notes.push({ level: 'info', message: `Task ${n} was running when the run stopped — marked interrupted.` });
    }

    if (typeof gitCommitsFor === 'function' && !isSettled(rec.status)) {
      const commits = gitCommitsFor(Number(n), rec) || [];
      if (commits.length) {
        rec.commits = commits;
        rec.status = STATUS.DONE;
        rec.reconciled = true;
        notes.push({
          level: 'info',
          message: `Task ${n} has ${commits.length} commit(s) on its lane branch but was not recorded done — reconciled from git.`,
        });
      }
    }
  }

  return notes;
}

/** Tasks eligible to start right now: resumable, and all DAG deps settled. */
function readyTasks(state, edges) {
  const settled = new Set(
    Object.entries(state.tasks).filter(([, r]) => isSettled(r.status)).map(([n]) => Number(n)),
  );
  const inFlight = new Set(
    Object.entries(state.tasks).filter(([, r]) => r.status === STATUS.RUNNING).map(([n]) => Number(n)),
  );
  const barrierSet = new Set(state.barriers);

  const depsOf = (n) => edges.filter((e) => e.to === n).map((e) => e.from);

  const ready = [];
  for (const lane of state.lanes) {
    for (const n of lane.tasks) {
      const rec = state.tasks[String(n)];
      if (!rec) continue;
      if (isSettled(rec.status)) continue; // finished — look further down the lane

      // This is the lane's first unfinished task, and a lane is strictly
      // sequential. Whatever its state, nothing behind it may start: skipping
      // ahead would put two processes in one worktree, which is the exact
      // corruption per-lane worktrees exist to prevent.
      if (rec.status === STATUS.RUNNING || inFlight.has(n)) break; // lane busy
      if (!isResumable(rec.status)) break;                        // e.g. blocked: lane stalls
      if (depsOf(n).every((d) => settled.has(d))) ready.push({ n, lane: lane.id });
      break;
    }
  }

  // Barriers run only once every lane task is settled, and strictly in order.
  const allLaneTasksDone = state.lanes.every((l) => l.tasks.every((n) => settled.has(n)));
  if (allLaneTasksDone) {
    for (const n of state.barriers) {
      const rec = state.tasks[String(n)];
      if (!rec) continue;
      if (isSettled(rec.status)) continue;
      if (isResumable(rec.status) && !inFlight.has(n)) ready.push({ n, lane: null, barrier: true });
      break; // barriers are strictly sequential
    }
  }

  return ready.filter((r) => barrierSet.has(r.n) === Boolean(r.barrier));
}

function summarize(state) {
  const counts = {};
  for (const rec of Object.values(state.tasks)) counts[rec.status] = (counts[rec.status] || 0) + 1;
  const total = Object.keys(state.tasks).length;
  return { total, counts, done: counts[STATUS.DONE] || 0 };
}

module.exports = {
  SCHEMA, STATUS, statePathFor, hashPlan,
  create, load, save, updateTask, reconcile, readyTasks, summarize,
  isSettled, isResumable,
};
