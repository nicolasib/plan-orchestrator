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
function startedAtOf(pid, { fresh = false } = {}) {
  const hit = psCache.get(pid);
  if (!fresh && hit && Date.now() - hit.at < PS_TTL_MS) return hit.startedAt;
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
  // A stamp is taken right after a spawn, when the pid may have been cached
  // under an earlier owner: it always asks `ps`, and feeds the cache.
  if (pid !== process.pid) return { pid, startedAt: startedAtOf(pid, { fresh: true }) };
  if (!ownStamp) ownStamp = { pid, startedAt: startedAtOf(pid, { fresh: true }) };
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

/**
 * A process group that outlived its leader: no process holds the pid, yet a
 * group with that id still has members — the workers a dead runner left. A
 * pgid cannot be reused as a pid while its group has members, so the group
 * can only be the leader's. `false` for a pid in use, whoever holds it.
 */
function orphanedGroup(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    if (e.code !== 'ESRCH') return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
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

module.exports = { processStamp, processAlive, orphanedGroup, killGroup };
