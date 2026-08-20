'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/**
 * Run one task as its own headless agent process.
 *
 * The process boundary is the whole point. A lane that hits a usage limit, a
 * 529, or a context blowout dies alone: its exit code lands here, the CLI marks
 * that one task failed, and every other lane keeps running. Nothing about the
 * run lives in a conversation that can be lost.
 */

const AGENT_BIN = process.env.PLO_AGENT_BIN || 'claude';

/**
 * Build the argv for a task run. Kept pure so tests can assert the command
 * without spawning anything.
 */
function buildArgs({ prompt, sessionId, model, allowedTools, permissionMode, maxTurns, addDirs = [] }) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (sessionId) args.push('--session-id', sessionId);
  if (model) args.push('--model', model);
  if (permissionMode) args.push('--permission-mode', permissionMode);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (allowedTools && allowedTools.length) args.push('--allowed-tools', ...allowedTools);
  for (const d of addDirs) args.push('--add-dir', d);
  return args;
}

/**
 * Parse a stream-json line into an event we care about. Unknown shapes are
 * ignored rather than thrown on — the CLI must not break when the agent's
 * event schema gains a field.
 */
function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj.type === 'result') {
    return {
      kind: 'result',
      isError: Boolean(obj.is_error || obj.subtype === 'error_max_turns' || obj.subtype === 'error_during_execution'),
      subtype: obj.subtype || null,
      result: obj.result || null,
      sessionId: obj.session_id || null,
      usage: obj.usage || null,
      costUsd: obj.total_cost_usd ?? null,
    };
  }
  if (obj.type === 'system' && obj.subtype === 'init') {
    return { kind: 'init', sessionId: obj.session_id || null, model: obj.model || null };
  }
  if (obj.type === 'assistant' || obj.type === 'user') {
    return { kind: 'turn', role: obj.type };
  }
  return null;
}

/**
 * Spawn one agent process and resolve when it exits.
 *
 * Never rejects on agent failure — a failed lane is data, not an exception.
 * It rejects only if the binary itself cannot be launched.
 */
function runAgent({ cwd, prompt, sessionId, model, allowedTools, permissionMode, maxTurns, addDirs, logFile, onEvent, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const args = buildArgs({ prompt, sessionId, model, allowedTools, permissionMode, maxTurns, addDirs });

    let log = null;
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      log = fs.createWriteStream(logFile, { flags: 'a' });
      log.write(`\n=== ${new Date().toISOString()} :: ${AGENT_BIN} ${args.slice(0, 2).join(' ')} … (cwd=${cwd})\n`);
    }

    const child = spawn(AGENT_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], signal });

    const summary = { turns: 0, sessionId: sessionId || null, result: null, isError: false, subtype: null, costUsd: null, outputTokens: null, stderr: '' };
    let buf = '';
    let timer = null;
    let timedOut = false;

    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      if (log) log.write(chunk);
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const ev = parseEvent(line);
        if (!ev) continue;
        if (ev.kind === 'turn') summary.turns += 1;
        if (ev.kind === 'init' && ev.sessionId) summary.sessionId = ev.sessionId;
        if (ev.kind === 'result') {
          summary.result = ev.result;
          summary.isError = ev.isError;
          summary.subtype = ev.subtype;
          summary.costUsd = ev.costUsd;
          // The agent reports the spawn's own total here. Counting it off the
          // log later cannot match it: a task writes tens of megabytes and
          // anything reading that file reads its tail.
          if (ev.usage && typeof ev.usage.output_tokens === 'number') summary.outputTokens = ev.usage.output_tokens;
          if (ev.sessionId) summary.sessionId = ev.sessionId;
        }
        if (onEvent) onEvent(ev);
      }
    });

    child.stderr.on('data', (chunk) => {
      if (log) log.write(chunk);
      summary.stderr += chunk.toString().slice(0, 4000);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (log) log.end();
      if (err.code === 'ENOENT') {
        reject(new Error(`agent binary not found: ${AGENT_BIN}. Set PLO_AGENT_BIN or install it on PATH.`));
        return;
      }
      reject(err);
    });

    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer);
      if (log) log.end();
      resolve({
        ...summary,
        exitCode: code,
        signal: sig,
        timedOut,
        ok: code === 0 && !summary.isError && !timedOut,
      });
    });
  });
}

const newSessionId = () => crypto.randomUUID();

/**
 * Run thunks with a hard concurrency ceiling. Results come back in input order.
 * A thunk that throws resolves to {error} rather than sinking the whole pool —
 * one dead lane must not stop the others.
 */
async function pool(thunks, limit) {
  const results = new Array(thunks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, thunks.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= thunks.length) return;
      try {
        results[i] = await thunks[i]();
      } catch (e) {
        results[i] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { runAgent, buildArgs, parseEvent, pool, newSessionId, AGENT_BIN };
