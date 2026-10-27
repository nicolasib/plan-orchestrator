// smoke/task-18.js — Task 18: the panel at 390, 900 and 1200 px, reduced
// motion read from the stylesheet, the operators' frames on every screen that
// has them, and a page that never leaves its origin; against the fixture of
// `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertConsole, shot, sleep, note and __rec.
//
// Aside has no setViewportSize, so a width is a same-origin iframe the spec
// lays over the 7411 page, fixed at the top left and above the scanlines
// (`.screen::after`, z-index 60), so a SHOT shows it. The iframe's own
// viewport drives its media queries. Every measure goes through
// `contentDocument`, and only once the frame's stream reads ● LIVE, its
// view-title reads the sub-tab asked for and its fonts are in.
//
// `.screen` clips (overflow:hidden), so `documentElement.scrollWidth` alone
// can never see an overflow: S18-1 also reads the scroll boxes inside it, and
// every ancestor of the tab strip and of the stream that is wider than its box
// has to be one that scrolls.
//
// The frame sweep pauses every animation on `.vb svg` and walks currentTime
// from 0 to 3200 ms in steps of 97 (a prime, so the instants fall all over
// each cycle). The `use`s are the operators' (`.vb use`): the sprite's own
// symbols are never rendered and have no box.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';
const ORIGIN = `${HOST}:7411/`;
const SUBS = {
  STAT: ['AGENTS', 'CONDITION'],
  INV: ['ALL', 'PROBLEMS', 'RUNNING', 'QUEUE', 'DONE'],
  DATA: ['QUESTS', 'LOG', 'NUMBERS'],
  MAP: ['LANES'],
  RADIO: ['STATIONS'],
};
const EVERY_SUB = Object.entries(SUBS).flatMap(([tab, subs]) => subs.map((sub) => ({ tab, sub, hash: `#tab=${tab}&sub=${sub}` })));

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

const titleIs = (want) => {
  const v = document.querySelector('[data-testid=view-title]');
  return Boolean(v) && v.textContent.trim() === want;
};

/** Open a scenario with the console buffer attached and wait for the stream. */
async function openLive(port, hash = '') {
  const page = await openWithConsole(`${HOST}:${port}/${hash}`);
  const live = Boolean(await until(page, streamIs, LIVE, 8000));
  if (!live) note(`${port} never showed ${LIVE} within 8 s`);
  return { page, live };
}

/** Move the page itself through its hash and wait for the sub-tab's title. */
async function goTo(page, hash, sub) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  return Boolean(await until(page, titleIs, sub, 5000));
}

// ------------------------------------------------------------- the widths

const FRAME = 'smoke-width';

/** In the top page: the frame is live, shows `sub`, and its fonts are in. */
const frameShows = ({ id, live, sub }) => {
  const f = document.getElementById(id);
  const d = f && f.contentDocument;
  if (!d || !d.fonts || d.fonts.status !== 'loaded') return false;
  const st = d.querySelector('[data-testid=stream]');
  const vt = d.querySelector('[data-testid=view-title]');
  return Boolean(st && vt) && st.textContent.trim() === live && vt.textContent.trim() === sub;
};

/** A fresh frame `width` px wide on `hash`, replacing any before it. */
async function frameAt(page, width, hash, sub) {
  await page.evaluate(({ id, width, url }) => {
    const old = document.getElementById(id);
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = id;
    f.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:800px;border:0;z-index:2147483647;background:#06140b`;
    f.src = url;
    document.body.appendChild(f);
  }, { id: FRAME, width, url: `${ORIGIN}${hash}` });
  const ok = Boolean(await until(page, frameShows, { id: FRAME, live: LIVE, sub }, 10000));
  if (!ok) note(`${width} px frame on ${hash} never showed ${sub} ${LIVE} within 10 s`);
  return ok;
}

/** Move the frame through its own hash, as a link in it would. */
async function frameTo(page, hash, sub) {
  await page.evaluate(({ id, hash }) => { document.getElementById(id).contentWindow.location.hash = hash; }, { id: FRAME, hash });
  return Boolean(await until(page, frameShows, { id: FRAME, live: LIVE, sub }, 5000));
}

/** R3's measures of the frame, for one sub-tab. */
const narrow = ({ id }) => {
  const f = document.getElementById(id);
  const d = f.contentDocument;
  const w = f.contentWindow;
  const name = (el) => (el.id ? `#${el.id}` : el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]`
    : `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join('')}`);
  const wide = (el) => el.scrollWidth > el.clientWidth + 1;
  const boxes = [d.querySelector('.screen'), d.getElementById('view'), d.getElementById('foot'), ...d.querySelectorAll('#view .col')];
  const clipped = [];
  for (const tid of ['tab-RADIO', 'stream']) {
    const from = d.querySelector(`[data-testid=${tid}]`);
    if (!from) { clipped.push(`[data-testid=${tid}] absent`); continue; }
    for (let el = from.parentElement; el && !el.classList.contains('screen'); el = el.parentElement) {
      const ox = w.getComputedStyle(el).overflowX;
      if (wide(el) && ox !== 'auto' && ox !== 'scroll') clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth} overflow-x ${ox}`);
    }
  }
  const foot = d.getElementById('foot');
  const segs = foot ? [...foot.children] : [];
  const map = d.querySelector('[data-testid=map]');
  return {
    doc: d.documentElement.scrollWidth,
    absent: ['.screen', '#view', '#foot'].filter((s) => !d.querySelector(s)),
    over: boxes.filter((el) => el && wide(el)).map((el) => `${name(el)} ${el.scrollWidth}>${el.clientWidth}`),
    clipped,
    segs: segs.length,
    rows: new Set(segs.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    map: map ? { sw: map.scrollWidth, cw: map.clientWidth } : null,
  };
};

/** Boxes of the frame's elements by selector, in the frame's px; null when absent. */
const boxesOf = ({ id, sel }) => {
  const d = document.getElementById(id).contentDocument;
  const out = {};
  for (const [k, s] of Object.entries(sel)) {
    const el = d.querySelector(s);
    const r = el ? el.getBoundingClientRect() : null;
    out[k] = r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
  }
  return out;
};

const inFrame = ({ id, sel, text }) => {
  const d = document.getElementById(id).contentDocument;
  const el = d && d.querySelector(sel);
  return Boolean(el) && (text == null || el.textContent.trim() === text);
};

const px = (v) => (v == null ? 'absent' : String(Math.round(v * 10) / 10));

// ---------------------------------------------------------------- 7411 (mid)

const { page } = await openLive(7411);

// S18-1 — 390 px: every sub-tab fits, the tab strip scrolls, the footer is two
// rows, the map scrolls sideways.
await frameAt(page, 390, '#tab=STAT&sub=AGENTS', 'AGENTS');
for (const { tab, sub, hash } of EVERY_SUB) {
  const shown = await frameTo(page, hash, sub);
  let m = null;
  try { m = await page.evaluate(narrow, { id: FRAME }); } catch (e) { m = { error: e.message }; }
  if (m.error) {
    check('S18-1', `390 px ${hash}`, false, `measure failed: ${m.error}`);
    continue;
  }
  check('S18-1', `390 px ${hash}: documentElement ≤ 390, .screen/#view/#foot/#view .col fit, the tabs and the stream never clip`,
    shown && !m.absent.length && m.doc <= 390 && !m.over.length && !m.clipped.length,
    `${shown ? `${sub} shown` : `${sub} never shown`} · documentElement.scrollWidth ${m.doc}`
      + ` · wider than their box: ${m.over.length ? m.over.join(', ') : 'none'}`
      + ` · clipping: ${m.clipped.length ? m.clipped.join(', ') : 'none'}`
      + (m.absent.length ? ` · absent ${m.absent.join(', ')}` : ''));
  if (tab === 'STAT') {
    check('S18-1', `390 px ${hash}: the children of #foot sit on at most 2 rows`, m.segs >= 1 && m.rows <= 2,
      `${m.segs} segment(s) on ${m.rows} row(s)`);
  }
  if (tab === 'MAP') {
    check('S18-1', `390 px ${hash}: [data-testid=map] scrolls sideways`, Boolean(m.map) && m.map.sw > m.map.cw,
      m.map ? `scrollWidth ${m.map.sw}, clientWidth ${m.map.cw}` : 'map absent');
    await shot(page, 'w390-map');
  }
  if (hash === '#tab=STAT&sub=AGENTS') await shot(page, 'w390-stat');
}

// S18-2 — 900 px: STAT in two columns with the details under the hero; INV
// with the record under the table.
await frameAt(page, 900, '#tab=STAT&agent=T5', 'AGENTS');
await until(page, inFrame, { id: FRAME, sel: '[data-testid=hero-name]', text: 'T5 · CONTROLLER' }, 4000);
const s900 = await page.evaluate(boxesOf, { id: FRAME, sel: { hero: '[data-testid=hero]', details: '[data-testid=details]', crew: '[data-testid=agent-T5]' } });
check('S18-2', '900 px #tab=STAT&agent=T5: the details start at or below the hero\'s bottom (details.top ≥ hero.bottom − 1)',
  s900.hero && s900.details && s900.details.top >= s900.hero.bottom - 1,
  `details.top ${px(s900.details && s900.details.top)}, hero.bottom ${px(s900.hero && s900.hero.bottom)}`);
check('S18-2', '900 px #tab=STAT&agent=T5: the crew sits beside the hero (agent-T5.right ≤ hero.left + 1)',
  s900.hero && s900.crew && s900.crew.right <= s900.hero.left + 1,
  `agent-T5.right ${px(s900.crew && s900.crew.right)}, hero.left ${px(s900.hero && s900.hero.left)}`);
await shot(page, 'w900-stat');

await frameTo(page, '#tab=INV&task=5', 'ALL');
await until(page, inFrame, { id: FRAME, sel: '[data-testid=record]' }, 4000);
const i900 = await page.evaluate(boxesOf, { id: FRAME, sel: { table: '[data-testid=inv-table]', record: '[data-testid=record]' } });
check('S18-2', '900 px #tab=INV&task=5: the record starts at or below the table\'s bottom (record.top ≥ inv-table.bottom − 1)',
  i900.table && i900.record && i900.record.top >= i900.table.bottom - 1,
  `record.top ${px(i900.record && i900.record.top)}, inv-table.bottom ${px(i900.table && i900.table.bottom)}`);

// S18-3 — 1200 px: the prototype's three columns.
await frameAt(page, 1200, '#tab=STAT&agent=T5', 'AGENTS');
await until(page, inFrame, { id: FRAME, sel: '[data-testid=hero-name]', text: 'T5 · CONTROLLER' }, 4000);
const s1200 = await page.evaluate(boxesOf, { id: FRAME, sel: { hero: '[data-testid=hero]', details: '[data-testid=details]' } });
check('S18-3', '1200 px #tab=STAT&agent=T5: the details start at or right of the hero\'s right edge (details.left ≥ hero.right − 1)',
  s1200.hero && s1200.details && s1200.details.left >= s1200.hero.right - 1,
  `details.left ${px(s1200.details && s1200.details.left)}, hero.right ${px(s1200.hero && s1200.hero.right)}`);
await shot(page, 'w1200-stat');

await page.evaluate((id) => { const f = document.getElementById(id); if (f) f.remove(); }, FRAME);

// S18-4 — the frames, once the sprite's symbols are in the page.
const sweep = () => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vbs = [...document.querySelectorAll('.vb')];
  const uses = [...document.querySelectorAll('.vb use')];
  const unresolved = uses.filter((u) => !document.querySelector(u.getAttribute('href'))).length;
  const anims = document.getAnimations()
    .filter((a) => a.effect && a.effect.target instanceof Element && a.effect.target.matches('.vb svg'));
  for (const a of anims) a.pause();
  const bad = [];
  let instants = 0;
  for (let t = 0; t <= 3200; t += 97) {
    for (const a of anims) a.currentTime = t;
    instants += 1;
    vbs.forEach((vb, i) => {
      const q1 = vb.querySelector(':scope > .q1');
      const q2 = vb.querySelector(':scope > .q2');
      const shown = [q1, q2].filter((q) => q && getComputedStyle(q).opacity === '1');
      if (shown.length !== 1) bad.push(`t=${t} ${vb.getAttribute('data-pose')}#${i}: ${shown.length} frames`);
      else if (reduced && shown[0] !== q1) bad.push(`t=${t} ${vb.getAttribute('data-pose')}#${i}: frame 2 with reduced motion`);
    });
    const flat = uses.filter((u) => !(u.getBBox().width > 0)).length;
    if (flat) bad.push(`t=${t}: ${flat} use(s) with no width`);
  }
  return { reduced, vbs: vbs.length, uses: uses.length, unresolved, anims: anims.length, instants, nbad: bad.length, bad: bad.slice(0, 4) };
};

const spriteIn = () => {
  const uses = [...document.querySelectorAll('.vb use')];
  return uses.length > 0 && uses.every((u) => Boolean(document.querySelector(u.getAttribute('href'))));
};

async function frames(p, label) {
  await until(p, spriteIn, null, 5000);
  let r;
  try { r = await p.evaluate(sweep); } catch (e) { return check('S18-4', label, false, `sweep failed: ${e.message}`); }
  if (r.reduced) note(`${label}: this machine has prefers-reduced-motion: reduce — no animation; checked that each .vb shows only .q1`);
  check('S18-4', `${label}: at each of ${r.instants} instants every .vb shows exactly one of .q1/.q2 and every .vb use has a width`,
    r.vbs >= 1 && r.uses >= 1 && r.unresolved === 0 && (r.reduced || r.anims >= 1) && r.nbad === 0,
    `${r.vbs} .vb · ${r.anims} animation(s) on .vb svg · ${r.uses} use (${r.unresolved} unresolved)`
      + ` · ${r.nbad} miss(es)${r.nbad ? ` ${JSON.stringify(r.bad)}` : ''}${r.reduced ? ' · reduced motion' : ''}`);
}

const SCREENS_11 = [['#tab=STAT&sub=AGENTS', 'AGENTS'], ['#tab=STAT&sub=CONDITION', 'CONDITION'], ['#tab=MAP&sub=LANES', 'LANES']];
for (const [hash, sub] of SCREENS_11) {
  const shown = await goTo(page, hash, sub);
  if (!shown) note(`7411 ${hash} never showed ${sub}`);
  await frames(page, `7411 ${hash}`);
}

// S18-6 — every sub-tab, then every resource the page loaded.
const walked = [];
for (const { hash, sub } of EVERY_SUB) if (!(await goTo(page, hash, sub))) walked.push(sub);
if (walked.length) note(`7411: never showed ${walked.join(', ')} on the walk`);
const names = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
const sprite = names.find((n) => n.endsWith('/assets/operador.svg'));
check('S18-6', '7411 after every sub-tab: at least one resource entry, one of them /assets/operador.svg',
  names.length >= 1 && Boolean(sprite), `${names.length} entr(ies) · sprite ${sprite || 'absent'}`);
const away = names.filter((n) => !n.startsWith(ORIGIN));
check('S18-6', `7411 after every sub-tab: every resource entry starts with ${ORIGIN}`, names.length >= 1 && !away.length,
  away.length ? `${away.length} elsewhere: ${JSON.stringify(away.slice(0, 4))}` : `all ${names.length} on the origin`);

// S18-5 — reduced motion, by structure (R7).
const motion = await page.evaluate(() => {
  const found = [];
  const loose = [];
  const walk = (rules, media) => {
    for (const r of rules) {
      const inside = r instanceof CSSMediaRule ? [...media, r.media.mediaText] : media;
      if (r instanceof CSSStyleRule) {
        const n = r.style.animationName;
        if (n && n !== 'none') {
          found.push(r.selectorText);
          if (!inside.some((t) => t.replace(/\s+/g, ' ').includes('prefers-reduced-motion: no-preference'))) loose.push(`${r.selectorText} { animation-name: ${n} }`);
        }
      }
      if (r.cssRules) walk(r.cssRules, inside);
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules, []);
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].map((c) => `.${c}`).join('')}`;
  const inline = [...document.querySelectorAll('*')]
    .filter((el) => el.style && el.style.animationName && el.style.animationName !== 'none').map(name);
  const kinds = document.getAnimations().map((a) => a.constructor.name);
  return { found, loose, inline, kinds: kinds.length, foreign: kinds.filter((k) => k !== 'CSSAnimation' && k !== 'CSSTransition') };
});
check('S18-5', 'every CSSStyleRule with an animation-name sits inside @media (prefers-reduced-motion: no-preference)',
  motion.found.length >= 1 && !motion.loose.length,
  `${motion.found.length} rule(s) with an animation name · outside: ${motion.loose.length ? JSON.stringify(motion.loose.slice(0, 4)) : 'none'}`);
check('S18-5', 'no element carries an inline animation-name', !motion.inline.length,
  motion.inline.length ? JSON.stringify(motion.inline.slice(0, 4)) : 'none');
check('S18-5', 'document.getAnimations() holds only CSSAnimation and CSSTransition', !motion.foreign.length,
  `${motion.kinds} animation(s) · other kinds: ${motion.foreign.length ? JSON.stringify([...new Set(motion.foreign)]) : 'none'}`);

await assertConsole(page, 'S18-7', 'console 7411, with its 390, 900 and 1200 px frames');

// ------------------------------------------------------------- 7413 (review)

const { page: p13 } = await openLive(7413);
if (!(await until(p13, titleIs, 'AGENTS', 4000))) note('7413 never showed AGENTS');
await frames(p13, '7413 STAT › AGENTS');
await assertConsole(p13, 'S18-7', 'console 7413');

// -------------------------------------------------------------- 7415 (empty)

const { page: p15 } = await openLive(7415);
if (!(await until(p15, () => Boolean(document.querySelector('[data-testid=empty-state] .vb')), null, 4000))) note('7415 never showed its sleeping operator');
await frames(p15, '7415 empty state');
await assertConsole(p15, 'S18-7', 'console 7415');

// ------------------------------------------------------------------- S18-7

const wanted = ['w390-stat', 'w390-map', 'w900-stat', 'w1200-stat'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S18-7', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
