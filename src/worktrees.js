'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * One git worktree per lane, branched off the feature base.
 *
 * Why worktrees at all: superpowers:subagent-driven-development forbids running
 * two implementers in parallel, and it is right to — inside one checkout they
 * collide on the index and on each other's files. Giving every lane its own
 * checkout removes the hazard the rule exists to prevent, which is the only
 * reason parallel lanes are safe.
 *
 * Dependencies are COPIED, never symlinked. A symlinked node_modules is shared
 * mutable state between lanes: one lane's install rewrites another lane's tree
 * mid-test. On APFS the copy is a clonefile (`cp -Rc`) — copy-on-write, so it
 * costs almost nothing in time or disk despite being a real, isolated copy.
 */

const git = (cwd, args, opts = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : ['pipe', 'pipe', 'pipe'] }).trim();

const SEEDABLE = ['node_modules', '.env', '.env.local', '.env.development', '.env.test', '.venv', 'vendor'];

function repoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

function currentBranch(cwd) {
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function headCommit(cwd, ref = 'HEAD') {
  return git(cwd, ['rev-parse', ref]);
}

const laneBranch = (base, laneId) => `${base}-lane-${laneId.toLowerCase()}`;

function laneWorktreePath(root, planSlug, laneId, worktreeDir) {
  const dir = worktreeDir || path.join(path.dirname(root), '.plo-worktrees');
  return path.join(dir, `${planSlug}-lane-${laneId.toLowerCase()}`);
}

/**
 * Compare two paths by identity, not by spelling.
 *
 * `git worktree list` reports fully resolved paths. On macOS the system temp
 * dir (and plenty of real checkouts) sit behind a symlink — `/var` -> `/private/var` —
 * so a constructed path and git's report describe the same directory with
 * different strings. Comparing the strings makes an existing lane worktree look
 * absent, and re-preparation then dies on `already exists`. That is the resume
 * path, so it has to be right.
 */
function samePath(a, b) {
  const norm = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return norm(a) === norm(b);
}

function listWorktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push(cur);
      cur = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
    }
  }
  if (cur.path) entries.push(cur);
  return entries;
}

/**
 * Copy a dependency directory using a copy-on-write clone where the filesystem
 * supports it. Falls back to a plain recursive copy.
 */
function cloneCopy(src, dest) {
  try {
    execFileSync('cp', ['-Rc', src, dest], { stdio: 'pipe' });
    return 'clone';
  } catch {
    execFileSync('cp', ['-R', src, dest], { stdio: 'pipe' });
    return 'copy';
  }
}

/**
 * Seed a fresh worktree with the untracked artifacts a test run needs.
 * Returns a report so the caller can tell the human what was copied.
 */
function seedWorktree(root, dest, extra = []) {
  const seeded = [];
  for (const name of [...SEEDABLE, ...extra]) {
    const src = path.join(root, name);
    const dst = path.join(dest, name);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    const mode = cloneCopy(src, dst);
    seeded.push({ name, mode });
  }
  return seeded;
}

/**
 * Create (or adopt) the worktree for one lane.
 * Idempotent: re-running against an existing lane worktree adopts it, which is
 * what `plo resume` needs after a crash.
 */
function ensureLaneWorktree({ root, planSlug, laneId, baseCommit, baseBranch, worktreeDir, extraSeed }) {
  const branch = laneBranch(baseBranch, laneId);
  const dest = laneWorktreePath(root, planSlug, laneId, worktreeDir);

  const existing = listWorktrees(root).find((w) => samePath(w.path, dest));
  if (existing) {
    return { branch: existing.branch || branch, path: dest, created: false, seeded: [] };
  }

  // A directory git does not know about is a leftover from an interrupted
  // teardown. Say so plainly rather than letting `git worktree add` fail with
  // a message that gives no instruction.
  if (fs.existsSync(dest)) {
    throw new Error(
      `${dest} exists but is not a registered worktree of ${root}. `
      + 'It is likely left over from an interrupted run. Remove it (or pass --worktree-dir) and retry.',
    );
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const branchExists = (() => {
    try {
      git(root, ['rev-parse', '--verify', `refs/heads/${branch}`], { quiet: true });
      return true;
    } catch {
      return false;
    }
  })();

  // Adopt an existing lane branch rather than clobbering commits a dead run made.
  const args = branchExists
    ? ['worktree', 'add', dest, branch]
    : ['worktree', 'add', '-b', branch, dest, baseCommit];
  git(root, args);

  const seeded = seedWorktree(root, dest, extraSeed);
  return { branch, path: dest, created: true, seeded, adoptedBranch: branchExists };
}

function removeLaneWorktree({ root, dest, branch, deleteBranch = false }) {
  try {
    git(root, ['worktree', 'remove', '--force', dest]);
  } catch (e) {
    if (!/is not a working tree|No such file/.test(String(e.stderr || e.message))) throw e;
  }
  if (deleteBranch && branch) {
    try {
      git(root, ['branch', '-D', branch]);
    } catch { /* branch already gone or checked out elsewhere */ }
  }
}

/** Commits a lane branch has that the base does not — the lane's actual output. */
function laneCommits(root, baseCommit, branch) {
  try {
    const out = git(root, ['log', '--format=%H %s', `${baseCommit}..${branch}`]);
    if (!out) return [];
    return out.split('\n').map((l) => {
      const sp = l.indexOf(' ');
      return { sha: l.slice(0, sp), subject: l.slice(sp + 1) };
    });
  } catch {
    return [];
  }
}

function isDirty(cwd) {
  return git(cwd, ['status', '--porcelain']).length > 0;
}

module.exports = {
  git, repoRoot, currentBranch, headCommit, laneBranch, laneWorktreePath,
  listWorktrees, ensureLaneWorktree, removeLaneWorktree, seedWorktree,
  laneCommits, isDirty, samePath, SEEDABLE,
};
