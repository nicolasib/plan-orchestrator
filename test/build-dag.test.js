'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDag, buildEdges, topoSort, findBarriers, inferSemanticEdges, isDocPath } = require('../src/build-dag');

/** Minimal task shape the DAG builder needs. */
const T = (n, writes = [], extra = {}) => ({
  n, title: `Task ${n}`, weight: extra.weight || 10, writes,
  consumesTasks: extra.consumes || [], producesForTasks: extra.produces || [],
  files: { modify: writes, create: [], test: [], delete: [] },
});

test('rule 1: two tasks writing the same path get a hard edge in plan order', () => {
  const { edges, conflicts } = buildEdges([T(1, ['src/a.js']), T(2, ['src/a.js'])]);
  assert.equal(edges.length, 1);
  assert.deepEqual({ from: edges[0].from, to: edges[0].to, kind: edges[0].kind }, { from: 1, to: 2, kind: 'write-write' });
  assert.match(edges[0].evidence, /both write `src\/a\.js`/);
  assert.deepEqual(conflicts, [{ path: 'src/a.js', tasks: [1, 2] }]);
});

test('rule 1: disjoint writes produce no edge', () => {
  const { edges } = buildEdges([T(1, ['src/a.js']), T(2, ['src/b.js'])]);
  assert.deepEqual(edges, []);
});

test('read-only sharing is not a conflict — only declared writes count', () => {
  // Both tasks consume src/utils/platforms.js but neither declares it.
  const a = T(1, ['src/a.js'], { consumes: [] });
  const b = T(2, ['src/b.js'], { consumes: [] });
  const { edges } = buildEdges([a, b]);
  assert.deepEqual(edges, [], 'shared reads must never serialize lanes');
});

test('rule 2: Consumes points backward, Produces points forward', () => {
  const tasks = [T(1, ['src/h.js'], { produces: [2] }), T(2, ['src/a.js'], { consumes: [1] })];
  const { edges } = buildEdges(tasks);
  assert.equal(edges.length, 1, 'the same edge stated from both ends is one edge');
  assert.deepEqual({ from: edges[0].from, to: edges[0].to }, { from: 1, to: 2 });
});

test('rule 0: completed tasks leave the graph, and their conflicts leave with them', () => {
  const tasks = [T(1, ['src/a.js']), T(2, ['src/a.js']), T(3, ['src/b.js'])];
  const { live, edges, conflicts } = buildEdges(tasks, { done: [1] });
  assert.deepEqual(live.map((t) => t.n), [2, 3]);
  assert.deepEqual(edges, [], 'T2 no longer conflicts with merged T1');
  assert.deepEqual(conflicts, []);
});

test('rule 4: an override drops a hard edge and can add one', () => {
  const tasks = [T(1, ['src/a.js']), T(2, ['src/a.js']), T(3, ['src/c.js'])];
  const { edges } = buildEdges(tasks, {
    overrides: { dropEdges: ['1->2'], addEdges: [{ from: 3, to: 1, reason: 'human says so' }] },
  });
  assert.equal(edges.length, 1);
  assert.deepEqual({ from: edges[0].from, to: edges[0].to, kind: edges[0].kind }, { from: 3, to: 1, kind: 'override' });
});

test('a hard write-write edge is not downgraded by a softer restatement', () => {
  const tasks = [T(1, ['src/a.js']), T(2, ['src/a.js'], { consumes: [1] })];
  const { edges } = buildEdges(tasks);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, 'write-write', 'the stronger evidence survives');
});

test('topoSort reports a cycle instead of silently reordering', () => {
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 1 }];
  const { order, cycle } = topoSort([1, 2], edges);
  assert.deepEqual(order, []);
  assert.deepEqual(cycle, [1, 2]);
});

test('isDocPath distinguishes docs from source', () => {
  assert.equal(isDocPath('docs/openapi/v1.yaml'), true);
  assert.equal(isDocPath('docs/external-api.md'), true);
  assert.equal(isDocPath('src/routes/a.js'), false);
  assert.equal(isDocPath('tests/a.test.js'), false);
});

test('inferSemanticEdges: a no-writes task gates on everything', () => {
  const tasks = [T(1, ['src/a.js']), T(2, ['src/b.js']), T(3, [])];
  const inferred = inferSemanticEdges(tasks);
  assert.deepEqual(inferred.map((e) => `${e.from}->${e.to}`).sort(), ['1->3', '2->3']);
});

test('inferSemanticEdges: a docs-only task gates on every code task', () => {
  const tasks = [T(1, ['src/a.js']), T(2, ['docs/api.md'])];
  const inferred = inferSemanticEdges(tasks);
  assert.deepEqual(inferred.map((e) => `${e.from}->${e.to}`), ['1->2']);
});

test('findBarriers peels in levels and returns execution order', () => {
  // 1,2 are code; 3 is docs (gates on 1,2); 4 is wrap-up (gates on all).
  const nums = [1, 2, 3, 4];
  const edges = [
    { from: 1, to: 3 }, { from: 2, to: 3 },
    { from: 1, to: 4 }, { from: 2, to: 4 }, { from: 3, to: 4 },
  ];
  assert.deepEqual(findBarriers(nums, edges), [3, 4], 'docs then wrap-up, in that order');
});

test('packLanes never exceeds maxLanes and keeps conflicting tasks in one lane', () => {
  const tasks = [
    T(1, ['src/a.js'], { weight: 100 }), T(2, ['src/b.js'], { weight: 100 }),
    T(3, ['src/c.js'], { weight: 100 }), T(4, ['src/a.js'], { weight: 100 }),
  ];
  const dag = buildDag(tasks, { maxLanes: 2 });
  assert.ok(dag.lanes.length <= 2, `expected <=2 lanes, got ${dag.lanes.length}`);

  const laneOf = new Map();
  dag.lanes.forEach((l) => l.tasks.forEach((n) => laneOf.set(n, l.id)));
  assert.equal(laneOf.get(1), laneOf.get(4), 'T1 and T4 both write src/a.js — same lane');
  const lane = dag.lanes.find((l) => l.id === laneOf.get(1));
  assert.ok(lane.tasks.indexOf(1) < lane.tasks.indexOf(4), 'and in dependency order');
});

test('packing to fewer lanes only removes parallelism — never creates a conflict', () => {
  const tasks = [
    T(1, ['src/a.js']), T(2, ['src/b.js']), T(3, ['src/c.js']),
    T(4, ['src/d.js']), T(5, ['src/e.js']),
  ];
  for (const maxLanes of [1, 2, 3, 5]) {
    const dag = buildDag(tasks, { maxLanes });
    assert.ok(dag.lanes.length <= maxLanes);
    const placed = dag.lanes.flatMap((l) => l.tasks).sort((a, b) => a - b);
    assert.deepEqual(placed, [1, 2, 3, 4, 5], `every task placed exactly once at maxLanes=${maxLanes}`);
  }
});

test('a barrier is never packed into a lane', () => {
  const tasks = [T(1, ['src/a.js']), T(2, ['src/b.js']), T(3, [])];
  const dag = buildDag(tasks, { maxLanes: 3 });
  assert.deepEqual(dag.barriers, [3]);
  assert.ok(!dag.lanes.flatMap((l) => l.tasks).includes(3));
});
