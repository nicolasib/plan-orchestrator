'use strict';

/**
 * Parse a superpowers-style implementation plan into structured tasks.
 *
 * The plan format this targets (as produced by superpowers:writing-plans):
 *
 *   ### Task 3: POST /v1/requests
 *
 *   **Files:**
 *   - Modify: `src/routes/external/requests.js`
 *   - Test: `tests/external.requests.write.test.js` (novo)
 *
 *   **Interfaces:**
 *   - Consumes: `requestsRepo.create(...)` (Task 2); helpers da Task 1.
 *   - Produces: `makeRequestsRouter({ ... })`
 *
 *   - [ ] **Step 1: ...**
 *
 * Everything the DAG builder needs is already declared in these two blocks.
 * We parse them literally and never guess — inference that isn't grounded in
 * the plan text belongs in the LLM pass, clearly labelled as a soft edge.
 */

const KNOWN_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'json', 'yaml', 'yml', 'toml',
  'md', 'mdx', 'txt',
  'css', 'scss', 'sass', 'less',
  'sql', 'py', 'rb', 'go', 'rs', 'sh', 'bash',
  'html', 'vue', 'svelte',
]);

const TASK_HEADING = /^#{2,4}\s+Task\s+(\d+)\s*[:—-]\s*(.*)$/;
const FILE_VERB = /^-\s*(Modify|Create|Test|Delete|Add|Move|Rename)\s*:/i;
const IFACE_VERB = /^-\s*(Consumes|Produces|Regra [^:]*)\s*:/i;

/**
 * A backticked token counts as a path when its basename carries a known source
 * extension (or it is an explicit directory). This keeps `options.metadata` and
 * `req.externalKey` out of the file set while keeping `shared.js` in — and it
 * rejects a bare route literal like `/`, which a plain "contains a slash" test
 * happily accepts.
 */
function looksLikePath(token) {
  if (!token || /\s/.test(token) || !/[A-Za-z0-9]/.test(token)) return false;
  if (token.endsWith('/')) return token.length > 1; // explicit directory
  const base = token.slice(token.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return KNOWN_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/**
 * Plans routinely name a file in order to forbid touching it:
 *   - Test: `tests/foo.write.test.js` (novo — não mexer no `tests/foo.test.js`)
 * Taking that second path as a write invents conflicts and, worse, attaches
 * false evidence to real ones. Anything after a negation marker is excluded.
 * pt-BR and English, since plans here are written in both.
 */
const NEGATION = /\b(n[ãa]o\s+(?:mexer|alterar|tocar|modificar|editar)|sem\s+mexer|do\s+not\s+(?:touch|modify|edit)|don'?t\s+(?:touch|modify|edit)|leave\s+(?:alone|unchanged)|unchanged|untouched)\b/i;

function splitOnNegation(line) {
  const m = line.match(NEGATION);
  if (!m) return { kept: line, excluded: '' };
  return { kept: line.slice(0, m.index), excluded: line.slice(m.index) };
}

function backtickedPaths(text) {
  const out = [];
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const token = m[1].trim();
    if (looksLikePath(token)) out.push(token);
  }
  return out;
}

/**
 * Every backticked path on a line, in order. One `Files:` line can legitimately
 * name two (e.g. a new test file plus an existing one gaining a case).
 * Returns both the writes and the paths a negation excluded, so the analyzer
 * can show its work when a human reviews the DAG.
 */
function extractPaths(line) {
  const { kept, excluded } = splitOnNegation(line);
  return { paths: backtickedPaths(kept), excluded: backtickedPaths(excluded) };
}

/**
 * Literal cross-references: "Task 2", "Tasks 3-7", "Tasks 3, 4 e 5".
 * Ranges are expanded. Returns a sorted unique list of task numbers.
 */
function extractTaskRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(/\bTasks?\s+(\d+)\s*(?:[-–—]\s*(\d+))?/gi)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : null;
    if (to !== null && to >= from && to - from < 100) {
      for (let i = from; i <= to; i += 1) refs.add(i);
    } else {
      refs.add(from);
      // "Tasks 3, 4 e 5" — pick up the trailing comma/conjunction list.
      const tail = text.slice(m.index + m[0].length);
      const listMatch = tail.match(/^(\s*(?:,|\se\s|\sand\s|\s&\s)\s*\d+)+/);
      if (listMatch) {
        for (const n of listMatch[0].matchAll(/\d+/g)) refs.add(Number(n[0]));
      }
    }
  }
  return [...refs].sort((a, b) => a - b);
}

/** Pull the Global Constraints section — worktree path, branch, test command. */
function parseGlobalConstraints(lines) {
  const start = lines.findIndex((l) => /^#{2,3}\s+Global Constraints/i.test(l));
  if (start === -1) return { raw: '', testCommand: null, branch: null, base: null };

  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{2,4}\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const raw = body.join('\n');

  const testCommand =
    (raw.match(/`(npm test|pnpm test|yarn test|npm run test[^`]*)`/) || [])[1] || null;
  const branch = (raw.match(/branch\s+`([^`]+)`/i) || [])[1] || null;
  const base =
    (raw.match(/base\s+`([^`]+)`/i) || [])[1] ||
    (raw.match(/--base\s+(\S+)/) || [])[1] ||
    null;

  return { raw, testCommand, branch, base };
}

/**
 * @param {string} markdown raw plan file contents
 * @returns {{tasks: Array, constraints: object, title: string}}
 */
function parsePlan(markdown) {
  const lines = markdown.split('\n');
  const title = (lines.find((l) => /^#\s+/.test(l)) || '# Untitled').replace(/^#\s+/, '').trim();

  // Locate task headings first so each task's body is a clean slice.
  const heads = [];
  lines.forEach((line, idx) => {
    const m = line.match(TASK_HEADING);
    if (m) heads.push({ n: Number(m[1]), title: m[2].trim(), line: idx });
  });

  const tasks = heads.map((head, i) => {
    const from = head.line;
    const to = i + 1 < heads.length ? heads[i + 1].line : lines.length;
    const body = lines.slice(from, to);

    const files = { modify: [], create: [], test: [], delete: [] };
    const excludedPaths = [];
    const interfaces = { consumes: '', produces: '', other: '' };
    const steps = [];

    let block = null; // 'files' | 'interfaces'
    let ifaceKey = null;

    for (const line of body) {
      if (/^\*\*Files:\*\*/i.test(line)) { block = 'files'; ifaceKey = null; continue; }
      if (/^\*\*Interfaces:\*\*/i.test(line)) { block = 'interfaces'; ifaceKey = null; continue; }
      if (/^\*\*[A-Z]/.test(line) && !/^\*\*Step/i.test(line)) { block = null; ifaceKey = null; }

      const stepMatch = line.match(/^-\s*\[( |x|X)\]\s*(.*)$/);
      if (stepMatch) {
        steps.push({ checked: stepMatch[1].toLowerCase() === 'x', text: stepMatch[2].trim() });
        block = null;
        ifaceKey = null;
        continue;
      }

      if (block === 'files') {
        const verb = line.match(FILE_VERB);
        if (!verb) continue;
        const kind = verb[1].toLowerCase();
        const bucket =
          kind === 'delete' ? 'delete'
            : kind === 'test' ? 'test'
              : kind === 'modify' ? 'modify'
                : 'create';
        const { paths, excluded } = extractPaths(line);
        for (const p of paths) {
          if (!files[bucket].includes(p)) files[bucket].push(p);
        }
        for (const p of excluded) {
          if (!excludedPaths.includes(p)) excludedPaths.push(p);
        }
        continue;
      }

      if (block === 'interfaces') {
        const verb = line.match(IFACE_VERB);
        if (verb) {
          const k = verb[1].toLowerCase();
          ifaceKey = k.startsWith('consumes') ? 'consumes' : k.startsWith('produces') ? 'produces' : 'other';
          interfaces[ifaceKey] += `${line}\n`;
        } else if (ifaceKey && line.trim()) {
          interfaces[ifaceKey] += `${line}\n`;
        }
      }
    }

    // Every declared path is a write. Tests included — two tasks appending to
    // the same test file conflict exactly as two tasks editing the same source.
    const writes = [...new Set([...files.modify, ...files.create, ...files.test, ...files.delete])];

    return {
      n: head.n,
      title: head.title,
      lineStart: from + 1,
      lineEnd: to,
      weight: to - from,
      files,
      writes,
      excludedPaths,
      interfaces,
      // Direction matters: a ref inside Consumes points backward (they precede
      // me); a ref inside Produces points forward (they depend on me).
      consumesTasks: extractTaskRefs(interfaces.consumes).filter((r) => r !== head.n),
      producesForTasks: extractTaskRefs(interfaces.produces).filter((r) => r !== head.n),
      steps,
      done: steps.length > 0 && steps.every((s) => s.checked),
    };
  });

  return { title, constraints: parseGlobalConstraints(lines), tasks };
}

module.exports = { parsePlan, extractPaths, extractTaskRefs, looksLikePath };
