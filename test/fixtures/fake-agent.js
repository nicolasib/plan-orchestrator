#!/usr/bin/env node
'use strict';

/**
 * A stand-in for the agent CLI, for tests that drive `runLanes` end to end.
 *
 * It reads which task it was handed off the prompt, does what the test's spec
 * says for that attempt, and prints the stream-json a real run ends with. It
 * also writes down what it saw — the prompt, its argv and any files the spec
 * names — so a test can assert on the worktree as the agent found it.
 *
 *   PLO_FAKE_SPEC  JSON: { "<task>" | "review": step | [step for attempt 1, attempt 2, ...] }
 *                  step: { observe: [path], requires: [path], writes: {path: body}, exit: code,
 *                          sleepMs: ms, events: [object],
 *                          result: { is_error, subtype, text, total_cost_usd, output_tokens } }
 *   PLO_FAKE_SEEN  directory for task-<n>-<attempt>.json (review-<attempt>.json) observations
 *
 * A prompt that names no task (`Implement **Task N`) is the cross-lane review,
 * and answers to the spec's `review` key.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
const named = prompt.match(/Implement \*\*Task (\d+)/);
const n = named ? Number(named[1]) : null;
const key = named ? n : 'review';
const prefix = named ? `task-${n}-` : 'review-';
const cwd = process.cwd();
const seenDir = process.env.PLO_FAKE_SEEN;

const attempt = seenDir && fs.existsSync(seenDir)
  ? fs.readdirSync(seenDir).filter((f) => f.startsWith(prefix)).length
  : 0;
const entry = JSON.parse(fs.readFileSync(process.env.PLO_FAKE_SPEC, 'utf8'))[key] || {};
const step = Array.isArray(entry) ? entry[Math.min(attempt, entry.length - 1)] || {} : entry;

// Absolute paths are read as they are; relative ones against the worktree.
const read = (p) => {
  try {
    return fs.readFileSync(path.resolve(cwd, p), 'utf8');
  } catch {
    return null;
  }
};

if (seenDir) {
  fs.mkdirSync(seenDir, { recursive: true });
  const files = Object.fromEntries((step.observe || []).map((p) => [p, read(p)]));
  fs.writeFileSync(path.join(seenDir, `${prefix}${attempt + 1}.json`), JSON.stringify({ prompt, cwd, argv, files }, null, 2));
}

if (step.sleepMs) {
  // A blocking wait installs no signal handler, so the SIGTERM an aborted
  // spawn sends ends the process mid-sleep, the way it ends a real agent.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, step.sleepMs);
}

const finish = (text) => {
  const over = step.result || {};
  const result = {
    type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'fake', usage: { output_tokens: 1 },
  };
  for (const k of ['is_error', 'subtype', 'total_cost_usd']) if (over[k] !== undefined) result[k] = over[k];
  if (over.output_tokens !== undefined) result.usage.output_tokens = over.output_tokens;

  process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake', model: 'fake' })}\n`);
  for (const ev of step.events || []) process.stdout.write(`${JSON.stringify(ev)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const missing = (step.requires || []).filter((p) => read(p) === null);
if (missing.length) {
  finish(`STATUS: BLOCKED — ${missing.join(', ')} is not in this worktree`);
  process.exit(0);
}

const writes = Object.entries(step.writes || {});
for (const [p, body] of writes) {
  fs.mkdirSync(path.dirname(path.join(cwd, p)), { recursive: true });
  fs.writeFileSync(path.join(cwd, p), body);
}
if (writes.length) {
  // `add -A`, the way a careless agent stages: whatever the worktree shows
  // as changed goes into the commit.
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync('git', ['commit', '-q', '-m', named ? `task ${n}` : 'review'], { cwd });
}

if (step.exit) process.exit(step.exit);
finish(step.result && step.result.text !== undefined ? step.result.text : 'STATUS: DONE — fake');
