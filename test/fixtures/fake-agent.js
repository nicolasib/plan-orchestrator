#!/usr/bin/env node
'use strict';

/**
 * A stand-in for the agent CLI, for tests that drive `runLanes` end to end.
 *
 * It reads which task it was handed off the prompt, does what the test's spec
 * says for that attempt, and prints the stream-json a real run ends with. It
 * also writes down what it saw — the prompt and any files the spec names — so
 * a test can assert on the worktree as the agent found it.
 *
 *   PLO_FAKE_SPEC  JSON: { "<task>": step | [step for attempt 1, attempt 2, ...] }
 *                  step: { observe: [path], requires: [path], writes: {path: body}, exit: code }
 *   PLO_FAKE_SEEN  directory for task-<n>-<attempt>.json observations
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
const n = Number((prompt.match(/Implement \*\*Task (\d+)/) || [])[1]);
const cwd = process.cwd();
const seenDir = process.env.PLO_FAKE_SEEN;

const attempt = seenDir && fs.existsSync(seenDir)
  ? fs.readdirSync(seenDir).filter((f) => f.startsWith(`task-${n}-`)).length
  : 0;
const entry = JSON.parse(fs.readFileSync(process.env.PLO_FAKE_SPEC, 'utf8'))[n] || {};
const step = Array.isArray(entry) ? entry[Math.min(attempt, entry.length - 1)] || {} : entry;

const read = (p) => {
  try {
    return fs.readFileSync(path.join(cwd, p), 'utf8');
  } catch {
    return null;
  }
};

if (seenDir) {
  fs.mkdirSync(seenDir, { recursive: true });
  const files = Object.fromEntries((step.observe || []).map((p) => [p, read(p)]));
  fs.writeFileSync(path.join(seenDir, `task-${n}-${attempt + 1}.json`), JSON.stringify({ prompt, cwd, files }, null, 2));
}

const finish = (result) => {
  process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake', model: 'fake' })}\n`);
  process.stdout.write(`${JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result, session_id: 'fake', usage: { output_tokens: 1 },
  })}\n`);
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
  execFileSync('git', ['commit', '-q', '-m', `task ${n}`], { cwd });
}

if (step.exit) process.exit(step.exit);
finish('STATUS: DONE — fake');
