# Esforço por task e visibilidade do fim do run — desenho

> **Status:** aguardando aprovação. Branch `feat/esforco-e-painel-pipboy`.
> **Documento irmão:** o painel Pip-Boy (documento B), desenhado em paralelo
> na mesma branch. Este documento diz **o que** a página precisa mostrar —
> os dados no snapshot do `monitor` e os estados. **Como** aparece é do B.

Conferido em `main` @ `3972d43`. As citações `arquivo:linha` abaixo são desse
commit.

---

## 1. Por que

Os runs do `plo` estão levando horas. A medição de 22/10/2026 sobre 117 tasks
e 39 h de tempo de task (logs `.plo-logs/task-N.jsonl` de 12 planos, segundo a
segundo) mostra para onde vai esse tempo:

| Onde | Fatia do tempo ativo |
|---|---|
| Modelo pensando e escrevendo | **~81%** — controladora 36%, implementador 25%, revisor 17% |
| Testes, build, lint, typecheck | 11% |
| Smoke, reset de banco, dev server | 4% |
| Espera cega (`sleep 300` da controladora) | 4% |

O minuto por task acompanha o output de Opus por task: takz 1.29 fez 118k
tokens em 46 min/task, o combate do zombiegame fez 23k em 11 min/task. Cerca de
metade desse output é thinking. **Nenhuma task escolhe quanto pensar:** o
`~/.claude/settings.json` tem `effortLevel: xhigh`, o `buildArgs` não passa
esforço (`src/spawn.js:23-32`), e todo processo herda xhigh — a task que
renomeia um campo pensa tanto quanto a que desenha uma migração.

O segundo problema é o fim do run. Depois que a última task termina, o
`plo integrate` ainda faz merge, roda a suíte completa e dispara a revisão entre
lanes. A revisão levou de 4,7 a 7,1 min nas quatro rodadas do zombiegame e
9,0 min no revo setores; a suíte, de 1 a 3 min (o vitest do takz, ~3 min). São
de 5 a 12 minutos em que o painel diz que acabou:

- O estado só é gravado quando cada etapa **termina** (`src/integrate.js:268-313`).
  Merge, suíte e revisão não escrevem nada ao começar. A exceção são as
  barreiras, que gravam `running` antes de rodar (`src/integrate.js:117-120`) —
  por isso elas já aparecem.
- No `monitor`, suíte e revisão só conhecem `pending`, `done` e `failed`
  (`src/monitor.js:538-549`). "Rodando" não existe para elas.
- `totals.active` só conta tasks em `running` (`src/monitor.js:716`). Com todas
  as tasks feitas, a página escreve "All N tasks done" com o ícone de concluído
  (`src/ui.html:1984-1996`), o relógio congela no fim da última task
  (`src/ui.html:2589`), e a faixa de etapas diz "waiting on cross-lane review"
  (`src/ui.html:2063-2071`) — que lê como fila, não como trabalho.
- A suíte roda com `execSync` (`src/integrate.js:27-29`, chamado em
  `src/integrate.js:174`): o texto só existe quando ela termina, e o estado
  guarda as últimas 40 linhas (`src/integrate.js:175`).
- O revisor escreve `.plo-logs/cross-lane-review.jsonl`
  (`src/integrate.js:229`), mas o `monitor` nunca lê esse arquivo.

---

## 2. O que o usuário decidiu

- **Opus em tudo.** O modelo não varia por task; só o esforço varia.
- **O esforço é decidido depois da spec, por task, pela complexidade.** Quem
  escreve o plano marca cada task; o `plo` lê e aplica.
- **Ver a saída dos testes ao vivo** durante a suíte completa — não só o tempo
  decorrido.
- **Ver que merge, suíte e revisão estão rodando**, em vez de o painel parecer
  terminado.
- **O painel ganha cara nova (Pip-Boy) no mesmo pacote** — o documento B. Os
  dois são construídos juntos.

---

## 3. Metas, não-metas, anti-metas

**Metas**

1. Cada task roda com o esforço que o plano marcou para ela, visto e aprovado
   no portão do `plo analyze`.
2. Do fim da última task até o fim do `integrate`, o snapshot sempre diz qual
   etapa está rodando, desde quando, e o que ela está fazendo.
3. A saída da suíte completa chega ao snapshot enquanto a suíte roda.
4. Um `integrate` que morreu nunca aparece como rodando.

**Não-metas**

- Trocar o modelo por task. Opus em tudo foi decisão do usuário.
- Mostrar ao vivo os testes que os agentes rodam **dentro** das tasks. Esses já
  aparecem como chamadas de Bash no log da task; este documento trata da suíte
  que o próprio `plo` roda.
- Cortar a espera cega, o pre-flight da controladora ou as suítes repetidas.
  Saíram da medição, mas são outro trabalho.
- Redesenhar a página. É do documento B.

**Anti-metas** — o que faria isto falhar mesmo funcionando:

- Uma task rodar com um esforço diferente do que o portão mostrou.
- Uma task sem a linha de esforço mudar de comportamento. Sem marcação, roda
  exatamente como hoje.
- O painel declarar o run concluído enquanto a revisão ainda trabalha — ou,
  no sentido oposto, mostrar "rodando" para sempre depois que o processo morreu.
- Baixar o esforço a ponto de o ciclo de correção ficar mais caro que o thinking
  economizado. Por isso a nova tentativa sobe o esforço (§5.6).

---

## 4. Restrições

- **Zero dependências e sem build.** O `plo` não tem nenhuma
  (`package.json`), e a página é um arquivo só servido como está
  (`src/serve.js:15-18`).
- **As skills do superpowers não podem ser editadas.** Vivem no cache versionado
  (`~/.claude/plugins/cache/.../superpowers/<versão>/`), sobrescrito a cada
  atualização. O plano ganha a linha de esforço do mesmo jeito que já ganha o
  bloco `**Smoke Gate:**`: por regra fora do plugin (§5.1).
- **Sem marcação, comportamento de hoje.** Nada de `--effort` no argv; o
  processo herda o `effortLevel` do settings.
- **O portão de aprovação mostra o esforço.** Corrigir o nível de uma task é
  tão barato quanto corrigir uma aresta.
- **O CLI aceita o flag.** `claude --help` (2.1.308) lista
  `--effort <level>` com `low, medium, high, xhigh, max` para a sessão.

---

## 5. Parte 1 — esforço por task

### 5.1 Onde o esforço nasce

Cada task do plano ganha uma linha logo abaixo do título:

```markdown
### Task 4: Renomear `ownerId` para `responsavelId` no repositório

**Effort:** medium — troca mecânica em 2 arquivos, código pronto no plano

**Files:**
- Modify: `src/repos/setores.js`
```

O nível em inglês (é o valor do flag); o motivo, uma linha, na língua do plano.

Quem escreve é o `superpowers:writing-plans`, que não pode ser editado. A regra
entra pelos mesmos dois lugares que já mudam o plano por fora:

- **`~/.claude/hooks/superpowers-lane-option.sh`** — `PostToolUse` no `Skill`,
  sai calado a menos que a skill seja `writing-plans` (linhas 13-19), e injeta
  um bloco de contexto que o modelo lê logo depois de carregar a skill (linhas
  21-102). Hoje esse bloco só trata do handoff de execução e já manda editar o
  cabeçalho do plano (linhas 97-99). Ganha um parágrafo: toda task carrega
  `**Effort:**` com nível e motivo, pelo mapa de §5.2.
- **`~/.claude/CLAUDE.md`** — onde mora a regra do `**Smoke Gate:**`
  (linha 60). Ganha uma linha irmã na seção do `plo`.

O hook é o lugar principal: dispara exatamente quando o plano está para ser
escrito. Este documento só descreve a mudança; a edição do hook e do
CLAUDE.md é uma task do plano.

### 5.2 O mapa de complexidade — *decisão minha*

| Nível | Quando |
|---|---|
| `medium` | Mecânica: 1 ou 2 arquivos, o código está praticamente pronto no plano, sem decisão a tomar. |
| `high` | Integração entre arquivos, tela com smoke gate, regra de negócio que o plano descreve mas não escreve. |
| `xhigh` | Decisão de arquitetura, migração de dados, ou área que já deu problema em run anterior. |

O plano usa só esses três. O `plo` aceita os cinco valores do CLI — quem quiser
`low` ou `max` escreve à mão e vê no portão.

### 5.3 Parser

`parsePlan` percorre o corpo de cada task linha a linha. Hoje reconhece dois
blocos em negrito, `**Files:**` e `**Interfaces:**` (`src/parse-plan.js:165-166`);
qualquer outra linha que comece com `**` + maiúscula fecha o bloco aberto
(`src/parse-plan.js:167`). `**Effort:**` é um campo de uma linha, não um bloco:
um regex no mesmo laço, antes da linha 167, captura nível e motivo, e o objeto
da task (`src/parse-plan.js:212-228`) ganha `effort: { level, reason, line }` ou
`effort: null`.

Valor fora dos cinco nunca vira "sem marcação" em silêncio — seria rodar com um
esforço que o portão não mostrou. O parser guarda o valor cru; o `analyze`
aponta o erro com número da task e linha; o `init` se recusa a começar.

### 5.4 Portão

O `plo analyze` imprime cada task sob a sua lane (`src/render.js:49-57`) e sob
BARRIERS (`src/render.js:60-67`). Cada linha ganha o nível — `medium`, `high`,
`xhigh`, ou `herdado` para task sem marcação — e o motivo, cortado para caber.
Uma linha de resumo conta tasks por nível. A correção se faz no próprio plano,
antes do `init`.

### 5.5 Caminho até o processo

Hoje o modelo é um só, do CLI até o argv:
`args.model` (`bin/plo.js:198`) → `opts.model` em `runLanes` → `runAgent({ model:
opts.model })` em `runTask` (`src/run.js:264`) → `runAgent` (`src/spawn.js:74-76`)
→ `buildArgs` (`src/spawn.js:23-26`), que empurra `--model`.

O esforço não segue esse caminho: não é um flag do `plo`, é um campo da task.
`runTask` (`src/run.js:203`) já tem `plan` e `n` em mãos; lê o nível da task,
aplica a subida de §5.6 e passa `effort` ao `runAgent`. `buildArgs` ganha
`if (effort) args.push('--effort', effort)`, ao lado do `--model`.

### 5.6 Nova tentativa sobe um nível — *decisão minha*

Uma task que falhou, travou ou ficou em `needs-verify` volta com um nível acima
do que usou, até `xhigh`: `medium → high → xhigh → xhigh`. Task sem marcação
não sobe (já herda xhigh).

A conta usa `attempts`, que o `runTask` já incrementa a cada tentativa
(`src/run.js:250`), limitada por `MAX_ATTEMPTS = 3` (`src/state.js:49`). O
`plo resume` zera `attempts` de uma task esgotada (`src/state.js:193-199`) —
o humano olhou a falha —, e com isso o esforço volta ao do plano. É o
comportamento certo: a nova rodada parte do que o humano mudou, não do esforço
de quem falhou.

### 5.7 Barreiras e revisão entre lanes — *decisão minha*

Ficam sem `--effort`, herdando xhigh como hoje. A barreira roda no tree mesclado
com o contrato de todas as lanes (`src/integrate.js:95-166`, `model` na linha
136); a revisão é o único juiz do diff combinado (`src/integrate.js:226-265`,
`model` na linha 246). Nenhuma das duas cabe no mapa de §5.2.

### 5.8 Registro

O registro da task no estado ganha `effort` — o nível de fato usado na última
tentativa — gravado junto com `status: running` (`src/run.js:246-255`). O
`monitor` repassa o campo na visão da task (`src/monitor.js:411-451`). Precisa
vir do estado: o evento `init` do stream-json traz o modelo, não o nível
(conferido num `task-N.jsonl` do revo).

### 5.9 Em aberto

**Os subagentes herdam o `--effort` da sessão?** A controladora de cada task
roda o `subagent-driven-development` e despacha implementador e revisores pelo
Agent tool. Se o esforço passado ao processo chega a esses subagentes, a
mudança alcança quase todo o tempo de modelo (os 81%). Se não chega, só a
controladora (36%) fica mais leve, e o prompt da lane (`laneTaskPrompt`,
`src/prompts.js:68`) passa a mandar o nível em cada despacho. Quem constrói
descobre — sem experimento pago dedicado; o primeiro run real com a linha de
esforço responde, olhando o thinking dos subagentes no log.

---

## 6. Parte 2 — o fim do run visível

### 6.1 Cada etapa grava o próprio começo

`integrate` (`src/integrate.js:268-313`) passa a gravar o estado **antes** de
cada etapa, não só depois. `st.integration` (forma inicial em
`src/state.js:97`) ganha:

```js
integration: {
  status,            // como hoje, mais 'merging' | 'suite-running' | 'reviewing'
  mergedLanes, suite, review,          // como hoje
  pid,               // process.pid do `plo integrate` vivo
  stages: {          // uma entrada por etapa que já começou
    merge:  { startedAt, endedAt },
    suite:  { startedAt, endedAt, logFile, command },
    review: { startedAt, endedAt, logFile, sessionId, costUsd, outputTokens },
  },
}
```

As barreiras não mudam: já gravam o próprio começo como tasks.

### 6.2 A suíte ao vivo — *decisão minha*

`fullSuite` (`src/integrate.js:168-177`) troca o `execSync` por `spawn`, com
stdout e stderr indo para `.plo-logs/full-suite.log` enquanto a suíte roda.
O arquivo recomeça a cada run, com uma linha de cabeçalho (horário e comando);
o resultado anterior continua em `st.integration.suite.summary`, como hoje.

O `monitor` lê o fim do arquivo com o `tailFile` que já existe
(`src/monitor.js:38-62`) e entrega as últimas linhas no snapshot. Dois cuidados:
códigos de cor ANSI saem antes de entregar (vários runners forçam cor mesmo
sem TTY), e linhas reescritas com `\r` (barras de progresso) ficam só com o
último trecho.

O resultado continua o mesmo: `ok`, `code`, `summary` com as 40 últimas linhas,
`command`.

### 6.3 O revisor entre lanes como agente — *decisão minha*

Antes de despachar (`src/integrate.js:231-232`), `integrate` grava
`stages.review` com `startedAt`, `logFile` e `sessionId`. O `monitor` monta a
visão do revisor com o mesmo leitor das tasks — `readTaskLog`
(`src/monitor.js:311-320`) e o mesmo `digestLog`, que já zera a contagem a
cada cabeçalho `===` de nova rodada (`src/monitor.js:154-180`) — e a entrega
no **mesmo formato** da visão de task (`taskView`, `src/monitor.js:391-457`):
status, modelo, última ferramenta, atividade, subagentes, turnos, custo. Com
isso a página trata o revisor como mais um agente; hoje ela monta a lista de
agentes a partir de `lanes[].tasks` e `barriers` (`src/ui.html:1871-1880`).

O custo e os tokens do revisor, que hoje se perdem, vão para
`stages.review` quando o `result` chega.

### 6.4 `integrate` que morre — *decisão minha*

O `pid` gravado em §6.1 permite ao `monitor` perguntar se o processo ainda vive
(`process.kill(pid, 0)`; `plo serve` roda na mesma máquina). Etapa com
`startedAt`, sem `endedAt` e com o processo morto aparece como `interrupted`.

Além disso, `cmdIntegrate` (`bin/plo.js:218-234`) não trata SIGINT/SIGTERM,
ao contrário do `cmdRun` (`bin/plo.js:186-192`). Passa a tratar: grava a etapa
como interrompida antes de sair. E um `plo integrate` novo que encontra uma
etapa largada em andamento a trata como interrompida e refaz, do mesmo jeito
que o `reconcile` faz com task em `running` (`src/state.js:200-203`).

### 6.5 O contrato do snapshot

`snapshot` (`src/monitor.js:645-727`) passa a entregar, além do que já entrega:

| Campo | O que é |
|---|---|
| `stages[].status` | `pending`, `running`, `done`, `failed` ou `interrupted`, para todas as etapas — merge, suíte e revisão incluídas (hoje `src/monitor.js:494-551` não produz `running` para elas). |
| `stages[].startedAt`, `stages[].endedAt` | Para relógio e duração de cada etapa. |
| `integrationRunning` | `true` enquanto alguma etapa da integração está em `running`. |
| `totals.active` | `true` com task **ou** etapa da integração rodando (hoje só tasks, `src/monitor.js:716`). |
| `runOver` | `true` só quando a integração terminou: `done`, `review-findings` ou etapa falhada sem processo vivo. A página não declara fim sem isso. |
| `suiteLive` | `{ command, startedAt, lines: [...], logFile }` enquanto a suíte roda; `null` fora dela. |
| `reviewer` | A visão do revisor no formato de `taskView`, com `kind: 'review'`; `null` antes de a revisão começar. |
| `tasks[].effort` | O nível usado na última tentativa, ou `null` para herdado (§5.8). |

### 6.6 Os estados que a página precisa mostrar

A aparência é do documento B. O que qualquer aparência precisa garantir:

1. **Tasks feitas, integração rodando** — não é "concluído". Diz qual etapa,
   há quanto tempo; o relógio do run continua contando.
2. **Suíte rodando** — o comando, o tempo, e o fim da saída atualizando.
3. **Revisão rodando** — o revisor como agente vivo, com o que está lendo e os
   subagentes que abriu.
4. **Etapa interrompida** — distinguível de rodando e de falhada.
5. **Run concluído** — só com `runOver`.
6. **O esforço de cada task**, e quando a nova tentativa subiu o nível.

---

## 7. Decisões minhas, para conferir

1. O mapa de complexidade de §5.2 (`medium`/`high`/`xhigh`).
2. Nova tentativa sobe um nível, até `xhigh`; `resume` volta ao nível do plano.
3. Barreiras e revisão entre lanes sem `--effort`, herdando xhigh.
4. Valor de esforço inválido para o `init`, em vez de virar "herdado".
5. `pid` gravado para o painel mostrar `interrupted` quando o `integrate` morrer.
6. Suíte escrevendo em `.plo-logs/full-suite.log`, recomeçado a cada run, com o
   fim exibido ao vivo.
7. O revisor entre lanes aparece como agente, no formato de task, lido pelo
   mesmo leitor de log.
8. A regra da linha `**Effort:**` entra pelo hook do `writing-plans`, com uma
   linha irmã no `CLAUDE.md` global.

---

## 8. O que fica para quem constrói

- Os nomes exatos dos campos novos e dos status intermediários, desde que o
  contrato de §6.5 seja respeitado.
- Quantas linhas da suíte entram no snapshot e quanto do motivo o `analyze`
  mostra antes de cortar.
- O texto do parágrafo novo no hook e da linha no `CLAUDE.md`.
- A resposta de §5.9, e o despacho com esforço no prompt da lane se for preciso.
- Os testes: `node --test` (`package.json`), com o binário do agente trocado
  por `PLO_AGENT_BIN` (`src/spawn.js:17`) — parser (`test/parse-plan.test.js`),
  argv (`test/spawn.test.js`), estado e reconcile (`test/state.test.js`),
  snapshot (`test/monitor.test.js`).

---

## 9. Como saber que funcionou

- `plo analyze` num plano com `**Effort:**` mostra o nível de cada task; num
  plano sem a linha, mostra `herdado` e o argv não tem `--effort`.
- `buildArgs` com `effort: 'medium'` produz `--effort medium`; sem `effort`,
  o argv é idêntico ao de hoje.
- Uma task `medium` que falha roda a segunda tentativa com `--effort high`.
- Durante a revisão entre lanes, `snapshot.integrationRunning` é `true`,
  `snapshot.reviewer.status` é `running`, e `runOver` é `false`.
- Durante a suíte, `snapshot.suiteLive.lines` muda entre dois polls.
- Matar o `plo integrate` com `kill -9` no meio da suíte leva a etapa a
  `interrupted` no próximo poll.
