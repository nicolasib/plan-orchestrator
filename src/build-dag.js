'use strict';

/**
 * Turn parsed tasks into a DAG, then pack the DAG into lanes.
 *
 * Edge rules, in priority order:
 *   1. write-write  — two tasks declare the same path. Hard edge, never dropped.
 *   2. interface    — a Consumes/Produces block names another task literally.
 *   3. semantic     — supplied by an LLM pass or the plan author. Soft: shown
 *                     to the human, and droppable via an override file.
 *   4. override     — the human's corrections. Win over everything.
 *
 * Rule 0 runs before any of them: tasks already completed are removed from the
 * graph entirely. A conflict against merged work is not a conflict.
 */

const EDGE_KINDS = { WRITE: 'write-write', IFACE: 'interface', SEMANTIC: 'semantic', OVERRIDE: 'override' };

/** Stable key so an edge can be named in an override file: "3->8". */
const edgeKey = (from, to) => `${from}->${to}`;

/**
 * @param {Array} tasks parsed tasks
 * @param {object} opts
 * @param {number[]} opts.done task numbers already complete (from state/git)
 * @param {Array} opts.semanticEdges [{from,to,reason}] from the LLM pass
 * @param {object} opts.overrides { addEdges:[], dropEdges:[], pin:{taskN:lane} }
 */
function buildEdges(tasks, opts = {}) {
  const { done = [], semanticEdges = [], overrides = {} } = opts;
  const doneSet = new Set(done);
  const live = tasks.filter((t) => !doneSet.has(t.n));
  const liveNums = new Set(live.map((t) => t.n));

  /** @type {Map<string, {from:number,to:number,kind:string,evidence:string}>} */
  const edges = new Map();
  const add = (from, to, kind, evidence) => {
    if (from === to) return;
    if (!liveNums.has(from) || !liveNums.has(to)) return; // rule 0
    const key = edgeKey(from, to);
    const existing = edges.get(key);
    // A hard rule already recorded beats a softer restatement of the same edge.
    if (existing && rank(existing.kind) <= rank(kind)) return;
    edges.set(key, { from, to, kind, evidence });
  };
  const rank = (kind) => [EDGE_KINDS.OVERRIDE, EDGE_KINDS.WRITE, EDGE_KINDS.IFACE, EDGE_KINDS.SEMANTIC].indexOf(kind);

  // --- Rule 1: write-write conflicts ---------------------------------------
  const byPath = new Map();
  for (const t of live) {
    for (const p of t.writes) {
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(t.n);
    }
  }
  const conflicts = [];
  for (const [path, owners] of byPath) {
    if (owners.length < 2) continue;
    const sorted = [...owners].sort((a, b) => a - b);
    conflicts.push({ path, tasks: sorted });
    // Chain them in plan order: the plan's own sequence is the tie-breaker.
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      add(sorted[i], sorted[i + 1], EDGE_KINDS.WRITE, `both write \`${path}\``);
    }
  }

  // --- Rule 2: interface references ----------------------------------------
  for (const t of live) {
    for (const dep of t.consumesTasks) {
      add(dep, t.n, EDGE_KINDS.IFACE, `Task ${t.n} Consumes: names Task ${dep}`);
    }
    for (const consumer of t.producesForTasks) {
      add(t.n, consumer, EDGE_KINDS.IFACE, `Task ${t.n} Produces: names Task ${consumer}`);
    }
  }

  // --- Rule 3: semantic edges from the LLM pass ----------------------------
  for (const e of semanticEdges) {
    add(e.from, e.to, EDGE_KINDS.SEMANTIC, e.reason || 'semantic dependency');
  }

  // --- Rule 4: human overrides --------------------------------------------
  for (const e of overrides.addEdges || []) {
    const key = edgeKey(e.from, e.to);
    edges.set(key, { from: e.from, to: e.to, kind: EDGE_KINDS.OVERRIDE, evidence: e.reason || 'manual override' });
  }
  for (const spec of overrides.dropEdges || []) {
    const key = typeof spec === 'string' ? spec : edgeKey(spec.from, spec.to);
    edges.delete(key);
  }

  return { live, edges: [...edges.values()], conflicts };
}

/** Kahn topological sort. Returns {order, cycle} — cycle is non-empty on failure. */
function topoSort(nums, edges) {
  const indeg = new Map(nums.map((n) => [n, 0]));
  const out = new Map(nums.map((n) => [n, []]));
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    indeg.set(e.to, indeg.get(e.to) + 1);
    out.get(e.from).push(e.to);
  }
  // Lowest task number first keeps output deterministic and plan-ordered.
  const ready = nums.filter((n) => indeg.get(n) === 0).sort((a, b) => a - b);
  const order = [];
  while (ready.length) {
    const n = ready.shift();
    order.push(n);
    for (const m of out.get(n)) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) {
        ready.push(m);
        ready.sort((a, b) => a - b);
      }
    }
  }
  const cycle = nums.filter((n) => !order.includes(n));
  return { order, cycle };
}

/** Transitive ancestors of each node, used to detect true independence. */
function ancestorSets(nums, edges) {
  const preds = new Map(nums.map((n) => [n, []]));
  for (const e of edges) if (preds.has(e.to)) preds.get(e.to).push(e.from);

  const memo = new Map();
  const visit = (n, seen = new Set()) => {
    if (memo.has(n)) return memo.get(n);
    if (seen.has(n)) return new Set();
    seen.add(n);
    const acc = new Set();
    for (const p of preds.get(n) || []) {
      acc.add(p);
      for (const a of visit(p, seen)) acc.add(a);
    }
    memo.set(n, acc);
    return acc;
  };
  return new Map(nums.map((n) => [n, visit(n)]));
}

/**
 * A barrier task depends (transitively) on every other live task — a full-suite
 * run, a PR task, a docs pass. Barriers come in levels: peel the outermost one
 * off and the next may itself become a barrier over what remains. Returned in
 * execution order, so [10, 11] means "docs, then PR".
 */
function findBarriers(nums, edges) {
  const barriers = [];
  let remaining = [...nums];

  for (;;) {
    const anc = ancestorSets(remaining, edges.filter((e) => remaining.includes(e.from) && remaining.includes(e.to)));
    const found = remaining.filter((n) => {
      const others = remaining.filter((m) => m !== n);
      return others.length > 0 && others.every((m) => anc.get(n).has(m));
    });
    if (!found.length) break;
    barriers.unshift(...found.sort((a, b) => a - b));
    remaining = remaining.filter((n) => !found.includes(n));
  }

  return barriers;
}

const DOC_EXTENSIONS = /\.(md|mdx|ya?ml|json|txt)$/i;
const isDocPath = (p) => /(^|\/)docs?\//i.test(p) || (DOC_EXTENSIONS.test(p) && !/(^|\/)(src|lib|app|tests?)\//i.test(p));

/**
 * Deterministic stand-ins for the LLM semantic pass, so the CLI produces a
 * correct DAG with no model in the loop. Both are emitted as SEMANTIC (soft):
 * they show up in the review output flagged for a human, and an override file
 * can drop them.
 *
 *   - A task that declares no writes at all is a wrap-up (full suite, open PR).
 *     It gates on everything.
 *   - A docs-only task describes contracts that code tasks settle, so it gates
 *     on every code task. It carries no file conflict — only an ordering one.
 */
function inferSemanticEdges(tasks) {
  const out = [];
  const codeTasks = tasks.filter((t) => t.writes.length && !t.writes.every(isDocPath));
  const docTasks = tasks.filter((t) => t.writes.length && t.writes.every(isDocPath));
  const wrapUps = tasks.filter((t) => t.writes.length === 0);

  for (const d of docTasks) {
    for (const c of codeTasks) {
      out.push({ from: c.n, to: d.n, reason: `docs-only task: describes contracts settled by Task ${c.n}` });
    }
  }
  for (const w of wrapUps) {
    for (const t of tasks) {
      if (t.n === w.n) continue;
      out.push({ from: t.n, to: w.n, reason: `Task ${w.n} declares no writes — wrap-up gating on Task ${t.n}` });
    }
  }
  return out;
}

/**
 * Pack tasks into at most maxLanes lanes.
 *
 * Two tasks may share a lane freely — a lane is sequential, so packing can only
 * ever *remove* parallelism, never create a conflict. The packer therefore
 * optimises for balance: longest-chain-first into the lightest lane, with the
 * constraint that a task must land at or after all of its in-lane ancestors.
 */
function packLanes(tasks, edges, maxLanes) {
  const nums = tasks.map((t) => t.n);
  const weight = new Map(tasks.map((t) => [t.n, t.weight || 1]));
  const { order, cycle } = topoSort(nums, edges);
  if (cycle.length) return { lanes: [], barriers: [], cycle };

  const barriers = findBarriers(nums, edges);
  const barrierSet = new Set(barriers);
  const schedulable = order.filter((n) => !barrierSet.has(n));
  const anc = ancestorSets(nums, edges);

  // Chain roots: a task whose ancestors are all barriers-or-none starts a chain.
  // Assign in topological order so a dependent always finds its ancestor placed.
  const lanes = [];
  const laneOf = new Map();

  for (const n of schedulable) {
    const inLaneAncestors = [...anc.get(n)].filter((a) => laneOf.has(a));
    const forced = new Set(inLaneAncestors.map((a) => laneOf.get(a)));

    let target;
    if (forced.size === 1) {
      // Exactly one lane already holds this task's history — extend it.
      target = [...forced][0];
    } else if (forced.size > 1) {
      // Ancestors span lanes: this task must follow all of them. It cannot be
      // packed in parallel with any; put it in the heaviest contributing lane
      // and record a join so the runner waits for the others.
      target = [...forced].sort((a, b) => laneWeight(b) - laneWeight(a))[0];
    } else if (lanes.length < maxLanes) {
      lanes.push({ id: laneId(lanes.length), tasks: [] });
      target = lanes.length - 1;
    } else {
      target = lightestLane();
    }

    lanes[target].tasks.push(n);
    laneOf.set(n, target);
  }

  function laneWeight(i) {
    return lanes[i].tasks.reduce((s, n) => s + (weight.get(n) || 1), 0);
  }
  function lightestLane() {
    let best = 0;
    for (let i = 1; i < lanes.length; i += 1) if (laneWeight(i) < laneWeight(best)) best = i;
    return best;
  }

  // Cross-lane dependencies the runner must respect as waits, not merges.
  const joins = [];
  for (const e of edges) {
    const a = laneOf.get(e.from);
    const b = laneOf.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) {
      joins.push({ from: e.from, to: e.to, fromLane: lanes[a].id, toLane: lanes[b].id, kind: e.kind });
    }
  }

  return {
    lanes: lanes.map((l) => ({
      ...l,
      tasks: l.tasks.sort((x, y) => order.indexOf(x) - order.indexOf(y)),
      weight: l.tasks.reduce((s, n) => s + (weight.get(n) || 1), 0),
    })),
    barriers,
    joins,
    order,
    cycle: [],
  };
}

const laneId = (i) => String.fromCharCode(65 + i); // A, B, C…

/**
 * Full analysis: parsed tasks + context -> reviewable lane plan.
 */
function buildDag(tasks, opts = {}) {
  const maxLanes = opts.maxLanes || 3;
  const doneSet = new Set(opts.done || []);
  // Infer over live tasks only: a docs task shouldn't gate on merged work.
  const inferred = opts.inferSemantic === false
    ? []
    : inferSemanticEdges(tasks.filter((t) => !doneSet.has(t.n)));
  const semanticEdges = [...inferred, ...(opts.semanticEdges || [])];
  const { live, edges, conflicts } = buildEdges(tasks, { ...opts, semanticEdges });
  const packed = packLanes(live, edges, maxLanes);

  return {
    maxLanes,
    done: (opts.done || []).slice().sort((a, b) => a - b),
    tasks: live,
    edges,
    conflicts,
    ...packed,
  };
}

module.exports = {
  buildDag, buildEdges, packLanes, topoSort, findBarriers, ancestorSets,
  inferSemanticEdges, isDocPath, EDGE_KINDS, edgeKey,
};
