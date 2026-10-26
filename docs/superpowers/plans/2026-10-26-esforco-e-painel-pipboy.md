# Esforço por task e painel do operador — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use parallel-plan-execution (recommended — `plo`: one headless process per task, fresh context, checkpointed to disk), superpowers:subagent-driven-development, or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada task roda com o esforço que o plano marcou para ela; o fim do run (merge, barreiras, suíte, revisão) aparece rodando, com a saída da suíte ao vivo; e o `plo serve` ganha o painel do operador, em fósforo verde.

**Architecture:** As Tasks 1–9 mexem nos dados: o parser e o portão do `**Effort:**`, o caminho até o argv, o registro de cada tentativa (pid, custo somado, tentativas), o `integrate` gravando o começo de cada etapa, a suíte por `spawn` num log, e o `monitor` montando o snapshot do contrato (A §6.5 + B §9.1). A Task 10 traz os ativos (o sprite do operador e a rota `/assets/`), e a 11 monta o gerador de fixture e o bootstrap do smoke gate. As Tasks 12–18 reescrevem `src/ui.html` aba por aba, sobre o esqueleto da Task 12.

**Tech Stack:** Node ≥ 20, CommonJS, zero dependências, `node --test`; uma página HTML única com JS inline; smoke gate no Aside Browser.

**Spec:** `docs/superpowers/specs/2026-10-26-esforco-por-task-e-fim-do-run-design.md` (documento A) e `docs/superpowers/specs/2026-10-26-painel-operador-design.md` (documento B). O protótipo aprovado está em `docs/superpowers/specs/2026-10-26-painel-operador/prototipo.html`, e onde ele e o B diferem, vale o B. As citações `arquivo:linha` deste plano são de `3972d43`.

## Global Constraints

- Tests: `npm test`.
- Zero dependências e sem build: nada entra no `package.json`, e a página continua um arquivo só (`src/ui.html`), com JS inline (A §4, B §4).
- Inglês no código, nos comentários, no CLI e na página (B §6). Mensagens de commit em português, no formato `tipo(escopo): …`.
- Níveis de esforço: exatamente `low`, `medium`, `high`, `xhigh`, `max`. A nova tentativa sobe `low → medium → high → xhigh` e para em `xhigh`; `max` continua `max`. Task sem `**Effort:**` não leva `--effort` no argv (A §4, §5.6).
- O `monitor` e o `plo serve` só leem. A página não faz requisição fora da própria origem (B §3, meta 4).
- Limiares: NO SIGNAL com 6 min sem evento e alerta com 15 min (B §8.1); QUIET com 30 s sem snapshot (B §6.1); `5H LIMIT` em âmbar a partir de 80% (B §6.1).
- Cores só pelos tokens em `:root` do `src/ui.html`: `--g #39ff7e`, `--gd rgba(57,255,126,.5)`, `--gf rgba(57,255,126,.12)`, `--ink #06140b`, `--al #ffb13d`, `--fig #43ff86`, `--ln #052812` (protótipo, linhas 13–14). Só tema escuro.
- `data-testid` na página: `tab-<TAB>`, `sub-<SUB>`, `view-title`, `agent-<id>`, `hero-name`, `row-T<n>`, `quest-T<n>`, `node-<id>`, `station-<id>`, `copy-<what>`, `foot-<what>`. Toda vista tem um `[data-testid=view-title]` com o nome da sub-aba.
- A página antiga, para copiar funções: `git show 3972d43:src/ui.html`.
- Shell: um comando por chamada, sem `&&`, `;`, heredoc ou `| head`, porque o sandbox das lanes recusa. O commit vai em dois comandos: `git add <arquivos>` e `git commit -m "<assunto>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- Os specs do smoke ficam em `smoke/task-<N>.js`, versionados. Só `smoke/.artifacts/` fica fora do git.

## Review Focus

1. **Estado gravado por um `plo` anterior**, sem `pid`, `stages`, `effort`, `tries`, `edges` nem `usage5h`: o snapshot e a página abrem sem erro, e nenhuma task sem `pid` vira `interrupted`. Os testes estão na Task 7 (`a running task with no pid…`) e no cenário `idle` da Task 11, conferido pela Task 12 (S12-7).
2. **Saída da suíte com cor ANSI, `\r` de barra de progresso e comando de teste que não existe**: o snapshot recebe linhas limpas, e a etapa falha com o código 127 em vez de derrubar o `integrate`. Os testes estão nas Tasks 6 e 8 e em S17-5.
3. **`**Effort:**` com caixa, espaços e crases diferentes, e sem motivo** (`**Effort:**  HIGH`, `` **Effort:** `xhigh` ``): o parser lê o nível, e o motivo fica `null`. O teste está na Task 1.
4. **HTML no texto do agente** (erro, atividade, relatório): aparece como texto e nunca executa. O fixture está na Task 11, e a asserção, em S14-5.
5. **Stream que cai e volta com um agente selecionado**: a seleção e o hash ficam, nada se mexe durante a queda, e tudo volta a andar depois. As asserções são S12-10 e S13-14.

---

### Task 1: `**Effort:**` no parser, no portão e na recusa

**Effort:** high — parser, render e CLI, com a regra de recusa em três comandos

**Files:**
- Modify: `src/parse-plan.js:140-234`
- Modify: `src/render.js:20-70`
- Modify: `bin/plo.js:42-52`
- Modify: `bin/plo.js:89-234`
- Test: `test/parse-plan.test.js`
- Create: `test/effort-cli.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `parsePlan(md).tasks[i].effort`, que é `{ level: string, reason: string|null, line: number, valid: boolean }` ou `null`. `EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']` e `effortErrors(plan) → [{ n, line, value }]`, exportados de `src/parse-plan.js`. `loadPlan(planPath, { strictEffort })` em `bin/plo.js`.

- [ ] **Step 1: Write the failing parser tests** em `test/parse-plan.test.js`

```js
const EFFORT_PLAN = `# Effort plan

### Task 1: Alpha

**Effort:** medium — troca mecânica

**Files:**
- Create: \`src/a.js\`

- [ ] step

### Task 2: Beta

**Effort:**  HIGH

- [ ] step

### Task 3: Gamma

- [ ] step

### Task 4: Delta

**Effort:** altissimo — demais

- [ ] step

### Task 5: Epsilon

**Effort:** \`xhigh\`

- [ ] step
`;
const lineOf = (s) => EFFORT_PLAN.split('\n').findIndex((l) => l.includes(s)) + 1;

test('parsePlan: reads the Effort line, level lowercased, reason optional', () => {
  const t = parsePlan(EFFORT_PLAN).tasks;
  assert.deepEqual(t[0].effort, { level: 'medium', reason: 'troca mecânica', line: lineOf('troca mecânica'), valid: true });
  assert.deepEqual(t[1].effort, { level: 'high', reason: null, line: lineOf('HIGH'), valid: true });
  assert.equal(t[2].effort, null);
  assert.equal(t[4].effort.level, 'xhigh');
});

test('parsePlan: the Effort line leaves Files and steps as they were', () => {
  const t = parsePlan(EFFORT_PLAN).tasks[0];
  assert.deepEqual(t.writes, ['src/a.js']);
  assert.equal(t.steps.length, 1);
});

test('parsePlan: an unknown level is kept raw and flagged, never dropped', () => {
  const plan = parsePlan(EFFORT_PLAN);
  assert.equal(plan.tasks[3].effort.valid, false);
  assert.deepEqual(effortErrors(plan), [{ n: 4, line: lineOf('altissimo'), value: 'altissimo' }]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/parse-plan.test.js`
Expected: FAIL — `effortErrors is not a function`, and `effort` is `undefined`.

- [ ] **Step 3: Implement the Effort line in `parsePlan`**

O laço do corpo da task (`src/parse-plan.js:164-206`) passa a saber o índice da linha, porque `line` é a linha 1-based no arquivo (`from + i + 1`). Antes do teste que fecha blocos (`/^\*\*[A-Z]/`), aplique `EFFORT_LINE = /^\*\*Effort:\*\*\s*(\S+)(?:\s+[—–-]\s*(.*?))?\s*$/i`. O nível sai sem crases e em minúsculas; motivo vazio vira `null`. A linha fecha o bloco aberto e segue para a próxima (`continue`). O objeto da task (`src/parse-plan.js:212-228`) ganha `effort`, que fica `null` sem a linha. Exporte `EFFORT_LEVELS` e `effortErrors`.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/parse-plan.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing CLI tests** em `test/effort-cli.test.js`

Os testes rodam `spawnSync(process.execPath, [PLO, …], { encoding: 'utf8' })` sobre um plano gravado num tmpdir. `GATE_PLAN` tem as tasks 1 (`medium — troca mecânica`, cria `src/a.js`), 2 (`**Effort:** high`, cria `src/b.js`) e 3 (sem linha, cria `src/c.js`), e a Task 4 "Wrap", com `**Effort:** medium` e `- Consumes: Tasks 1-3`, que vira barreira. `EFFORT_PLAN` é o do Step 1.

```js
test('analyze prints each task with its level, inherited when unmarked, and a count', () => {
  const r = analyze(GATE_PLAN);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T1 {2}Alpha {2}\[medium\] {2}troca mecânica/);
  assert.match(r.stdout, /T3 {2}Gamma {2}\[inherited\]/);
  assert.match(r.stdout, /BARRIERS[\s\S]*T4 {2}Wrap {2}\[medium\]/);
  assert.match(r.stdout, /Effort: 2 medium · 1 high · 1 inherited/);
});

test('analyze lists an invalid level and exits 3', () => {
  const r = analyze(EFFORT_PLAN);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /EFFORT ERRORS/);
  assert.ok(r.stdout.includes(`T4 (line ${lineOf('altissimo')}): "altissimo" — use one of low, medium, high, xhigh, max`));
});

test('init refuses a plan with an invalid level, and writes no state', () => {
  const { dir, planPath } = writePlan(EFFORT_PLAN);
  const r = plo(['init', '--plan', planPath]);
  assert.equal(r.status, 3);
  assert.ok(r.stderr.includes(`invalid **Effort:** in T4 (line ${lineOf('altissimo')}): "altissimo"`));
  assert.equal(fs.existsSync(path.join(dir, '.plan-state-plan.json')), false);
});

test('run and resume refuse an invalid level written after init', () => {
  const { planPath } = writePlan(GATE_PLAN);
  state.save(planPath, state.create({ planPath, planContents: GATE_PLAN, repoRoot: path.dirname(planPath), baseBranch: 'x', baseCommit: 'abc1234', maxLanes: 1, lanes: [{ id: 'A', tasks: [1, 2, 3], weight: 1 }], barriers: [4] }));
  fs.writeFileSync(planPath, GATE_PLAN.replace('**Effort:** high', '**Effort:** altissimo'));
  for (const cmd of ['run', 'resume']) {
    const r = plo([cmd, '--plan', planPath]);
    assert.equal(r.status, 3, cmd);
    assert.match(r.stderr, /invalid \*\*Effort:\*\* in T2/);
  }
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `node --test test/effort-cli.test.js`
Expected: FAIL — the gate prints no level, and init exits 0.

- [ ] **Step 7: Implement the gate and the refusal**

`render.dag` (`src/render.js:49-67`) escreve as linhas de lane e de BARRIERS como `    ${mark} T${n}  ${title}  [${level ?? 'inherited'}]` mais `  ${motivo}`, cortado em 60 caracteres com `…`. Depois de BARRIERS vem a linha `Effort: …`, que conta as tasks das lanes e das barreiras na ordem de `EFFORT_LEVELS`, com `inherited` por último, só os níveis que aparecem, separados por ` · `. Com erro, vem a seção `rule('EFFORT ERRORS')`, uma linha por erro: `  T4 (line 26): "altissimo" — use one of low, medium, high, xhigh, max`. O `cmdAnalyze` imprime como hoje e devolve `EXIT.ANALYSIS` quando há erro; o `--json` ganha `effortErrors`. O `loadPlan(planPath, { strictEffort = false } = {})` chama `fail(…, EXIT.ANALYSIS)` com uma linha por erro: `invalid **Effort:** in T${n} (line ${line}): "${value}" — use one of low, medium, high, xhigh, max`. O `cmdInit`, o `cmdRun` (que serve o `resume`) e o `cmdIntegrate` passam `strictEffort: true`. O `integrate` entra na lista porque a barreira obedece à própria linha (A §5.7).

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/parse-plan.js src/render.js bin/plo.js test/parse-plan.test.js test/effort-cli.test.js
git commit -m "feat(plano): linha **Effort:** no parser, no portão do analyze e na recusa do init/run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 2: O esforço chega ao processo, e a nova tentativa sobe

**Effort:** xhigh — regra de subida com quatro exceções em dois caminhos de execução, mais o agente falso que as tasks seguintes usam

**Files:**
- Create: `src/effort.js`
- Modify: `src/spawn.js:23-32`
- Modify: `src/spawn.js:74-76`
- Modify: `src/run.js:203-324`
- Modify: `src/integrate.js:95-165`
- Modify: `src/state.js:178-224`
- Modify: `test/fixtures/fake-agent.js`
- Create: `test/helpers/run-repo.js`
- Test: `test/spawn.test.js`
- Test: `test/state.test.js`
- Create: `test/effort.test.js`
- Create: `test/integrate.test.js`

**Interfaces:**
- Consumes: `task.effort` e `EFFORT_LEVELS` (Task 1).
- Produces:
  - `src/effort.js`: `effortFor(planned: string|null, raises: number) → string|null`; `plannedEffort(task) → string|null` (o `task.effort.level` válido, senão `null`); `isApiFailure(outcome) → boolean`; `shouldRaise(status, outcome, { aborted }) → boolean`.
  - `buildArgs({ …, effort })` empurra `--effort <level>` logo depois do `--model`; `runAgent({ …, effort })` repassa.
  - Registro da task e da barreira: `effort` (o nível usado na tentativa, `null` quando herdado), gravado junto com `status: running`; e `raises`, o contador de A §5.6, que o `reconcile` zera.
  - Agente falso: o JSON visto ganha `argv`; `observe` aceita caminho absoluto; o passo ganha `events: [object]` (impressos como linhas stream-json antes do resultado), `result: { is_error, subtype, text, total_cost_usd, output_tokens }` (mesclado sobre o resultado padrão) e `sleepMs`; um prompt sem `Implement **Task N` usa a chave `review` do spec e grava `review-<tentativa>.json`.
  - `test/helpers/run-repo.js`: `makeRepo(planText)`, `cleanup(repo)`, `initRun(repo, { maxLanes, testCommand })`, `useSpec(repo, spec)`, `seen(repo, key, attempt = 1)` e `runLanesIn(repo, st, plan, dag, opts)`. O `makeRepo` commita um `.gitignore` com `.plan-state-*.json` e `.plo-logs/`, para o `integrate` achar a árvore limpa; o `repo.statePath` é o caminho absoluto do state.

- [ ] **Step 1: Write the failing unit tests**

Em `test/spawn.test.js`:

```js
test('buildArgs passes --effort right after --model', () => {
  const a = buildArgs({ prompt: 'x', model: 'opus', effort: 'medium' });
  const i = a.indexOf('--model');
  assert.deepEqual(a.slice(i, i + 4), ['--model', 'opus', '--effort', 'medium']);
});
test('buildArgs without effort is the argv of today', () => {
  assert.equal(buildArgs({ prompt: 'x', model: 'opus' }).includes('--effort'), false);
});
```

Em `test/effort.test.js`:

```js
test('effortFor climbs one level per raise and stops at xhigh', () => {
  assert.deepEqual([0, 1, 2, 3].map((r) => effortFor('medium', r)), ['medium', 'high', 'xhigh', 'xhigh']);
  assert.equal(effortFor('low', 1), 'medium');
  assert.equal(effortFor('max', 2), 'max');
  assert.equal(effortFor(null, 2), null);
});
test('a usage limit or a 529 is the API failing, not the task', () => {
  assert.equal(isApiFailure({ ok: false, result: 'API Error: 529 {"type":"overloaded_error"}', stderr: '' }), true);
  assert.equal(isApiFailure({ ok: false, result: null, stderr: 'Claude AI usage limit reached|1793138400' }), true);
  assert.equal(isApiFailure({ ok: false, result: 'Tests failed: 3', stderr: '' }), false);
  assert.equal(isApiFailure({ ok: true, result: 'the PR talks about rate limits', stderr: '' }), false);
});
test('shouldRaise only when the agent ran and the task stopped on its own result', () => {
  const ran = { ok: false, result: 'Tests failed', stderr: '' };
  for (const s of ['failed', 'blocked', 'needs-verify']) assert.equal(shouldRaise(s, ran, { aborted: false }), true, s);
  assert.equal(shouldRaise('done', { ok: true }, { aborted: false }), false);
  assert.equal(shouldRaise('failed', ran, { aborted: true }), false);
  assert.equal(shouldRaise('failed', { ok: false, result: 'API Error: 529', stderr: '' }, { aborted: false }), false);
});
```

Em `test/state.test.js`:

```js
test('reconcile: every run or resume starts each task back at its planned level', () => {
  const p = tmpPlan();
  const st = mkState(p);
  st.tasks['1'].raises = 2;
  state.reconcile(st);
  assert.equal(st.tasks['1'].raises, 0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/spawn.test.js test/effort.test.js test/state.test.js`
Expected: FAIL — `Cannot find module '../src/effort'`, and no `--effort` in argv.

- [ ] **Step 3: Implement `src/effort.js`, `buildArgs`/`runAgent` and the `reconcile` reset**

`effortFor` sobe na escada `['low', 'medium', 'high', 'xhigh']` e para no fim dela; `max` devolve `max`; `null` devolve `null`. `isApiFailure` só vale com `!outcome.ok` e testa `` `${outcome.result || ''}\n${outcome.stderr || ''}` `` contra `/\bAPI Error\b|\b529\b|overloaded|rate[ _-]?limit|usage limit|Unable to verify organization|authentication_failed/i`. `shouldRaise` é `status !== 'done' && !aborted && !isApiFailure(outcome)`. No `reconcile` (`src/state.js:191`), todo registro com `raises` volta a 0.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/spawn.test.js test/effort.test.js test/state.test.js`
Expected: PASS

- [ ] **Step 5: Extend the fake agent and write the run-repo helper**

O agente falso muda como diz o bloco Interfaces; sem `events`, `result` nem `sleepMs`, ele imprime exatamente o que imprime hoje. O `run-repo.js` copia `makeRepo`, `cleanup`, `initRun` e `useSpec` de `test/run-lanes.test.js:119-168`, sem mexer naquele arquivo. Ele acrescenta o `.gitignore` e define `PLO_AGENT_BIN` antes de qualquer `require('../../src/spawn')`.

- [ ] **Step 6: Write the failing run tests** em `test/effort.test.js`

`RUN_PLAN` tem a Task 1, `**Effort:** medium`, que cria `src/a.js`, e a Task 2, sem linha, que cria `src/b.js`, com `maxLanes: 2`.

```js
const argvOf = (repo, key, attempt) => seen(repo, key, attempt).argv;
const effortIn = (argv) => (argv.includes('--effort') ? argv[argv.indexOf('--effort') + 1] : null);

test('a task marked medium runs with --effort medium; an unmarked one carries no --effort', async (t) => {
  const repo = makeRepo(RUN_PLAN); t.after(() => cleanup(repo));
  const { st, plan, dag } = initRun(repo, { maxLanes: 2 });
  useSpec(repo, { 1: { writes: { 'src/a.js': '1' } }, 2: { writes: { 'src/b.js': '2' } } });
  await runLanesIn(repo, st, plan, dag);
  assert.equal(effortIn(argvOf(repo, 1, 1)), 'medium');
  assert.equal(effortIn(argvOf(repo, 2, 1)), null);
  assert.equal(st.tasks['1'].effort, 'medium');
  assert.equal(st.tasks['2'].effort, null);
});

test('a medium task that fails comes back at high, then xhigh, and resume returns it to medium', async (t) => {
  // spec 1: three attempts that exit 1 -> argv medium, high, xhigh; the lane stalls.
  // state.reconcile(st) (what resume does); spec 1: writes -> attempt 4 argv medium.
});

test('a lane that failed in prep comes back at its planned level', async (t) => {
  // lane A's worktree pointed at a missing dir: runTask fails in prep, raises stays 0;
  // restored: runTask runs with --effort medium.
});

test('an API failure does not raise the level', async (t) => {
  // spec 1: [{ result: { is_error: true, subtype: 'error_during_execution', text: 'API Error: 529 overloaded' } }, { writes }]
  // -> attempt 2 argv medium; final status done; raises 0.
});
```

Em `test/integrate.test.js`, `BARRIER_PLAN` tem as Tasks 1 e 2 (arquivos separados) e a Task 3, com `**Effort:** medium` e `- Consumes: Tasks 1-2` (barreira). O `initRun` usa `{ maxLanes: 2, testCommand: 'node -e ""' }`.

```js
test('a barrier marked medium runs with --effort medium, the cross-lane review with none', async (t) => {
  // spec: 1, 2, 3 write; review: { result: { text: 'CROSS-LANE VERDICT: CLEAN' } }
  // runLanesIn, then integrate(repo.planPath, st, plan, { log() {} })
  assert.equal(effortIn(argvOf(repo, 3, 1)), 'medium');
  assert.equal(effortIn(argvOf(repo, 'review', 1)), null);
  assert.equal(st.integration.status, 'done');
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `node --test test/effort.test.js test/integrate.test.js`
Expected: FAIL — no `--effort` reaches the agent.

- [ ] **Step 8: Implement the effort in `runTask` and `runBarriers`**

No `runTask`, `used = effortFor(plannedEffort(task), rec.raises || 0)`; o patch de `running` (`src/run.js:246-255`) grava `effort: used`; o `runAgent` recebe `effort: used`; e o patch do fim (`src/run.js:301-315`) grava `raises: (rec.raises || 0) + (shouldRaise(status, outcome, { aborted: Boolean(opts.signal && opts.signal.aborted) }) ? 1 : 0)`. A falha de preparo (`228-237`) e o binário que não abre (`271-278`) não tocam em `raises`. O `runBarriers` faz o mesmo com a linha da própria barreira (`src/integrate.js:117-157`). O `crossLaneReview` não muda.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/effort.js src/spawn.js src/run.js src/integrate.js src/state.js test/fixtures/fake-agent.js test/helpers/run-repo.js test/spawn.test.js test/state.test.js test/effort.test.js test/integrate.test.js
git commit -m "feat(run): --effort por task e subida de nível na nova tentativa" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 3: Cada tentativa deixa registro: pid, custo somado, tentativas

**Effort:** high — módulo de processo novo e o fim da tentativa em dois caminhos

**Files:**
- Create: `src/proc.js`
- Modify: `src/run.js:203-324`
- Modify: `src/integrate.js:95-165`
- Create: `test/proc.test.js`
- Create: `test/records.test.js`

**Interfaces:**
- Consumes: `test/helpers/run-repo.js`, os passos `result`/`sleepMs`/`observe` do agente falso e o campo `effort` do registro (Task 2).
- Produces:
  - `src/proc.js`: `processStamp(pid = process.pid) → { pid, startedAt: string|null }`, com o ISO de `ps -o lstart= -p <pid>`; `processAlive(pid, startedAt) → boolean`; `killGroup(pid, signal) → boolean`, que faz `process.kill(-pid, signal)` e devolve `false` quando o grupo já não existe.
  - Registro em `status: running`, na task de lane e na barreira: `pid` e `pidStartedAt`, do `plo` que dirige a task.
  - Fim de toda tentativa em que o agente rodou, na task de lane e na barreira: `costUsd` somado entre tentativas (`null` só quando nenhuma informou); `outputTokens` somado (agora também na barreira); e `tries` ganha `{ effort, status, at }`.

- [ ] **Step 1: Write the failing tests** em `test/proc.test.js`

```js
test('processStamp reads this process start, and processAlive accepts it', () => {
  const me = processStamp();
  assert.equal(me.pid, process.pid);
  assert.ok(Math.abs(Date.parse(me.startedAt) - (Date.now() - process.uptime() * 1000)) < 5000);
  assert.equal(processAlive(me.pid, me.startedAt), true);
});
test('a dead pid is not alive', () => {
  const { pid } = spawnSync(process.execPath, ['-e', '']);
  assert.equal(processAlive(pid, null), false);
});
test('a live pid with another start time is a reused pid', () => {
  const me = processStamp();
  assert.equal(processAlive(me.pid, new Date(Date.parse(me.startedAt) - 60000).toISOString()), false);
});
test('killGroup kills a detached process group', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  assert.equal(killGroup(child.pid, 'SIGKILL'), true);
  await once(child, 'exit');
  assert.equal(processAlive(child.pid, null), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/proc.test.js`
Expected: FAIL — `Cannot find module '../src/proc'`.

- [ ] **Step 3: Implement `src/proc.js`**

`processAlive` faz `process.kill(pid, 0)`: `ESRCH` dá `false`, e `EPERM` conta como vivo. Vivo e com `startedAt`, ele compara `Date.parse` da saída do `ps` com `Date.parse(startedAt)`, e mais de 5 s de diferença é pid reaproveitado (A §8). A resposta do `ps` fica em cache por pid durante 30 s, porque o `monitor` pergunta a cada segundo. O `ps` roda com `execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)])`; a saída (`Mon Oct 26 14:03:11 2026`) passa direto pelo `Date.parse`.

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/proc.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing record tests** em `test/records.test.js`

Use o `RUN_PLAN` da Task 2 (copie a constante) e o `BARRIER_PLAN` para a barreira.

```js
test('a running task records the pid of the plo that drives it', async (t) => {
  // spec 1: { observe: [repo.statePath], writes } -> the state the agent saw:
  const saw = JSON.parse(seen(repo, 1).files[repo.statePath]);
  assert.equal(saw.tasks['1'].status, 'running');
  assert.equal(saw.tasks['1'].pid, process.pid);
  assert.equal(saw.tasks['1'].pidStartedAt, processStamp().startedAt);
});

test('cost is summed across attempts, and every finished attempt is a try', async (t) => {
  // spec 1: [{ result: { is_error: true, text: 'Tests failed', total_cost_usd: 0.5, output_tokens: 100 } },
  //          { writes, result: { total_cost_usd: 0.25, output_tokens: 50 } }]
  const rec = state.load(repo.planPath).tasks['1'];
  assert.equal(rec.costUsd, 0.75);
  assert.equal(rec.outputTokens, 150);
  assert.deepEqual(rec.tries.map(({ effort, status }) => ({ effort, status })), [
    { effort: 'medium', status: 'failed' }, { effort: 'high', status: 'done' },
  ]);
  assert.ok(rec.tries.every((x) => !Number.isNaN(Date.parse(x.at))));
});

test('a prep failure and an interrupted attempt leave no try', async (t) => {
  // prep: lane worktree pointed at a missing dir -> runTask -> tries is empty.
  // interrupted: spec 1 { sleepMs: 3000 }; runTask with an AbortController aborted after 300 ms -> tries is empty.
});

test('a barrier records its cost, output and tries', async (t) => {
  // BARRIER_PLAN; spec 3: { result: { total_cost_usd: 0.4, output_tokens: 70 } } -> after integrate:
  assert.equal(rec3.costUsd, 0.4);
  assert.equal(rec3.outputTokens, 70);
  assert.equal(rec3.tries.length, 1);
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `node --test test/records.test.js`
Expected: FAIL — `pid` is `undefined` and `costUsd` is `0.25`.

- [ ] **Step 7: Implement the records**

O carimbo `processStamp()` do próprio processo é calculado uma vez por processo. O patch de `running` de `runTask` e de `runBarriers` grava `pid` e `pidStartedAt`. No fim de `runTask` (`src/run.js:301-315`), `costUsd` segue a mesma regra do `outputTokens` ao lado: `null` quando os dois lados são `null`, senão a soma. `tries` só ganha a entrada quando `opts.signal` não foi abortado. O `runBarriers` (`src/integrate.js:151-157`) grava `costUsd`, `outputTokens` e `tries` do mesmo jeito.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/proc.js src/run.js src/integrate.js test/proc.test.js test/records.test.js
git commit -m "feat(run): pid do plo, custo somado e tentativas no registro de cada task" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 4: Uso de 5 h e arestas gravados no estado

**Effort:** high — evento novo atravessando três chamadores, e o grafo gravado pelo `cmdRun`

**Files:**
- Modify: `src/spawn.js:39-66`
- Modify: `src/state.js`
- Modify: `src/run.js:203-324`
- Modify: `src/integrate.js:95-265`
- Modify: `bin/plo.js:151-216`
- Test: `test/spawn.test.js`
- Test: `test/state.test.js`
- Create: `test/usage.test.js`

**Interfaces:**
- Consumes: o helper `run-repo` e o passo `events` do agente falso (Task 2).
- Produces: `parseEvent` devolve `{ kind: 'rate_limit', info }` para `rate_limit_event`. `state.recordUsage(planPath, st, info) → boolean` grava `st.usage5h = { utilization, resetsAt, at }` a partir de `info.unifiedWindows.five_hour`; evento sem essa janela não muda nada e devolve `false`. `st.edges = [{ from, to }]` é gravado pelo `cmdRun` a cada `run`/`resume`, nunca no `--dry-run`.

- [ ] **Step 1: Write the failing tests**

```js
// test/spawn.test.js
const RATE = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1793138400, rateLimitType: 'seven_day', utilization: 0.38, unifiedWindows: { five_hour: { utilization: 0.16, resetsAt: 1792623600 }, seven_day: { utilization: 0.38, resetsAt: 1793138400 } } } };
test('parseEvent hands the rate limit event over', () => {
  assert.deepEqual(parseEvent(JSON.stringify(RATE)), { kind: 'rate_limit', info: RATE.rate_limit_info });
});

// test/state.test.js
test('recordUsage keeps the five-hour window, and ignores an event without one', () => {
  // recordUsage(p, st, RATE.rate_limit_info) -> true; st.usage5h -> { utilization: 0.16, resetsAt: 1792623600, at: <iso> }
  // recordUsage(p, st, { status: 'allowed', rateLimitType: 'five_hour' }) -> false; usage5h unchanged
});
```

Em `test/usage.test.js`:
- `'a lane task records the five-hour window its agent reported'`: spec `1: { events: [RATE], writes }`, depois `state.load(...).usage5h.utilization === 0.16`.
- `'the barrier and the reviewer record it too'`: com o `BARRIER_PLAN` e a revisão emitindo `RATE` com `five_hour.utilization: 0.42`, o valor final é `0.42`.
- `'plo run writes the dependency edges into the state, and --dry-run does not'`: é teste de CLI. `spawnSync(process.execPath, [PLO, 'run', '--plan', repo.planPath, '--worktree-dir', repo.worktreeDir], { env: { ...process.env, PLO_AGENT_BIN, PLO_FAKE_SPEC, PLO_FAKE_SEEN } })` sobre um plano em que a Task 3 consome a Task 1. Depois, `st.edges` precisa ser igual a `buildDag(plan.tasks, { done: [], maxLanes: 3, overrides: {} }).edges.map(({ from, to }) => ({ from, to }))`. Antes disso, num repo novo, `plo run --dry-run` deixa `st.edges` `undefined`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/spawn.test.js test/state.test.js test/usage.test.js`
Expected: FAIL — `parseEvent` returns `null`, and there is no `usage5h`.

- [ ] **Step 3: Implement**

`parseEvent` reconhece o `rate_limit_event`. O `runTask`, o `runBarriers` e o `crossLaneReview` passam ao `runAgent` um `onEvent: (ev) => { if (ev.kind === 'rate_limit') state.recordUsage(planPath, st, ev.info); }`. O `cmdRun` grava `st.edges` a partir do `dependencyEdges` (`bin/plo.js:177`) e salva, logo depois do retorno do `--dry-run` e antes do `prepareLanes`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/spawn.js src/state.js src/run.js src/integrate.js bin/plo.js test/spawn.test.js test/state.test.js test/usage.test.js
git commit -m "feat(estado): janela de 5 h e arestas do plano gravadas pelo processo que roda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 5: O integrate grava o começo de cada etapa e trata o sinal

**Effort:** xhigh — ordem de gravação, etapa largada refeita e sinal no CLI

**Files:**
- Modify: `src/integrate.js:226-312`
- Modify: `src/state.js:97`
- Modify: `bin/plo.js:218-234`
- Test: `test/integrate.test.js`

**Interfaces:**
- Consumes: `processStamp` (Task 3); o `observe` com caminho absoluto, o `sleepMs` e a chave `review` do agente falso (Task 2).
- Produces:
  - `st.integration.pid` e `st.integration.pidStartedAt`, do `plo integrate` vivo.
  - `st.integration.stages.merge = { startedAt, endedAt }` e `stages.review = { startedAt, endedAt, logFile, sessionId, costUsd, outputTokens }`. O `state.create` já nasce com `stages: {}`.
  - `integration.status` ganha `'merging'`, `'reviewing'` e `'interrupted'`. Uma etapa interrompida leva `interrupted: true` e `endedAt`.
  - `markInterrupted(planPath, st) → 'merge'|'suite'|'review'|null`, exportado de `src/integrate.js`. Fecha a etapa aberta (com `startedAt` e sem `endedAt`), marca como `interrupted` toda barreira em `running` e grava o estado.
  - `crossLaneReview` devolve também `costUsd` e `outputTokens`.

- [ ] **Step 1: Write the failing tests** em `test/integrate.test.js`

```js
test('integrate stamps every stage with start and end, and the review with its log and cost', async (t) => {
  // BARRIER_PLAN; review: { result: { text: 'CROSS-LANE VERDICT: CLEAN', total_cost_usd: 0.42, output_tokens: 900 } }
  const i = state.load(repo.planPath).integration;
  assert.ok(i.stages.merge.startedAt <= i.stages.merge.endedAt);
  assert.match(i.stages.review.logFile, /cross-lane-review\.jsonl$/);
  assert.equal(typeof i.stages.review.sessionId, 'string');
  assert.equal(i.stages.review.costUsd, 0.42);
  assert.equal(i.stages.review.outputTokens, 900);
  assert.equal(i.pid, process.pid);
});

test('the review stage is on disk before the reviewer starts', async (t) => {
  // review: { observe: [repo.statePath], result: CLEAN }
  const saw = JSON.parse(seen(repo, 'review').files[repo.statePath]).integration;
  assert.equal(saw.status, 'reviewing');
  assert.ok(saw.stages.review.startedAt);
  assert.equal(saw.stages.review.endedAt, undefined);
  assert.ok(saw.stages.merge.endedAt, 'the merge had already closed');
});

test('markInterrupted closes the open stage and the running barrier', () => {
  // st with integration.stages.review = { startedAt } and barrier T3 running
  assert.equal(markInterrupted(planPath, st), 'review');
  assert.equal(st.integration.stages.review.interrupted, true);
  assert.ok(st.integration.stages.review.endedAt);
  assert.equal(st.integration.status, 'interrupted');
  assert.equal(st.tasks['3'].status, 'interrupted');
});

test('a new integrate redoes a stage left running', async (t) => {
  // lanes done; st.integration.status = 'reviewing'; stages.review = { startedAt: OLD } -> integrate
  // -> stages.review.startedAt !== OLD, endedAt set, status 'done'
});

test('SIGTERM stops plo integrate, marks the review interrupted and exits 130', async (t) => {
  // lanes done in process; review: { sleepMs: 10000 }; spawn PLO integrate --plan with the fake env
  // waitFor(state status === 'reviewing'); child.kill('SIGTERM'); exit code 130
  // state: integration.status 'interrupted', stages.review.interrupted true
});
```

O `waitFor(fn, ms = 10000)` local consulta a cada 50 ms.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/integrate.test.js`
Expected: FAIL — `stages` is `undefined`, and `markInterrupted is not a function`.

- [ ] **Step 3: Implement**

O `integrate` grava `pid`/`pidStartedAt` ao começar e garante `st.integration.stages` em estado antigo. Quando o merge roda, ele grava `stages.merge = { startedAt }` e o status `merging` e salva; depois do `mergeLanes`, grava o `endedAt` e o status de hoje. O `crossLaneReview` grava `stages.review = { startedAt, logFile, sessionId }` e o status `reviewing` e salva **antes** do `runAgent`. Quando o resultado chega, ele grava `endedAt`, `costUsd` e `outputTokens` (`?? null`). Toda etapa que recomeça sobrescreve o objeto inteiro, e é isso que refaz a etapa largada. O `cmdIntegrate` monta um `AbortController` como o do `cmdRun` (`bin/plo.js:186-192`), passa `signal` ao `integrate` e, no SIGINT/SIGTERM, faz `controller.abort()`, `markInterrupted(abs, st)`, um `log` com a etapa e `process.exit(130)`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrate.js src/state.js bin/plo.js test/integrate.test.js
git commit -m "feat(integrate): cada etapa grava o começo, e o Ctrl-C marca a etapa como interrompida" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 6: A suíte completa ao vivo, em `.plo-logs/full-suite.log`

**Effort:** xhigh — processo em grupo próprio com saída pelo pipe do `plo`, e a suíte anterior morta antes de truncar o log

**Files:**
- Modify: `src/integrate.js:168-177`
- Modify: `src/integrate.js:268-312`
- Modify: `bin/plo.js:218-234`
- Test: `test/integrate.test.js`

**Interfaces:**
- Consumes: `processStamp`, `processAlive` e `killGroup` (Task 3); `stages`, `markInterrupted` e o controlador do `cmdIntegrate` (Task 5).
- Produces: `fullSuite(planPath, st, { log, signal }) → Promise<{ ok, code, summary, command } | { ok: false, skipped: true, summary }>`; `stages.suite = { startedAt, endedAt, logFile, command, pid, pidStartedAt }`; o status `'suite-running'`; e `.plo-logs/full-suite.log`, cuja primeira linha é `# <ISO> $ <command>` e que recebe stdout e stderr conforme chegam.

- [ ] **Step 1: Write the failing tests** em `test/integrate.test.js`

Estes testes usam um tmpdir com `state.create`, como `test/monitor.test.js:62-99`; o `repoRoot` é o tmpdir.

```js
test('the suite output reaches full-suite.log while the suite runs', async () => {
  st.testCommand = `node -e "console.log('first'); setTimeout(() => console.log('second'), 600)"`;
  const run = fullSuite(planPath, st, {});
  const log = path.join(path.dirname(planPath), '.plo-logs', 'full-suite.log');
  await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('first'));
  const mid = fs.readFileSync(log, 'utf8');
  assert.match(mid.split('\n')[0], /^# \d{4}-\d\d-\d\dT\S+ \$ node -e/);
  assert.equal(mid.includes('second'), false);
  const onDisk = state.load(planPath).integration;
  assert.equal(onDisk.status, 'suite-running');
  assert.equal(typeof onDisk.stages.suite.pid, 'number');
  const res = await run;
  assert.equal(res.ok, true);
  assert.match(res.summary, /first\nsecond/);
  assert.ok(state.load(planPath).integration.stages.suite.endedAt);
});

test('a test command that does not exist fails with 127, not a crash', async () => {
  st.testCommand = 'plo-no-such-command-xyz';
  const res = await fullSuite(planPath, st, {});
  assert.equal(res.ok, false);
  assert.equal(res.code, 127);
});

test('a suite still alive from a dead integrate is killed before the log is truncated', async () => {
  const stale = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const stamp = processStamp(stale.pid);
  st.integration.stages = { suite: { startedAt: new Date().toISOString(), pid: stamp.pid, pidStartedAt: stamp.startedAt } };
  st.testCommand = 'node -e ""';
  await fullSuite(planPath, st, {});
  await waitFor(() => !processAlive(stamp.pid, null), 3000);
});

test('SIGTERM to plo integrate kills the suite group and marks the stage interrupted', async (t) => {
  // makeRepo + lanes done (no barrier); st.testCommand = `node -e "setInterval(() => console.log('tick'), 200)"`; save
  // spawn PLO integrate; waitFor(status 'suite-running' && stages.suite.pid); SIGTERM; exit 130
  // stages.suite.interrupted === true; waitFor(() => !processAlive(suitePid, null), 3000)
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/integrate.test.js`
Expected: FAIL — `fullSuite` returns synchronously and writes no log.

- [ ] **Step 3: Implement**

Antes de tudo, se `stages.suite.pid` ainda vive (`processAlive(pid, pidStartedAt)`), o `fullSuite` o mata com `killGroup(pid, 'SIGKILL')` e registra no `log`. Depois trunca o log, escreve o cabeçalho e abre a suíte com `spawn(cmd, { cwd: st.repoRoot, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })`. Os dois pipes vão para um `createWriteStream(logFile, { flags: 'a' })` e para um buffer que guarda os últimos 256 KB, de onde sai o `summary` (as 40 últimas linhas). Com o pid em mãos, ele grava `stages.suite` (com `processStamp(child.pid)`) e o status `suite-running` e salva. No `close`, devolve `ok: code === 0` e grava o `endedAt`. Com `signal` abortado, chama `killGroup(child.pid, 'SIGTERM')`. O `integrate` passa a fazer `await fullSuite(planPath, st, { log, signal: opts.signal })`. O tratador de sinal do `cmdIntegrate` (Task 5) mata o grupo da suíte aberta (`stages.suite` sem `endedAt`) com `SIGTERM` antes de sair. A função `run` (`src/integrate.js:27-34`) continua só para o `reviewPackage`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrate.js bin/plo.js test/integrate.test.js
git commit -m "feat(integrate): suíte completa por spawn, ao vivo em full-suite.log, em grupo próprio" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 7: O monitor reconhece processo morto

**Effort:** high — liveness em tasks, subagentes e etapas, mais as duas flags do fim do run

**Files:**
- Modify: `src/monitor.js:335-384`
- Modify: `src/monitor.js:391-457`
- Modify: `src/monitor.js:494-552`
- Modify: `src/monitor.js:645-756`
- Test: `test/monitor.test.js`

**Interfaces:**
- Consumes: `processAlive` (Task 3); `pid`/`pidStartedAt` do registro (Task 3); `integration.pid` e `stages.*` (Tasks 5 e 6).
- Produces:
  - `snapshot(planPath, { alive })` e `taskDetail(planPath, n, { alive })`, com `alive(pid, startedAt) → boolean` e `processAlive` como padrão.
  - O status de uma task vira `interrupted` quando ela está em `running` com o `pid` morto. Sem `pid`, nada muda.
  - `buildChildren(activity, subs, { activityLimit, parentRunning })`: com `parentRunning` falso, os filhos em `running` viram `interrupted`.
  - `buildStages(lanes, barriers, integration, { alive })`: toda etapa ganha `startedAt` e `endedAt` (`null` quando não há). Merge, suíte e revisão passam a ter `running` e `interrupted`.
  - O snapshot ganha `integrationRunning` e `runOver`, e `totals.active` passa a contar a integração.

- [ ] **Step 1: Write the failing tests** em `test/monitor.test.js`

```js
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('a running task whose plo died is interrupted, and so are its open subagents', () => {
  const { planPath, logFile } = fixture();
  fs.appendFileSync(logFile, assistantTool('Task', { subagent_type: 'implementer', description: 'build' }, 'tu_sub', '2026-08-19T12:01:00.000Z'));
  const st = state.load(planPath);
  Object.assign(st.tasks['2'], { pid: deadPid(), pidStartedAt: null });
  state.save(planPath, st);
  const t2 = monitor.snapshot(planPath).lanes[0].tasks[1];
  assert.equal(t2.status, 'interrupted');
  assert.equal(t2.children.find((c) => c.id === 'tu_sub').status, 'interrupted');
});

test('a running task with no pid comes from an older plo, and stays running', () => {
  const { planPath } = fixture();
  assert.equal(monitor.snapshot(planPath).lanes[0].tasks[1].status, 'running');
});

test('a running task whose plo is alive stays running', () => {
  // pid: process.pid, pidStartedAt: processStamp().startedAt -> 'running'
});

test('stages carry their clock, and a review in flight keeps the run open', () => {
  // T1, T2, T3 done; integration: { status: 'reviewing', mergedLanes: ['A'], suite: { ok: true, code: 0, summary: '', command: 'npm test' },
  //   review: null, pid: process.pid, pidStartedAt: processStamp().startedAt,
  //   stages: { merge: { startedAt: M0, endedAt: M1 }, suite: { startedAt: S0, endedAt: S1 }, review: { startedAt: R0 } } }
  const s = monitor.snapshot(planPath);
  const review = s.stages.find((x) => x.key === 'review');
  assert.equal(review.status, 'running');
  assert.equal(review.startedAt, R0);
  assert.equal(review.endedAt, null);
  assert.equal(s.integrationRunning, true);
  assert.equal(s.totals.active, true);
  assert.equal(s.runOver, false);
});

test('a review whose integrate died is interrupted, and the run is not over', () => {
  // same, pid: deadPid() -> review 'interrupted'; integrationRunning false; totals.active false; runOver false
});

test('the run is over only when the integration finished', () => {
  // status 'done' -> true; 'review-findings' -> true; 'barrier-failed' with nothing running -> true; 'merged' -> false
});

test('taskDetail applies the same liveness', () => {
  // T2 running with a pid; taskDetail(planPath, 2, { alive: () => false }).status === 'interrupted'
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/monitor.test.js`
Expected: FAIL — status stays `running`, and `integrationRunning` is `undefined`.

- [ ] **Step 3: Implement**

No `taskView`, o status vem de `rec.status === 'running' && rec.pid && !alive(rec.pid, rec.pidStartedAt) ? 'interrupted' : rec.status`, e o `live`/`shown` passa a usar esse status. No `buildStages`, para `merge`, `suite` e `review`, com `s = (i.stages || {})[key]`: `s.interrupted` dá `interrupted`; `startedAt` sem `endedAt` dá `running` quando `alive(i.pid, i.pidStartedAt)`, senão `interrupted`; e o resto segue a regra de hoje. As etapas `run` e `barriers` levam como `startedAt` o menor `startedAt` das suas tasks e, quando estão `done`, como `endedAt` o maior `endedAt`. `integrationRunning` é verdadeiro com merge, suíte ou revisão em `running`, ou com uma barreira em `running`. `runOver = !totals.active && ['done', 'review-findings', 'merge-failed', 'barrier-failed', 'suite-failed'].includes(i.status)`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor.js test/monitor.test.js
git commit -m "feat(monitor): task, etapa e subagente com processo morto aparecem interrompidos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 8: A suíte ao vivo e o revisor no snapshot

**Effort:** high — leitura do log da suíte e a visão do revisor no formato de task

**Files:**
- Modify: `src/monitor.js`
- Test: `test/monitor.test.js`

**Interfaces:**
- Consumes: o formato do `full-suite.log` e `stages.suite` (Task 6); `stages.review` (Task 5); a opção `alive` e o `parentRunning` (Task 7).
- Produces:
  - `cleanTermLines(text) → string[]`, exportado.
  - `snapshot.suiteLive = { command, startedAt, logFile, lines }` só enquanto a etapa da suíte está em `running`, e `null` fora disso. `lines` são as 40 últimas linhas limpas, lidas de um tail de 64 KB.
  - `snapshot.reviewer`, no formato do `taskView`, com `id: 'review'`, `kind: 'review'`, `n: null` e `title: 'Cross-lane review'`; `null` antes de a revisão começar. Enquanto roda, `costUsd` e `outputTokens` ficam `null`, e os subagentes seguem a regra do `parentRunning`.
  - `totals.costUsd` soma `integration.stages.review.costUsd`.

- [ ] **Step 1: Write the failing tests**

```js
test('cleanTermLines strips colour, keeps the last segment of a rewritten line, drops the header', () => {
  const raw = '# 2026-10-26T14:00:00.000Z $ npm test\n\x1b[32m✓\x1b[39m a.test.js\r\nprogress 10%\rprogress 100%\n\x1b[1mTests\x1b[22m 3 passed\n';
  assert.deepEqual(monitor.cleanTermLines(raw), ['✓ a.test.js', 'progress 100%', 'Tests 3 passed']);
});

test('while the suite runs, the snapshot carries its last lines, and they move', () => {
  // integration: status 'suite-running', pid alive, stages.suite { startedAt, logFile, command: 'npm test', pid, pidStartedAt }
  // log: header + 2 lines -> suiteLive.lines.length 2, suiteLive.command 'npm test'; append one -> 3
});

test('suiteLive is null once the suite ended', () => { /* stages.suite.endedAt set -> null */ });

test('the reviewer is one more agent: running, with its subagents, its cost null until it ends', () => {
  // review log: init, a Read call, a Task call tu_rv (code-reviewer) with no result; stages.review { startedAt, logFile, sessionId }; pid alive
  // r = snapshot.reviewer: id 'review', kind 'review', status 'running', children[0].status 'running', costUsd null
  // then stages.review.endedAt + costUsd 0.42: status 'done', costUsd 0.42, children[0].status 'interrupted',
  // and totals.costUsd === 1.5 + 0.42
});

test('the reviewer is null before the review starts', () => { /* fixture() -> snapshot.reviewer === null */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/monitor.test.js`
Expected: FAIL — `cleanTermLines is not a function`.

- [ ] **Step 3: Implement**

O `cleanTermLines` tira os códigos com `/\x1b\[[0-9;?]*[ -\/]*[@-~]/g`, separa por `\n`, tira o `\r` do fim de cada linha e fica com o trecho depois do último `\r`. Ele descarta a linha de cabeçalho (`/^# \d{4}-\d\d-\d\dT\S+ \$ /`) e a última linha, se vier vazia. O revisor é montado pelo mesmo `readTaskLog` e pelo mesmo `buildChildren` das tasks, a partir de `stages.review.logFile`. O status dele é `interrupted` quando a etapa saiu `interrupted` no `buildStages`, `running` quando saiu `running`, e `done` quando tem `endedAt`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor.js test/monitor.test.js
git commit -m "feat(monitor): suíte ao vivo e revisor entre lanes no snapshot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 9: Os campos novos de cada task: esforço, tentativas, último teste e custo de quem roda

**Effort:** high — digest com o último teste, os campos de B §9.1 e duas expectativas antigas revistas

**Files:**
- Modify: `src/monitor.js`
- Test: `test/monitor.test.js`

**Interfaces:**
- Consumes: `task.effort` e `EFFORT_LEVELS` (Task 1); `effort` e `raises` do registro (Task 2); `tries` (Task 3); `st.usage5h` e `st.edges` (Task 4); o status com liveness (Task 7).
- Produces:
  - `digestLog(text, { activityLimit, testCommand })` devolve também `lastTest = { command, at, ok, tail } | null`.
  - A visão da task ganha `effort: { planned, used, raised, reason } | null`, `tries: [{ effort, status, at }]` e `lastTest`.
  - Uma task com status `running` (depois da liveness) sai com `costUsd` e `outputTokens` `null`, no `snapshot` e no `taskDetail`.
  - O snapshot ganha `usage5h` (`st.usage5h || null`) e `edges` (`st.edges || []`).

- [ ] **Step 1: Write the failing tests**

```js
const subCall = (id, command, at) => ev({ type: 'assistant', timestamp: at, parent_tool_use_id: 'tu_impl', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }], usage: { output_tokens: 5 } } });

test('lastTest is the last test call of the task or of a subagent, with the tail of its output', () => {
  const out = `${Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')}\nTests 12 passed`;
  const log = SAMPLE_LOG + subCall('tu_t', 'npx vitest run src/panel.test.ts', '2026-08-19T12:01:00.000Z') + toolResult('tu_t', out, false, '2026-08-19T12:01:20.000Z');
  const d = monitor.digestLog(log, { testCommand: 'npm test' });
  assert.equal(d.lastTest.command, 'npx vitest run src/panel.test.ts');
  assert.equal(d.lastTest.at, '2026-08-19T12:01:00.000Z');
  assert.equal(d.lastTest.ok, true);
  assert.deepEqual(d.lastTest.tail.split('\n'), [...Array.from({ length: 9 }, (_, i) => `line ${i + 22}`), 'Tests 12 passed']);
});

test('the test command of the plan counts, a test still running has ok null, and a plain Bash call is no test', () => {
  // SAMPLE_LOG alone -> lastTest { command: 'npm test -- requests', ok: false }
  // + subCall('tu_u', 'npm test', T) with no result -> ok null
  // a log whose only Bash is `ls -la` -> lastTest null
});

test('effort: planned from the plan, used from the record, raised when used is above', () => {
  // PLAN gains '**Effort:** medium — x' under Task 2; st.tasks['2'].effort = 'high'
  // -> { planned: 'medium', used: 'high', raised: true, reason: 'x' }; T1 -> null; T3 -> null
});

test('tries pass through as recorded', () => { /* st.tasks['1'].tries = [{ effort: 'medium', status: 'done', at }] */ });

test('a running task reports no cost and no output yet', () => {
  // st.tasks['2'].costUsd = 1.2, outputTokens = 500 (an earlier attempt) -> snapshot T2: null, null;
  // taskDetail(planPath, 2).outputTokens === null
});

test('usage5h and edges come from the state, empty for an older state', () => {
  // fixture() -> usage5h null, edges []; st.usage5h = {...}, st.edges = [{ from: 1, to: 2 }] -> passed through
});
```

Revise as duas expectativas que a regra "rodando sai `null`" contradiz:
- Em `'a token count comes from what the agent reported, never from a running sum'` (`test/monitor.test.js:556-572`), antes de anexar o `result`, grave a T2 como `failed`. A asserção `12864` passa a dizer "a task that stopped shows what its spawn reported".
- Em `'the checkpoint outranks the log, and the totals add up the run'` (`574-593`), grave a T2 como `failed` junto com `outputTokens = 17760`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/monitor.test.js`
Expected: FAIL — `lastTest`, `effort` and `tries` are `undefined`, and the running T2 still reports `1.2`.

- [ ] **Step 3: Implement**

O `lastTest` olha toda chamada de Bash, inclusive de subagente, cujo comando contém o `testCommand` ou bate em `/\b(vitest|jest|pytest|go test|node --test|(npm|pnpm|yarn)( run)? test)\b/`. O `command` é o `input.command` inteiro; `ok` é `null` até o `tool_result` chegar e depois `!is_error`. O `tail` são as 10 últimas linhas do texto inteiro do resultado, com no máximo 1024 caracteres contados do fim. Use a mesma extração de texto do `resultPreview` (`src/monitor.js:117`), sem o corte de 140 caracteres. O `taskView` passa `testCommand: st.testCommand` ao digest. Para comparar níveis, `raised` usa a ordem de `EFFORT_LEVELS`. `effort` é `null` quando não há `planned` nem `used`. A regra do custo `null` vale na visão e no `taskDetail` (`src/monitor.js:745`).

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor.js test/monitor.test.js
git commit -m "feat(monitor): esforço, tentativas, último teste e custo nulo de quem ainda roda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 10: Ativos: o sprite do operador e a rota `/assets/`

**Effort:** medium — script de uma vez e uma rota de lista fechada; a fonte já está na base

**Files:**
- Create: `docs/superpowers/specs/2026-10-26-painel-operador/gerar/monta-sprite.js`
- Modify: `docs/superpowers/specs/2026-10-26-painel-operador/gerar/README.md`
- Create: `src/assets/operador.svg`
- Modify: `src/serve.js:84-157`
- Test: `test/serve.test.js`

**Interfaces:**
- Consumes: `src/assets/roboto-condensed.ttf` e `src/assets/OFL.txt`, commitados na base antes do run.
- Produces: `GET /assets/operador.svg`, com 12 `<symbol id="op-<pose>-<1|2>">` para as poses `orgulho`, `trabalhando`, `revisando`, `travado`, `falhou` e `dormindo`; `GET /assets/roboto-condensed.ttf` (`font/ttf`); `GET /assets/OFL.txt` (`text/plain; charset=utf-8`). Qualquer outro caminho sob `/assets/` dá 404.

- [ ] **Step 1: Write the failing tests** em `test/serve.test.js`

```js
test('the assets route serves the sprite, the font and its licence', async () => {
  const { planPath } = fixture();
  const { base, close } = await boot(planPath);
  try {
    const svg = await get(base, '/assets/operador.svg');
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /^image\/svg\+xml/);
    assert.equal((svg.body.match(/<symbol id="op-/g) || []).length, 12);
    assert.equal(svg.body.includes('class="'), false);
    assert.ok(svg.body.includes('fill:var(--fig)') && svg.body.includes('fill:var(--ln)'));
    const ttf = await fetch(`${base}/assets/roboto-condensed.ttf`);
    assert.equal(ttf.status, 200);
    assert.equal(ttf.headers.get('content-type'), 'font/ttf');
    const ofl = await get(base, '/assets/OFL.txt');
    assert.equal(ofl.status, 200);
    assert.match(ofl.body, /SIL OPEN FONT LICENSE/i);
  } finally { await close(); }
});

test('the assets route answers only its own list', async () => {
  for (const p of ['/assets/..%2Fpackage.json', '/assets/operador.svg.bak', '/assets/', '/assets/%E0%A4%A', '/assets/OFL.TXT']) {
    assert.equal((await get(base, p)).status, 404, p);
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/serve.test.js`
Expected: FAIL — 404 on `/assets/operador.svg`.

- [ ] **Step 3: Write `monta-sprite.js` and generate the sprite**

O script é Node puro e roda uma vez: `node docs/superpowers/specs/2026-10-26-painel-operador/gerar/monta-sprite.js`. Ele lê `../operador/bone-<pose>-<1|2>.svg`, pega o `viewBox` e o miolo entre o primeiro `>` e o último `</svg>`. Troca `class="sil"` e `class="fx"` por `style="fill:var(--fig)"`, e `class="ln"` por `style="fill:var(--ln)"`. Embrulha cada quadro em `<symbol id="op-<pose>-<n>" viewBox="…">` e escreve `src/assets/operador.svg` como `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>…</defs></svg>`. É o mesmo que fazia `monta-pipboy-v3.py` (B §7.3). O `README.md` da pasta ganha um item 4 que diz como rodar o script.

- [ ] **Step 4: Implement the route**

`ASSETS = { 'operador.svg': 'image/svg+xml', 'roboto-condensed.ttf': 'font/ttf', 'OFL.txt': 'text/plain; charset=utf-8' }`. Para `url.pathname.startsWith('/assets/')`, o nome é `decodeURIComponent(url.pathname.slice(8))` dentro de `try`; o que lança vira 404. Só um nome que é chave própria de `ASSETS` (`Object.prototype.hasOwnProperty.call`) é lido, de `path.join(__dirname, 'assets', name)`, com `cache-control: no-store`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-26-painel-operador/gerar/monta-sprite.js docs/superpowers/specs/2026-10-26-painel-operador/gerar/README.md src/assets/operador.svg src/serve.js test/serve.test.js
git commit -m "feat(serve): sprite do operador e rota /assets/ de lista fechada" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface

---

### Task 11: Gerador de fixture e bootstrap do smoke gate

**Effort:** high — sete cenários com valores exatos que as asserções das Tasks 12–18 conferem, e o primeiro bootstrap do repositório

**Files:**
- Create: `smoke/fixture.js`
- Create: `smoke/PROJECT.md`
- Modify: `.gitignore`
- Create: `test/fixture.test.js`

**Interfaces:**
- Consumes: `processStamp` (Task 3); as formas de registro e de estado das Tasks 2–6 (`effort`, `raises`, `tries`, `pid`, `pidStartedAt`, `costUsd`, `integration.stages`, `usage5h`, `edges`); os campos do snapshot das Tasks 7–9; `createServer` e `listen` de `src/serve.js`.
- Produces:
  - `node smoke/fixture.js up` grava os cenários em `smoke/.artifacts/fixtures/<nome>/` e serve cada um na sua porta, com `listen(server, { port, host: '127.0.0.1', attempts: 1 })`: porta ocupada é erro, não pulo. Imprime uma linha `READY mid=http://127.0.0.1:7411 suite=… review=… barrier=… empty=… drop=… idle=…` e fica no ar até SIGTERM/SIGINT.
  - `writeScenarios(dir, { now, live }) → { [nome]: planPath }`, exportado, para o teste de node.
  - O `repoRoot` de todo estado é a raiz do repositório. Por isso o comando que a página monta é `plo <verbo> --plan smoke/.artifacts/fixtures/<nome>/plan.md`.

**Os cenários** (as asserções das Tasks 12–18 contam com estes valores):

| Porta | Nome | O que é |
|---|---|---|
| 7411 | `mid` | plano "Operator fixture", 8 tasks, 4 lanes, run no meio (tabela abaixo) |
| 7412 | `suite` | T1–T8 `done`; integração `suite-running`, com o `full-suite.log` crescendo uma linha a cada 700 ms |
| 7413 | `review` | T1–T8 `done`; suíte passou; integração `reviewing`; o revisor roda com um subagente `tu_rv` (`code-reviewer`) sem resultado |
| 7414 | `barrier` | T1–T7 `done`; barreira T8 `failed` com um subagente `tu_orph` sem resultado; integração `barrier-failed` com pid morto |
| 7415 | `empty` | só o plano, sem estado |
| 7416 | `drop` | proxy para a 7411; `GET /__fixture/drop` desliga todo stream aberto e derruba conexão nova (socket destruído) por 8 s |
| 7417 | `idle` | T1–T7 `done`, T8 `pending`, integração `pending`, na **forma antiga**: sem `pid`, `stages`, `effort`, `tries`, `edges` nem `usage5h` |

O `mid`, com base `feature/fixture @ abc1234`, `testCommand: 'npm test'`, `maxLanes: 4` e lanes A [1, 2, 3], B [4, 5], C [6], D [7]:

| T | Título | Lane | Esforço no plano | Registro |
|---|---|---|---|---|
| 1 | Core types | A | medium | `done`; custo 0.80; 21 000 tokens de saída; tries [medium done] |
| 2 | Panel shell | A | high | `running`, pid vivo, attempts 1, effort high; log com o subagente `tu_impl` (`implementer`) rodando `npm test -- panel` 40 s atrás, que passou com o fim `Tests 12 passed`; último evento 20 s atrás |
| 3 | Panel wiring | A | medium | `pending` |
| 4 | Data layer | B | xhigh | `done`; custo 3.10 |
| 5 | Counts per team | B | medium | `failed`; attempts 3; raises 2; effort xhigh; tries medium/high/xhigh, todas `failed`; custo 2.30; o erro abaixo |
| 6 | Icons | C | high | `running`, pid vivo; último evento 8 min atrás |
| 7 | Team page | D | high | `running`, pid vivo; último evento 20 min atrás |
| 8 | Docs and PR prep | barreira | medium | `pending` |

O erro da T5, exato:

```
Expected 4 teams, got 3.

<img src=x onerror="window.__xss=1">

    AssertionError: counts per team
```

- No plano, toda task tem a linha `**Effort:** <nível da tabela> — fixture` e pelo menos um passo; a T2 tem 3 passos: `Write the failing test`, `Implement the shell` e `Commit`.
- `edges`: `1→2, 2→3, 4→3, 4→5` e de cada uma das T1–T7 para a T8.
- `usage5h`: `utilization` 0.84 e `resetsAt` daqui a 2 h, em segundos.
- O pid vivo é o `processStamp()` do próprio gerador; o pid morto sai de um `spawnSync`.
- O `mid` e o `review` são regravados a cada 30 s a partir do relógio do momento, para "20 s atrás" continuar valendo durante o gate.
- O `full-suite.log` do `suite` começa com o cabeçalho, linhas com cor ANSI (`\x1b[32m✓\x1b[39m test/case-<k>.test.js (3 tests) 12ms`) e uma linha reescrita, `progress 10%\rprogress 100%`.
- No `review`, o merge levou de agora−4 min a agora−3 min 30 s, e a suíte, de agora−3 min a agora−2 min.

- [ ] **Step 1: Write the failing test** em `test/fixture.test.js`

```js
test('every scenario reads back through the monitor with the numbers the smoke gate expects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plo-fixture-'));
  const plans = writeScenarios(dir, { now: Date.now(), live: processStamp() });
  const mid = monitor.snapshot(plans.mid);
  assert.equal(mid.totals.done, 2);
  assert.equal(mid.totals.total, 8);
  assert.equal(Math.round(mid.totals.costUsd * 100), 620);
  const t = (s, n) => [...s.lanes.flatMap((l) => l.tasks), ...s.barriers].find((x) => x.n === n);
  assert.deepEqual(t(mid, 5).effort, { planned: 'medium', used: 'xhigh', raised: true, reason: 'fixture' });
  assert.equal(t(mid, 2).lastTest.ok, true);
  assert.equal(t(mid, 2).status, 'running');
  assert.equal(mid.usage5h.utilization, 0.84);
  assert.equal(mid.edges.length, 11);
  const barrier = monitor.snapshot(plans.barrier);
  assert.equal(barrier.runOver, true);
  assert.equal(t(barrier, 8).children.find((c) => c.id === 'tu_orph').status, 'interrupted');
  assert.ok(monitor.snapshot(plans.suite).suiteLive.lines.length > 0);
  assert.equal(monitor.snapshot(plans.review).reviewer.status, 'running');
  const idle = monitor.snapshot(plans.idle);
  assert.equal(idle.usage5h, null);
  assert.deepEqual(idle.edges, []);
  assert.equal(monitor.snapshot(plans.empty).ready, false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/fixture.test.js`
Expected: FAIL — `Cannot find module '../smoke/fixture'`.

- [ ] **Step 3: Implement `smoke/fixture.js`**

O `writeScenarios` monta cada estado com `state.create` e completa os registros à mão. Os logs `task-N.jsonl` levam eventos com `timestamp` relativo a `now`. O `up` chama o `writeScenarios` na pasta de artefatos, sobe os servidores e o proxy, acrescenta as linhas da suíte e regrava `mid`/`review`. Com `require.main === module` e `process.argv[2] === 'up'`, sobe tudo; sem isso, só exporta.

- [ ] **Step 4: Run it to see it pass**

Run: `node --test test/fixture.test.js`
Expected: PASS

- [ ] **Step 5: Write `smoke/PROJECT.md` and ignore the artifacts**

Siga `~/.claude/skills/smoke-gate/PROJECT-template.md`:
- **App:** Node `http` mais um HTML. O dev command é `node smoke/fixture.js up` em background, com a linha `READY` como sinal de boot (~1 s); base URL por cenário.
- **Dev build confirmed:** não se aplica (sem React); o CONSOLE confere zero erro.
- **Aside environment:** com o estado de movimento reduzido desta máquina. O Aside não força `prefers-reduced-motion`, então a Task 18 confere pela estrutura do CSS.
- **Auth:** `none`.
- **Data:** o fixture, num servidor que só lê. Sem rede, sem run de verdade, nunca produção.
- **Routes:** a tabela de portas acima.
- **Selector convention:** os `data-testid` das Global Constraints.
- **Clipboard:** antes de clicar num COPY, o spec troca `navigator.clipboard` por `{ writeText: (t) => { window.__copied = t; return Promise.resolve(); } }` com `Object.defineProperty`.
- **Viewport:** iframe de 390, 900 e 1200 px (o Aside não tem `setViewportSize`).
- **Known flaky:** nenhum.

O `.gitignore` ganha `smoke/.artifacts/`.

- [ ] **Step 6: Prove the gate can fail**

Suba `node smoke/fixture.js up` em background e espere o `READY`. Rode um spec descartável contra a página atual em `http://127.0.0.1:7411/`, com `CLICKABLE [data-testid=tab-STAT]` e a pós-condição `view-title` = `AGENTS`. O resultado precisa ser **FAIL** (o elemento não existe na página antiga), não BLOCKED. Anote a data e o veredito em "Bootstrap record" no `PROJECT.md`, pare o fixture e apague o spec descartável.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add smoke/fixture.js smoke/PROJECT.md .gitignore test/fixture.test.js
git commit -m "test(smoke): gerador de fixture com sete cenários e bootstrap do smoke gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:** N/A — no UI surface (this task writes the gate itself; Step 6 is its proof that it can fail)

---

### Task 12: Página: esqueleto, moldura, stream e estados derivados

**Effort:** xhigh — base de todas as abas: render por chave, stream, rotas do hash, a lista do que precisa de você e o comando certo de cada caso

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-12.js`

**Interfaces:**
- Consumes: os campos do snapshot das Tasks 7–9; `/assets/*` (Task 10); o fixture e as portas (Task 11).
- Produces, como globais do script da página, para as tasks de página seguintes:
  - `S = { snap, skew, tab, sub: { STAT, INV, DATA, MAP, RADIO }, sel: { agent, task, quest, station }, stream: 'live'|'quiet'|'reconnecting', frozen }`.
  - `VIEWS[tab][sub] = (el) => void`. Cada vista pinta no corpo, e esta task registra marcadores que só desenham o `view-title`.
  - `agents() → Agent[]`, com `Agent = { id, kind: 'task'|'barrier'|'sub'|'review'|'suite', parent, n, lane, name, role, status, silentMin, pose, alert, src }`. O `status` é o do snapshot, ou `'nosignal'` para task, barreira ou revisor em `running` calados há 6 min ou mais. A ordem é: lanes na ordem de `st.lanes` (a task, depois os subagentes dela), barreiras, e por fim o grupo do fim do run (suíte, revisor e os subagentes dele).
  - `needYou() → Item[]`, com `Item = { key, agentId, label, tag, text, command, copy }` (B §8.2), na ordem dos agentes.
  - `whatToDo(agent) → { text, command, copy } | null` (B §8.3).
  - `cmd(verb)`, `poseFor(agent)` (B §7.1), `fig(pose, height, alert, key)`, `keyed(container, items)` com `items = [{ key, sig, html }]`, `copyBtn(text, testid)`, `E(s)`, `md(src)`, `dur(ms)`, `since(iso)`, `money(x)` (`—` para `null`) e `go({ tab, sub, agent, task, quest, station })`, que atualiza `S` e o hash e redesenha.

- [ ] **Step 1: Generate `smoke/task-12.js` from the Smoke Gate block below** (smoke-gate skill, passo "Generate")

- [ ] **Step 2: Run the gate to see it fail**

Suba o fixture (`node smoke/fixture.js up`, em background, até o `READY`) e rode o gate da Task 12.
Expected: FAIL — a página antiga não tem `tab-STAT`.

- [ ] **Step 3: Rewrite `src/ui.html`**

- **CSS:** vem do protótipo (`prototipo.html:13-131`), sem a moldura do aparelho. Os tokens vão para `:root`, e `body` ganha `background: var(--ink)`. O `@font-face` da Roboto Condensed vem de `/assets/roboto-condensed.ttf` (`font-weight: 100 900`). Toda `animation` fica dentro de `@media (prefers-reduced-motion: no-preference)`. A classe `.frozen` no `body` pausa tudo: `animation-play-state: paused !important` em `.vb svg` e nos piscas; `.vb .q2 { opacity: 0 !important }` e `.vb .q1 { opacity: 1 !important }`.
- **Arranque:** o `<title>` inicial é `plo`, porque o `test/serve.test.js` confere `<title>plo`. A página busca `/assets/operador.svg` uma vez, o insere escondido no topo do `body` e só então desenha.
- **Moldura** (B §6.1):
  - A barra de abas tem as 5 abas, o título do plano, o chip `! N ALERTS` (`alerts-chip`, em âmbar, que leva a STAT › CONDITION) e o sinal do stream (`stream`). Embaixo vêm a barra de sub-abas e o corpo.
  - O rodapé tem `foot-tasks` (`TASKS feitas/total`), `foot-needyou` (`N NEED YOU`, só com N > 0), `foot-run` (texto e barra), `foot-limit`, `foot-cost` e `foot-clock`.
- **Texto do `foot-run`:**
  - com task de lane rodando, `RUN · <lanes com task rodando> LANES`;
  - senão, com a integração rodando, `END OF RUN · <MERGE|BARRIER T<n>|FULL SUITE|CROSS-LANE REVIEW> <há quanto> — not over yet`;
  - senão, com `runOver`, `RUN OVER`;
  - senão, `WAITING · <a primeira etapa de stages[] que não está done, em maiúsculas>`.

  O preenchimento é `(feitas + etapas merge/suíte/revisão feitas) / (total + 3)`.
- **`foot-limit`:** `5H LIMIT`, barra e porcentagem, com a classe `al` a partir de 0,80 e `title="resets at HH:MM"`; some quando `usage5h` é `null`.
- **Custo e relógio:** o custo é `$` mais `totals.costUsd` com duas casas. O relógio segue B §6.1: conta com `totals.active` e, sem ele, para no maior `endedAt` de tasks e etapas.
- **Stream:**
  - `EventSource('/api/stream')`; o evento `snapshot` atualiza `S.snap` e o `skew` e põe o sinal em `● LIVE`.
  - Com `error`, o sinal vira `RECONNECTING…` em âmbar, entra o `.frozen` e os relógios param. Se `readyState === EventSource.CLOSED`, a página reabre em 2000 ms.
  - Com 30 s sem snapshot, o sinal vira `QUIET <há quanto>` e não congela nada.
- **Hash:** `#tab=…&sub=…&agent=…&task=…&quest=…&station=…`. O formato antigo `#task=N` vira `tab=INV`, `sub=ALL`, `task=N`. Esc limpa `S.sel.task` e redesenha.
- **Título:** `` `${needYou().length ? '⚠ ' : ''}${done}/${total} · ${title}` ``.
- **Estado vazio** (`ready: false`): `empty-state` com a mensagem, `copyBtn(cmd('analyze'), 'copy-cmd')` e o operador `dormindo`.
- **Cópia:** o `copyText` usa `navigator.clipboard.writeText`, lido no momento do clique, quando `window.isSecureContext && navigator.clipboard`; senão, o textarea com `execCommand('copy')`, como a página antiga (`1710-1758`). O rótulo `COPIED ✓` fica 1,6 s, com borda âmbar (B §6.7).
- **`fig`:** como o protótipo (`prototipo.html:167-172`), mas o atraso negativo vem de um hash do `key`, não de um contador, para o mesmo boneco manter o atraso quando é redesenhado. `.al` pinta em âmbar.
- **`keyed`:** reaproveita o filho `[data-key]` cujo `data-sig` não mudou (B §9.4). Os `[data-since]` só trocam o texto.
- **Da página antiga:** `md`/`mdInline` (`1247-1332`), `dur` (`1341`), `relPlan` e `cmd` (`1759-1763`), `humanize` (`1673`, o "doing"), `queueAfter` (`1831`), `outcomeOf` (`1851`), `BARRIER_TIP` (`1446`), `EDIT_TOOLS`/`feedText`/`feedMatch` (`2315-2325`) e `hashTask` (`2441`).
- **Dados:** a tabela de B §8.3 entra como dado, com o verbo certo: `resume` para lane, `integrate` para barreira e integração, `analyze` para plano mudado. Com revisão com ressalvas, o COPY leva `review.reportFile`.

- [ ] **Step 4: Run the gate to see it pass**

Run: o gate da Task 12, com o fixture no ar.
Expected: PASS em S12-1 … S12-12.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-12.js
git commit -m "feat(painel): esqueleto do painel do operador — abas, rodapé, stream e estados derivados" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7411/` (mid); também 7414, 7415, 7416 e 7417
- **Reach state:** `node smoke/fixture.js up` em background até a linha `READY`; abrir a rota e esperar `[data-testid=stream]` com `● LIVE`
- **Assertions:**
  - [ ] S12-1 `CLICKABLE` `[data-testid=tab-INV]`, `tab-DATA`, `tab-MAP`, `tab-RADIO` e `tab-STAT`, nessa ordem → post: `[data-testid=view-title]` vira `ALL`, `QUESTS`, `LANES`, `STATIONS` e `AGENTS`, e `location.hash` contém `tab=<TAB>`
  - [ ] S12-2 `CLICKABLE` cada `[data-testid=sub-<SUB>]` das cinco abas (12 sub-abas) → post: `view-title` igual ao nome da sub-aba
  - [ ] S12-3 `CLICKABLE` `[data-testid=alerts-chip]`, com o texto `! 2 ALERTS` → post: `view-title` = `CONDITION` e o hash contém `tab=STAT&sub=CONDITION`
  - [ ] S12-4 `CHECK` rodapé na 7411: `foot-tasks` = `TASKS 2/8`; `foot-needyou` = `2 NEED YOU`; `foot-run` começa com `RUN · 3 LANES`; `foot-limit` contém `84%` e tem a classe `al`; `foot-cost` = `$6.20`; `document.title` = `⚠ 2/8 · Operator fixture`
  - [ ] S12-5 `CHECK` `foot-clock` muda entre duas leituras feitas com 2 s de intervalo na 7411
  - [ ] S12-6 `CHECK` abrir `http://127.0.0.1:7411/#task=4` deixa `[data-testid=tab-INV]` com `aria-selected="true"`, e o hash com `task=4`
  - [ ] S12-7 `CHECK` 7414: `foot-run` = `RUN OVER`. 7417 (forma antiga): `foot-run` = `WAITING · MERGE`, sem `foot-limit`, e o console sem erro
  - [ ] S12-8 `CHECK` 7415: `[data-testid=empty-state]` visível, com `plo analyze` no texto, `[data-testid=copy-cmd]` presente e um `.vb` com `<use href="#op-dormindo-1">`
  - [ ] S12-9 `CLICKABLE` `[data-testid=copy-cmd]` na 7415, com o clipboard trocado pelo coletor → post: rótulo `COPIED ✓`, e `window.__copied` começa com `plo analyze --plan ` e termina com `smoke/.artifacts/fixtures/empty/plan.md`
  - [ ] S12-10 `CHECK` 7416 aberta em `#tab=STAT&agent=T2`. Depois de `fetch('/__fixture/drop')`, em até 4 s: `[data-testid=stream]` = `RECONNECTING…`, `body.frozen`, todo `.vb .q2` com opacidade computada `0`, toda animação de `.vb svg` com `playState === 'paused'` e `foot-clock` igual em duas leituras com 2 s de intervalo. Em até 15 s: volta `● LIVE`, sem `frozen`, e o hash ainda contém `agent=T2`
  - [ ] S12-11 `CONSOLE` zero erros na 7411, 7414, 7415, 7416 e 7417
  - [ ] S12-12 `SHOT` estados: `mid-stat`, `condition`, `empty`, `reconnecting`, `idle`

---

### Task 13: STAT — AGENTS e CONDITION

**Effort:** high — tela com smoke gate, cinco tipos de agente e a seleção presa ao id

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-13.js`

**Interfaces:**
- Consumes: `S`, `VIEWS`, `agents()`, `needYou()`, `whatToDo()`, `poseFor()`, `fig()`, `keyed()`, `copyBtn()`, `since()`, `money()` e `go()` (Task 12).
- Produces: `VIEWS.STAT.AGENTS` e `VIEWS.STAT.CONDITION`.

- [ ] **Step 1: Generate `smoke/task-13.js` from the Smoke Gate block below**

- [ ] **Step 2: Run the gate to see it fail**

Expected: FAIL — `hero-name` does not exist yet.

- [ ] **Step 3: Implement AGENTS and CONDITION** (B §6.2, layout de `viewAgentes`/`viewCondicao` em `prototipo.html:270-324`)

- **AGENTS** tem três colunas:
  - **Lista:** botões `agent-<id>` agrupados por `LANE A · T2 Panel shell`, com os subagentes indentados embaixo; depois `BARRIERS`; depois `END OF RUN` (suíte e revisor com os subagentes dele). O `END OF RUN` aparece quando a suíte ou a revisão começam e fica até um `runOver` sem item em `needYou()`. Na linha, um NO SIGNAL leva a etiqueta tracejada em âmbar.
  - **Herói:** `fig(pose, 240, alert, id)`, `hero-name`, `hero-tag`, o "doing" e os cinco números de B §6.2. Para `hero-name`:
    - task ou barreira: `T<n> · CONTROLLER`;
    - subagente: `T<n> · <AGENTTYPE em maiúsculas>`;
    - revisor: `CROSS-LANE REVIEW`;
    - subagente do revisor: `REVIEW · <AGENTTYPE>`;
    - suíte: `FULL SUITE`.

    `EFFORT` mostra `used ?? planned`, com ` ↑` quando `raised`; `—` vale para o dado que não existe.
  - **Detalhes:**
    - `whattodo` com `copyBtn(command, 'copy-cmd')`;
    - LAST ACTIONS;
    - SUBAGENTS;
    - o cartão da task com `open in INV` (`go({ tab: 'INV', task })`) e `see quest` (`go({ tab: 'DATA', sub: 'QUESTS', quest })`);
    - na suíte, `live-output` com `suiteLive.lines` e o link para o RADIO.
  - **Seleção:** `S.sel.agent`, ou o primeiro de `needYou()` com `agentId`, ou o primeiro rodando. Fica presa ao id entre snapshots.
  - **Lista vazia:** o operador `dormindo`, `nobody working — waiting on <etapa em minúsculas>` e o COPY do comando de B §8.3.
- **CONDITION:**
  - No centro, `fig(needYou().length ? 'travado' : 'orgulho', 280, …)`.
  - As lanes alternam esquerda e direita como botões `cond-lane-<ID>`, com `feitas/total` ou o estado da task parada. O clique vai a AGENTS com a task atual da lane selecionada.
  - Embaixo vêm o fim do run e a próxima barreira (ou `no barrier`), e a lista `alert-<i>` de `needYou()`: etiqueta, texto e `copyBtn(command, 'copy-alert-<i>')` quando há comando.

- [ ] **Step 4: Run the gate to see it pass**

Expected: PASS em S13-1 … S13-17.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-13.js
git commit -m "feat(painel): STAT — agentes com herói e detalhes, e a tela de condição com os alertas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7411/#tab=STAT&sub=AGENTS`; também 7412, 7413, 7414, 7416 e 7417
- **Reach state:** fixture no ar (`READY`); `● LIVE`; clipboard trocado pelo coletor antes de cada COPY
- **Assertions:**
  - [ ] S13-1 `CHECK` 7411 sem `agent` no hash: `[data-testid=hero-name]` contém `T5` (o primeiro que precisa de você)
  - [ ] S13-2 `CLICKABLE` `[data-testid=agent-T2]` → post: `hero-name` = `T2 · CONTROLLER`, e o hash contém `agent=T2`
  - [ ] S13-3 `CLICKABLE` `[data-testid=agent-tu_impl]` → post: `hero-name` = `T2 · IMPLEMENTER`, e o hash contém `agent=tu_impl`
  - [ ] S13-4 `CHECK` herói da T2: `EFFORT high`, `TRY 1/3`, `COST —`, e um `use` com `href="#op-trabalhando-1"`
  - [ ] S13-5 `CHECK` `#tab=STAT&agent=T5`: `EFFORT xhigh ↑`, `TRY 3/3`, `COST $2.30`; `[data-testid=whattodo]` contém `Expected 4 teams, got 3.` e `plo resume --plan smoke/.artifacts/fixtures/mid/plan.md`; operador `.vb.al` com `#op-falhou-1`
  - [ ] S13-6 `CLICKABLE` `[data-testid=copy-cmd]` no herói da T5 → post: rótulo `COPIED ✓` e `window.__copied` = `plo resume --plan smoke/.artifacts/fixtures/mid/plan.md`
  - [ ] S13-7 `CHECK` a linha `agent-T7` tem a etiqueta `NO SIGNAL`, tracejada e em âmbar. Selecionada, `whattodo` bate com `/^no event for 2\d min — last: /`, e o operador usa `#op-dormindo-1`. `agent-T6` também tem `NO SIGNAL`
  - [ ] S13-8 `CLICKABLE` `[data-testid=sub-CONDITION]` → post: o centro tem `#op-travado-1`; há quatro `[data-testid^=cond-lane-]` e exatamente dois `[data-testid^=alert-]`, um com `T5` e um com `T7`, nenhum com `T6`; o alerta da T5 tem um COPY
  - [ ] S13-9 `CLICKABLE` `[data-testid=cond-lane-B]` → post: `view-title` = `AGENTS`, e `hero-name` contém `T5`
  - [ ] S13-10 `CHECK` 7417: AGENTS mostra `nobody working — waiting on merge` com `#op-dormindo-1`, e o `copy-cmd` leva `plo integrate --plan smoke/.artifacts/fixtures/idle/plan.md`; CONDITION mostra `#op-orgulho-1` e nenhum alerta
  - [ ] S13-11 `CHECK` 7413: o grupo `END OF RUN` tem `agent-review` e `agent-tu_rv`. Com `agent-review` selecionado: `hero-name` = `CROSS-LANE REVIEW`, `EFFORT inherited`, `COST —` e `#op-revisando-1`. O `agent-tu_rv` também usa `#op-revisando-1`
  - [ ] S13-12 `CHECK` 7412 com `agent-suite`: `hero-name` = `FULL SUITE`, `COMMAND npm test`; o número de `LINES` cresce entre duas leituras com 2 s de intervalo; `[data-testid=live-output]` tem linhas e nenhum `\u001b`
  - [ ] S13-13 `CHECK` 7414 com `agent-T8`: `whattodo` contém `plo integrate --plan smoke/.artifacts/fixtures/barrier/plan.md` e não contém `plo resume`; a linha `agent-tu_orph` tem a etiqueta `INTERRUPTED` e `#op-dormindo-1`
  - [ ] S13-14 `CHECK` 7416 com `#tab=STAT&agent=T2`: depois de `fetch('/__fixture/drop')` e da volta do `● LIVE`, `hero-name` continua `T2 · CONTROLLER`
  - [ ] S13-15 `CHECK` 7412 com `agent-suite`: o `.vb` do herói é o mesmo nó (`===`) antes e depois de 3 s com o stream entregando snapshots
  - [ ] S13-16 `CONSOLE` zero erros na 7411, 7412, 7413, 7414 e 7417
  - [ ] S13-17 `SHOT` estados: `agents-t5`, `agents-t2-impl`, `agents-review`, `agents-suite`, `condition`, `idle-empty`

---

### Task 14: INV — tabela e ficha da task

**Effort:** high — tela com smoke gate, ficha com todos os campos de hoje mais esforço e tentativas, e o erro escapado

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-14.js`

**Interfaces:**
- Consumes: `S`, `VIEWS`, `agents()`, `whatToDo()`, `keyed()`, `copyBtn()`, `md()`, `dur()`, `money()`, `go()`, `queueAfter()` e `BARRIER_TIP` (Task 12).
- Produces: `VIEWS.INV.ALL`, `PROBLEMS`, `RUNNING`, `QUEUE` e `DONE`.

- [ ] **Step 1: Generate `smoke/task-14.js` from the Smoke Gate block below**

- [ ] **Step 2: Run the gate to see it fail**

Expected: FAIL — `row-T1` does not exist yet.

- [ ] **Step 3: Implement INV** (B §6.3, layout de `viewInv` em `prototipo.html:325-351`)

- **Filtros:**
  - PROBLEMS: tasks cujo agente está `failed`, `blocked`, `needs-verify`, `interrupted` ou `nosignal`;
  - RUNNING: `running` e `nosignal`;
  - QUEUE: `pending`, com a coluna `WAITING ON` (`queueAfter`);
  - DONE: `done`.
- **Tabela:** linhas `row-T<n>` com as colunas `T`, `NAME`, `LANE` (`BARRIER` com `title` = `BARRIER_TIP`), `EFFORT`, `TRIES`, `TIME`, `$` e estado. A linha selecionada leva a classe `sel`.
- **Ficha `record`:** busca `/api/task?n=<n>` ao selecionar, e de novo quando muda o status, o `attempts` ou o `turns` da task no snapshot. Traz todos os campos da ficha de hoje (`git show 3972d43:src/ui.html`, `2363-2419`):
  - status, lane, duração, turnos, tentativas, tokens e modelo;
  - sessão com `copy-session` e log com `copy-log`;
  - commits, o resultado do agente (`md`), as escritas declaradas, as excluídas, os passos do plano e a atividade.
- **Ficha, mais:**
  - `record-effort`: nível, origem (`used`/`planned`), seta e motivo;
  - `record-tries`: `medium failed › high failed › xhigh failed`, com `<nível> running` no fim quando a task roda;
  - `error-block` (`ERROR`, ou `WHY IT STOPPED` para `blocked`), em âmbar, com `md(error)` e `copyBtn(errorInteiro, 'copy-error')`;
  - `copy-cmd` com o comando de `whatToDo()`.
- **Teclado:** Esc fecha a ficha.

- [ ] **Step 4: Run the gate to see it pass**

Expected: PASS em S14-1 … S14-12.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-14.js
git commit -m "feat(painel): INV — tabela de tasks com filtros e a ficha completa com esforço e tentativas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7411/#tab=INV`; também 7414
- **Reach state:** fixture no ar; `● LIVE`; clipboard trocado pelo coletor
- **Assertions:**
  - [ ] S14-1 `CHECK` ALL tem as linhas `row-T1` … `row-T8`; a coluna LANE da `row-T8` diz `BARRIER`, com `title` igual ao `BARRIER_TIP`
  - [ ] S14-2 `CLICKABLE` `[data-testid=sub-PROBLEMS]` → post: as linhas são exatamente T5, T6 e T7
  - [ ] S14-3 `CLICKABLE` `[data-testid=sub-RUNNING]` → post: T2, T6 e T7. `sub-QUEUE` → T3 com `WAITING ON` `after T2` e T8 com `after the merge`. `sub-DONE` → T1 e T4
  - [ ] S14-4 `CLICKABLE` `[data-testid=row-T5]` → post: `[data-testid=record]` contém `T5 · Counts per team`, a linha leva a classe `sel`, e o hash contém `task=5`
  - [ ] S14-5 `CHECK` `[data-testid=error-block]` mostra `<img src=x onerror="window.__xss=1">` como texto; `document.querySelector('[data-testid=error-block] img')` é `null`; `window.__xss` é `undefined`
  - [ ] S14-6 `CLICKABLE` `[data-testid=copy-error]` → post: rótulo `COPIED ✓`, e `window.__copied` é igual a `(await (await fetch('/api/task?n=5')).json()).task.error`
  - [ ] S14-7 `CHECK` ficha da T5: `record-effort` contém `xhigh`, `used`, `↑` e `fixture`; `record-tries` = `medium failed › high failed › xhigh failed`; `copy-session` e `copy-log` presentes
  - [ ] S14-8 `CHECK` ficha da T2: `record-tries` termina com `high running`
  - [ ] S14-9 `CHECK` com a T5 aberta, `Escape` some com `[data-testid=record]`, e o hash perde o `task=`
  - [ ] S14-10 `CHECK` abrir `http://127.0.0.1:7411/#task=4` mostra a ficha da T4
  - [ ] S14-11 `CHECK` 7414 com `#tab=INV&task=8`: `error-block` com COPY, e `copy-cmd` leva `plo integrate --plan smoke/.artifacts/fixtures/barrier/plan.md`
  - [ ] S14-12 `CONSOLE` zero erros; `SHOT` estados: `inv-all`, `inv-t5`, `inv-queue`, `inv-barrier`

---

### Task 15: DATA — QUESTS, LOG e NUMBERS

**Effort:** high — três sub-abas, o feed com busca e filtros, e as contas do painel de números

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-15.js`

**Interfaces:**
- Consumes: `S`, `VIEWS`, `agents()`, `keyed()`, `copyBtn()`, `md()`, `dur()`, `money()`, `go()`, `outcomeOf()`, `EDIT_TOOLS`, `feedText()` e `feedMatch()` (Task 12).
- Produces: `VIEWS.DATA.QUESTS`, `LOG` e `NUMBERS`.

- [ ] **Step 1: Generate `smoke/task-15.js` from the Smoke Gate block below**

- [ ] **Step 2: Run the gate to see it fail**

Expected: FAIL — `quest-T2` does not exist yet.

- [ ] **Step 3: Implement DATA** (B §6.4, layout de `viewMissoes`/`viewRegistro`/`viewNumeros` em `prototipo.html:352-392`)

- **QUESTS:**
  - `IN PROGRESS` reúne as rodando e as paradas; depois vêm `QUEUED` e `DONE`. Os botões são `quest-T<n>`.
  - A missão selecionada busca `/api/task?n=` e lista em `objectives` os `steps` do plano, cada um com o checkbox.
  - Task parada mostra o bloco `WHY IT STOPPED` com `copy-error`.
- **LOG:**
  - O `snapshot.feed` e o `reviewer.activity` (quem: `review`) se intercalam por hora, em linhas `log-row`: hora, quem (`T7 › implementer`, `review`), ferramenta e alvo.
  - Os controles são `log-search`; `log-filter-all`, `log-filter-errors`, `log-filter-bash` e `log-filter-edits` (o filtro `errors` dá a classe `err` às linhas); e `log-wrap`, que liga a classe `wrap` na lista.
  - As linhas da suíte não entram.
- **NUMBERS:**
  - `numbers-lanecost`: custo por lane em barras, com a soma dos `costUsd` das tasks da lane (`—` quando nenhuma tem custo).
  - `numbers-stages`: a duração de cada etapa por `startedAt`/`endedAt`, `running` enquanto roda, e `not run — no test command` para a suíte pulada.
  - `numbers-effort`: a contagem planejada por nível (`effort.planned`, com as herdadas como `inherited`) e `raised N`.
  - `numbers-run`: `base branch @ commit` (7 caracteres), comando de teste, `lanes · max N`, relógio contra tempo de agente, ganho ×, tokens, commits, suíte e veredito da revisão (`outcomeOf`).
  - O "tempo parado esperando gente" do protótipo não entra.

- [ ] **Step 4: Run the gate to see it pass**

Expected: PASS em S15-1 … S15-9.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-15.js
git commit -m "feat(painel): DATA — missões com os passos do plano, registro do run e números" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7411/#tab=DATA&sub=QUESTS`; também 7413
- **Reach state:** fixture no ar; `● LIVE`
- **Assertions:**
  - [ ] S15-1 `CHECK` QUESTS tem `IN PROGRESS` com T2, T5, T6 e T7; `QUEUED` com T3 e T8; `DONE` com T1 e T4
  - [ ] S15-2 `CLICKABLE` `[data-testid=quest-T2]` → post: `[data-testid=objectives]` tem 3 itens, `Write the failing test`, `Implement the shell` e `Commit`, e o hash contém `quest=2`
  - [ ] S15-3 `CLICKABLE` `[data-testid=quest-T5]` → post: o bloco `WHY IT STOPPED` aparece com `[data-testid=copy-error]`
  - [ ] S15-4 `CHECK` LOG na 7411 tem 5 ou mais `[data-testid=log-row]`. Depois de digitar `npm test` em `[data-testid=log-search]`, toda linha visível contém `npm test`, e a contagem é ≥ 1 e menor que a inicial
  - [ ] S15-5 `CLICKABLE` `[data-testid=log-filter-errors]` → post: toda linha visível tem a classe `err`, com pelo menos uma. `CLICKABLE` `[data-testid=log-wrap]` → post: a lista tem a classe `wrap`
  - [ ] S15-6 `CHECK` LOG na 7413 tem pelo menos uma linha cujo "quem" é `review`
  - [ ] S15-7 `CHECK` NUMBERS na 7411: `numbers-run` contém `feature/fixture @ abc1234`, `npm test` e `4 · max 4`; `numbers-effort` contém `medium 4`, `high 3`, `xhigh 1` e `raised 1`; `numbers-lanecost` mostra `$0.80` na lane A e `$5.40` na lane B
  - [ ] S15-8 `CHECK` NUMBERS na 7413: em `numbers-stages`, a linha do merge mostra `30s`, a da suíte mostra `1m`, e a da revisão, `running`
  - [ ] S15-9 `CONSOLE` zero erros; `SHOT` estados: `quests-t2`, `quests-t5`, `log-filtered`, `numbers`

---

### Task 16: MAP — o mapa de missão

**Effort:** high — posição dos nós pelo caminho mais longo, só as arestas entre lanes, cliques para INV e RADIO

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-16.js`

**Interfaces:**
- Consumes: `S`, `VIEWS`, `agents()`, `poseFor()`, `fig()`, `keyed()` e `go()` (Task 12); `snapshot.edges` (Task 9).
- Produces: `VIEWS.MAP.LANES`.

- [ ] **Step 1: Generate `smoke/task-16.js` from the Smoke Gate block below**

- [ ] **Step 2: Run the gate to see it fail**

Expected: FAIL — `node-T1` does not exist yet.

- [ ] **Step 3: Implement MAP** (B §6.5, desenho de `viewMap` em `prototipo.html:393-428`)

- **Trilhas e colunas:** cada lane é uma trilha, na ordem de `st.lanes`. A coluna de cada task é o caminho mais longo até ela, num grafo com as arestas de `edges` entre tasks de lane e uma aresta implícita de cada task para a seguinte na mesma lane. Arestas de tasks fora das lanes, como as já feitas antes do `init`, ficam de fora.
- **Fim da trilha:** depois da maior coluna vêm `node-MERGE`, as barreiras em ordem (`node-T<n>`), `node-SUITE` e `node-REVIEW`.
- **Arestas desenhadas:** só as de `edges` entre lanes diferentes, tracejadas, como `[data-testid=map-edge]` com `data-from`/`data-to`.
- **Nós:**
  - as classes são `done`, `run` (pisca), `al` (parado) e `pend`;
  - nó rodando ou parado leva `fig(pose, 44, alert, id)` em cima; `SUITE` e `REVIEW` também, enquanto rodam;
  - clique numa task vai a `go({ tab: 'INV', task })`; em `SUITE`, a `go({ tab: 'RADIO', station: 'suite' })`; em `REVIEW`, a `go({ tab: 'RADIO', station: 'review' })`.
- **Legenda:** as cinco poses.
- **Largura:** o mapa rola na horizontal e não encolhe os nós.

- [ ] **Step 4: Run the gate to see it pass**

Expected: PASS em S16-1 … S16-8.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-16.js
git commit -m "feat(painel): MAP — trilhas por lane, arestas entre lanes e o fim do run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7411/#tab=MAP`; também 7412 e 7413
- **Reach state:** fixture no ar; `● LIVE`
- **Assertions:**
  - [ ] S16-1 `CHECK` existem `node-T1` … `node-T7`, `node-MERGE`, `node-T8`, `node-SUITE` e `node-REVIEW`, e exatamente um `[data-testid=map-edge]`, com `data-from="4"` e `data-to="3"`
  - [ ] S16-2 `CHECK` colunas, pelo `x` do `getBoundingClientRect()`: `x(T1) < x(T2) < x(T3)`, `x(T4) === x(T1)` e `x(T5) === x(T2)`
  - [ ] S16-3 `CHECK` classes: `node-T1` `done`, `node-T2` `run`, `node-T5` `al`, `node-T3` `pend`. Há operadores sobre T2, T5, T6 e T7, e nenhum sobre T1 ou T3
  - [ ] S16-4 `CLICKABLE` `[data-testid=node-T5]` → post: `tab-INV` com `aria-selected="true"`, e `[data-testid=record]` contém `T5`
  - [ ] S16-5 `CLICKABLE` `[data-testid=node-SUITE]` → post: `tab-RADIO` selecionada, `[data-testid=station-suite]` com `aria-pressed="true"`, e o hash contém `station=suite`
  - [ ] S16-6 `CHECK` 7412 tem um `.vb` com `#op-trabalhando-1` sobre `node-SUITE`; 7413 tem `#op-revisando-1` sobre `node-REVIEW`
  - [ ] S16-7 `CHECK` a legenda tem os usos `#op-trabalhando-1`, `#op-travado-1`, `#op-falhou-1`, `#op-dormindo-1` e `#op-orgulho-1`
  - [ ] S16-8 `CONSOLE` zero erros; `SHOT` estados: `map-mid`, `map-suite`, `map-review`

---

### Task 17: RADIO — as estações e a onda

**Effort:** high — onda viva só no ar, estouro por linha nova, e a medida de amplitude no gate

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-17.js`

**Interfaces:**
- Consumes: `S`, `VIEWS`, `keyed()`, `E()` e `go()` (Task 12); `suiteLive`, `reviewer` e `tasks[].lastTest` (Tasks 8 e 9).
- Produces: `VIEWS.RADIO.STATIONS`.

- [ ] **Step 1: Generate `smoke/task-17.js` from the Smoke Gate block below**

- [ ] **Step 2: Run the gate to see it fail**

Expected: FAIL — `station-suite` does not exist yet.

- [ ] **Step 3: Implement RADIO** (B §6.6, desenho de `viewRadio` e eixo `SCOPE_AXES` em `prototipo.html:161-166` e `429-450`)

- **Estações** (B §6.6), como botões com `aria-pressed`:
  - `station-suite` (`FULL SUITE`) e `station-review` (`CROSS-LANE REVIEW`) estão sempre na lista.
  - Há uma `station-T<n>` por task em `running` com `lastTest`.
  - A saída vai em `radio-out`: na suíte, `suiteLive.lines`, depois o `integration.suite.summary` com o resultado, e antes de tudo `no signal — starts after the merge`; na revisão, uma linha por evento do revisor; na task, o comando, `running`/`pass`/`fail` e o `lastTest.tail`.
  - No ar, um marcador `ON AIR`.
- **Onda:** a `<polyline id="wv">` fica num `<svg viewBox="0 0 400 160" preserveAspectRatio="none">` com o eixo em L. O algoritmo é o do protótipo (`prototipo.html:503-522`), com três mudanças:
  - `live` vem de a estação selecionada estar no ar;
  - a "linha nova" de B §6.6 põe `burst = 1` (na suíte, o número de linhas cresceu; na revisão, evento novo; na task, `lastTest.at` mudou ou o resultado chegou);
  - o estouro aleatório vale para toda estação no ar que não é a suíte.
- **Quando a onda anda:** o laço de 50 ms só roda com a aba RADIO aberta, `document.visibilityState === 'visible'` e sem `S.frozen`; com `S.frozen`, a onda fica reta. Com `matchMedia('(prefers-reduced-motion: reduce)').matches`, não há laço: a onda é desenhada uma vez por linha nova.

- [ ] **Step 4: Run the gate to see it pass**

Expected: PASS em S17-1 … S17-8.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-17.js
git commit -m "feat(painel): RADIO — estações ao vivo e a onda que só anda no ar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7412/#tab=RADIO&station=suite`; também 7411 e 7413
- **Reach state:** fixture no ar; `● LIVE`; aba visível
- **Assertions:**
  - [ ] S17-1 `CHECK` 7411 tem `station-suite`, `station-review` e `station-T2`, e não tem `station-T6` nem `station-T7`. Com `station-suite` selecionada, `radio-out` contém `no signal — starts after the merge`
  - [ ] S17-2 `CLICKABLE` `[data-testid=station-T2]` na 7411 → post: `[data-testid=radio-out]` contém `npm test -- panel` e `pass`, há um marcador `ON AIR` visível, e o hash contém `station=T2`
  - [ ] S17-3 `CHECK` 7412 com `station-suite`. A medida é a amplitude pico a pico dos 80 primeiros pontos de `#wv`, em unidades do viewBox. Depois que o número de linhas de `radio-out` cresce, ela passa de 30 em pelo menos uma de 10 amostras seguidas, a cada 50 ms
  - [ ] S17-4 `CHECK` 7412 com `station-review` (fora do ar): a mesma medida fica em 2 ou menos nas 10 amostras
  - [ ] S17-5 `CHECK` 7412 `radio-out`: nenhum `\u001b`; contém `progress 100%` e não contém `progress 10%`
  - [ ] S17-6 `CHECK` 7413 com `station-review` no ar: `radio-out` tem pelo menos 3 linhas
  - [ ] S17-7 `CHECK` o `<svg>` de `#wv` tem `viewBox="0 0 400 160"` e um `path.ax`
  - [ ] S17-8 `CONSOLE` zero erros; `SHOT` estados: `radio-suite-onair`, `radio-review-offair`, `radio-t2`

---

### Task 18: Larguras, movimento reduzido, quadros do operador e a passada final

**Effort:** high — três larguras, regra estrutural de movimento reduzido e a conferência dos quadros em todas as telas

**Files:**
- Modify: `src/ui.html`
- Create: `smoke/task-18.js`

**Interfaces:**
- Consumes: todas as vistas (Tasks 12–17).
- Produces: o layout de B §6.9 e a página final.

- [ ] **Step 1: Generate `smoke/task-18.js` from the Smoke Gate block below**

- [ ] **Step 2: Run the gate to see it fail**

Expected: FAIL in S18-1 or S18-2 (sem os pontos de quebra, a 390 px há rolagem horizontal).

- [ ] **Step 3: Implement the breakpoints and close the pass** (B §6.9)

- A partir de 1100 px, vale o layout do protótipo.
- De 700 a 1099 px, STAT fica em duas colunas, com os detalhes embaixo do herói, e INV mostra a ficha embaixo da tabela.
- Abaixo de 700 px, tudo vira uma coluna: as abas rolam na horizontal, o rodapé ocupa duas linhas, e o mapa rola sem encolher.
- Confira que toda `animation` está dentro de `@media (prefers-reduced-motion: no-preference)` e que nenhuma URL fora de `/` e `/assets/` aparece no arquivo.

- [ ] **Step 4: Run the gate to see it pass**

Expected: PASS em S18-1 … S18-7.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui.html smoke/task-18.js
git commit -m "feat(painel): larguras de 390 a 1100 px, movimento reduzido e passada final" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Smoke Gate:**
- **Route:** `http://127.0.0.1:7411/`, também em iframe de 390, 900 e 1200 px; e 7413
- **Reach state:** fixture no ar; `● LIVE`; os iframes são da mesma origem e são criados pelo spec
- **Assertions:**
  - [ ] S18-1 `CHECK` iframe de 390 px, para cada `#tab=STAT|INV|DATA|MAP|RADIO`: `contentDocument.documentElement.scrollWidth <= 390`. No MAP, o contêiner do mapa tem `scrollWidth > clientWidth`
  - [ ] S18-2 `CHECK` iframe de 900 px: em `#tab=STAT&agent=T5`, o topo dos detalhes fica no fundo do herói ou abaixo dele; em `#tab=INV&task=5`, o topo de `record` fica no fundo da tabela ou abaixo dele
  - [ ] S18-3 `CHECK` iframe de 1200 px em `#tab=STAT&agent=T5`: a borda esquerda dos detalhes fica na borda direita do herói ou depois dela (três colunas)
  - [ ] S18-4 `CHECK` quadros na 7411 (STAT, CONDITION e MAP) e na 7413 (STAT). As animações de `.vb svg` são pausadas e postas em `currentTime` de 0 a 3200 ms, de 97 em 97. Em cada instante, cada `.vb` tem exatamente um de `.q1`/`.q2` com opacidade computada `1`, e todo `use` tem `getBBox().width > 0`. Se esta máquina estiver com movimento reduzido, não há animação, e cada `.vb` mostra só o `.q1`; isso fica anotado no SMOKE.md
  - [ ] S18-5 `CHECK` movimento reduzido, pela estrutura: todo `CSSStyleRule` da página cujo `animation-name` não é `none` está dentro de um `CSSMediaRule` cuja condição contém `prefers-reduced-motion: no-preference`
  - [ ] S18-6 `CHECK` depois de passar por todas as abas na 7411, todo `performance.getEntriesByType('resource')` tem `name` começando com `http://127.0.0.1:7411/`
  - [ ] S18-7 `CONSOLE` zero erros; `SHOT` estados: `w390-stat`, `w390-map`, `w900-stat`, `w1200-stat`
