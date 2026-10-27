// smoke/task-12.js — Task 12: the operator panel's frame, footer, stream,
// hash routes and derived states, against the fixture of `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertClickable, assertConsole, requireMotion, shot, sleep
// and __rec. Every CLICKABLE row reads a value the click has to change.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';
const DOWN = 'RECONNECTING…';
const TAB_ORDER = ['INV', 'DATA', 'MAP', 'RADIO', 'STAT'];
const SUBS = {
  STAT: ['AGENTS', 'CONDITION'],
  INV: ['ALL', 'PROBLEMS', 'RUNNING', 'QUEUE', 'DONE'],
  DATA: ['QUESTS', 'LOG', 'NUMBERS'],
  MAP: ['LANES'],
  RADIO: ['STATIONS'],
};

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
  return { page, live };
}

const viewAndHash = (page, part) => page.evaluate((p) => {
  const v = document.querySelector('[data-testid=view-title]');
  const title = v ? v.textContent.trim() : '(no view-title)';
  return `${title} | ${location.hash.includes(p) ? `hash has ${p}` : `hash ${location.hash || '(empty)'}`}`;
}, part);

// ---------------------------------------------------------------- 7411 (mid)

const { page, live } = await openLive(7411);
// S12-10 needs the operators animating; a machine set to reduce motion cannot
// show that they stop, which is an environment failure, not a code one.
await requireMotion(page);
if (!live) note(`7411 never showed ${LIVE} within 8 s`);
await shot(page, 'mid-stat');

// S12-4 — the footer and the title on the mid run.
const foot = await page.evaluate(() => {
  const q = (id) => document.querySelector(`[data-testid=${id}]`);
  const t = (id) => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null);
  return {
    tasks: t('foot-tasks'),
    needyou: t('foot-needyou'),
    run: t('foot-run'),
    limit: t('foot-limit'),
    limitAl: Boolean(q('foot-limit')) && q('foot-limit').classList.contains('al'),
    cost: t('foot-cost'),
    title: document.title,
  };
});
check('S12-4', 'foot-tasks', foot.tasks === 'TASKS 2/8', JSON.stringify(foot.tasks));
check('S12-4', 'foot-needyou', foot.needyou === '2 NEED YOU', JSON.stringify(foot.needyou));
check('S12-4', 'foot-run', typeof foot.run === 'string' && foot.run.startsWith('RUN · 3 LANES'), JSON.stringify(foot.run));
check('S12-4', 'foot-limit', typeof foot.limit === 'string' && foot.limit.includes('84%') && foot.limitAl,
  `${JSON.stringify(foot.limit)}, class al: ${foot.limitAl}`);
check('S12-4', 'foot-cost', foot.cost === '$6.20', JSON.stringify(foot.cost));
check('S12-4', 'document.title', foot.title === '⚠ 2/8 · Operator fixture', JSON.stringify(foot.title));

// S12-5 — the run clock counts while the run is active.
const clock1 = await textOf(page, '[data-testid=foot-clock]');
await sleep(2000);
const clock2 = await textOf(page, '[data-testid=foot-clock]');
check('S12-5', 'foot-clock moves on 7411', clock1 != null && clock2 != null && clock1 !== clock2, `${clock1} → ${clock2}`);

// S12-1 — each tab opens its first sub-tab and writes tab= to the hash.
for (const tab of TAB_ORDER) {
  const first = SUBS[tab][0];
  await assertClickable(page, `[data-testid=tab-${tab}]`,
    async () => viewAndHash(page, `tab=${tab}`),
    `${first} | hash has tab=${tab}`, 'S12-1', `tab ${tab} opens ${first}`);
}

// S12-2 — every sub-tab of every tab. The default sub-tab is clicked last so
// the title changes, and sub= is dropped from the address before each click so
// the click has to write it back (MAP and RADIO have one sub-tab each, and
// their title alone could not tell a dead handler from a live one).
for (const tab of Object.keys(SUBS)) {
  const sel = `[data-testid=tab-${tab}]`;
  if (await page.locator(sel).count()) {
    await page.locator(sel).click();
    await sleep(250);
  }
  const subs = SUBS[tab];
  for (const sub of subs.slice(1).concat(subs[0])) {
    await page.evaluate((t) => history.replaceState(null, '', `#tab=${t}`), tab);
    await assertClickable(page, `[data-testid=sub-${sub}]`,
      async () => viewAndHash(page, `sub=${sub}`),
      `${sub} | hash has sub=${sub}`, 'S12-2', `sub-tab ${tab} › ${sub}`);
  }
}

// S12-3 — the alerts chip, from RADIO, lands on STAT › CONDITION.
const chip = await textOf(page, '[data-testid=alerts-chip]');
await assertClickable(page, '[data-testid=alerts-chip]',
  async () => `${chip} | ${await viewAndHash(page, 'tab=STAT&sub=CONDITION')}`,
  '! 2 ALERTS | CONDITION | hash has tab=STAT&sub=CONDITION', 'S12-3', 'alerts chip opens STAT › CONDITION');
await shot(page, 'condition');

await assertConsole(page, 'S12-11', 'console 7411');

// S12-6 — the old #task=N link still opens the task in INV.
const { page: p6 } = await openLive(7411, '#task=4');
const r6 = await p6.evaluate(() => {
  const t = document.querySelector('[data-testid=tab-INV]');
  return { selected: t ? t.getAttribute('aria-selected') : null, hash: location.hash };
});
check('S12-6', '#task=4 opens INV with task=4', r6.selected === 'true' && /(^#|&)task=4(&|$)/.test(r6.hash),
  `tab-INV aria-selected=${r6.selected}, hash ${r6.hash || '(empty)'}`);
await assertConsole(p6, 'S12-11', 'console 7411 #task=4');

// ------------------------------------------------------- 7414 and 7417 (S12-7)

const { page: p14 } = await openLive(7414);
const run14 = await textOf(p14, '[data-testid=foot-run]');
check('S12-7', '7414 foot-run', run14 === 'RUN OVER', JSON.stringify(run14));
await assertConsole(p14, 'S12-11', 'console 7414');

const { page: p17 } = await openLive(7417);
const r17 = await p17.evaluate(() => {
  const run = document.querySelector('[data-testid=foot-run]');
  return {
    run: run ? run.textContent.replace(/\s+/g, ' ').trim() : null,
    limit: Boolean(document.querySelector('[data-testid=foot-limit]')),
  };
});
check('S12-7', '7417 foot-run (old state form)', r17.run === 'WAITING · MERGE', JSON.stringify(r17.run));
check('S12-7', '7417 has no foot-limit', !r17.limit, `foot-limit present: ${r17.limit}`);
const errors17 = (await p17.console.logs()).filter((l) => l.level === 'error').map((l) => l.message);
check('S12-7', '7417 console without error', errors17.length === 0, JSON.stringify(errors17.slice(0, 4)));
await shot(p17, 'idle');
await assertConsole(p17, 'S12-11', 'console 7417');

// ---------------------------------------------------------- 7415 (S12-8, S12-9)

const { page: p15 } = await openLive(7415);
const emptyVisible = await p15.locator('[data-testid=empty-state]').isVisible().catch(() => false);
const r8 = await p15.evaluate(() => {
  const es = document.querySelector('[data-testid=empty-state]');
  return {
    analyze: Boolean(es) && es.textContent.includes('plo analyze'),
    copy: Boolean(document.querySelector('[data-testid=copy-cmd]')),
    sleeper: Boolean(document.querySelector('.vb use[href="#op-dormindo-1"]')),
  };
});
check('S12-8', 'empty-state visible', emptyVisible, String(emptyVisible));
check('S12-8', 'empty-state names plo analyze', r8.analyze, String(r8.analyze));
check('S12-8', 'copy-cmd present', r8.copy, String(r8.copy));
check('S12-8', 'sleeping operator (.vb use #op-dormindo-1)', r8.sleeper, String(r8.sleeper));
await shot(p15, 'empty');

await p15.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
    configurable: true,
  });
});
await assertClickable(p15, '[data-testid=copy-cmd]',
  async () => p15.evaluate(() => {
    const b = document.querySelector('[data-testid=copy-cmd]');
    const c = window.__copied;
    const right = typeof c === 'string' && c.startsWith('plo analyze --plan ')
      && c.endsWith('smoke/.artifacts/fixtures/empty/plan.md');
    return `${b ? b.textContent.trim() : '(gone)'} | ${right ? 'copied the analyze command' : `copied ${JSON.stringify(c)}`}`;
  }),
  'COPIED ✓ | copied the analyze command', 'S12-9', 'copy-cmd copies plo analyze --plan …');
await assertConsole(p15, 'S12-11', 'console 7415');

// --------------------------------------------------------------- 7416 (S12-10)

const { page: p16, live: live16 } = await openLive(7416, '#tab=STAT&agent=T2');
await assertConsole(p16, 'S12-11', 'console 7416 (before the drop)');

// The Task 12 views draw no operator, so one is added with the page's own
// `fig` — otherwise "every operator stops" would hold of an empty set.
let probe = { q2: 0, anims: 0, error: null };
try {
  probe = await p16.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div id="smoke-probe">${fig('trabalhando', 60, false, 'probe')}</div>`);
    const svgs = [...document.querySelectorAll('.vb svg')];
    return { q2: document.querySelectorAll('.vb .q2').length, anims: svgs.reduce((n, s) => n + s.getAnimations().length, 0), error: null };
  });
} catch (e) {
  probe.error = e.message;
}
check('S12-10', 'probe operator on screen and animating', probe.q2 >= 1 && probe.anims >= 1,
  probe.error ? `fig failed: ${probe.error}` : `${probe.q2} .vb .q2, ${probe.anims} animation(s) on .vb svg`);

if (!live16) {
  check('S12-10', 'stream drop', false, `7416 never showed ${LIVE}; the drop was not attempted`);
} else {
  const t0 = Date.now();
  await p16.evaluate(async () => (await fetch('/__fixture/drop')).status);
  const down = await until(p16, (want) => {
    const el = document.querySelector('[data-testid=stream]');
    return Boolean(el) && el.textContent.trim() === want && document.body.classList.contains('frozen');
  }, DOWN, 4000);
  const downState = await p16.evaluate(() => {
    const el = document.querySelector('[data-testid=stream]');
    return `stream ${JSON.stringify(el ? el.textContent.trim() : null)}, body.frozen ${document.body.classList.contains('frozen')}`;
  });
  check('S12-10', `within 4 s: ${DOWN} and body.frozen`, down, `${downState} after ${Date.now() - t0} ms`);

  const still = await p16.evaluate(() => {
    const q2 = [...document.querySelectorAll('.vb .q2')];
    const anims = [...document.querySelectorAll('.vb svg')].flatMap((s) => s.getAnimations());
    return {
      q2: q2.length,
      q2Shown: q2.filter((e) => getComputedStyle(e).opacity !== '0').length,
      anims: anims.length,
      moving: anims.filter((a) => a.playState !== 'paused').map((a) => a.playState),
    };
  });
  check('S12-10', 'every .vb .q2 at computed opacity 0', still.q2 >= 1 && still.q2Shown === 0,
    `${still.q2Shown} of ${still.q2} .vb .q2 not at opacity 0`);
  check('S12-10', 'every .vb svg animation paused', still.anims >= 1 && still.moving.length === 0,
    `${still.moving.length} of ${still.anims} not paused ${JSON.stringify(still.moving.slice(0, 4))}`);

  const k1 = await textOf(p16, '[data-testid=foot-clock]');
  await sleep(2000);
  const k2 = await textOf(p16, '[data-testid=foot-clock]');
  check('S12-10', 'foot-clock stands still while down', k1 != null && k1 === k2, `${k1} → ${k2}`);
  await shot(p16, 'reconnecting');

  const back = await until(p16, (want) => {
    const el = document.querySelector('[data-testid=stream]');
    return Boolean(el) && el.textContent.trim() === want && !document.body.classList.contains('frozen');
  }, LIVE, Math.max(0, 15000 - (Date.now() - t0)));
  const after = await p16.evaluate(() => ({
    stream: (document.querySelector('[data-testid=stream]') || {}).textContent || null,
    frozen: document.body.classList.contains('frozen'),
    hash: location.hash,
  }));
  check('S12-10', `within 15 s: ${LIVE} again, not frozen`, back,
    `stream ${JSON.stringify(after.stream)}, frozen ${after.frozen}, ${Date.now() - t0} ms after the drop`);
  check('S12-10', 'hash still holds agent=T2', /(^#|&)agent=T2(&|$)/.test(after.hash), after.hash || '(empty)');
  await assertConsole(p16, 'S12-11', 'console 7416 (after the drop and back)');
}

// ------------------------------------------------------------------ S12-12

const wanted = ['mid-stat', 'condition', 'empty', 'reconnecting', 'idle'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S12-12', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
