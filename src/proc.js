'use strict';

const { execFileSync } = require('child_process');

/**
 * Who is running, and is it still the same process: the pid alone can be
 * reused by the OS, so it travels with the moment the process started.
 */

const PS_TTL_MS = 30 * 1000;
// The monitor asks about the same pids every second; `ps` answers once per 30 s.
const psCache = new Map();

/** Start time of a pid as an ISO string, `null` when `ps` cannot find it. */
function startedAtOf(pid) {
  const hit = psCache.get(pid);
  if (hit && Date.now() - hit.at < PS_TTL_MS) return hit.startedAt;
  let startedAt = null;
  try {
    // lstart is locale-dependent on macOS; only the C locale parses with Date.parse.
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' },
    }).trim();
    const ms = Date.parse(out);
    if (out && !Number.isNaN(ms)) startedAt = new Date(ms).toISOString();
  } catch { /* dead pid: ps exits non-zero */ }
  psCache.set(pid, { at: Date.now(), startedAt });
  return startedAt;
}

// This process's own stamp never changes, so it is read once.
let ownStamp = null;

function processStamp(pid = process.pid) {
  if (pid !== process.pid) return { pid, startedAt: startedAtOf(pid) };
  if (!ownStamp) ownStamp = { pid, startedAt: startedAtOf(pid) };
  return ownStamp;
}

/** Alive, and — when a start time is given — the same process that stamp was taken from. */
function processAlive(pid, startedAt) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === 'EPERM') return startedAt == null || sameStart(pid, startedAt);
    return false;
  }
  return startedAt == null || sameStart(pid, startedAt);
}

function sameStart(pid, startedAt) {
  const now = startedAtOf(pid);
  if (now == null) return false;
  return Math.abs(Date.parse(now) - Date.parse(startedAt)) <= 5000;
}

/** Signal a whole process group; `false` when the group no longer exists. */
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
}

module.exports = { processStamp, processAlive, killGroup };
