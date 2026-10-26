# Esforço por task e visibilidade do fim do run — desenho

> **Status:** aguardando aprovação; leitura de construtor feita em 26/10.
> Branch `feat/esforco-e-painel-pipboy`.
> **Documento irmão:** o painel Pip-Boy (documento B), desenhado em paralelo
> na mesma branch. Este documento diz **o que** a página precisa mostrar —
> os dados no snapshot do `monitor` e os estados. **Como** aparece é do B.
> Os dois viram **um plano só** (§3.1).

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
4. Nenhuma task ou etapa cujo processo morreu aparece como rodando — nem as do
   `plo integrate` (merge, barreira, suíte, revisão), nem as tasks de lane do
   `plo run` (§6.4).

**Não-metas**

- Trocar o modelo por task. Opus em tudo foi decisão do usuário.
- Mostrar ao vivo os testes que os agentes rodam **dentro** das tasks. Esses já
  aparecem como chamadas de Bash no log da task; este documento trata da suíte
  que o próprio `plo` roda.
- Cortar a espera cega, o pre-flight da controladora ou as suítes repetidas.
  Saíram da medição, mas são outro trabalho.
- Desenhar a aparência da página **neste documento**. A aparência é do
  documento B, que entra no **mesmo plano** (§3.1).

**Anti-metas** — o que faria isto falhar mesmo funcionando:

- Uma task rodar com um esforço diferente do que o portão mostrou.
- Uma task sem a linha de esforço mudar de comportamento. Sem marcação, roda
  exatamente como hoje.
- O painel declarar o run concluído enquanto a revisão ainda trabalha — ou,
  no sentido oposto, mostrar "rodando" para sempre depois que o processo morreu.
- Baixar o esforço a ponto de o ciclo de correção ficar mais caro que o thinking
  economizado. Por isso a nova tentativa sobe o esforço (§5.6).

### 3.1 Um plano só, com o documento B — *decisão minha*

- Os documentos A e B viram **um plano**. No plano, as tasks de dados deste
  documento (estado, `integrate`, `monitor`, snapshot) vêm **antes** das tasks
  de página do B, que desenham o que elas entregam.
- A página atual **não ganha ajuste provisório**. O B reescreve a página no
  mesmo plano; um remendo no `ui.html` de hoje seria jogado fora antes de
  chegar ao usuário. Até o B entrar, a anti-meta "o painel declara concluído
  enquanto a revisão trabalha" continua valendo na página velha — e isso é
  aceito, porque as duas partes chegam juntas.
- O B **pode acrescentar** campos ao contrato de §6.5, **não pode remover**.
  O que está em §6.5 é o mínimo que qualquer aparência recebe.

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
escrito.

**A edição do hook e do CLAUDE.md não é task do plano** — *decisão minha*.
O `~/.claude` não é repositório git, e uma task de lane só termina `done` se
deixar commit na branch da lane (`src/run.js:287`); além disso, o processo da
task roda confinado ao worktree — o `runTask` não passa `addDirs` ao
`runAgent` (`src/run.js:260-270`). Executada pelo `plo`, essa task falharia
ou travaria. Vira um **passo manual da sessão que controla o plano, depois do
merge do PR**: só então o `plo` instalado sabe ler a linha, e só então vale
pedir ao `writing-plans` que a escreva.

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
aponta o erro com número da task e linha; o `init`, o `run` e o `resume` se
recusam a começar — *decisão minha*. Só o `init` não basta: o `cmdRun` relê
o plano a cada `run`/`resume` (`bin/plo.js:152`) e só chama o `cmdInit`
quando ainda não há estado (`bin/plo.js:154-156`), então um valor inválido
escrito depois do `init` escaparia da recusa.

### 5.4 Portão

O `plo analyze` imprime cada task sob a sua lane (`src/render.js:49-57`) e sob
BARRIERS (`src/render.js:60-67`). Cada linha ganha o nível — `medium`, `high`,
`xhigh`, ou `herdado` para task sem marcação — e o motivo, cortado para caber.
Uma linha de resumo conta tasks por nível. A correção se faz no próprio plano,
antes do `init`.

As linhas de BARRIERS mostram o nível **da própria barreira**, porque a
barreira obedece à sua linha `**Effort:**` (§5.7). A revisão entre lanes, que
não é task do plano, não aparece com nível.

### 5.5 Caminho até o processo

Hoje o modelo é um só, do CLI até o argv:
`args.model` (`bin/plo.js:198`) → `opts.model` em `runLanes` → `runAgent({ model:
opts.model })` em `runTask` (`src/run.js:264`) → `runAgent` (`src/spawn.js:74-76`)
→ `buildArgs` (`src/spawn.js:23-26`), que empurra `--model`.

O esforço não segue esse caminho: não é um flag do `plo`, é um campo da task.
`runTask` (`src/run.js:203`) já tem `plan` e `n` em mãos; lê o nível da task,
aplica a subida de §5.6 e passa `effort` ao `runAgent`. `buildArgs` ganha
`if (effort) args.push('--effort', effort)`, ao lado do `--model`. A barreira
faz o mesmo no `runBarriers`, que também recebe o `plan`
(`src/integrate.js:94`) e chama o `runAgent` direto, sem passar pelo `runTask`
(`src/integrate.js:123`).

**O nível vem do plano atual, a cada `run`/`resume`** — *decisão minha*. O
`cmdRun` relê o plano em toda invocação (`bin/plo.js:152`), e o plano é editado
no meio do run de propósito (aad43ce passou a sincronizar essas revisões nas
lanes). Congelar o nível no `init` faria o run ignorar a correção que o humano
acabou de escrever. A garantia do portão continua: uma edição depois do `init`
muda o hash do plano e cai no aviso de plano mudado que já existe
(`src/state.js:181`), que manda re-rodar o `analyze` antes de seguir.

### 5.6 Nova tentativa sobe um nível — *decisão minha*

Uma task que falhou, travou ou ficou em `needs-verify` volta com um nível acima
do que usou, até `xhigh`: `medium → high → xhigh → xhigh`. Task sem marcação
não sobe (já herda xhigh).

**A conta usa um contador próprio, não `attempts`** — *decisão minha*.
`attempts` sobe em casos em que o agente não falhou: é incrementado antes de o
agente rodar (`src/run.js:250`), inclusive quando o binário nem abre
(`src/run.js:271-276`), e sobe na falha de preparo da lane, como conflito no
merge de uma aresta entre lanes, antes de qualquer agente existir
(`src/run.js:233`). O contador novo (o nome fica para quem constrói) só sobe
quando **o agente rodou até o fim e a task terminou `failed`, `blocked` ou
`needs-verify` pelo resultado dele**. Não sobe em:

- falha de preparo da lane (`src/run.js:233`);
- binário que não abre (`src/run.js:271-276`);
- interrupção por Ctrl-C ou SIGTERM — o `AbortController` do `cmdRun`
  (`bin/plo.js:186-192`), repassado ao processo pelo `signal` do `spawn`
  (`src/spawn.js:85`);
- limite de uso ou 529 — falha da API, não da task.

**O contador zera em todo `run`/`resume`.** O `reconcile` roda em toda
invocação do `cmdRun` (`bin/plo.js:158`) e passa a zerar o contador de todas
as tasks: cada invocação começa no nível do plano. É o comportamento certo — o
humano que relança olhou a falha, e a nova rodada parte do que ele mudou, não
do esforço de quem falhou. Hoje o `reconcile` só zera `attempts` de task que
gastou as 3 tentativas (`src/state.js:193-199`, `MAX_ATTEMPTS` em
`src/state.js:49`); `attempts` continua assim, como teto de tentativas.

Na barreira, a "nova tentativa" é o próximo `plo integrate`: o `runBarriers`
não repete a task dentro da mesma execução (`src/integrate.js:161`). O
`integrate` não chama o `reconcile`, então o contador de uma barreira que
falhou continua de pé entre dois `plo integrate` e só zera num `run`/`resume`.

### 5.7 Barreiras obedecem à própria linha; a revisão entre lanes, não — *decisão minha*

**A barreira roda com o nível da sua linha `**Effort:**`**, como qualquer
task, e sobe do mesmo jeito (§5.6). O motivo é o tamanho do que ficaria de
fora: o `findBarriers` (`src/build-dag.js:149-165`) transforma em barreira
toda task que tem todas as restantes como ancestrais, e repete isso em
camadas. Numa cadeia 1→2→3→4 ele devolve `[2, 3, 4]`. Num plano em cadeia —
o caso comum a `--max-lanes 1` —, quase todas as tasks rodam no `integrate`,
e uma barreira que ignorasse a linha deixaria o esforço por task quase sem
efeito. O `runBarriers` lê o nível do `plan` e o passa ao `runAgent`
(`src/integrate.js:123`, §5.5); o portão mostra esse nível em BARRIERS (§5.4).

**A revisão entre lanes fica sem `--effort`, herdando xhigh** como hoje. Ela
não é task do plano — não tem linha para obedecer — e é o único juiz do diff
combinado (`src/integrate.js:226-265`, `model` na linha 246).

### 5.8 Registro

O registro da task no estado ganha `effort` — o nível de fato usado na última
tentativa — gravado junto com `status: running` (`src/run.js:246-255`; na
barreira, `src/integrate.js:117-120`). O `monitor` repassa o campo na visão da
task (`src/monitor.js:411-451`). O nível usado precisa vir do estado: o evento
`init` do stream-json traz o modelo, não o nível (conferido num `task-N.jsonl`
do revo).

Task que ainda não rodou não tem nível usado. Para ela, o `monitor` lê o nível
**do plano atual** — ele já lê e parseia o plano a cada snapshot
(`src/monitor.js:647-648`) — *decisão minha*. Assim uma task pendente marcada
`medium` aparece `medium`, não "herdado". O snapshot diz de onde veio o nível
(planejado ou usado) e se a tentativa subiu (§6.5).

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
    suite:  { startedAt, endedAt, logFile, command, pid },  // pid do processo da suíte (§6.2)
    review: { startedAt, endedAt, logFile, sessionId, costUsd, outputTokens },
  },
}
```

As barreiras já gravam o próprio começo como tasks (`src/integrate.js:117-120`).
Ganham só o `pid`, como toda task em `running`:

**Toda task em `running` grava o `pid` do processo `plo` que a dirige** —
*decisão minha*. Na task de lane, o `pid` do `plo run`, gravado junto com
`status: running` (`src/run.js:246-255`); na barreira, o do `plo integrate`
(`src/integrate.js:117-120`). É o que deixa o `monitor` reconhecer uma task
órfã (§6.4).

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

**Como o processo da suíte vive e morre** — *decisão minha*:

- A saída passa **pelo pipe do `plo`** até o arquivo; a suíte não recebe o
  descritor do arquivo direto. Se o `plo` morre, a suíte morre por SIGPIPE na
  próxima escrita, em vez de seguir órfã escrevendo num log que um `integrate`
  novo vai truncar.
- A suíte roda no **próprio grupo de processos** (`detached`), com o `pid`
  gravado em `stages.suite.pid`. O tratamento de SIGINT/SIGTERM do `integrate`
  (§6.4) mata o grupo inteiro — o runner e os workers que ele abriu.
- Um `plo integrate` novo que acha em `stages.suite.pid` um processo ainda
  vivo **mata esse processo antes de truncar** `full-suite.log`. Nunca duas
  suítes em paralelo no mesmo tree e no mesmo arquivo.

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

### 6.4 Processo que morre — `integrate` e `run` — *decisão minha*

Os `pid`s gravados em §6.1 permitem ao `monitor` perguntar se o processo ainda
vive (`process.kill(pid, 0)`; `plo serve` roda na mesma máquina). **Qualquer
task ou etapa em `running` cujo processo morreu aparece como `interrupted`**:

- etapa do `integrate` com `startedAt`, sem `endedAt` e processo morto;
- barreira em `running` com o `plo integrate` morto. Hoje ela fica `running`
  para sempre: o `integrate` nunca chama o `reconcile`, que só roda no
  `run`/`resume` (`bin/plo.js:158`);
- task de lane em `running` com o `plo run` morto. Hoje ela também fica
  `running` até o próximo `run`/`resume` reconciliar
  (`src/state.js:200-203`), e `totals.active` segue `true` com ninguém
  trabalhando.

O `monitor` só **mostra** `interrupted`; ele é só leitura (`src/serve.js`) e
não grava o estado. Quem grava continua sendo o `reconcile` no `run`/`resume`
e, no `integrate`, o passo abaixo.

`cmdIntegrate` (`bin/plo.js:218-234`) não trata SIGINT/SIGTERM nem repassa
sinal de cancelamento aos filhos (`bin/plo.js:223-230`), ao contrário do
`cmdRun` (`bin/plo.js:186-192`). Passa a tratar, do mesmo jeito: um
`AbortController` cujo `signal` vai para o `runAgent` das barreiras e da
revisão (o `runBarriers` e o `crossLaneReview` já repassam `opts.signal`,
`src/integrate.js:141` e `250`); na interrupção, mata o grupo da suíte (§6.2)
e grava a etapa como interrompida antes de sair. Um `plo integrate` novo que
encontra uma etapa ou barreira largada em `running` a trata como interrompida
e refaz, do mesmo jeito que o `reconcile` faz com task em `running`
(`src/state.js:200-203`).

### 6.5 O contrato do snapshot

`snapshot` (`src/monitor.js:645-727`) passa a entregar, além do que já entrega.
Este é o mínimo que a página do documento B recebe: o B pode acrescentar
campos, não remover (§3.1).

| Campo | O que é |
|---|---|
| `stages[].status` | `pending`, `running`, `done`, `failed` ou `interrupted`, para todas as etapas — merge, suíte e revisão incluídas (hoje `src/monitor.js:494-551` não produz `running` para elas). `interrupted` também quando a etapa está em `running` e o processo morreu (§6.4). |
| `tasks[].status` | Como hoje, mas `running` com o processo dirigente morto sai como `interrupted` (§6.4). Vale para tasks de lane e barreiras. |
| `stages[].startedAt`, `stages[].endedAt` | Para relógio e duração de cada etapa. |
| `integrationRunning` | `true` enquanto alguma etapa da integração está em `running`. |
| `totals.active` | `true` com task **ou** etapa da integração rodando (hoje só tasks, `src/monitor.js:716`). |
| `runOver` | `true` só quando a integração terminou: `done`, `review-findings` ou etapa falhada sem processo vivo. A página não declara fim sem isso. |
| `suiteLive` | `{ command, startedAt, lines: [...], logFile }` enquanto a suíte roda; `null` fora dela. |
| `reviewer` | A visão do revisor no formato de `taskView`, com `kind: 'review'`; `null` antes de a revisão começar. |
| `tasks[].effort` | O nível usado na última tentativa; para task que ainda não rodou, o nível do plano atual; `null` para herdado. Diz de onde veio (planejado ou usado) e se a tentativa subiu o nível (§5.6, §5.8). Vale para barreiras. |

### 6.6 Os estados que a página precisa mostrar

A aparência é do documento B. O que qualquer aparência precisa garantir:

1. **Tasks feitas, integração rodando** — não é "concluído". Diz qual etapa,
   há quanto tempo; o relógio do run continua contando.
2. **Suíte rodando** — o comando, o tempo, e o fim da saída atualizando.
3. **Revisão rodando** — o revisor como agente vivo, com o que está lendo e os
   subagentes que abriu.
4. **Etapa ou task interrompida** — distinguível de rodando e de falhada,
   inclusive quando o processo morreu sem avisar.
5. **Run concluído** — só com `runOver`.
6. **O esforço de cada task**, e quando a nova tentativa subiu o nível.

---

## 7. Decisões minhas, para conferir

1. O mapa de complexidade de §5.2 (`medium`/`high`/`xhigh`).
2. Nova tentativa sobe um nível, até `xhigh`, por um **contador próprio** que
   só sobe quando o agente rodou e a task terminou `failed`, `blocked` ou
   `needs-verify` pelo resultado dele — não em falha de preparo, binário que
   não abre, limite de uso, 529 ou Ctrl-C. Todo `run`/`resume` zera o
   contador: o nível volta ao do plano (§5.6).
3. **Barreira obedece à própria linha `**Effort:**`** (o `findBarriers` faz
   barreira de quase toda task de um plano em cadeia); só a revisão entre
   lanes fica sem `--effort`, herdando xhigh (§5.7).
4. Valor de esforço inválido faz o `init`, o `run` e o `resume` se recusarem
   a começar, em vez de virar "herdado" (§5.3).
5. `pid` gravado em toda task em `running` (lane e barreira) e em cada etapa
   do `integrate`; o painel mostra `interrupted` para qualquer uma cujo
   processo morreu (§6.1, §6.4).
6. Suíte escrevendo em `.plo-logs/full-suite.log`, recomeçado a cada run, com o
   fim exibido ao vivo; saída pelo pipe do `plo`, grupo de processos próprio,
   morto na interrupção, e suíte anterior viva morta antes de truncar o log
   (§6.2).
7. O revisor entre lanes aparece como agente, no formato de task, lido pelo
   mesmo leitor de log.
8. A regra da linha `**Effort:**` entra pelo hook do `writing-plans`, com uma
   linha irmã no `CLAUDE.md` global — editados **à mão pela sessão que
   controla o plano, depois do merge do PR**, não como task do plano (§5.1).
9. **Um plano só** para os documentos A e B; tasks de dados do A antes das de
   página do B; nenhum ajuste provisório na página atual; o B acrescenta
   campos ao contrato de §6.5, não remove (§3.1).
10. O nível é **lido do plano atual a cada `run`/`resume`**, não congelado no
    `init`; edição depois do `init` cai no aviso de plano mudado; o `monitor`
    mostra o nível do plano para tasks que ainda não rodaram (§5.5, §5.8).

---

## 8. O que fica para quem constrói

- Os nomes exatos dos campos novos e dos status intermediários, desde que o
  contrato de §6.5 seja respeitado.
- Quantas linhas da suíte entram no snapshot e quanto do motivo o `analyze`
  mostra antes de cortar.
- O texto do parágrafo novo no hook e da linha no `CLAUDE.md`. A edição em
  si **não entra no plano**: é passo manual da sessão que controla o plano,
  depois do merge do PR (§5.1).
- O nome e o lugar do contador de subida (§5.6), e como reconhecer no
  resultado do agente que a falha foi da API (limite de uso, 529) e não da
  task — pistas: o `rate_limit_event` que o `monitor` já lê
  (`src/monitor.js:206`) e o resultado de erro da API.
- Como o `monitor` se protege de `pid` reaproveitado pelo sistema (por
  exemplo, conferindo também o horário de início do processo).
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
- Uma task `medium` que falha roda a segunda tentativa com `--effort high`;
  uma task cuja lane falhou no preparo volta com `--effort medium`; depois de
  um `plo resume`, volta a `medium`.
- Uma barreira marcada `medium` roda com `--effort medium`; a revisão entre
  lanes roda sem `--effort`.
- Um valor `**Effort:** altissimo` escrito depois do `init` faz o próximo
  `plo run` se recusar a começar.
- Durante a revisão entre lanes, `snapshot.integrationRunning` é `true`,
  `snapshot.reviewer.status` é `running`, e `runOver` é `false`.
- Durante a suíte, `snapshot.suiteLive.lines` muda entre dois polls.
- Matar o `plo integrate` com `kill -9` no meio da suíte leva a etapa a
  `interrupted` no próximo poll, e a suíte morre junto; um `plo integrate`
  novo não sobe uma segunda suíte em paralelo.
- Matar o `plo run` com `kill -9` com uma task rodando leva a task a
  `interrupted` no próximo poll, sem esperar um `resume`.
