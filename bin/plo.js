#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parsePlan } = require('../src/parse-plan');
const { buildDag } = require('../src/build-dag');
const state = require('../src/state');
const wt = require('../src/worktrees');
const { runLanes, prepareLanes } = require('../src/run');
const { integrate } = require('../src/integrate');
const render = require('../src/render');

/**
 * plo — parallel lane execution for TDD implementation plans.
 *
 * Agent-agnostic by construction: plain argv in, human text or `--json` out,
 * meaningful exit codes. Nothing here assumes it is being driven by a
 * particular assistant, or by an assistant at all.
 */

const EXIT = { OK: 0, USAGE: 2, ANALYSIS: 3, RUN_INCOMPLETE: 4, INTEGRATION: 5 };

function parseArgv(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i += 1; }
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

const log = (msg) => process.stderr.write(`${msg}\n`);
const out = (msg) => process.stdout.write(`${msg}\n`);

function loadPlan(planPath) {
  if (!planPath) fail('no plan file given. Usage: plo <command> --plan <file>', EXIT.USAGE);
  const abs = path.resolve(planPath);
  if (!fs.existsSync(abs)) fail(`no such plan file: ${abs}`, EXIT.USAGE);
  const contents = fs.readFileSync(abs, 'utf8');
  const plan = parsePlan(contents);
  if (!plan.tasks.length) {
    fail(`no tasks found in ${abs}. Expected headings like "### Task 1: ...".`, EXIT.ANALYSIS);
  }
  return { abs, contents, plan };
}

function fail(msg, code = 1) {
  process.stderr.write(`plo: ${msg}\n`);
  process.exit(code);
}

/** Tasks already complete: the plan's own checkboxes, plus the state file. */
function resolveDone(plan, st, args) {
  const done = new Set();
  for (const t of plan.tasks) if (t.done) done.add(t.n);
  if (st) {
    for (const [n, r] of Object.entries(st.tasks)) if (r.status === state.STATUS.DONE) done.add(Number(n));
  }
  if (args.done) String(args.done).split(',').map((s) => Number(s.trim())).filter(Boolean).forEach((n) => done.add(n));
  return [...done].sort((a, b) => a - b);
}

function loadOverrides(planPath, args) {
  const p = args.overrides ? path.resolve(args.overrides) : path.join(path.dirname(planPath), '.plan-lanes.json');
  if (!fs.existsSync(p)) return { file: null, overrides: {} };
  try {
    return { file: p, overrides: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    fail(`could not parse overrides at ${p}: ${e.message}`, EXIT.USAGE);
    return null;
  }
}

// ---------------------------------------------------------------- commands

function cmdAnalyze(args) {
  const { abs, contents, plan } = loadPlan(args.plan);
  const existing = state.load(abs);
  const done = resolveDone(plan, existing, args);
  const { file: ovFile, overrides } = loadOverrides(abs, args);
  const maxLanes = Number(args['max-lanes'] || (existing && existing.maxLanes) || 3);

  const dag = buildDag(plan.tasks, { done, maxLanes, overrides, inferSemantic: args['no-infer'] !== true });

  if (dag.cycle && dag.cycle.length) {
    fail(`dependency cycle among tasks ${dag.cycle.join(', ')}. Correct it in ${ovFile || '.plan-lanes.json'} with a dropEdges entry.`, EXIT.ANALYSIS);
  }

  if (args.json) {
    out(JSON.stringify({ plan: abs, title: plan.title, constraints: plan.constraints, ...dag }, null, 2));
    return EXIT.OK;
  }

  out(render.dag(plan, dag, { planPath: abs, overridesFile: ovFile }));
  return EXIT.OK;
}

function cmdInit(args) {
  const { abs, contents, plan } = loadPlan(args.plan);
  const existing = state.load(abs);
  if (existing && !args.force) {
    fail(`state already exists at ${state.statePathFor(abs)}. Use \`plo status\` or \`plo resume\`, or pass --force to recreate.`, EXIT.USAGE);
  }

  const done = resolveDone(plan, existing, args);
  const { overrides } = loadOverrides(abs, args);
  const maxLanes = Number(args['max-lanes'] || 3);
  const dag = buildDag(plan.tasks, { done, maxLanes, overrides });
  if (dag.cycle && dag.cycle.length) fail(`dependency cycle among tasks ${dag.cycle.join(', ')}.`, EXIT.ANALYSIS);

  const repoRoot = args.repo ? path.resolve(args.repo) : wt.repoRoot(path.dirname(abs));
  const baseBranch = args.base || wt.currentBranch(repoRoot);
  const baseCommit = wt.headCommit(repoRoot);

  const st = state.create({
    planPath: abs,
    planContents: contents,
    repoRoot,
    baseBranch,
    baseCommit,
    maxLanes,
    lanes: dag.lanes,
    barriers: dag.barriers,
    testCommand: args['test-command'] || plan.constraints.testCommand,
  });
  const p = state.save(abs, st);

  out(`state written: ${p}`);
  out(`  repo:    ${repoRoot}`);
  out(`  base:    ${baseBranch} @ ${baseCommit.slice(0, 7)}`);
  out(`  lanes:   ${dag.lanes.map((l) => `${l.id}[${l.tasks.join(',')}]`).join(' ')}`);
  out(`  barriers:${dag.barriers.length ? ` ${dag.barriers.join(' -> ')}` : ' none'}`);
  out(`  done:    ${done.length ? done.join(', ') : 'none'}`);
  out(`  tests:   ${st.testCommand || '(unknown — pass --test-command)'}`);
  return EXIT.OK;
}

async function cmdRun(args, { resuming = false } = {}) {
  const { abs, contents, plan } = loadPlan(args.plan);
  let st = state.load(abs);
  if (!st) {
    if (!resuming) { cmdInit(args); st = state.load(abs); } else fail('no .plan-state.json — run `plo init` first.', EXIT.USAGE);
  }

  const notes = state.reconcile(st, {
    planContents: contents,
    gitCommitsFor: (n, rec) => {
      const lane = st.lanes.find((l) => l.id === rec.lane);
      if (!lane || !lane.branch || !rec.baseBefore) return [];
      return wt.laneCommits(st.repoRoot, rec.baseBefore, lane.branch).map((c) => c.sha);
    },
  });
  for (const n of notes) log(`${n.level}: ${n.message}`);
  state.save(abs, st);

  const done = resolveDone(plan, st, args);
  const { overrides } = loadOverrides(abs, args);
  const dag = buildDag(plan.tasks, { done, maxLanes: st.maxLanes, overrides });

  if (args['dry-run']) {
    out(render.dag(plan, dag, { planPath: abs, state: st, dryRun: true }));
    return EXIT.OK;
  }

  prepareLanes(abs, st, { worktreeDir: args['worktree-dir'], extraSeed: args.seed ? String(args.seed).split(',') : [], log });

  const controller = new AbortController();
  const onSignal = () => {
    log('\ninterrupted — letting in-flight tasks finish writing state. Ctrl-C again to kill.');
    controller.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const res = await runLanes(abs, st, plan, {
    edges: dag.edges,
    maxLanes: st.maxLanes,
    model: args.model,
    permissionMode: args['permission-mode'] || 'acceptEdits',
    maxTurns: args['max-turns'] ? Number(args['max-turns']) : undefined,
    taskTimeoutMs: args.timeout ? Number(args.timeout) * 1000 : undefined,
    signal: controller.signal,
    log,
  });

  out(render.runSummary(st, res));

  if (!res.allLanesDone) {
    out('\nLanes did not all complete. Fix or investigate, then `plo resume --plan <file>`.');
    return EXIT.RUN_INCOMPLETE;
  }
  if (args.integrate) return cmdIntegrate(args);

  out('\nAll lane tasks done. Next: `plo integrate --plan <file>`');
  return EXIT.OK;
}

async function cmdIntegrate(args) {
  const { abs, contents, plan } = loadPlan(args.plan);
  const st = state.load(abs);
  if (!st) fail('no .plan-state.json — nothing to integrate.', EXIT.USAGE);

  const res = await integrate(abs, st, plan, {
    model: args.model,
    reviewModel: args['review-model'] || args.model,
    permissionMode: args['permission-mode'] || 'acceptEdits',
    taskTimeoutMs: args.timeout ? Number(args.timeout) * 1000 : undefined,
    noFf: args['no-ff'] !== 'false',
    log,
  });

  out(render.integration(st, res));
  return res.ok ? EXIT.OK : EXIT.INTEGRATION;
}

function cmdStatus(args) {
  const { abs, contents, plan } = loadPlan(args.plan);
  const st = state.load(abs);
  if (!st) { out('no .plan-state.json yet — run `plo analyze` then `plo init`.'); return EXIT.OK; }
  if (args.json) { out(JSON.stringify(st, null, 2)); return EXIT.OK; }
  out(render.status(plan, st));
  return EXIT.OK;
}

function cmdClean(args) {
  const { abs } = loadPlan(args.plan);
  const st = state.load(abs);
  if (!st) fail('no .plan-state.json — nothing to clean.', EXIT.USAGE);

  const unmerged = st.lanes.filter((l) => l.branch && wt.laneCommits(st.repoRoot, st.base.commit, l.branch).length
    && !st.integration.mergedLanes.includes(l.id));
  if (unmerged.length && !args.force) {
    fail(`lanes ${unmerged.map((l) => l.id).join(', ')} have unmerged commits. `
      + 'Run `plo integrate` first, or pass --force to remove the worktrees anyway (branches are kept).', EXIT.USAGE);
  }

  for (const lane of st.lanes) {
    if (!lane.worktree) continue;
    wt.removeLaneWorktree({ root: st.repoRoot, dest: lane.worktree, branch: lane.branch, deleteBranch: Boolean(args['delete-branches']) });
    out(`removed worktree for lane ${lane.id}: ${lane.worktree}`);
  }
  return EXIT.OK;
}

const USAGE = `plo — parallel lane execution for TDD implementation plans

USAGE
  plo <command> --plan <plan.md> [options]

COMMANDS
  analyze     Parse the plan, build the DAG, print the lane plan for review.
              Changes nothing. Run this first, correct it, then init.
  init        Write .plan-state.json from the approved lane plan.
  run         Create lane worktrees and execute lane tasks concurrently.
  resume      Reconcile state with git and continue where the last run stopped.
  integrate   Merge lanes -> barrier tasks -> FULL suite -> cross-lane review.
  status      Print per-task status from the checkpoint file.
  clean       Remove lane worktrees (refuses if a lane has unmerged commits).

OPTIONS
  --plan <file>          the plan markdown (required)
  --max-lanes <n>        concurrency ceiling (default 3)
  --done <1,2>           mark tasks complete on top of the plan's checkboxes
  --overrides <file>     lane corrections (default: .plan-lanes.json beside the plan)
  --no-infer             disable the docs/wrap-up barrier heuristics
  --dry-run              with run/resume: show what would execute, spawn nothing
  --json                 machine-readable output (analyze, status)
  --model <name>         model for task processes
  --review-model <name>  model for the cross-lane review (defaults to --model)
  --permission-mode <m>  passed through to the agent (default acceptEdits)
  --max-turns <n>        per-process turn cap
  --timeout <seconds>    per-task wall-clock cap
  --worktree-dir <dir>   where lane worktrees go (default ../.plo-worktrees)
  --seed <a,b>           extra untracked paths to copy into each worktree
  --test-command <cmd>   override the test command parsed from the plan
  --integrate            with run: continue straight into integration
  --delete-branches      with clean: delete lane branches too

ENVIRONMENT
  PLO_AGENT_BIN          agent CLI to spawn (default: claude)

EXIT CODES
  0 ok   2 usage   3 analysis error   4 run incomplete   5 integration failed
`;

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgv(argv);
  const cmd = args._[0];

  if (!cmd || args.help || args.h) { out(USAGE); return EXIT.OK; }
  // Allow `plo analyze path.md` as well as `--plan path.md`.
  if (!args.plan && args._[1]) args.plan = args._[1];

  switch (cmd) {
    case 'analyze': return cmdAnalyze(args);
    case 'init': return cmdInit(args);
    case 'run': return cmdRun(args);
    case 'resume': return cmdRun(args, { resuming: true });
    case 'integrate': return cmdIntegrate(args);
    case 'status': return cmdStatus(args);
    case 'clean': return cmdClean(args);
    default:
      fail(`unknown command \`${cmd}\`. Run \`plo --help\`.`, EXIT.USAGE);
      return EXIT.USAGE;
  }
}

main().then((code) => process.exit(code ?? EXIT.OK)).catch((e) => {
  process.stderr.write(`plo: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
