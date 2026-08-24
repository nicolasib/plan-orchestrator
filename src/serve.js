'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const monitor = require('./monitor');

/**
 * A local dashboard for a run in flight.
 *
 * Deliberately narrow: it reads, it never writes, and it binds to loopback by
 * default. `plo run` holds one terminal; this is the second window that
 * answers "what is each lane doing right now, and has anything died".
 *
 * No dependencies and no build step — the CLI has none, and a monitor that
 * needs `npm install` to watch a run that is already burning tokens is a
 * monitor that does not get used.
 */

const DEFAULT_PORT = 7331;
const DEFAULT_HOST = '127.0.0.1';
const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;
const PORT_ATTEMPTS = 10;

const UI_FILE = path.join(__dirname, 'ui.html');

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

/**
 * Never let a bad read take the server down. A plan deleted mid-run, a
 * checkpoint being replaced, a corrupt state file — all of those are things
 * the dashboard should *display*, not die of.
 */
function safeSnapshot(planPath, opts) {
  try {
    return monitor.snapshot(planPath, opts);
  } catch (e) {
    return { plan: planPath, ready: false, error: e.message };
  }
}

/**
 * `activityLimit` was 8 because a card showed eight rows and nothing on the
 * page wanted more. It is now an agent's log drawer, opened on purpose by a
 * reader who wants to see what it has been doing — eight calls is about a
 * minute of work, which is not enough to answer that. It is per task and only
 * for tasks that are running or stopped, so the cost is bounded by how many
 * agents are alive, not by how long the plan is.
 */
function createServer({ planPath, activityLimit = 16, pollMs = POLL_MS } = {}) {
  const clients = new Set();
  let timer = null;
  let lastPayload = null;

  const compute = () => JSON.stringify(safeSnapshot(planPath, { activityLimit }));

  const broadcast = (payload, { force = false } = {}) => {
    if (!force && payload === lastPayload) return false;
    lastPayload = payload;
    const frame = `event: snapshot\ndata: {"now":${Date.now()},"snapshot":${payload}}\n\n`;
    for (const c of clients) c.write(frame);
    return true;
  };

  // Poll only while someone is watching. An open browser tab costs one stat
  // and one tail per second; a closed one costs nothing.
  const ensureTimer = () => {
    if (timer || !clients.size) return;
    timer = setInterval(() => broadcast(compute()), pollMs);
    if (timer.unref) timer.unref();
  };
  const stopTimer = () => {
    if (timer && !clients.size) { clearInterval(timer); timer = null; }
  };

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      json(res, 400, { error: 'bad request' });
      return;
    }

    if (req.method !== 'GET') { json(res, 405, { error: 'read-only server' }); return; }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html;
      try {
        html = fs.readFileSync(UI_FILE);
      } catch (e) {
        json(res, 500, { error: `ui.html missing: ${e.message}` });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/snapshot') {
      json(res, 200, { now: Date.now(), snapshot: safeSnapshot(planPath, { activityLimit }) });
      return;
    }

    if (url.pathname === '/api/task') {
      const n = Number(url.searchParams.get('n'));
      if (!Number.isInteger(n)) { json(res, 400, { error: 'n must be a task number' }); return; }
      let detail;
      try {
        detail = monitor.taskDetail(planPath, n, { activityLimit: Number(url.searchParams.get('limit')) || 200 });
      } catch (e) {
        json(res, 500, { error: e.message });
        return;
      }
      if (!detail) { json(res, 404, { error: `no task ${n} in this run` }); return; }
      json(res, 200, { now: Date.now(), task: detail });
      return;
    }

    if (url.pathname === '/api/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);

      // The newcomer gets the current state immediately; the shared dedupe
      // must not swallow it just because another client already has it.
      res.write(`event: snapshot\ndata: {"now":${Date.now()},"snapshot":${compute()}}\n\n`);

      const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      if (beat.unref) beat.unref();
      const close = () => {
        clearInterval(beat);
        clients.delete(res);
        stopTimer();
      };
      req.on('close', close);
      res.on('error', close);
      ensureTimer();
      return;
    }

    json(res, 404, { error: `no route ${url.pathname}` });
  });

  /**
   * An SSE response never ends on its own, and `server.close()` waits for every
   * open connection before it calls back. Closing without hanging up on the
   * watchers first deadlocks: Ctrl-C leaves the process alive for as long as a
   * browser tab is open, and the port stays taken.
   */
  const shutdown = () => new Promise((resolve) => {
    if (timer) { clearInterval(timer); timer = null; }
    for (const c of clients) { try { c.end(); } catch { /* already gone */ } }
    clients.clear();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  });

  server.on('close', () => {
    if (timer) { clearInterval(timer); timer = null; }
    clients.clear();
  });

  // Exposed for tests: assert the fan-out without driving a browser.
  server.plo = { compute, broadcast, clients, shutdown };
  return server;
}

/** Bind, stepping past a port already taken by another run's dashboard. */
function listen(server, { port = DEFAULT_PORT, host = DEFAULT_HOST, attempts = PORT_ATTEMPTS } = {}) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tryPort = (p) => {
      const onError = (e) => {
        if (e.code === 'EADDRINUSE' && tries < attempts - 1 && p !== 0) {
          tries += 1;
          setImmediate(() => tryPort(p + 1));
          return;
        }
        reject(e);
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        resolve(server.address());
      });
    };
    tryPort(port);
  });
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch { /* a dashboard you have to click is still a dashboard */ }
}

async function serve({ planPath, port, host, open = false, activityLimit, pollMs, log = () => {} } = {}) {
  const server = createServer({ planPath, activityLimit, pollMs });
  const addr = await listen(server, { port, host });
  const shown = addr.address === '0.0.0.0' || addr.address === '::' ? 'localhost' : addr.address;
  const url = `http://${shown.includes(':') ? `[${shown}]` : shown}:${addr.port}`;
  log(`plo serve — ${url}`);
  log(`  plan:  ${planPath}`);
  log('  read-only. Ctrl-C to stop.');
  if (open) openBrowser(url);
  return { server, url, address: addr };
}

module.exports = { createServer, listen, serve, DEFAULT_PORT, DEFAULT_HOST };
