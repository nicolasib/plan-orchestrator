// smoke/task-16.js — Task 16: MAP › LANES, against the fixture of
// `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertClickable, assertConsole, shot, sleep, note and __rec.
// Every CLICKABLE row reads a value the click has to change. A column is a
// node's own left edge (`getBoundingClientRect().x`), and "an operator over
// node X" is a `.vb` inside `[data-testid=node-X]`.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';
const NODES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'MERGE', 'T8', 'SUITE', 'REVIEW'];
const POSES = ['trabalhando', 'travado', 'falhou', 'dormindo', 'orgulho'];

function check(id, label, ok, detail) {
  __rec(id, 'CHECK', Boolean(ok), `${label}: ${detail}`);
}

/** Poll a page-side predicate until it returns something truthy. */
async function until(page, fn, arg, timeout) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeout) {
    try { v = await page.evaluate(fn, arg); } catch (e) { v = undefined; }
    if (v) return v;
    await sleep(150);
  }
  return v;
}

const streamIs = (want) => {
  const el = document.querySelector('[data-testid=stream]');
  return Boolean(el) && el.textContent.trim() === want;
};

/** Open a scenario with the console buffer attached and wait for the stream. */
async function openLive(port, hash = '') {
  const page = await openWithConsole(`${HOST}:${port}/${hash}`);
  const live = Boolean(await until(page, streamIs, LIVE, 8000));
  if (!live) note(`${port} never showed ${LIVE} within 8 s`);
  return { page, live };
}

/** Every node: its left edge, its classes and the operator over it; and the
 *  drawn edges as `from>to`. */
const mapState = (page) => page.evaluate((ids) => {
  const nodes = {};
  for (const id of ids) {
    const el = document.querySelector(`[data-testid=node-${id}]`);
    if (!el) { nodes[id] = null; continue; }
    const use = el.querySelector('.vb use');
    nodes[id] = { x: el.getBoundingClientRect().x, cls: [...el.classList], op: use ? use.getAttribute('href') : null };
  }
  const edges = [...document.querySelectorAll('[data-testid=map-edge]')]
    .map((e) => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`);
  return { nodes, edges };
}, NODES);

/** The operator hrefs inside one node. */
const opsOver = (page, id) => page.evaluate((k) => {
  const el = document.querySelector(`[data-testid=node-${k}]`);
  return el ? [...el.querySelectorAll('.vb use')].map((u) => u.getAttribute('href')) : null;
}, id);

// ---------------------------------------------------------------- 7411 (mid)

const { page } = await openLive(7411, '#tab=MAP');
await until(page, () => Boolean(document.querySelector('[data-testid=node-T1]')), null, 4000);
const m = await mapState(page);

// S16-1 — every node of the run, and the one edge between lanes.
const missing = NODES.filter((id) => !m.nodes[id]);
check('S16-1', 'node-T1 … node-T7, node-MERGE, node-T8, node-SUITE and node-REVIEW exist', missing.length === 0,
  missing.length ? `missing ${missing.join(', ')}` : `all ${NODES.length} present`);
check('S16-1', 'exactly one map-edge, data-from 4 and data-to 3', m.edges.length === 1 && m.edges[0] === '4>3',
  `edges ${JSON.stringify(m.edges)}`);

// S16-2 — columns by the longest path: T1 → T2 → T3 in lane A, and T4 → T3
// pushes nothing back; T4 starts with T1 and T5 sits with T2.
const x = (id) => (m.nodes[id] ? m.nodes[id].x : NaN);
const xs = ['T1', 'T2', 'T3', 'T4', 'T5'].map((id) => `${id} ${x(id)}`).join(', ');
check('S16-2', 'x(T1) < x(T2) < x(T3)', x('T1') < x('T2') && x('T2') < x('T3'), xs);
check('S16-2', 'x(T4) === x(T1)', x('T4') === x('T1'), xs);
check('S16-2', 'x(T5) === x(T2)', x('T5') === x('T2'), xs);

// S16-2 — on the fixture the longest path and "index within the lane" give
// the same columns, so the rule itself is checked on a synthetic graph through
// the page's own `mapColumns`: lanes [1,2] and [3,4], and 2 → 3 pushes T3 to
// column 2 and T4 to 3. With `edges` ignored they would sit at 0 and 1. The
// same call locks ruling 6: 4 → 1 would close a cycle and is ignored, 9 is
// outside the lanes and dropped, and the self-loop and the duplicate add
// nothing.
const cols2 = await page.evaluate(() => {
  try {
    const r = mapColumns([{ tasks: [{ n: 1 }, { n: 2 }] }, { tasks: [{ n: 3 }, { n: 4 }] }],
      [{ from: 2, to: 3 }, { from: 4, to: 1 }, { from: 9, to: 1 }, { from: 3, to: 3 }, { from: 2, to: 3 }]);
    return {
      col: [...r.col.entries()].map(([n, c]) => `${n}:${c}`).join(' '),
      cross: r.cross.map((e) => `${e.from}>${e.to}`).join(' ') || '(none)',
    };
  } catch (e) {
    return { col: `threw ${e.message}`, cross: '—' };
  }
});
check('S16-2', 'mapColumns on lanes [1,2] [3,4] with 2→3, 4→1, 9→1, 3→3, 2→3: columns 1:0 2:1 3:2 4:3, cross 2>3 only',
  cols2.col === '1:0 2:1 3:2 4:3' && cols2.cross === '2>3', `columns ${cols2.col} · cross ${cols2.cross}`);

// S16-3 — the node classes, and an operator over a node only while it runs or
// has stopped.
const cls = (id) => (m.nodes[id] ? m.nodes[id].cls : []);
for (const [id, want] of [['T1', 'done'], ['T2', 'run'], ['T5', 'al'], ['T3', 'pend']]) {
  check('S16-3', `node-${id} has class ${want}`, cls(id).includes(want), `classes ${cls(id).join(' ') || '(none)'}`);
}
const op = (id) => (m.nodes[id] ? m.nodes[id].op : null);
const withOp = ['T2', 'T5', 'T6', 'T7'];
check('S16-3', 'operators over T2, T5, T6 and T7', withOp.every((id) => op(id)),
  withOp.map((id) => `${id} ${op(id) || 'none'}`).join(', '));
check('S16-3', 'no operator over T1 or T3', !op('T1') && !op('T3'), `T1 ${op('T1') || 'none'}, T3 ${op('T3') || 'none'}`);

// S16-7 — the legend shows the five poses.
const legend = await page.evaluate(() => {
  const l = document.querySelector('[data-testid=map-legend]');
  return l ? [...l.querySelectorAll('.vb use')].map((u) => u.getAttribute('href')) : null;
});
for (const pose of POSES) {
  check('S16-7', `map-legend uses #op-${pose}-1`, Boolean(legend) && legend.includes(`#op-${pose}-1`),
    legend ? `uses ${JSON.stringify(legend)}` : 'no map-legend');
}
await shot(page, 'map-mid');

// S16-4 — a task node opens its record in INV.
await assertClickable(page, '[data-testid=node-T5]', async () => {
  await until(page, () => {
    const r = document.querySelector('[data-testid=record]');
    return Boolean(r) && r.textContent.includes('T5');
  }, null, 4000);
  return page.evaluate(() => {
    const tab = document.querySelector('[data-testid=tab-INV]');
    const rec = document.querySelector('[data-testid=record]');
    return `tab-INV aria-selected ${tab ? tab.getAttribute('aria-selected') : '(no tab)'}`
      + ` · record ${rec ? (rec.textContent.includes('T5') ? 'has T5' : 'without T5') : 'absent'}`;
  });
}, 'tab-INV aria-selected true · record has T5', 'S16-4', 'node-T5 opens T5 in INV');

// S16-5 — SUITE opens its station in RADIO.
await page.locator('[data-testid=tab-MAP]').click();
await sleep(300);
await until(page, () => Boolean(document.querySelector('[data-testid=node-SUITE]')), null, 3000);
await assertClickable(page, '[data-testid=node-SUITE]', () => page.evaluate(() => {
  const tab = document.querySelector('[data-testid=tab-RADIO]');
  const station = /(^#|&)station=suite(&|$)/.test(location.hash);
  const suite = document.querySelector('[data-testid=station-suite]');
  return `tab-RADIO aria-selected ${tab ? tab.getAttribute('aria-selected') : '(no tab)'}`
    + ` · hash ${station ? 'has station=suite' : location.hash || '(empty)'}`
    + ` · station-suite aria-pressed ${suite ? suite.getAttribute('aria-pressed') : '(no station-suite)'}`;
}), 'tab-RADIO aria-selected true · hash has station=suite · station-suite aria-pressed true', 'S16-5', 'node-SUITE opens the suite station in RADIO');

await assertConsole(page, 'S16-8', 'console 7411 #tab=MAP');

// -------------------------------------------------------------- 7412 (suite)

const { page: p12 } = await openLive(7412, '#tab=MAP');
await until(p12, () => Boolean(document.querySelector('[data-testid=node-SUITE] .vb')), null, 4000);

// S16-6 — the running suite carries a working operator.
const ops12 = await opsOver(p12, 'SUITE');
check('S16-6', '7412: a .vb with #op-trabalhando-1 over node-SUITE', Boolean(ops12) && ops12.includes('#op-trabalhando-1'),
  ops12 ? `uses ${JSON.stringify(ops12)}` : 'no node-SUITE');

// S16-6 — and keeps that operator's node while snapshots arrive (a second
// stream counts them: the suite log grows, so the server pushes every second).
const kept12 = await p12.evaluate(async () => {
  const before = document.querySelector('[data-testid=node-SUITE] .vb');
  let frames = 0;
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', () => { frames += 1; });
  await new Promise((r) => setTimeout(r, 3000));
  es.close();
  const after = document.querySelector('[data-testid=node-SUITE] .vb');
  return { found: Boolean(before), same: Boolean(before) && before === after, frames };
});
check('S16-6', '7412: the SUITE operator is the same node across 3 s of snapshots', kept12.same && kept12.frames >= 2,
  `found ${kept12.found}, same ${kept12.same}, ${kept12.frames} snapshot(s)`);
await shot(p12, 'map-suite');
await assertConsole(p12, 'S16-8', 'console 7412 #tab=MAP');

// ------------------------------------------------------------- 7413 (review)

const { page: p13 } = await openLive(7413, '#tab=MAP');
await until(p13, () => Boolean(document.querySelector('[data-testid=node-REVIEW] .vb')), null, 4000);

// S16-6 — the running review carries a reviewing operator.
const ops13 = await opsOver(p13, 'REVIEW');
check('S16-6', '7413: a .vb with #op-revisando-1 over node-REVIEW', Boolean(ops13) && ops13.includes('#op-revisando-1'),
  ops13 ? `uses ${JSON.stringify(ops13)}` : 'no node-REVIEW');
await shot(p13, 'map-review');
await assertConsole(p13, 'S16-8', 'console 7413 #tab=MAP');

// ------------------------------------------------------------------- S16-8

const wanted = ['map-mid', 'map-suite', 'map-review'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S16-8', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
