// smoke/task-13.js — Task 13: STAT › AGENTS and STAT › CONDITION, against the
// fixture of `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertClickable, assertConsole, shot, sleep, note and __rec.
// Every CLICKABLE row reads a value the click has to change. Rows carry no
// operator (controller ruling), so an agent's operator is read off the hero
// after selecting it.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';
const DOWN = 'RECONNECTING…';
// var(--al), #ffb13d, as getComputedStyle reports it.
const AMBER = 'rgb(255, 177, 61)';
const plan = (name) => `smoke/.artifacts/fixtures/${name}/plan.md`;

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

const textOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

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

/** Wait for the hero to exist; null when it never does. */
const heroReady = (page) => until(page, () => {
  const el = document.querySelector('[data-testid=hero-name]');
  return el ? el.textContent.trim() : null;
}, null, 4000);

const heroName = (page) => textOf(page, '[data-testid=hero-name]');

/** The selected agent's hero: name, tag, the five numbers, its operator. */
const readHero = (page) => page.evaluate(() => {
  const norm = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const name = document.querySelector('[data-testid=hero-name]');
  const hero = name ? name.closest('.hero') : null;
  const vb = hero ? hero.querySelector('.vb') : null;
  const use = vb ? vb.querySelector('use') : null;
  return {
    name: norm(name),
    tag: norm(document.querySelector('[data-testid=hero-tag]')),
    cells: hero ? [...hero.querySelectorAll('.ic')].map(norm) : [],
    use: use ? use.getAttribute('href') : null,
    al: Boolean(vb && vb.classList.contains('al')),
  };
});

const cellsOf = (h) => JSON.stringify(h.cells);
const linesOf = (h) => {
  const c = h.cells.find((x) => typeof x === 'string' && x.startsWith('LINES '));
  return c ? parseInt(c.slice('LINES '.length), 10) : NaN;
};

const whatToDoText = (page) => textOf(page, '[data-testid=whattodo]');

/** Click an agent row when it exists; a missing one must fail a row, not kill the run. */
async function pick(page, id) {
  const sel = `[data-testid=agent-${id}]`;
  if (!(await page.locator(sel).count())) return false;
  await page.locator(sel).click();
  await sleep(400);
  return true;
}

const hashHas = (page, part) => page.evaluate((p) => (
  new RegExp(`(^#|&)${p}(&|$)`).test(location.hash) ? `hash has ${p}` : `hash ${location.hash || '(empty)'}`
), part);

async function useCollector(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
      configurable: true,
    });
    window.__copied = undefined;
  });
}

const copied = (page, testid) => page.evaluate((id) => {
  const b = document.querySelector(`[data-testid=${id}]`);
  return `${b ? b.textContent.trim() : '(gone)'} | ${window.__copied === undefined ? '(nothing copied)' : window.__copied}`;
}, testid);

/** One CHECK row per expected hero number. */
function checkCells(id, who, h, want) {
  for (const w of want) check(id, `${who} hero shows ${w}`, h.cells.includes(w), cellsOf(h));
}

// ------------------------------------------------------- 7411 (mid), no agent

const { page } = await openLive(7411, '#tab=STAT&sub=AGENTS');

// S13-1 — no agent in the hash: the first thing that needs you is selected,
// and the default is not written back into the address.
const h1 = await heroReady(page);
const hash1 = await page.evaluate(() => location.hash);
check('S13-1', 'hero-name with no agent in the hash names T5', typeof h1 === 'string' && h1.includes('T5'),
  `hero-name ${JSON.stringify(h1 ?? null)}`);
check('S13-1', 'the default selection stays out of the hash', !/(^#|&)agent=/.test(hash1), hash1 || '(empty)');

// S13-2 — a row selects its agent and writes it to the hash.
await assertClickable(page, '[data-testid=agent-T2]',
  async () => `${await heroName(page)} | ${await hashHas(page, 'agent=T2')}`,
  'T2 · CONTROLLER | hash has agent=T2', 'S13-2', 'agent-T2 selects T2');

// S13-4 — T2's numbers and operator.
const h4 = await readHero(page);
checkCells('S13-4', 'T2', h4, ['EFFORT high', 'TRY 1/3', 'COST —']);
check('S13-4', 'T2 operator uses #op-trabalhando-1', h4.use === '#op-trabalhando-1', `use ${JSON.stringify(h4.use)}`);

// S13-3 — a subagent row.
await assertClickable(page, '[data-testid=agent-tu_impl]',
  async () => `${await heroName(page)} | ${await hashHas(page, 'agent=tu_impl')}`,
  'T2 · IMPLEMENTER | hash has agent=tu_impl', 'S13-3', 'agent-tu_impl selects the implementer');
await shot(page, 'agents-t2-impl');

// S13-7 — the silent rows, read while neither is selected (a selected row
// inverts its tag's colours), then T7 selected.
const tags7 = await page.evaluate(() => {
  const tag = (id) => {
    const row = document.querySelector(`[data-testid=agent-${id}]`);
    const t = row ? row.querySelector('.tg') : null;
    if (!t) return null;
    const cs = getComputedStyle(t);
    return { text: t.textContent.trim(), style: cs.outlineStyle, outline: cs.outlineColor, color: cs.color, sel: row.classList.contains('sel') };
  };
  return { t7: tag('T7'), t6: tag('T6') };
});
const t7 = tags7.t7 || {};
check('S13-7', 'agent-T7 carries the NO SIGNAL tag', t7.text === 'NO SIGNAL', JSON.stringify(tags7.t7));
check('S13-7', 'agent-T7 tag is dashed and amber', !t7.sel && t7.style === 'dashed' && t7.outline === AMBER && t7.color === AMBER,
  `selected ${t7.sel}, outline ${t7.style} ${t7.outline}, color ${t7.color}`);
check('S13-7', 'agent-T6 carries the NO SIGNAL tag', Boolean(tags7.t6) && tags7.t6.text === 'NO SIGNAL', JSON.stringify(tags7.t6));
const picked7 = await pick(page, 'T7');
const w7 = await whatToDoText(page);
check('S13-7', 'T7 whattodo reads "no event for 2x min — last: …"', picked7 && /^no event for 2\d min — last: /.test(w7 || ''),
  `clicked ${picked7}, whattodo ${JSON.stringify(w7)}`);
const h7 = await readHero(page);
check('S13-7', 'T7 operator uses #op-dormindo-1', h7.name === 'T7 · CONTROLLER' && h7.use === '#op-dormindo-1',
  `hero-name ${JSON.stringify(h7.name)}, use ${JSON.stringify(h7.use)}`);

await assertConsole(page, 'S13-16', 'console 7411');

// ---------------------------------------------- 7411 (mid), opened on T5

const { page: p5 } = await openLive(7411, '#tab=STAT&agent=T5');
await heroReady(p5);

// S13-5 — T5's numbers, its advice and command, its operator; the error's
// markup arrives as text.
const h5 = await readHero(p5);
checkCells('S13-5', 'T5', h5, ['EFFORT xhigh ↑', 'TRY 3/3', 'COST $2.30']);
const w5 = await whatToDoText(p5);
check('S13-5', 'T5 whattodo has the recorded error', (w5 || '').includes('Expected 4 teams, got 3.'), JSON.stringify(w5));
check('S13-5', 'T5 whattodo has the resume command', (w5 || '').includes(`plo resume --plan ${plan('mid')}`), JSON.stringify(w5));
check('S13-5', 'T5 operator is .vb.al with #op-falhou-1', h5.al && h5.use === '#op-falhou-1',
  `hero-name ${JSON.stringify(h5.name)}, al ${h5.al}, use ${JSON.stringify(h5.use)}`);
const xss = await p5.evaluate(() => ({
  img: Boolean(document.querySelector('[data-testid=whattodo] img')),
  fired: window.__xss !== undefined,
  shown: (document.querySelector('[data-testid=whattodo]') || {}).textContent || '',
}));
check('S13-5', 'the error\'s <img onerror> is text, not markup', !xss.img && !xss.fired && xss.shown.includes('<img src=x onerror='),
  `img element ${xss.img}, __xss set ${xss.fired}`);
await shot(p5, 'agents-t5');

// S13-6 — COPY in the hero copies the command.
await useCollector(p5);
await assertClickable(p5, '[data-testid=copy-cmd]', async () => copied(p5, 'copy-cmd'),
  `COPIED ✓ | plo resume --plan ${plan('mid')}`, 'S13-6', 'copy-cmd in T5\'s hero');

// S13-8 — CONDITION: the operator stuck, four lanes, the two alerts.
await assertClickable(p5, '[data-testid=sub-CONDITION]', async () => p5.evaluate(() => {
  const use = document.querySelector('#view .cond .fig .vb use');
  const alerts = [...document.querySelectorAll('[data-testid^=alert-]')];
  const has = (n) => alerts.filter((a) => a.textContent.includes(n)).length;
  const t5 = alerts.find((a) => a.textContent.includes('T5'));
  return [
    `centre ${use ? use.getAttribute('href') : '(none)'}`,
    `${document.querySelectorAll('[data-testid^=cond-lane-]').length} lanes`,
    `${alerts.length} alerts`,
    `T5 ${has('T5')} T7 ${has('T7')} T6 ${has('T6')}`,
    `T5 copy ${t5 && t5.querySelector('[data-testid^=copy-alert-]') ? 'yes' : 'no'}`,
  ].join(' | ');
}), 'centre #op-travado-1 | 4 lanes | 2 alerts | T5 1 T7 1 T6 0 | T5 copy yes', 'S13-8', 'sub-CONDITION shows the condition');
await shot(p5, 'condition');

// S13-9 — a lane opens AGENTS on its current task.
await assertClickable(p5, '[data-testid=cond-lane-B]', async () => p5.evaluate(() => {
  const t = document.querySelector('[data-testid=view-title]');
  const h = document.querySelector('[data-testid=hero-name]');
  const name = h ? h.textContent.trim() : '(no hero-name)';
  return `${t ? t.textContent.trim() : '(no view-title)'} | ${name.includes('T5') ? 'hero names T5' : name}`;
}), 'AGENTS | hero names T5', 'S13-9', 'cond-lane-B opens AGENTS on T5');

await assertConsole(p5, 'S13-16', 'console 7411 #agent=T5');

// ------------------------------------------------------------ 7417 (idle)

const { page: p17 } = await openLive(7417, '#tab=STAT&sub=AGENTS');
await until(p17, () => Boolean(document.querySelector('[data-testid=copy-cmd]')), null, 4000);
const e17 = await p17.evaluate(() => {
  const v = document.getElementById('view');
  return {
    text: v ? v.textContent.replace(/\s+/g, ' ') : '',
    sleeper: Boolean(v && v.querySelector('.vb use[href="#op-dormindo-1"]')),
  };
});
check('S13-10', 'AGENTS reads "nobody working — waiting on merge"', e17.text.includes('nobody working — waiting on merge'),
  JSON.stringify(e17.text.slice(0, 160)));
check('S13-10', 'AGENTS empty shows #op-dormindo-1', e17.sleeper, String(e17.sleeper));
await shot(p17, 'idle-empty');
await useCollector(p17);
const hasCopy17 = await p17.locator('[data-testid=copy-cmd]').count();
if (hasCopy17) {
  await p17.locator('[data-testid=copy-cmd]').click();
  await sleep(400);
}
const c17 = await copied(p17, 'copy-cmd');
check('S13-10', 'copy-cmd carries plo integrate', c17 === `COPIED ✓ | plo integrate --plan ${plan('idle')}`, `${hasCopy17 ? '' : 'no copy-cmd; '}${c17}`);
if (await p17.locator('[data-testid=sub-CONDITION]').count()) {
  await p17.locator('[data-testid=sub-CONDITION]').click();
  await sleep(400);
}
const cond17 = await p17.evaluate(() => {
  const use = document.querySelector('#view .cond .fig .vb use');
  return { use: use ? use.getAttribute('href') : null, alerts: document.querySelectorAll('[data-testid^=alert-]').length };
});
check('S13-10', 'CONDITION shows #op-orgulho-1 and no alert', cond17.use === '#op-orgulho-1' && cond17.alerts === 0,
  `centre ${JSON.stringify(cond17.use)}, ${cond17.alerts} alert(s)`);
await assertConsole(p17, 'S13-16', 'console 7417');

// ----------------------------------------------------------- 7412 (suite)

const { page: p12 } = await openLive(7412, '#tab=STAT&agent=suite');
await heroReady(p12);

// S13-12 — the suite's hero and its live output.
const h12 = await readHero(p12);
check('S13-12', 'hero-name is FULL SUITE', h12.name === 'FULL SUITE', JSON.stringify(h12.name));
checkCells('S13-12', 'suite', h12, ['COMMAND npm test']);
const n1 = linesOf(h12);
await sleep(2000);
const n2 = linesOf(await readHero(p12));
check('S13-12', 'LINES grows over 2 s', Number.isFinite(n1) && Number.isFinite(n2) && n2 > n1, `${n1} → ${n2}`);
const out12 = await p12.evaluate(() => {
  const el = document.querySelector('[data-testid=live-output]');
  return el ? el.textContent : null;
});
const outLines = (out12 || '').split('\n').filter((l) => l.trim());
check('S13-12', 'live-output has lines and no \\u001b', outLines.length > 0 && !out12.includes('\u001b'),
  `${outLines.length} line(s), escape present ${(out12 || '').includes('\u001b')}`);

// S13-15 — the hero's operator is one node across snapshots: LINES moving
// proves snapshots arrived and the hero repainted around it.
const vb0 = await p12.evaluate(() => {
  const h = document.querySelector('[data-testid=hero-name]');
  window.__vb = h && h.closest('.hero') ? h.closest('.hero').querySelector('.vb') : null;
  return Boolean(window.__vb);
});
const l0 = linesOf(await readHero(p12));
await sleep(3000);
const vb1 = await p12.evaluate(() => {
  const h = document.querySelector('[data-testid=hero-name]');
  const now = h && h.closest('.hero') ? h.closest('.hero').querySelector('.vb') : null;
  return { same: Boolean(window.__vb) && now === window.__vb, connected: Boolean(window.__vb && window.__vb.isConnected) };
});
const l1 = linesOf(await readHero(p12));
check('S13-15', 'hero .vb is the same node after 3 s of snapshots', vb0 && vb1.same && Number.isFinite(l0) && l1 > l0,
  `found ${vb0}, same ${vb1.same}, connected ${vb1.connected}, LINES ${l0} → ${l1}`);
await shot(p12, 'agents-suite');
await assertConsole(p12, 'S13-16', 'console 7412');

// ---------------------------------------------------------- 7413 (review)

const { page: p13 } = await openLive(7413, '#tab=STAT&sub=AGENTS');
await heroReady(p13);

// S13-11 — END OF RUN holds the reviewer and its subagent.
const end13 = await p13.evaluate(() => {
  const h = [...document.querySelectorAll('.gh')].find((x) => x.textContent.trim() === 'END OF RUN');
  if (!h) return null;
  const ids = [];
  for (let n = h.nextElementSibling; n && !n.classList.contains('gh'); n = n.nextElementSibling) {
    if (n.getAttribute('data-testid')) ids.push(n.getAttribute('data-testid'));
  }
  return ids;
});
check('S13-11', 'END OF RUN holds agent-review and agent-tu_rv',
  Array.isArray(end13) && end13.includes('agent-review') && end13.includes('agent-tu_rv'), JSON.stringify(end13));
const picked13 = await pick(p13, 'review');
const h13 = await readHero(p13);
check('S13-11', 'agent-review: hero-name CROSS-LANE REVIEW', picked13 && h13.name === 'CROSS-LANE REVIEW', JSON.stringify(h13.name));
checkCells('S13-11', 'reviewer', h13, ['EFFORT inherited', 'COST —']);
check('S13-11', 'reviewer operator uses #op-revisando-1', h13.use === '#op-revisando-1', `use ${JSON.stringify(h13.use)}`);
await shot(p13, 'agents-review');
const pickedRv = await pick(p13, 'tu_rv');
const hRv = await readHero(p13);
check('S13-11', 'agent-tu_rv also uses #op-revisando-1', pickedRv && hRv.name === 'REVIEW · CODE-REVIEWER' && hRv.use === '#op-revisando-1',
  `clicked ${pickedRv}, hero-name ${JSON.stringify(hRv.name)}, use ${JSON.stringify(hRv.use)}`);

// S13-18 — the finished suite's OUTPUT is cleaned as RADIO cleans it. The
// fixture's summary carries colour codes and `progress 10%\rprogress 100%`;
// the HTML parser turns a `\r` left in into a line break, so the segment it
// overwrote would show as a line of its own.
const pickedSuite13 = await pick(p13, 'suite');
const out13 = await p13.evaluate(() => {
  const el = document.querySelector('[data-testid=live-output]');
  return el ? el.textContent : null;
});
check('S13-18', 'STAT suite OUTPUT has no \\u001b, no \\r and no overwritten progress segment',
  pickedSuite13 && typeof out13 === 'string' && out13.trim().length > 0
    && !out13.includes('\u001b') && !out13.includes('\r') && !out13.includes('progress 10%'),
  `clicked ${pickedSuite13}, output ${JSON.stringify(out13)}`);
await assertConsole(p13, 'S13-16', 'console 7413');

// --------------------------------------------------------- 7414 (barrier)

const { page: p14 } = await openLive(7414, '#tab=STAT&agent=T8');
await heroReady(p14);

// S13-13 — a barrier's command is integrate; its orphaned subagent sleeps.
const w14 = await whatToDoText(p14);
check('S13-13', 'T8 whattodo has plo integrate and no plo resume',
  (w14 || '').includes(`plo integrate --plan ${plan('barrier')}`) && !(w14 || '').includes('plo resume'), JSON.stringify(w14));
const orphTag = await textOf(p14, '[data-testid=agent-tu_orph] .tg');
check('S13-13', 'agent-tu_orph carries the INTERRUPTED tag', orphTag === 'INTERRUPTED', JSON.stringify(orphTag));
const pickedOrph = await pick(p14, 'tu_orph');
const hOrph = await readHero(p14);
check('S13-13', 'agent-tu_orph uses #op-dormindo-1', pickedOrph && hOrph.name === 'T8 · IMPLEMENTER' && hOrph.use === '#op-dormindo-1',
  `clicked ${pickedOrph}, hero-name ${JSON.stringify(hOrph.name)}, use ${JSON.stringify(hOrph.use)}`);
await assertConsole(p14, 'S13-16', 'console 7414');

// ------------------------------------------------------------ 7416 (drop)

const { page: p16, live: live16 } = await openLive(7416, '#tab=STAT&agent=T2');
await heroReady(p16);
const before16 = await heroName(p16);
if (!live16) {
  check('S13-14', 'stream drop', false, `7416 never showed ${LIVE}; the drop was not attempted`);
} else {
  const t0 = Date.now();
  await p16.evaluate(async () => (await fetch('/__fixture/drop')).status);
  const down = await until(p16, (want) => {
    const el = document.querySelector('[data-testid=stream]');
    return Boolean(el) && el.textContent.trim() === want;
  }, DOWN, 4000);
  // The same window as S12-10.
  const back = await until(p16, (want) => {
    const el = document.querySelector('[data-testid=stream]');
    return Boolean(el) && el.textContent.trim() === want && !document.body.classList.contains('frozen');
  }, LIVE, Math.max(0, 15000 - (Date.now() - t0)));
  const after16 = await heroName(p16);
  check('S13-14', `after the drop and back to ${LIVE}, hero-name is still T2 · CONTROLLER`,
    before16 === 'T2 · CONTROLLER' && Boolean(down) && Boolean(back) && after16 === 'T2 · CONTROLLER',
    `before ${JSON.stringify(before16)}, went down ${Boolean(down)}, back ${Boolean(back)} after ${Date.now() - t0} ms, after ${JSON.stringify(after16)}`);
}

// ------------------------------------------------------------------ S13-17

const wanted = ['agents-t5', 'agents-t2-impl', 'agents-review', 'agents-suite', 'condition', 'idle-empty'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S13-17', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
