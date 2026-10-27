// smoke/task-17.js — Task 17: RADIO › STATIONS, against the fixture of
// `node smoke/fixture.js up`.
//
// Body only: runner/harness.js is concatenated ahead of this file and supplies
// openWithConsole, assertClickable, assertConsole, shot, sleep, note and __rec.
// Every CLICKABLE row reads a value the click has to change.
//
// The wave's measure is the peak-to-peak amplitude of the first 80 points of
// `#wv`, in viewBox units, and every run of samples is taken inside the page,
// so the 50 ms between two of them is the page's clock and not a round trip.
// "A new line arrived" is radio-out's LAST line changing: the suite's window
// holds 40 lines and stops growing once it is full.

const HOST = 'http://127.0.0.1';
const LIVE = '● LIVE';

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

/** Open a scenario with the console buffer attached and wait for the stream
 *  and for the tab to be visible (the wave only moves in a visible tab). */
async function openLive(port, hash = '') {
  const page = await openWithConsole(`${HOST}:${port}/${hash}`);
  const live = Boolean(await until(page, streamIs, LIVE, 8000));
  if (!live) note(`${port} never showed ${LIVE} within 8 s`);
  const vis = await page.evaluate(() => document.visibilityState);
  if (vis !== 'visible') note(`${port}: document.visibilityState is ${vis}`);
  return { page, live };
}

/** A plain click that never kills the run: a missing element is a red row,
 *  not a dead repl. */
async function tap(page, sel) {
  try { await page.locator(sel).click(); return 'clicked'; } catch (e) { return `click failed (${e.message})`; }
}

/** radio-out's text, its last line, and whether a visible ON AIR marker is up
 *  (present with a box — never computed opacity: it blinks to .2). */
const radioState = (page) => page.evaluate(() => {
  const out = document.querySelector('[data-testid=radio-out]');
  const text = out ? out.textContent : null;
  const air = [...document.querySelectorAll('.onair')].find((e) => e.textContent.trim() === 'ON AIR');
  const box = air ? air.getBoundingClientRect() : null;
  const pressed = [...document.querySelectorAll('[data-testid^=station-]')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-testid'));
  return {
    text,
    lines: text == null ? 0 : text.split('\n').filter((l) => l.trim()).length,
    onAir: Boolean(box) && box.width > 0 && box.height > 0,
    pressed,
  };
});

/** In the page: wait (up to `waitMs`) for radio-out's last line to change if
 *  asked, then take 10 samples 50 ms apart of the wave's peak-to-peak. */
const sampleWave = (page, waitForLine, waitMs = 6000) => page.evaluate(async ({ waitForLine, waitMs }) => {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const last = () => {
    const o = document.querySelector('[data-testid=radio-out]');
    return o ? o.textContent.split('\n').pop() : null;
  };
  const p2p = () => {
    const wv = document.getElementById('wv');
    if (!wv) return null;
    const ys = String(wv.getAttribute('points') || '').trim().split(/\s+/).slice(0, 80)
      .map((p) => Number(p.split(',')[1])).filter((y) => Number.isFinite(y));
    return ys.length ? Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10 : null;
  };
  let changed = null;
  if (waitForLine) {
    const before = last();
    const t0 = Date.now();
    while (last() === before && Date.now() - t0 < waitMs) await nap(10);
    changed = last() !== before;
  }
  const samples = [];
  for (let i = 0; i < 10; i += 1) {
    samples.push(p2p());
    if (i < 9) await nap(50);
  }
  return { changed, samples, vis: document.visibilityState };
}, { waitForLine, waitMs });

// ---------------------------------------------------------------- 7411 (mid)

const { page } = await openLive(7411, '#tab=RADIO&station=suite');
await until(page, () => Boolean(document.querySelector('[data-testid=station-suite]')), null, 4000);

// S17-1 — the two fixed stations and T2 (running, with a test run); T6 and T7
// run with no test run, so they have no station.
const st11 = await page.evaluate(() => {
  const has = (id) => Boolean(document.querySelector(`[data-testid=station-${id}]`));
  return { suite: has('suite'), review: has('review'), T2: has('T2'), T6: has('T6'), T7: has('T7') };
});
check('S17-1', '7411: station-suite, station-review and station-T2 exist', st11.suite && st11.review && st11.T2,
  `suite ${st11.suite}, review ${st11.review}, T2 ${st11.T2}`);
check('S17-1', '7411: no station-T6 and no station-T7', !st11.T6 && !st11.T7, `T6 ${st11.T6}, T7 ${st11.T7}`);
const r11 = await radioState(page);
check('S17-1', '7411 station=suite: station-suite pressed and radio-out contains "no signal — starts after the merge"',
  r11.pressed.length === 1 && r11.pressed[0] === 'station-suite' && r11.text != null && r11.text.includes('no signal — starts after the merge'),
  `pressed ${JSON.stringify(r11.pressed)} · radio-out ${r11.text == null ? 'absent' : JSON.stringify(r11.text.slice(0, 120))}`);

// S17-7 — the wave's drawing: a 400 × 160 viewBox and the L axis.
const svg11 = await page.evaluate(() => {
  const wv = document.getElementById('wv');
  const svg = wv ? wv.closest('svg') : null;
  return { wv: Boolean(wv), viewBox: svg ? svg.getAttribute('viewBox') : null, ax: Boolean(svg && svg.querySelector('path.ax')) };
});
check('S17-7', '7411: the <svg> of #wv has viewBox="0 0 400 160" and a path.ax',
  svg11.wv && svg11.viewBox === '0 0 400 160' && svg11.ax,
  `#wv ${svg11.wv ? 'present' : 'absent'} · viewBox ${JSON.stringify(svg11.viewBox)} · path.ax ${svg11.ax}`);

// S17-2 — tuning in to T2 shows its test run, on air, in the address.
await assertClickable(page, '[data-testid=station-T2]', async () => {
  await until(page, () => {
    const o = document.querySelector('[data-testid=radio-out]');
    return Boolean(o) && o.textContent.includes('npm test -- panel');
  }, null, 3000);
  const r = await radioState(page);
  const hash = await page.evaluate(() => location.hash);
  const text = r.text || '';
  return `radio-out ${text.includes('npm test -- panel') ? 'has npm test -- panel' : 'without the command'}`
    + ` · ${text.split('\n').some((l) => l.trim() === 'pass') ? 'a pass line' : 'no pass line'}`
    + ` · ON AIR ${r.onAir ? 'visible' : 'not visible'}`
    + ` · hash ${/(^#|&)station=T2(&|$)/.test(hash) ? 'has station=T2' : hash || '(empty)'}`;
}, 'radio-out has npm test -- panel · a pass line · ON AIR visible · hash has station=T2', 'S17-2', 'station-T2 tunes in to T2');
await shot(page, 'radio-t2');
await assertConsole(page, 'S17-8', 'console 7411 #tab=RADIO');

// -------------------------------------------------------------- 7412 (suite)

const { page: p12 } = await openLive(7412, '#tab=RADIO&station=suite');
await until(p12, () => {
  const o = document.querySelector('[data-testid=radio-out]');
  return Boolean(o) && o.textContent.trim().length > 0;
}, null, 4000);

// S17-3 — the suite on air: right after a new line, the wave bursts past 30.
const w3 = await sampleWave(p12, true);
const r12 = await radioState(p12);
check('S17-3', '7412 station=suite: after radio-out gets a new last line, peak-to-peak > 30 in at least one of 10 samples (50 ms)',
  w3.changed === true && r12.onAir && w3.samples.some((v) => v != null && v > 30),
  `new line ${w3.changed} · ON AIR ${r12.onAir} · samples ${JSON.stringify(w3.samples)} · ${w3.vis}`);
await shot(p12, 'radio-suite-onair');

// S17-5 — the live lines are the cleaned ones.
const t12 = r12.text || '';
check('S17-5', '7412 station=suite: radio-out has no \\u001b, no \\r and no "progress 10%"',
  r12.text != null && !t12.includes('\u001b') && !t12.includes('\r') && !t12.includes('progress 10%'),
  r12.text == null ? 'radio-out absent'
    : `ESC ${t12.includes('\u001b')} · CR ${t12.includes('\r')} · progress 10% ${t12.includes('progress 10%')} · ${r12.lines} line(s)`);

// S17-4 — the review is off air here: switching to it flattens the wave at once.
const tap12 = await tap(p12, '[data-testid=station-review]');
const w4 = await sampleWave(p12, false);
const r12b = await radioState(p12);
check('S17-4', '7412 station=review (off air): peak-to-peak <= 2 in all 10 samples (50 ms)',
  r12b.pressed.length === 1 && r12b.pressed[0] === 'station-review' && !r12b.onAir
    && w4.samples.every((v) => v != null && v <= 2),
  `${tap12} · pressed ${JSON.stringify(r12b.pressed)} · ON AIR ${r12b.onAir} · samples ${JSON.stringify(w4.samples)} · ${w4.vis}`);
await shot(p12, 'radio-review-offair');
await assertConsole(p12, 'S17-8', 'console 7412 #tab=RADIO');

// ------------------------------------------------------------- 7413 (review)

const { page: p13 } = await openLive(7413, '#tab=RADIO&station=review');
await until(p13, () => {
  const o = document.querySelector('[data-testid=radio-out]');
  return Boolean(o) && o.textContent.trim().length > 0;
}, null, 4000);

// S17-6 — the reviewer on air: one line per event, its subagent's included.
const r13 = await radioState(p13);
check('S17-6', '7413 station=review (on air): radio-out has at least 3 lines',
  r13.pressed.length === 1 && r13.pressed[0] === 'station-review' && r13.onAir && r13.lines >= 3,
  `pressed ${JSON.stringify(r13.pressed)} · ON AIR ${r13.onAir} · ${r13.lines} line(s) · ${JSON.stringify((r13.text || '').slice(0, 160))}`);

// S17-5 — the finished suite: its summary is cleaned the way the live lines are.
const tap13 = await tap(p13, '[data-testid=station-suite]');
await sleep(300);
const r13s = await radioState(p13);
const t13 = r13s.text || '';
check('S17-5', '7413 station=suite (finished): radio-out has no \\u001b, contains "progress 100%" and not "progress 10%"',
  r13s.pressed.length === 1 && r13s.pressed[0] === 'station-suite'
    && r13s.text != null && !t13.includes('\u001b') && t13.includes('progress 100%') && !t13.includes('progress 10%'),
  r13s.text == null ? `${tap13} · radio-out absent`
    : `ESC ${t13.includes('\u001b')} · progress 100% ${t13.includes('progress 100%')} · progress 10% ${t13.includes('progress 10%')} · ${JSON.stringify(t13.slice(-160))}`);
await assertConsole(p13, 'S17-8', 'console 7413 #tab=RADIO');

// ------------------------------------------------------------------- S17-8

const wanted = ['radio-suite-onair', 'radio-review-offair', 'radio-t2'];
const taken = __smoke.shots.map((s) => s.state);
__rec('S17-8', 'SHOT', wanted.every((w) => taken.includes(w)), `states: ${taken.join(', ')}`);

emit();
