'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildArgs, parseEvent, pool } = require('../src/spawn');

test('buildArgs produces a headless, streaming, session-pinned invocation', () => {
  const args = buildArgs({
    prompt: 'do the thing', sessionId: 'abc-123', model: 'sonnet',
    permissionMode: 'acceptEdits', maxTurns: 40, addDirs: ['/extra'],
  });
  assert.deepEqual(args, [
    '-p', 'do the thing',
    '--output-format', 'stream-json', '--verbose',
    '--session-id', 'abc-123',
    '--model', 'sonnet',
    '--permission-mode', 'acceptEdits',
    '--max-turns', '40',
    '--add-dir', '/extra',
  ]);
});

test('buildArgs omits every optional flag when unset', () => {
  assert.deepEqual(buildArgs({ prompt: 'x' }), ['-p', 'x', '--output-format', 'stream-json', '--verbose']);
});

test('parseEvent reads a successful result', () => {
  const ev = parseEvent(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: 'STATUS: DONE — abc123', session_id: 's1', total_cost_usd: 0.42,
  }));
  assert.equal(ev.kind, 'result');
  assert.equal(ev.isError, false);
  assert.equal(ev.sessionId, 's1');
  assert.equal(ev.costUsd, 0.42);
});

test('parseEvent treats a turn cap as an error, not a success', () => {
  const ev = parseEvent(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false }));
  assert.equal(ev.isError, true, 'hitting the turn cap means the task did not finish');
});

test('parseEvent counts assistant and user turns', () => {
  assert.equal(parseEvent(JSON.stringify({ type: 'assistant' })).kind, 'turn');
  assert.equal(parseEvent(JSON.stringify({ type: 'user' })).kind, 'turn');
});

test('parseEvent ignores malformed lines and unknown shapes rather than throwing', () => {
  assert.equal(parseEvent('not json at all'), null);
  assert.equal(parseEvent(''), null);
  assert.equal(parseEvent('   '), null);
  assert.equal(parseEvent(JSON.stringify({ type: 'something_new_in_a_future_version' })), null);
});

test('pool respects the concurrency ceiling', async () => {
  let active = 0;
  let peak = 0;
  const mk = () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1;
    return 'ok';
  };
  const res = await pool(Array.from({ length: 9 }, mk), 3);
  assert.equal(res.length, 9);
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded the ceiling of 3`);
});

test('pool: one failing thunk never sinks the others', async () => {
  const thunks = [
    async () => 'a',
    async () => { throw new Error('lane died'); },
    async () => 'c',
  ];
  const res = await pool(thunks, 3);
  assert.equal(res[0], 'a');
  assert.equal(res[1].error, 'lane died');
  assert.equal(res[2], 'c');
});

test('pool returns results in input order regardless of completion order', async () => {
  const thunks = [
    async () => { await new Promise((r) => setTimeout(r, 30)); return 'slow'; },
    async () => 'fast',
  ];
  assert.deepEqual(await pool(thunks, 2), ['slow', 'fast']);
});
