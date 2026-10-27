// smoke/task-14.js — Task 14: INV, the task table and the task record, against
// the fixture of `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertClickable, assertConsole, shot, sleep, note and __rec.
// Every CLICKABLE row reads a value the click has to change.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';
const plan = (name) => `smoke/.artifacts/fixtures/${name}/plan.md`;
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

async function useCollector(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
      configurable: true,
    });
    window.__copied = undefined;
  });
}

/** The table's rows, in screen order, as `T1,T2,…`. */
const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^=row-T]')]
  .map((r) => r.getAttribute('data-testid').slice('row-'.length)).join(','));

/** One cell of a row, by its column header. */
const cellOf = (page, row, head) => page.evaluate(({ row: r, head: h }) => {
  const ths = [...document.querySelectorAll('#view .tbl thead th')].map((t) => t.textContent.trim());
  const i = ths.indexOf(h);
  const tr = document.querySelector(`[data-testid=row-${r}]`);
  const td = tr && i >= 0 ? tr.cells[i] : null;
  if (!td) return { text: null, title: null };
  const titled = td.hasAttribute('title') ? td : td.querySelector('[title]');
  return { text: td.textContent.replace(/\s+/g, ' ').trim(), title: titled ? titled.getAttribute('title') : null };
}, { row, head });

/** Whether the record names `want`, the selected row, and the hash. */
const recordState = (page, n, want) => page.evaluate(({ n: k, want: w }) => {
  const r = document.querySelector('[data-testid=record]');
  const text = r ? r.textContent.replace(/\s+/g, ' ') : '';
  const row = document.querySelector(`[data-testid=row-T${k}]`);
  return [
    r ? (text.includes(w) ? `record ${w}` : `record ${JSON.stringify(text.slice(0, 80))}`) : 'no record',
    row && row.classList.contains('sel') ? 'sel' : 'not sel',
    new RegExp(`(^#|&)task=${k}(&|$)`).test(location.hash) ? `hash has task=${k}` : `hash ${location.hash || '(empty)'}`,
  ].join(' | ');
}, { n, want });

const recordHas = (page, want) => until(page, (w) => {
  const r = document.querySelector('[data-testid=record]');
  return Boolean(r) && r.textContent.replace(/\s+/g, ' ').includes(w);
}, want, 4000);

async function pressEscape(page) {
  try {
    await page.keyboard.press('Escape');
    return 'keyboard';
  } catch (e) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    return `dispatched (keyboard: ${e.message})`;
  }
}

// ---------------------------------------------------------------- 7411 (mid)

const { page } = await openLive(7411, '#tab=INV');
await until(page, () => Boolean(document.querySelector('[data-testid=row-T1]')), null, 4000);

// S14-1 — ALL lists every task and barrier; a barrier's lane says so.
const all1 = await rowsOf(page);
check('S14-1', 'ALL has row-T1 … row-T8', all1 === 'T1,T2,T3,T4,T5,T6,T7,T8', all1 || '(no rows)');
const lane8 = await cellOf(page, 'T8', 'LANE');
const tip = await page.evaluate(() => (typeof BARRIER_TIP === 'string' ? BARRIER_TIP : null));
check('S14-1', 'row-T8 LANE is BARRIER with title BARRIER_TIP',
  lane8.text === 'BARRIER' && Boolean(tip) && lane8.title === tip, JSON.stringify(lane8));
check('S14-4', 'no record while no task is selected',
  !(await page.locator('[data-testid=record]').count()), `record count ${await page.locator('[data-testid=record]').count()}`);
await shot(page, 'inv-all');

// S14-2 — PROBLEMS: the failed task and the two silent ones.
await assertClickable(page, '[data-testid=sub-PROBLEMS]', () => rowsOf(page), 'T5,T6,T7', 'S14-2', 'sub-PROBLEMS lists T5, T6, T7');

// S14-3 — RUNNING, QUEUE with WAITING ON, DONE.
await assertClickable(page, '[data-testid=sub-RUNNING]', () => rowsOf(page), 'T2,T6,T7', 'S14-3', 'sub-RUNNING lists T2, T6, T7');
await assertClickable(page, '[data-testid=sub-QUEUE]', async () => {
  const rows = await rowsOf(page);
  const w3 = await cellOf(page, 'T3', 'WAITING ON');
  const w8 = await cellOf(page, 'T8', 'WAITING ON');
  return `${rows} | T3 ${w3.text} | T8 ${w8.text}`;
}, 'T3,T8 | T3 after T2 | T8 after the merge', 'S14-3', 'sub-QUEUE lists T3 and T8 with WAITING ON');
await shot(page, 'inv-queue');
await assertClickable(page, '[data-testid=sub-DONE]', () => rowsOf(page), 'T1,T4', 'S14-3', 'sub-DONE lists T1, T4');

// S14-4 — a row opens its record, inverts, and writes the hash.
if (await page.locator('[data-testid=sub-ALL]').count()) {
  await page.locator('[data-testid=sub-ALL]').click();
  await sleep(300);
}
await assertClickable(page, '[data-testid=row-T5]', async () => {
  await recordHas(page, 'T5 · Counts per team');
  return recordState(page, 5, 'T5 · Counts per team');
}, 'record T5 · Counts per team | sel | hash has task=5', 'S14-4', 'row-T5 opens the record of T5');

// S14-5 — the error is escaped Markdown.
await until(page, () => Boolean(document.querySelector('[data-testid=error-block]')), null, 4000);
const xss = await page.evaluate(() => {
  const b = document.querySelector('[data-testid=error-block]');
  return {
    found: Boolean(b),
    shown: b ? b.textContent : '',
    img: document.querySelector('[data-testid=error-block] img') === null ? 'null' : 'element',
    fired: typeof window.__xss,
  };
});
check('S14-5', 'error-block shows the <img onerror> as text', xss.found && xss.shown.includes(XSS),
  xss.found ? JSON.stringify(xss.shown.replace(/\s+/g, ' ').slice(0, 120)) : 'no error-block');
check('S14-5', 'no img inside error-block and window.__xss undefined', xss.img === 'null' && xss.fired === 'undefined',
  `img ${xss.img}, window.__xss ${xss.fired}`);
await shot(page, 'inv-t5');

// S14-6 — COPY on the error copies the whole error, as the API has it.
await useCollector(page);
const apiError = await page.evaluate(async () => (await (await fetch('/api/task?n=5')).json()).task.error);
await assertClickable(page, '[data-testid=copy-error]', () => page.evaluate((want) => {
  const b = document.querySelector('[data-testid=copy-error]');
  const label = b ? b.textContent.trim() : '(gone)';
  const got = window.__copied;
  return `${label} | ${got === want ? 'copied the API error' : `copied ${JSON.stringify(got === undefined ? '(nothing)' : got)}`}`;
}, apiError), 'COPIED ✓ | copied the API error', 'S14-6', 'copy-error copies the whole error');

// S14-7 — T5's effort and tries; the session and log carry COPY.
const eff7 = await textOf(page, '[data-testid=record-effort]');
for (const w of ['xhigh', 'used', '↑', 'fixture']) {
  check('S14-7', `record-effort has ${w}`, (eff7 || '').includes(w), JSON.stringify(eff7));
}
const tries7 = await textOf(page, '[data-testid=record-tries]');
check('S14-7', 'record-tries is medium failed › high failed › xhigh failed',
  tries7 === 'medium failed › high failed › xhigh failed', JSON.stringify(tries7));
const cs = await page.locator('[data-testid=copy-session]').count();
const cl = await page.locator('[data-testid=copy-log]').count();
check('S14-7', 'copy-session and copy-log present', cs === 1 && cl === 1, `copy-session ${cs}, copy-log ${cl}`);

// S14-9 — Escape closes the record and drops task= from the hash. The record
// has to be open first, or the row passes on a page that never had one.
const before9 = await page.evaluate(() => ({
  record: document.querySelectorAll('[data-testid=record]').length,
  hash: location.hash,
}));
const how = await pressEscape(page);
await sleep(300);
const esc9 = await page.evaluate(() => ({
  record: document.querySelectorAll('[data-testid=record]').length,
  hash: location.hash,
}));
check('S14-9', 'Escape removes the record of T5 and task= from the hash',
  before9.record === 1 && /(^#|&)task=5(&|$)/.test(before9.hash) && esc9.record === 0 && !/(^#|&)task=/.test(esc9.hash),
  `before: record count ${before9.record}, hash ${before9.hash || '(empty)'}; ${how}; after: record count ${esc9.record}, hash ${esc9.hash || '(empty)'}`);

// S14-8 — a running task's chain ends on the attempt in flight.
if (await page.locator('[data-testid=row-T2]').count()) {
  await page.locator('[data-testid=row-T2]').click();
  await recordHas(page, 'T2 · Panel shell');
}
await until(page, () => Boolean(document.querySelector('[data-testid=record-tries]')), null, 4000);
const tries8 = await textOf(page, '[data-testid=record-tries]');
check('S14-8', 'T2 record-tries ends with high running', /high running$/.test(tries8 || ''), JSON.stringify(tries8));

await assertConsole(page, 'S14-12', 'console 7411 #tab=INV');

// ------------------------------------------------------ 7411, the old link

const { page: p4 } = await openLive(7411, '#task=4');
const r4 = await recordHas(p4, 'T4 · Data layer');
check('S14-10', '#task=4 opens the record of T4', r4, JSON.stringify(await textOf(p4, '[data-testid=record]')));
await assertConsole(p4, 'S14-12', 'console 7411 #task=4');

// ----------------------------------------------------------- 7414 (barrier)

const { page: p14 } = await openLive(7414, '#tab=INV&task=8');
await until(p14, () => Boolean(document.querySelector('[data-testid=error-block]')), null, 4000);
const b11 = await p14.evaluate(() => {
  const btn = document.querySelector('[data-testid=error-block] [data-testid=copy-error]');
  const cmd = document.querySelector('[data-testid=copy-cmd]');
  return {
    block: Boolean(document.querySelector('[data-testid=error-block]')),
    copy: btn ? btn.textContent.trim() : null,
    cmd: cmd ? cmd.getAttribute('data-copy') : null,
  };
});
check('S14-11', 'error-block with COPY', b11.block && b11.copy === 'COPY', `block ${b11.block}, copy ${JSON.stringify(b11.copy)}`);
check('S14-11', 'copy-cmd carries plo integrate', b11.cmd === `plo integrate --plan ${plan('barrier')}`, JSON.stringify(b11.cmd));
await shot(p14, 'inv-barrier');
await assertConsole(p14, 'S14-12', 'console 7414 #tab=INV&task=8');

// ------------------------------------------------------------------ S14-12

const wanted = ['inv-all', 'inv-t5', 'inv-queue', 'inv-barrier'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S14-12', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
