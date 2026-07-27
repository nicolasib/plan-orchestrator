'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePlan, looksLikePath, extractPaths, extractTaskRefs } = require('../src/parse-plan');

test('looksLikePath: accepts sources, rejects symbols and route literals', () => {
  assert.equal(looksLikePath('src/routes/external/requests.js'), true);
  assert.equal(looksLikePath('shared.js'), true);
  assert.equal(looksLikePath('docs/openapi/v1.yaml'), true);
  assert.equal(looksLikePath('src/lib/'), true, 'explicit directory');

  // These all appear backticked inside real Files:/Interfaces: lines.
  assert.equal(looksLikePath('/'), false, 'route literal, not a path');
  assert.equal(looksLikePath('options.metadata'), false);
  assert.equal(looksLikePath('req.externalKey'), false);
  assert.equal(looksLikePath('createBatch'), false);
  assert.equal(looksLikePath(''), false);
});

test('extractPaths: one line can declare two real writes', () => {
  const line = '- Test: `tests/requestsRepo.searchScope.test.js` (novo) + 1 caso em `tests/external.requests.test.js`';
  const { paths, excluded } = extractPaths(line);
  assert.deepEqual(paths, ['tests/requestsRepo.searchScope.test.js', 'tests/external.requests.test.js']);
  assert.deepEqual(excluded, []);
});

test('extractPaths: a negated path is excluded, not counted as a write', () => {
  const line = '- Test: `tests/external.requests.write.test.js` (novo — não mexer no `tests/external.requests.test.js`)';
  const { paths, excluded } = extractPaths(line);
  assert.deepEqual(paths, ['tests/external.requests.write.test.js']);
  assert.deepEqual(excluded, ['tests/external.requests.test.js'],
    'a "do not touch" mention must never become a write — it fabricates conflicts');
});

test('extractPaths: English negation forms', () => {
  const { paths, excluded } = extractPaths('- Modify: `src/a.js` (do not touch `src/b.js`)');
  assert.deepEqual(paths, ['src/a.js']);
  assert.deepEqual(excluded, ['src/b.js']);
});

test('extractTaskRefs: singles, ranges and lists', () => {
  assert.deepEqual(extractTaskRefs('usados nas Tasks 3-7.'), [3, 4, 5, 6, 7]);
  assert.deepEqual(extractTaskRefs('helpers da Task 1'), [1]);
  assert.deepEqual(extractTaskRefs('(Task 2)'), [2]);
  assert.deepEqual(extractTaskRefs('Tasks 3, 4 e 5'), [3, 4, 5]);
  assert.deepEqual(extractTaskRefs('no task references here'), []);
});

const FIXTURE = `# Sample Plan

## Global Constraints

- Worktree: \`/tmp/wt\`, branch \`feature/x\` (base \`origin/staging\`).
- Testes: \`npm test\` (\`node --test\`), da raiz do worktree.

---

### Task 1: Helpers

**Files:**
- Modify: \`src/shared.js\`
- Test: \`tests/shared.test.js\` (novo)

**Interfaces:**
- Produces: \`helper()\` exportado de \`shared.js\` e usados nas Tasks 2-3.

- [x] **Step 1: Teste que falha**
- [x] **Step 2: Implementar**

---

### Task 2: Route A

**Files:**
- Modify: \`src/a.js\`
- Test: \`tests/a.test.js\` (novo)

**Interfaces:**
- Consumes: helpers da Task 1.

- [ ] **Step 1: Teste que falha**

---

### Task 3: Route B

**Files:**
- Modify: \`src/b.js\`

- [ ] **Step 1: Implementar**
`;

test('parsePlan: extracts tasks, constraints, files and direction of refs', () => {
  const plan = parsePlan(FIXTURE);

  assert.equal(plan.title, 'Sample Plan');
  assert.equal(plan.constraints.testCommand, 'npm test');
  assert.equal(plan.constraints.branch, 'feature/x');
  assert.equal(plan.constraints.base, 'origin/staging');
  assert.equal(plan.tasks.length, 3);

  const [t1, t2, t3] = plan.tasks;

  assert.equal(t1.n, 1);
  assert.deepEqual(t1.writes, ['src/shared.js', 'tests/shared.test.js']);
  assert.deepEqual(t1.producesForTasks, [2, 3], 'Produces: "usados nas Tasks 2-3" points forward');
  assert.deepEqual(t1.consumesTasks, []);
  assert.equal(t1.done, true, 'all steps checked');

  assert.deepEqual(t2.consumesTasks, [1], 'Consumes: "Task 1" points backward');
  assert.equal(t2.done, false);

  assert.deepEqual(t3.writes, ['src/b.js']);
  assert.equal(t3.done, false);
});

test('parsePlan: a task never depends on itself', () => {
  const plan = parsePlan('### Task 4: Self\n\n**Interfaces:**\n- Consumes: see Task 4 above.\n');
  assert.deepEqual(plan.tasks[0].consumesTasks, []);
});

test('parsePlan: tolerates a plan with no Global Constraints section', () => {
  const plan = parsePlan('# Bare\n\n### Task 1: Only\n\n**Files:**\n- Create: `src/x.js`\n');
  assert.equal(plan.constraints.testCommand, null);
  assert.equal(plan.tasks.length, 1);
  assert.deepEqual(plan.tasks[0].writes, ['src/x.js']);
});
