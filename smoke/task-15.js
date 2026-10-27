// smoke/task-15.js — Task 15: DATA › QUESTS, LOG and NUMBERS, against the
// fixture of `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertClickable, assertConsole, shot, sleep, note and __rec.
// Every CLICKABLE row reads a value the click has to change. Text is read with
// its whitespace collapsed, as the markup puts a space between every label,
// bar and value.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';
const XSS = '<img src=x onerror="window.__xss=1">';

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

async function openSub(page, sub) {
  if (await page.locator(`[data-testid=sub-${sub}]`).count()) {
    await page.locator(`[data-testid=sub-${sub}]`).click();
    await sleep(300);
  }
}

/** The quest groups in screen order, as `HEAD:T1,T2 | HEAD:…`. */
const questGroups = (page) => page.evaluate(() => {
  const first = document.querySelector('[data-testid^=quest-T]');
  if (!first) return '(no quest buttons)';
  const out = [];
  for (const el of first.parentElement.children) {
    if (el.classList.contains('gh')) out.push({ head: el.textContent.trim(), ids: [] });
    else if (el.matches('[data-testid^=quest-T]') && out.length) {
      out[out.length - 1].ids.push(el.getAttribute('data-testid').slice('quest-'.length));
    }
  }
  return out.map((g) => `${g.head}:${g.ids.join(',')}`).join(' | ');
});

/** The objectives against the steps wanted, and whether the hash names the quest. */
const objectivesState = (page, n, wanted) => page.evaluate(({ n: k, wanted: w }) => {
  const items = [...document.querySelectorAll('[data-testid=objectives] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  const each = w.map((want, i) => (items[i] && items[i].includes(want) ? want : `(${JSON.stringify(items[i] || null)})`));
  const hash = new RegExp(`(^#|&)quest=${k}(&|$)`).test(location.hash) ? `hash has quest=${k}` : `hash ${location.hash || '(empty)'}`;
  return [`${items.length} items`, ...each, hash].join(' · ');
}, { n, wanted });

/** The WHY IT STOPPED block of the selected quest, if any. */
const whyState = (page) => page.evaluate(() => {
  const block = [...document.querySelectorAll('#view .pn')].find((p) => {
    const h = p.querySelector('h4');
    return h && h.textContent.trim() === 'WHY IT STOPPED';
  });
  if (!block) return 'no WHY IT STOPPED block';
  return block.querySelector('[data-testid=copy-error]') ? 'WHY IT STOPPED with copy-error' : 'WHY IT STOPPED without copy-error';
});

const logRows = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid=log-row]')].map((r) => ({
  text: r.textContent.replace(/\s+/g, ' ').trim(),
  err: r.classList.contains('err'),
  who: (r.querySelector('.who') || { textContent: '' }).textContent.trim(),
})));

/** Type into the search box. `fill` first; an input event by hand only when
 *  the browser API is missing, and the detail says which one ran. */
async function typeInto(page, sel, text) {
  if (!(await page.locator(sel).count())) return `${sel} not found`;
  try {
    await page.locator(sel).fill(text);
    return 'fill';
  } catch (e) {
    await page.evaluate(({ s, t }) => {
      const el = document.querySelector(s);
      if (!el) return;
      el.focus();
      el.value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { s: sel, t: text });
    return `dispatched input (fill: ${e.message})`;
  }
}

/** The rows of a NUMBERS panel: its bars and key-value lines, text collapsed. */
const panelRows = (page, testid) => page.evaluate((t) => {
  const p = document.querySelector(`[data-testid=${t}]`);
  if (!p) return null;
  return [...p.querySelectorAll('.bars > div, .kv')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
}, testid);

const panelText = (page, testid) => page.evaluate((t) => {
  const p = document.querySelector(`[data-testid=${t}]`);
  return p ? p.textContent.replace(/\s+/g, ' ').trim() : null;
}, testid);

// ---------------------------------------------------------------- 7411 (mid)

const { page } = await openLive(7411, '#tab=DATA&sub=QUESTS');
await until(page, () => Boolean(document.querySelector('[data-testid^=quest-T]')), null, 4000);

// S15-1 — the three groups, tasks and barriers both, by n.
const groups1 = await questGroups(page);
check('S15-1', 'IN PROGRESS T2 T5 T6 T7, QUEUED T3 T8, DONE T1 T4',
  groups1 === 'IN PROGRESS:T2,T5,T6,T7 | QUEUED:T3,T8 | DONE:T1,T4', groups1);

// S15-2 — a quest's objectives are the plan's own steps; the pick is in the hash.
const STEPS2 = ['Write the failing test', 'Implement the shell', 'Commit'];
await assertClickable(page, '[data-testid=quest-T2]', async () => {
  await until(page, () => document.querySelectorAll('[data-testid=objectives] li').length === 3
    && /(^#|&)quest=2(&|$)/.test(location.hash), null, 4000);
  return objectivesState(page, 2, STEPS2);
}, ['3 items', ...STEPS2, 'hash has quest=2'].join(' · '), 'S15-2', 'quest-T2 lists the three plan steps of T2');
await shot(page, 'quests-t2');

// S15-3 — a stopped quest says why, with COPY; the error stays text.
await assertClickable(page, '[data-testid=quest-T5]', async () => {
  await until(page, () => [...document.querySelectorAll('#view .pn h4')].some((h) => h.textContent.trim() === 'WHY IT STOPPED'), null, 4000);
  return whyState(page);
}, 'WHY IT STOPPED with copy-error', 'S15-3', 'quest-T5 shows WHY IT STOPPED with copy-error');
const why3 = await page.evaluate(() => {
  const block = [...document.querySelectorAll('#view .pn')].find((p) => {
    const h = p.querySelector('h4');
    return h && h.textContent.trim() === 'WHY IT STOPPED';
  });
  return {
    found: Boolean(block),
    shown: block ? block.textContent : '',
    img: block && block.querySelector('img') ? 'element' : 'null',
    fired: typeof window.__xss,
    copy: block && block.querySelector('[data-testid=copy-error]') ? block.querySelector('[data-testid=copy-error]').getAttribute('data-copy') : null,
  };
});
check('S15-3', 'WHY IT STOPPED shows the <img onerror> as text, no img, window.__xss undefined',
  why3.found && why3.shown.includes(XSS) && why3.img === 'null' && why3.fired === 'undefined',
  `found ${why3.found}, text has it ${why3.shown.includes(XSS)}, img ${why3.img}, window.__xss ${why3.fired}`);
const apiError = await page.evaluate(async () => (await (await fetch('/api/task?n=5')).json()).task.error);
check('S15-3', 'copy-error carries the whole error', why3.copy === apiError,
  why3.copy === apiError ? 'same as /api/task?n=5' : JSON.stringify(why3.copy));
await shot(page, 'quests-t5');

// S15-4 — the run log, and the search narrowing it.
await openSub(page, 'LOG');
await until(page, () => document.querySelectorAll('[data-testid=log-row]').length >= 5, null, 4000);
const before4 = await logRows(page);
check('S15-4', 'LOG has 5 or more log-row', before4.length >= 5, `${before4.length} rows`);
const how4 = await typeInto(page, '[data-testid=log-search]', 'npm test');
await until(page, (n) => {
  const c = document.querySelectorAll('[data-testid=log-row]').length;
  return c > 0 && c < n;
}, before4.length, 4000);
const after4 = await logRows(page);
const strays4 = after4.filter((r) => !r.text.includes('npm test'));
check('S15-4', 'after typing npm test every row contains it, count ≥ 1 and below the first',
  after4.length >= 1 && after4.length < before4.length && strays4.length === 0,
  `${how4}; ${after4.length} of ${before4.length} rows; strays ${JSON.stringify(strays4.map((r) => r.text).slice(0, 2))}`);

// S15-5 — the errors filter and the wrap toggle. The search box is marked
// first: a repaint that rebuilt it would drop the reader's query and caret.
await page.evaluate(() => { window.__searchEl = document.querySelector('[data-testid=log-search]'); });
await assertClickable(page, '[data-testid=log-filter-errors]', async () => {
  const rows = await logRows(page);
  if (!rows.length) return 'no rows';
  const plain = rows.filter((r) => !r.err).length;
  return plain ? `${plain} of ${rows.length} rows without err` : 'every row err (≥ 1)';
}, 'every row err (≥ 1)', 'S15-5', 'log-filter-errors leaves only err rows');
const kept5 = await page.evaluate(() => {
  const el = document.querySelector('[data-testid=log-search]');
  return { same: Boolean(el) && el === window.__searchEl, value: el ? el.value : null };
});
check('S15-5', 'the search box keeps its node and its value across the filter click',
  kept5.same && kept5.value === 'npm test', `same node ${kept5.same}, value ${JSON.stringify(kept5.value)}`);
await assertClickable(page, '[data-testid=log-wrap]', () => page.evaluate(() => {
  const list = document.querySelector('[data-testid=log-list]');
  if (!list) return 'no log-list';
  return list.classList.contains('wrap') ? 'log-list has wrap' : 'log-list without wrap';
}), 'log-list has wrap', 'S15-5', 'log-wrap puts the class wrap on the list');
await shot(page, 'log-filtered');

// S15-7 — NUMBERS: the run, the effort in the plan, the cost per lane.
await openSub(page, 'NUMBERS');
await until(page, () => Boolean(document.querySelector('[data-testid=numbers-run]')), null, 4000);
const run7 = await panelText(page, 'numbers-run');
for (const w of ['feature/fixture @ abc1234', 'npm test', '4 · max 4']) {
  check('S15-7', `numbers-run has ${w}`, (run7 || '').includes(w), JSON.stringify(run7));
}
const eff7 = await panelRows(page, 'numbers-effort');
for (const w of ['medium 4', 'high 3', 'xhigh 1', 'raised 1']) {
  check('S15-7', `numbers-effort has ${w}`, Boolean(eff7) && eff7.some((r) => r.startsWith(`${w} `) || r === w), JSON.stringify(eff7));
}
const cost7 = await panelRows(page, 'numbers-lanecost');
for (const [lane, want] of [['A', '$0.80'], ['B', '$5.40']]) {
  const row = (cost7 || []).find((r) => r.startsWith(`LANE ${lane} `));
  check('S15-7', `numbers-lanecost lane ${lane} shows ${want}`, Boolean(row) && row.endsWith(want), JSON.stringify(row || cost7));
}
await shot(page, 'numbers');

await assertConsole(page, 'S15-9', 'console 7411 #tab=DATA');

// ------------------------------------------------------------- 7413 (review)

const { page: p13 } = await openLive(7413, '#tab=DATA&sub=LOG');
await until(p13, () => document.querySelectorAll('[data-testid=log-row]').length > 0, null, 4000);

// S15-6 — the reviewer's own events are in the log, as `review`.
const rows6 = await logRows(p13);
const review6 = rows6.filter((r) => r.who === 'review');
check('S15-6', 'LOG has a row whose who is review', review6.length >= 1,
  `${review6.length} of ${rows6.length} rows; whos ${JSON.stringify([...new Set(rows6.map((r) => r.who))])}`);

// S15-8 — the stages, each by its own clock.
await openSub(p13, 'NUMBERS');
await until(p13, () => Boolean(document.querySelector('[data-testid=numbers-stages]')), null, 4000);
const st8 = await panelRows(p13, 'numbers-stages');
for (const want of ['Merge 30s', 'Full suite 1m', 'Cross-lane review running']) {
  check('S15-8', `numbers-stages has ${want}`, Boolean(st8) && st8.includes(want), JSON.stringify(st8));
}

await assertConsole(p13, 'S15-9', 'console 7413 #tab=DATA');

// ------------------------------------------------------------------- S15-9

const wanted = ['quests-t2', 'quests-t5', 'log-filtered', 'numbers'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S15-9', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
