'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wt = require('../src/worktrees');

test('laneBranch derives a stable, lowercase branch name per lane', () => {
  assert.equal(wt.laneBranch('feature/x', 'A'), 'feature/x-lane-a');
  assert.equal(wt.laneBranch('feature/x', 'b'), 'feature/x-lane-b');
});

test('laneWorktreePath defaults outside the repo so no .gitignore is needed', () => {
  const p = wt.laneWorktreePath('/repos/app', 'my-plan', 'A');
  assert.equal(p, path.join('/repos', '.plo-worktrees', 'my-plan-lane-a'));
  assert.ok(!p.startsWith('/repos/app/'), 'lane worktrees must not live inside the repo');
});

test('laneWorktreePath honours an explicit worktree dir', () => {
  assert.equal(wt.laneWorktreePath('/repos/app', 'p', 'C', '/tmp/wt'), path.join('/tmp/wt', 'p-lane-c'));
});

/**
 * Regression: on macOS the temp dir is reached through a symlink (/var ->
 * /private/var), so `git worktree list` reports a resolved path that never
 * string-matches a constructed one. Comparing spellings made an existing lane
 * worktree look absent, and re-preparation — i.e. every resume — then failed
 * with "already exists".
 */
test('samePath compares directory identity, not spelling, through symlinks', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-sp-'));
  const link = `${real}-link`;
  fs.symlinkSync(real, link);
  try {
    assert.equal(wt.samePath(real, link), true, 'a symlink and its target are the same directory');
    assert.equal(wt.samePath(real, path.join(real, '.')), true);
    assert.equal(wt.samePath(real, `${real}-other`), false);
  } finally {
    fs.unlinkSync(link);
    fs.rmSync(real, { recursive: true, force: true });
  }
});

test('samePath falls back to resolution when a path does not exist yet', () => {
  assert.equal(wt.samePath('/nope/a/../a', '/nope/a'), true);
  assert.equal(wt.samePath('/nope/a', '/nope/b'), false);
});

test('SEEDABLE covers the untracked artifacts a fresh worktree needs to run tests', () => {
  assert.ok(wt.SEEDABLE.includes('node_modules'));
  assert.ok(wt.SEEDABLE.includes('.env'));
});
