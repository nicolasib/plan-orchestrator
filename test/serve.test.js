'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const state = require('../src/state');
const { createServer, listen } = require('../src/serve');

const PLAN = `# Auth refactor

### Task 1: Repo helpers

**Files:**
- Modify: \`src/repo.js\`

- [ ] step

### Task 2: Wrap-up

- [ ] docs
`;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-serve-'));
  const planPath = path.join(dir, 'auth-refactor.md');
  fs.writeFileSync(planPath, PLAN);

  const st = state.create({
    planPath, planContents: PLAN, repoRoot: dir,
    baseBranch: 'feature/auth', baseCommit: 'abc1234', maxLanes: 1,
    lanes: [{ id: 'A', tasks: [1], weight: 6 }], barriers: [2], testCommand: 'npm test',
  });
  st.lanes[0].branch = 'plo/auth-lane-a';
  state.save(planPath, st);
  return { dir, planPath, st };
}

/** Boot on an ephemeral port so parallel test runs cannot collide. */
async function boot(planPath) {
  const server = createServer({ planPath, pollMs: 50 });
  const addr = await listen(server, { port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${addr.port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

const get = async (base, p) => {
  const res = await fetch(base + p);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
};

test('GET / serves the dashboard document', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  try {
    const res = await get(s.base, '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.body, /<title>plo/);
    // An XML namespace is an identifier, not a fetch; a src/href is a fetch.
    assert.doesNotMatch(res.body, /(?:src|href)\s*=\s*["']https?:\/\//, 'the page must not load anything off-box');
  } finally { await s.close(); }
});

test('GET /api/snapshot returns the run payload with a server clock', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  try {
    const { status, body } = await get(s.base, '/api/snapshot');
    assert.equal(status, 200);
    assert.ok(body.now > 0);
    assert.equal(body.snapshot.ready, true);
    assert.equal(body.snapshot.lanes[0].label, 'A');
    assert.equal(body.snapshot.totals.total, 2);
  } finally { await s.close(); }
});

test('GET /api/task returns one task in full, 404s for one that does not exist', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  try {
    const ok = await get(s.base, '/api/task?n=1');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.task.title, 'Repo helpers');
    assert.deepEqual(ok.body.task.files.writes, ['src/repo.js']);

    assert.equal((await get(s.base, '/api/task?n=99')).status, 404);
    assert.equal((await get(s.base, '/api/task?n=abc')).status, 400);
  } finally { await s.close(); }
});

test('unknown routes 404 and writes are refused', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  try {
    assert.equal((await get(s.base, '/nope')).status, 404);
    const res = await fetch(`${s.base}/api/snapshot`, { method: 'POST' });
    assert.equal(res.status, 405, 'a monitor must never accept a write');
  } finally { await s.close(); }
});

test('a missing state file is displayed, not thrown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-serve-bare-'));
  const planPath = path.join(dir, 'fresh.md');
  fs.writeFileSync(planPath, PLAN);
  const s = await boot(planPath);
  try {
    const { status, body } = await get(s.base, '/api/snapshot');
    assert.equal(status, 200);
    assert.equal(body.snapshot.ready, false);
    assert.match(body.snapshot.message, /plo init/);
  } finally { await s.close(); }
});

test('a plan deleted under a live server degrades to an error payload', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  try {
    fs.unlinkSync(planPath);
    const { status, body } = await get(s.base, '/api/snapshot');
    assert.equal(status, 200);
    assert.equal(body.snapshot.ready, false);
    assert.ok(body.snapshot.error, 'the dashboard reports the failure instead of dying of it');
  } finally { await s.close(); }
});

test('/api/stream pushes the current state on connect and again when it changes', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  const frames = [];
  let buf = '';

  const req = http.get(`${s.base}/api/stream`, (res) => {
    assert.match(res.headers['content-type'], /text\/event-stream/);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (line) frames.push(JSON.parse(line.slice(6)));
      }
    });
  });

  try {
    await waitFor(() => frames.length >= 1);
    assert.equal(frames[0].snapshot.totals.done, 0);

    // Move the checkpoint the way a finishing task would.
    const st = state.load(planPath);
    st.tasks['1'].status = state.STATUS.DONE;
    state.save(planPath, st);

    await waitFor(() => frames.length >= 2);
    assert.equal(frames[1].snapshot.totals.done, 1);

    // Nothing changes for a while: the stream must stay quiet rather than
    // re-sending an identical payload every tick.
    const count = frames.length;
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(frames.length, count, 'an unchanged run must not produce frames');
  } finally {
    req.destroy();
    await s.close();
  }
});

test('shutdown hangs up on live watchers instead of waiting for them', async () => {
  const { planPath } = fixture();
  const s = await boot(planPath);
  const req = http.get(`${s.base}/api/stream`, () => {});
  await waitFor(() => s.server.plo.clients.size === 1);

  // Without hanging up first this never resolves: an SSE response has no end,
  // so Ctrl-C would leave the process alive for as long as a tab is open.
  const started = Date.now();
  await Promise.race([
    s.server.plo.shutdown(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('shutdown hung on an open SSE client')), 2000)),
  ]);
  assert.ok(Date.now() - started < 2000);
  assert.equal(s.server.plo.clients.size, 0);
  req.destroy();
});

test('the port is free again immediately after shutdown', async () => {
  const { planPath } = fixture();
  const first = createServer({ planPath });
  const addr = await listen(first, { port: 0, host: '127.0.0.1' });
  const req = http.get(`http://127.0.0.1:${addr.port}/api/stream`, () => {});
  await waitFor(() => first.plo.clients.size === 1);
  await first.plo.shutdown();
  req.destroy();

  const second = createServer({ planPath });
  const addr2 = await listen(second, { port: addr.port, host: '127.0.0.1', attempts: 1 });
  assert.equal(addr2.port, addr.port, 'a shut-down dashboard must not squat on its port');
  await new Promise((r) => second.close(r));
});

test('listen steps past a port already in use', async () => {
  const { planPath } = fixture();
  const first = createServer({ planPath });
  const addr = await listen(first, { port: 0, host: '127.0.0.1' });

  const second = createServer({ planPath });
  const addr2 = await listen(second, { port: addr.port, host: '127.0.0.1' });
  try {
    assert.equal(addr2.port, addr.port + 1);
  } finally {
    await new Promise((r) => first.close(r));
    await new Promise((r) => second.close(r));
  }
});

async function waitFor(pred, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    if (pred()) return;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}
