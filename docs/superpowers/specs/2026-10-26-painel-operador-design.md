# Painel do operador — desenho (documento B)

> **Status:** aguardando aprovação; leitura de construtor feita em 26/10.
> Branch `feat/esforco-e-painel-pipboy`.
> **Documento irmão:** `2026-10-26-esforco-por-task-e-fim-do-run-design.md`
> (documento A). O A diz **o que** a página precisa mostrar — os dados do
> snapshot e os estados (§6.5 e §6.6 do A). Este documento diz **como** aparece.
> Os dois viram **um plano só** (A §3.1).
> **Protótipo aprovado:** `2026-10-26-painel-operador/prototipo.html` (abre
> direto no navegador, com dados inventados e três cenários). Ele mostra o
> visual. **Onde o protótipo e este documento diferem, vale este documento.**

Conferido em `main` @ `3972d43`. As citações `arquivo:linha` abaixo são desse
commit.

---

## 1. Por que

A página de hoje (`src/ui.html`, 2.626 linhas) segue o visual do Linear: linhas
densas, cromo discreto, um acento índigo (`src/ui.html:10`). Ela mostra quem
está trabalhando, mas não tem personalidade. Depois que as tasks terminam, ela
parece acabada e não diz que ainda tem trabalho rodando (problema que o A
resolve nos dados).

O usuário pediu uma página mais detalhada e com mais personalidade, na linha do
[habblaud](https://github.com/marmottajr/habblaud), com a temática da
interface do Pip-Boy do Fallout 4: fósforo verde, abas no topo, bonecos.

---

## 2. O que o usuário decidiu

Tudo isto foi visto e aprovado no protótipo, no companion visual da sessão de
26/10:

- **Fallout, não pixel art.** Tela de fósforo verde no jeito do Pip-Boy do
  Fallout 4: abas STAT, INV, DATA, MAP e RADIO no topo, linhas de varredura,
  brilho.
- **Direções A + C juntas.** A (as abas do aparelho) e C (o mapa de missão),
  as duas no menu de cima.
- **Toda aba é clicável e tem informação útil.**
- **Clicar num agente mostra o status e o que está acontecendo.**
- **Erro e travado aparecem**, inclusive "travado por algum motivo".
- **Mascote próprio, não o Vault Boy.** É um operador de boné, gerado e
  vetorizado (§7). O Vault Boy e o nome Pip-Boy são da Bethesda, e o repositório
  do `plo` é público e MIT.
- **O operador anima trocando dois quadros, sem respiração.** A troca é seca,
  e um quadro substitui o outro; nunca aparecem os dois juntos.
- **Rádio com cara de rádio.** No lugar da grade, um eixo em L, com régua
  vertical à direita. A onda tem cara de som: os picos nascem na esquerda,
  andam para a direita e somem. Ela só se mexe quando a estação está no ar.
- **Botão de copiar no erro.**
- **Sem a moldura do aparelho.** Só a tela.
- **Alerta em âmbar.**
- **A saída dos testes ao vivo** (pedido que o A transformou em dados, §6.2
  do A).

---

## 3. Metas, não-metas, anti-metas

**Metas**

1. Os seis estados de §6.6 do A aparecem, cada um num lugar que dá para
   apontar (§6).
2. **Nada do que a página de hoje faz se perde.** O inventário de §5 lista cada
   função, com o lugar dela na página nova.
3. Qualquer agente vivo ou parado fica a um clique da aba de entrada.
4. A página funciona sem internet: não faz nenhuma requisição externa.
5. Todo número da página tem fonte: o snapshot do A (§6.5 do A), os campos
   deste documento (§9.1) ou uma conta feita na página e descrita aqui. Quando
   o dado ainda não existe — o custo de uma tentativa em curso, por exemplo —
   a página mostra `—`, nunca zero nem o valor de outra tentativa.

**Não-metas**

- Tema claro. O fósforo verde é escuro por natureza (§4).
- Comandar o run pela página (pausar, retomar, editar o plano). O `plo serve`
  continua só leitura; a página entrega o comando pronto para copiar, como hoje.
- Medir custo e tokens **durante** uma tentativa. O `monitor` lê só o fim do
  log e por isso não soma parciais (`src/monitor.js:421-431`); isso continua.

**Anti-metas** — o que faria isto falhar mesmo funcionando:

- O operador animado e a onda mexendo **com o stream caído**. Uma página que
  parece viva sem saber do run é pior que a de hoje (§6.1).
- Um processo morto aparecendo como rodando — task, etapa **ou subagente**
  (§8.4).
- O operador lembrar o Vault Boy, ou a página usar o nome Pip-Boy, a fonte ou o
  logotipo do jogo (§7.4).
- Os bonecos piscando ou reiniciando a animação a cada snapshot (§9.4).
- Um alerta que manda o comando errado. `plo resume` não roda barreira nem
  integração (§8.3).

---

## 4. Restrições

- **Zero dependências e sem build** (A §4). A página continua um arquivo só,
  `src/ui.html`, lido a cada requisição (`src/serve.js:97-106`). Os ativos
  binários (o desenho do operador e a fonte) vão em arquivos ao lado, servidos
  por uma rota nova e fechada (§9.3).
- **Sem requisição externa.** O protótipo puxa a Roboto Condensed do Google
  Fonts; a página não pode. A fonte vai no repositório (§9.3). Hoje a página
  usa as fontes do sistema (`src/ui.html:68`).
- **Só tema escuro** — *decisão minha*. Hoje existe o tema claro
  (`src/ui.html:72`). O fósforo verde sobre fundo claro não existe no jogo e
  perde o contraste que faz o tema funcionar.
- **Movimento reduzido** é respeitado, como hoje (`src/ui.html:231`, `477`,
  `695`, `767`, `851`, `958`, `976`). Com `prefers-reduced-motion`:
  - o operador fica no quadro 1;
  - nada pisca;
  - a onda do rádio é redesenhada uma vez por linha nova, sem animação
    contínua.
- **Propriedade intelectual** (§7.4).

---

## 5. Inventário: o que a página de hoje faz e para onde vai

Cada linha é um compromisso: quem constrói não pode deixar nenhuma de fora.

| Hoje | Onde está | Na página nova |
|---|---|---|
| Título da aba do navegador com `⚠` e `feitas/total` | `src/ui.html:1957-1959` | Igual. |
| Nome do plano; base `branch` @ commit; comando de teste; lanes · máximo | `src/ui.html:1927`, `1948-1953` | DATA › NUMBERS, painel RUN. O nome do plano também fica na barra das abas. |
| Veredito em uma frase (feitas, quem parou, quantos agentes trabalhando) | `src/ui.html:1980-1998` | Rodapé e STAT › CONDITION. |
| Faixa de etapas (lanes, merge, barreiras, suíte, revisão) | `src/ui.html:2007-2016` | MAP (fim da trilha), rodapé (§6.1) e DATA › NUMBERS, com a duração de cada etapa. |
| "nobody working — waiting on <etapa>", quando ninguém trabalha | `runningStage`, `src/ui.html:2052-2070`, `2090-2093` | STAT › AGENTS vazio (§6.2) e rodapé (`WAITING`, §6.1). |
| Alertas com o comando copiável: limite de uso, plano mudou, task falhou ou travou (com `plo resume` e "Read it") | `src/ui.html:2022-2041` | STAT › CONDITION, lista ALERTS; o chip `! N ALERTS` no topo leva até ela. Cada alerta mantém o botão COPY, agora com o comando certo para barreira e integração (§8.3). |
| Tripulação: agentes vivos e parados, subagentes aninhados, o que cada um faz, relógio, turnos, tokens, tentativa | `src/ui.html:2077-2207` | STAT › AGENTS (§6.2). |
| Gaveta do agente: relato do erro em markdown, copiar `resume` e branch, últimos eventos, "Task record" | `src/ui.html:2168-2190` | STAT › AGENTS, coluna da direita; o link "open in INV" faz o papel do "Task record". |
| Fila com o que segura cada task | `src/ui.html:2260-2270`, `queueAfter` em `1831` | INV › QUEUE, coluna WAITING ON. |
| Resultado: relógio contra tempo de agente, ganho ×, tokens, commits, suíte, veredito da revisão | `src/ui.html:2278-2299` | DATA › NUMBERS. |
| Feitas, com tokens e commits | `src/ui.html:2302-2311` | INV › DONE. |
| Feed do run com busca, filtro (erros, Bash, edições) e quebra de linha | `src/ui.html:2319-2341`, `2554-2560` | DATA › LOG, com os mesmos três controles (§6.4). |
| Ficha da task (`/api/task`): status, lane, duração, turnos, tentativas, tokens, modelo, sessão e log com copiar, commits, erro, resultado do agente, escritas declaradas, excluídas, passos do plano, atividade | `src/ui.html:2351-2411` | INV, painel da direita da task selecionada — todos os campos, mais o esforço e as tentativas (§6.3). |
| Link `#task=4` que sobrevive a reload e cola no Slack | `src/ui.html:2441-2457` | Continua abrindo a task, agora no INV (§6.8). |
| Teclado: Esc fecha, foco preso no painel modal | `src/ui.html:2500-2552` | Não há mais modal. Toda área clicável é `<button>` com foco visível; Esc volta da task para a lista (§6.8). |
| Relógios vivos (`data-since`), corrigidos pela hora do servidor | `src/ui.html:2584-2597`, `skew` em `2610` | Igual. |
| Indicador do stream: ao vivo, reconectando, quieto há N | `src/ui.html:2601-2623` | Canto direito da barra das abas (§6.1). |
| Estado vazio ("No state file yet — run `plo analyze`…") | `src/ui.html:1929-1943` | A tela mostra a mensagem e o comando com COPY, com o operador dormindo. |
| Avatares gerados por agente, cor por lane | `src/ui.html:1544-1661`; CSS a partir de `744` | Saem. O operador mostra o estado (§7) e a lane é dita por extenso (`LANE A`). Com uma cor só na tela, a cor não carrega mais a lane. |
| Dica da barreira (`BARRIER_TIP`) | `src/ui.html:1446` | INV, na coluna LANE (`BARRIER`), com a mesma frase como dica. |
| Layout por largura | `src/ui.html:145`, `146`, `159`, `204`, `287`, `394`, `402`, `489`, `628`, `673`, `968` | §6.9. |

---

## 6. As telas

A tela ocupa a janela inteira. No alto ficam as abas e as sub-abas; embaixo, o
rodapé fixo. O protótipo mostra as cinco abas; esta seção diz de onde vem cada
número.

**Língua da página: inglês** — *decisão minha*. A página de hoje, o CLI e o
código do `plo` falam inglês, e o repositório é público. O protótipo está em
português só porque foi desenhado nesta conversa. Os rótulos do jogo já são em
inglês (STAT, INV, DATA, MAP, RADIO). Exemplos: PRECISAM DE VOCÊ → NEED YOU,
SEM SINAL → NO SIGNAL, NO AR → ON AIR, COPIAR → COPY.

### 6.1 Moldura da tela: abas, chip de alertas, sinal, rodapé

- **Abas:** STAT, INV, DATA, MAP, RADIO, com as sub-abas de cada uma.
- **Chip `! N ALERTS`** em âmbar, quando N > 0: leva a STAT › CONDITION. N é o
  tamanho da lista de §8.2, o mesmo número do rodapé.
- **Sinal do stream**, à direita das abas:
  - `● LIVE`;
  - `QUIET 2m`, quando não chega snapshot há 30 s ou mais, como hoje
    (`src/ui.html:2622`);
  - `RECONNECTING…` em âmbar.

  **Sem stream, nada se mexe:** com a conexão caída (`RECONNECTING…`), os
  operadores param no quadro 1, a onda do rádio fica reta e os relógios param.
  `QUIET` não para nada: o stream só manda snapshot quando algo muda
  (`src/serve.js:66-72`) e manda `ping` nos intervalos, então quieto ainda é
  conectado.
- **Rodapé**, da esquerda para a direita:
  - `TASKS feitas/total` — tasks de lane e barreiras.
  - `N NEED YOU` em âmbar, só quando N > 0.
  - A barra do run, que muda de texto pela fase:
    - com task de lane rodando, `RUN · N LANES`;
    - com alguma etapa da integração em `running`, `END OF RUN · <etapa> <há
      quanto> — not over yet` (A §6.6, estado 1);
    - com nada rodando e o run sem `runOver`, `WAITING · <próxima etapa>`.
      Esse é o fim normal de um `plo run` sem `--integrate`
      (`bin/plo.js:214`), e também o de um run parado esperando gente;
    - com `runOver`, `RUN OVER`.

    O preenchimento é `(tasks feitas + etapas de integração feitas) / (tasks +
    etapas de integração)`. As etapas de integração são merge, suíte e
    revisão. As etapas `run` e `barriers` do `stages[]` não entram de novo,
    porque são agregados das próprias tasks (`src/monitor.js:518`, `529-536`).
  - `5H LIMIT` com barrinha e porcentagem (`usage5h`, §9.1), em âmbar a partir
    de 80%, e com a hora em que zera na dica. Some quando `usage5h` é `null`.
  - Custo: `totals.costUsd` mais o custo do revisor (§9.2).
  - Relógio do run, a partir de `totals.firstStartedAt`:
    - conta enquanto `totals.active` for `true` (A §6.5);
    - com `active` falso, mostra a duração até o último fim conhecido, o maior
      entre os `endedAt` das tasks e das etapas (A §6.5), e fica parado. É o
      que a página faz hoje com as tasks (`src/ui.html:2589`), agora contando
      as etapas.

### 6.2 STAT › AGENTS e STAT › CONDITION

**AGENTS** tem três colunas.

1. **Lista de agentes.** Fica agrupada como na tripulação de hoje: cabeçalho
   `LANE A · T7 <título>`, a controladora e os subagentes indentados embaixo.
   Depois vem o grupo das barreiras e, por fim, o grupo `END OF RUN`, com a
   suíte e o revisor entre lanes (`snapshot.reviewer`, A §6.5) e os
   subagentes dele.
   - Entram os agentes vivos e os parados, o mesmo filtro de hoje
     (`src/ui.html:1882-1884`).
   - O grupo `END OF RUN` aparece assim que uma das duas etapas começa
     (`startedAt` em A §6.5) e fica enquanto o run não terminar em `runOver`
     limpo, ou seja, sem alerta de §8.2.
2. **O agente selecionado.** Mostra:
   - o operador na pose do estado (§7);
   - `T7 · IMPLEMENTER`, a etiqueta de estado e o que está fazendo agora (o
     último evento, como o `doing` de hoje, `src/ui.html:1801`);
   - cinco números, que dependem do tipo de agente (tabela abaixo).
3. **Detalhes.** De cima para baixo:
   - `WHAT TO DO`, para quem parou (§8.3), com COPY do comando;
   - `LAST ACTIONS`, a atividade, com hora, ferramenta e alvo;
   - `SUBAGENTS`;
   - o cartão da task (título, arquivos · commits), com os links `open in INV`
     e `see quest`;
   - na suíte, `LIVE OUTPUT` com as últimas linhas de `suiteLive.lines` e o
     link para o RADIO.

**Os cinco números por tipo** — *decisão minha*. `—` quando o dado não existe
naquele momento (meta 5).

| Agente | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Task de lane (controladora) | EFFORT (`↑` se a tentativa subiu, A §5.6) | TRY `attempts/3` | TURNS | TIME | COST |
| Barreira | EFFORT | TRY `attempts` (sem teto: o `integrate` não tem um, `src/integrate.js:119`) | TURNS | TIME | COST |
| Subagente | TYPE (`agentType`) | — | TURNS | TIME | OUTPUT |
| Revisor entre lanes | EFFORT `inherited` | — | TURNS | TIME | COST |
| Suíte | COMMAND | — | LINES (linhas até agora) | TIME | EXIT (código, quando terminar) |

COST e OUTPUT de uma task ou barreira **rodando** são `—`. Esses números só
existem quando a tentativa termina (`src/monitor.js:420-431`), e o registro
guarda o da tentativa anterior até lá (`src/run.js:246-255`). A regra fica no
`monitor`: task em `running` sai com `costUsd` e `outputTokens` nulos.

**Os `id`s**: `T<n>` para tasks e barreiras, como hoje (`src/ui.html:1780`);
o `tool_use_id` para subagentes, como hoje (`src/ui.html:1811`); `suite` para a
suíte; `review` para o revisor, com os subagentes dele pelo `tool_use_id`. São
esses que vão no hash (§6.8).

**Quem vem selecionado** — *decisão minha*: o primeiro agente que precisa de
você (§8.2); se nenhum precisa, o primeiro que está rodando. A seleção fica
presa ao `id` entre os snapshots. O operador do cabeçalho não pode mudar de
agente sozinho a cada segundo.

**Ninguém trabalhando.** A lista vazia vira o estado de hoje
(`src/ui.html:2090-2093`):
- o operador `dormindo`;
- `nobody working — waiting on <etapa>`;
- o COPY do comando que destrava a próxima etapa (§8.3).

**CONDITION** (no protótipo, CONDIÇÃO).
- **Centro:** o operador grande, em `orgulho` quando nada precisa de você e em
  `travado` quando algo precisa.
- **Lanes:** distribuídas alternando esquerda e direita, de cima para baixo,
  com qualquer número de lanes; a área rola quando não cabem. Cada lane mostra
  `feitas/total` ou o estado da task que parou, e é clicável.
- **Fim do run:** em cima, a fase do fim do run; embaixo, a próxima barreira,
  ou `no barrier`.
- **ALERTS (§8.2):** embaixo de tudo, uma linha por alerta, com o que
  aconteceu, a etiqueta e o COPY do comando que resolve (§8.3).

### 6.3 INV — tasks

Tem as sub-abas `ALL`, `PROBLEMS`, `RUNNING`, `QUEUE` e `DONE`.

**A tabela** tem estas colunas:

- `T`
- `NAME`
- `LANE` (`BARRIER` para barreira)
- `EFFORT`
- `TRIES`
- `TIME`
- `$`
- estado
- em QUEUE, mais `WAITING ON` (`queueAfter`)

A linha da task selecionada fica invertida.

**O painel da direita é a ficha da task.** Ele traz todos os campos da ficha de
hoje (§5), com COPY no id da sessão, no caminho do log, no erro e no comando
`resume`, e mais duas coisas:

- **EFFORT**: o nível, a origem (`planned` ou `used`), a seta quando subiu, e
  o motivo da linha do plano (`tasks[].effort`, §9.1).
- **TRIES**: a corrente das tentativas, como `medium failed › high failed ›
  xhigh failed` (`tasks[].tries`, §9.1). Uma tentativa em curso aparece no fim
  da corrente como `<nível> running`.

O erro aparece no bloco `ERROR` (ou `WHY IT STOPPED`, para `blocked`), em
âmbar e renderizado como markdown, como hoje (`src/ui.html:2390`). O COPY fica
no cabeçalho do bloco.

### 6.4 DATA — QUESTS, LOG, NUMBERS

- **QUESTS** (no protótipo, MISSÕES). As tasks são missões, separadas em `IN
  PROGRESS`, `QUEUED` e `DONE`. Os objetivos da missão selecionada são **os
  passos do próprio plano**, com o checkbox marcado ou não, vindos da ficha da
  task (`/api/task`, `steps`, `src/ui.html:2401-2403`). Quando a task parou, o
  bloco `WHY IT STOPPED` mostra o erro, com COPY.
- **LOG** (no protótipo, REGISTRO). É o feed do run de hoje (`snapshot.feed`,
  só tasks, `src/monitor.js:682-683`), **mais os eventos do revisor**
  (`reviewer.activity`), intercalados pela hora na página. Cada linha traz
  hora, quem (`T7 › implementer`, `review`), ferramenta e alvo. Tem a busca, o
  filtro (all, errors, Bash, edits) e o botão de quebrar linha. As linhas da
  suíte não entram; elas moram no RADIO.
- **NUMBERS** (no protótipo, NÚMEROS). Traz:
  - custo por lane, em barras;
  - a duração de cada etapa (`stages[].startedAt`/`endedAt`, A §6.5);
  - o esforço **no plano**: quantas tasks em cada nível, contando o planejado
    (`effort.planned`, §9.1); e quantas subiram numa nova tentativa;
  - o painel RUN: base, comando de teste, lanes · máximo, relógio contra tempo
    de agente, ganho ×, tokens, commits, suíte, veredito da revisão.

  O protótipo tem um "tempo parado esperando gente", que não tem fonte de
  dado e **não entra**.

### 6.5 MAP — o mapa de missão

As lanes viram trilhas horizontais, uma por lane, na ordem de `st.lanes`. As
trilhas convergem em `MERGE`, que segue pelas barreiras em ordem, depois `SUITE`
e por fim `REVIEW`.

**Posição dos nós** — *decisão minha*. Cada task fica na linha da sua lane. A
coluna é o caminho mais longo até a task, num grafo com dois tipos de aresta:

- as arestas de `edges` (§9.1) entre tasks de lane;
- uma aresta implícita de cada task para a seguinte **na mesma lane**, porque
  a lane roda em sequência (`st.lanes[].tasks`).

A aresta implícita garante colunas diferentes para tasks da mesma lane, mesmo
quando o `packLanes` juntou tasks independentes (`src/build-dag.js:238-243`).

**Quais arestas aparecem:** só as de `edges` entre tasks de lanes
**diferentes**, tracejadas. Não aparecem:

- as arestas para barreiras. O `findBarriers` só faz barreira de uma task que
  depende de todas as outras (`src/build-dag.js:149-165`), e ela roda no
  `integrate`, depois do `MERGE`;
- as arestas de tasks feitas antes do `init`, que não estão em lane nenhuma.

**Marcações:**
- Um nó feito fica cheio; um rodando pisca; um que parou fica em âmbar.
- Sobre os nós que estão rodando ou parados fica um operador pequeno na pose
  do estado; sobre `SUITE` e `REVIEW` também, enquanto rodam.
- Clicar numa task abre no INV; clicar em `SUITE` ou `REVIEW` abre a estação
  no RADIO.
- A legenda mostra as cinco poses.

### 6.6 RADIO — as estações

Cada estação é uma fonte de saída ao vivo:

| Estação | No ar quando | Mostra | "Linha nova" (dispara o estouro da onda) |
|---|---|---|---|
| `FULL SUITE` | `suiteLive != null` (A §6.5) | `suiteLive.lines`. Depois que termina, o `integration.suite.summary` e o resultado. Antes, `no signal — starts after the merge`. | o número de linhas cresceu |
| `CROSS-LANE REVIEW` | `reviewer.status === 'running'` | A atividade do revisor, uma linha por evento. | evento novo |
| `T<n> · LANE TESTS` | a task está rodando e tem `lastTest` (§9.1) | O comando, o estado (`running`, `pass`, `fail`) e o fim da saída que o digest guardou (§9.1). | `lastTest.at` mudou ou o resultado chegou |

Há uma estação `T<n>` por task rodando com `lastTest`. Quando a task para, a
estação sai da lista.

**A onda** fica sobre um eixo em L: base com marcações para cima e régua
vertical à direita, sem caixa e sem grade. O desenho usa um viewBox de 400 ×
160, esticado na largura.

- **No ar:** a onda é uma mistura de senos com picos que nascem na esquerda e
  andam para a direita perdendo força. Cada linha nova dá um estouro de picos.
- **Fora do ar:** a onda fica reta, com um chiado de 1 unidade.
- **Quando atualiza:** a 50 ms, e só com a aba RADIO aberta e o documento
  visível.

O protótipo tem o algoritmo pronto (`prototipo.html`, função do `setInterval`
de 50 ms).

### 6.7 Copiar

O padrão é o do botão COPY do protótipo: borda âmbar, ícone de duas folhas e
`COPIED ✓` por 1,6 s. O botão usa a área de transferência quando há contexto
seguro e cai no `execCommand('copy')` quando não há, como o `copyText` de hoje
(`src/ui.html:1722`). O botão aparece em:

- todo bloco de erro (`ERROR`, `WHY IT STOPPED`);
- todo alerta com comando;
- o id da sessão;
- o caminho do log;
- a branch da lane.

O COPY de um erro copia o texto inteiro do erro, não o recorte que aparece na
lista.

### 6.8 Endereço e teclado

O estado da página vai no hash, como `#tab=INV&task=4` ou `#tab=STAT&agent=T7`
(os `id`s de §6.2), e sobrevive a reload. `#task=4`, o formato de hoje,
continua abrindo a task 4 no INV: links já colados em algum lugar não podem
quebrar.

Abas, sub-abas, agentes, linhas da tabela, nós do mapa e estações são todos
`<button>`. Esc volta da task selecionada para a lista.

### 6.9 Largura — *decisão minha*

- A partir de 1100 px: o layout do protótipo.
- Entre 700 e 1099 px: STAT fica em duas colunas, com os detalhes indo para
  baixo do agente; INV mostra a ficha abaixo da tabela.
- Abaixo de 700 px: uma coluna, abas com rolagem horizontal e rodapé em duas
  linhas. O mapa ganha rolagem horizontal, sem encolher os nós.

---

## 7. O operador

### 7.1 As poses

| Pose | Quando | Troca de quadro | Ciclo |
|---|---|---|---|
| `trabalhando` | `running`: controladora, implementador, suíte, e subagentes que não são de revisão | o lápis escreve | 0,7 s, metade cada |
| `revisando` | o revisor entre lanes e **todos** os subagentes dele; e, nas tasks, subagente cujo `agentType` tem "review" | a lupa vira | 1,8 s, metade cada |
| `travado` | `blocked` e `needs-verify` | a mão acena, o "!" sobe | 0,6 s, metade cada |
| `falhou` | `failed` | as estrelas giram | 0,5 s, metade cada |
| `dormindo` | sem sinal (§8.1) e `interrupted` | a cabeça cai, o Z sobe | 1,6 s, metade cada |
| `orgulho` | `done`, e STAT › CONDITION sem nada para você | a piscada | 3,2 s, quadro 2 de 93% a 98% |

Task em `pending` não tem operador.

`interrupted` usa `dormindo` — *decisão minha*. O processo parou sem erro do
agente, e o trabalho retoma com `plo resume`; `falhou` diria que o agente
quebrou. A etiqueta diferencia `INTERRUPTED` de `NO SIGNAL`.

### 7.2 Como anima

Cada operador são dois `<svg>` sobrepostos, um por quadro. O quadro 2 usa
keyframes `step-end` que o mostram metade do ciclo (ou de 93% a 98%, na
piscada). O quadro 1 usa as keyframes inversas, então nunca aparecem os dois
nem nenhum.

- **Atraso por boneco:** cada um ganha um `animation-delay` negativo próprio,
  para os bonecos não piscarem em sincronia.
- **Sem respiração:** não há outro movimento além da troca de quadros.
- **Alerta:** em estado de alerta, o boneco pinta com `--al` (âmbar) em vez do
  verde (classe `.al`).

O protótipo tem tudo isso pronto, e ele foi conferido assim: com as animações
pausadas e o `currentTime` avançado em mais de 20 instantes por tela, nunca
apareceram os dois quadros nem nenhum.

### 7.3 O arquivo

Os 12 quadros estão em `2026-10-26-painel-operador/operador/` (de 16 a 20 KB
cada). Cada arquivo tem três `<path>` com classe e sem preenchimento:

- `class="sil"`: a silhueta;
- `class="ln"`: o traço;
- `class="fx"`: o que flutua — "!", Z, estrelas, gota.

Eles viram **um arquivo de sprite**, `src/assets/operador.svg`, com 12
`<symbol id="op-<pose>-<1|2>">`. Na montagem, cada classe troca por estilo
inline: `sil` e `fx` viram `style="fill:var(--fig)"`, e `ln` vira
`style="fill:var(--ln)"`. O estilo inline é o que deixa a cor vir de quem usa o
`<use>`. O `prototipo.html` tem o sprite já montado assim.

A página busca o arquivo uma vez e o injeta escondido no documento **antes** de
desenhar o primeiro operador.

O sprite fica fora do `ui.html` — *decisão minha*. São cerca de 230 KB de
coordenadas numa linha só. Dentro do `ui.html`, todo agente que abrisse o
arquivo para mexer na página leria isso.

Como o operador foi gerado e como gerar uma pose nova no mesmo traço:
`2026-10-26-painel-operador/gerar/README.md`.

### 7.4 Propriedade intelectual

- O operador é um mascote **original**. O prompt pede "one original cartoon
  mascot" no estilo de propaganda dos anos 1950 e não cita nenhum personagem
  (`gerar/jobs.json`). A versão de cabelo repartido de lado foi descartada por
  lembrar demais o Vault Boy.
- A página **não usa** o nome Pip-Boy, o logotipo, a fonte, os sons nem nenhuma
  imagem do Fallout. O nome "PLO-MATIC 3000", que esteve na moldura do
  protótipo, saiu junto com a moldura.
- O estilo de fósforo verde, abas no topo e linhas de varredura é livre.
- A pasta de skin local com o Vault Boy, discutida na sessão, **não entra**: o
  operador ocupou o lugar dela.

---

## 8. Estados derivados

### 8.1 Sem sinal — *decisão minha*

Um agente `running` cujo último evento no log (`lastActivityAt`,
`src/monitor.js:167` e `438`) está há **6 minutos ou mais** aparece como `NO
SIGNAL`:

- pose `dormindo`;
- etiqueta tracejada em âmbar;
- `WHAT TO DO` dizendo há quanto tempo e qual foi a última ação.

**A partir de 15 minutos**, também entra na lista de §8.2.

Os dois números vêm da espera cega da controladora, `sleep 300` (A §1). Com 5
minutos, todo ciclo normal de espera viraria alarme. Com 6, o usuário vê a
espera, mas não é chamado por ela.

A conta é feita na página, com a hora do servidor (`skew`), sem campo novo no
snapshot. Vale para tasks, barreiras e o revisor. Subagente não entra: o
silêncio dele aparece no pai.

### 8.2 O que precisa de você

Uma lista só, que alimenta o chip `! N ALERTS`, o `N NEED YOU` do rodapé e a
lista ALERTS. Ela tem um item para cada um destes casos:

- task ou barreira `failed`, `blocked`, `needs-verify` ou `interrupted`;
- task, barreira ou revisor sem sinal há 15 minutos ou mais;
- etapa da integração `interrupted` (A §6.4);
- merge falhado (`integration.status === 'merge-failed'`);
- suíte que **rodou e falhou** (`suite.ok === false` sem `skipped`);
- revisão que terminou com ressalvas (`review.clean === false`);
- limite de uso com status diferente de `allowed` (`snapshot.rateLimit`, como
  hoje, `src/monitor.js:693`);
- plano mudado depois do `init` (`snapshot.planChanged`).

**Ficam de fora**, embora o `buildStages` os marque como `failed`
(`src/monitor.js:541`, `547`):

- a suíte pulada por falta de comando de teste (`suite.skipped`). Aparece só em
  DATA › NUMBERS, como `not run — no test command`;
- a revisão sem ressalvas.

### 8.3 WHAT TO DO e o comando de cada alerta — *decisão minha*

O texto é montado pela página a partir do que o run gravou; nenhum modelo
escreve conselho. O comando vem do mesmo `cmd` de hoje (`src/ui.html:1763`),
**com o verbo certo**. `plo resume` só roda tasks de lane: o `runLanes` exclui
as barreiras (`src/run.js:348`), e a integração só roda com `plo integrate` ou
`--integrate` (`bin/plo.js:208-215`).

| Situação | Texto | Comando |
|---|---|---|
| task de lane `failed` / `blocked` / `needs-verify` | o erro gravado | `plo resume --plan …` |
| task de lane `interrupted` | "the process that drove it stopped" | `plo resume --plan …` |
| barreira `failed` / `blocked` / `needs-verify` / `interrupted` | o erro gravado, ou "the process that drove it stopped" | `plo integrate --plan …` |
| merge falhado; etapa da integração `interrupted` | o `detail` da etapa | `plo integrate --plan …` |
| suíte rodou e falhou | as últimas linhas do `suite.summary` | `plo integrate --plan …` |
| revisão com ressalvas | o veredito (`review.verdict`) | nenhum. O COPY copia o caminho do relatório (`review.reportFile`, `.plo-logs/cross-lane-review.md`) |
| sem sinal | "no event for N min — last: <última ação>" | nenhum |
| limite de uso | "usage limit — resets at HH:MM" | `plo resume --plan …` |
| plano mudado | "the plan changed after init — re-run analyze" | `plo analyze --plan …` |
| ninguém trabalhando, lanes feitas, integração não começou | "lanes done — the integration has not started" | `plo integrate --plan …` |

A página de hoje manda `plo resume` também para barreira (`src/ui.html:2025`,
`2034`); a página nova corrige.

### 8.4 Subagente de quem já parou

O `monitor` marca como `running` todo subagente cujo resultado ainda não
chegou (`src/monitor.js:360-363`). Se o processo da task morreu, o resultado
não chega nunca.

**Regra:** subagente `running` sob uma task (ou sob o revisor) que **não**
está `running` aparece como `interrupted`, com pose `dormindo`. A regra fica no
`monitor`, ao montar os `children`, para que a página e qualquer outro leitor
recebam o mesmo estado.

---

## 9. Dados e servidor

### 9.1 O que este documento acrescenta ao snapshot

O A §3.1 deixa o B acrescentar campos ao contrato de §6.5, sem remover nenhum.

| Campo | O que é | De onde |
|---|---|---|
| `edges` | `[{ from, to }]`, as arestas de dependência do plano, para o MAP (§6.5). | O `cmdRun` calcula o grafo completo, com as sobreposições de lane (`bin/plo.js:177`; `loadOverrides` em `70-85`, que mexem nas arestas, `src/build-dag.js:83-87`), e **grava as arestas no estado** a cada `run`/`resume`. O `monitor` só repassa. Assim o `serve` não precisa achar nem ler o arquivo de sobreposições. Estado gravado antes desta mudança não tem o campo: o MAP desenha sem arestas entre lanes. |
| `usage5h` | `{ utilization, resetsAt, at }`, ou `null`. `utilization` é fração (0,05 = 5%); `resetsAt` é epoch em **segundos**, como hoje (`src/ui.html:2028`); `at` é quando o evento chegou. | O `rate_limit_event` traz `unifiedWindows.five_hour` em todos os 98 logs de `plo` conferidos em 26/10, mas é raro (de 2 a 22 por log de vários MB) e muitas vezes cai fora dos 512 KB finais que o `monitor` lê (`TAIL_BYTES`, `src/monitor.js:27`): em 8 de 21 logs medidos, o último ficou fora. Por isso **quem grava é o processo que dirige o agente**: o `runAgent` aceita `onEvent` (`src/spawn.js:74`, `121`); o `runTask`, o `runBarriers` e o `crossLaneReview` passam um que, num `rate_limit_event`, grava `usage5h` no estado. Vale o último gravado. |
| `tasks[].effort` | `{ planned, used, raised, reason }`, ou `null` quando o nível é herdado: sem linha `**Effort:**` e sem nível usado gravado, como o `null` de A §6.5. `planned` vem do plano atual; `used`, do registro da última tentativa (A §5.8); `raised`, se `used` está acima de `planned` (A §5.6); `reason`, do motivo da linha (A §5.3). | Dá forma ao campo que o A §6.5 descreve e o A §8 deixou sem nome. A página mostra `used` quando existe, senão `planned`. |
| `tasks[].lastTest` | `{ command, at, ok, tail }` ou `null`. | A última chamada de Bash **da task ou de qualquer subagente dela** — no fluxo da controladora, quem testa é o subagente implementador (`sub: true`, `src/monitor.js:196-198`, `231-238`) — cujo comando é o `st.testCommand` ou bate num runner conhecido (vitest, jest, `node --test`, pytest, `go test`). `ok` é `null` enquanto o resultado não chegou. `tail` são as últimas 10 linhas da saída, até 1 KB. O digest guarda isso à parte: o `preview` de hoje é o **começo** da saída numa linha de 140 caracteres (`src/monitor.js:117`), e o resumo de um runner fica no fim. O `command` usa o comando inteiro, não o recorte de 100 caracteres do alvo (`src/monitor.js:83`). |
| `tasks[].tries` | `[{ effort, status, at }]`, uma entrada por tentativa terminada. | Gravada no fim de toda tentativa em que o agente rodou até o fim, com o status em que ela terminou. Inclui a falha da API (limite de uso, 529): ela não sobe o contador do A (A §5.6), mas gastou uma tentativa. Leva o `effort` que o A gravou no início (A §5.8). Não entra: falha de preparo da lane (`src/run.js:232-234`), binário que não abre (`273-275`) e interrupção, que não grava fim; a interrupção aparece pelo estado `interrupted`. **É histórico:** não zera no `run`/`resume`, ao contrário do contador do A. |

O TRY de §6.2 é o `attempts` que já existe (o teto de tentativas), não o
tamanho de `tries`.

### 9.2 Custo — *decisão minha*

Para o custo do rodapé, da coluna `$` e do custo por lane serem a mesma conta:

- **`costUsd` soma as tentativas**, como o `outputTokens` já soma
  (`src/run.js:307-313`). Hoje ele guarda só a última (`src/run.js:306`).
- **As barreiras gravam `costUsd` e `outputTokens`** como as tasks de lane.
  Hoje não gravam (`src/integrate.js:151-157`).
- **O custo do revisor** (`integration.stages.review.costUsd` no estado,
  A §6.1) entra no total que
  a página mostra no rodapé e no painel RUN. O `totals.costUsd` do snapshot
  (`src/monitor.js:687`) passa a incluí-lo.
- **Task rodando sai com `costUsd` e `outputTokens` nulos** no snapshot (§6.2).
- **Subagente não tem custo**, só `outputTokens` (`buildChildren`,
  `src/monitor.js:335-384`); a página não inventa um.

### 9.3 Rota de ativos — *decisão minha*

O `serve.js` ganha `GET /assets/<nome>`. A rota responde **só** aos nomes de
uma lista fixa:

- `operador.svg` (`image/svg+xml`);
- a Roboto Condensed (`font/ttf`, o arquivo variável oficial, sem conversão);
- `OFL.txt`, a licença da fonte (`text/plain`).

A comparação é com o nome **já decodificado** e exige igualdade exata com um
item da lista; qualquer outro nome leva 404, e nada da URL vira caminho de
arquivo. Hoje qualquer rota fora das conhecidas já leva 404
(`src/serve.js:157`).

A fonte é a Roboto Condensed por ser a do protótipo aprovado. A licença SIL
Open Font License deixa distribuí-la junto com o código, desde que o arquivo de
licença vá junto.

### 9.4 Render sem reiniciar animação

O stream manda um snapshot inteiro sempre que o poll acha mudança
(`src/serve.js:66-80`, `130-155`), ou seja, quase todo segundo durante um run.
Trocar o `innerHTML` de um operador reinicia a animação dele. Por isso:

- Cada operador, linha de agente e nó do mapa só é refeito quando a pose ou o
  estado dele mudam. É o mesmo princípio do `paint` e do `data-sig` de hoje
  (`src/ui.html:1217`, `2101-2117`).
- O relógio e os `data-since` atualizam só o texto.
- A onda do rádio é a única coisa redesenhada continuamente.

---

## 10. Decisões minhas, para conferir

1. **Página em inglês**, como o CLI, a página de hoje e o repositório público.
   O protótipo em português é só desenho (§6).
2. **Só tema escuro**; o tema claro de hoje sai (§4).
3. **Sem sinal a partir de 6 min** sem evento, e vira alerta a partir de
   15 min, por causa do `sleep 300` da controladora (§8.1).
4. `interrupted` usa a pose `dormindo`, não `falhou`; subagente de quem já
   parou aparece `interrupted` (§7.1, §8.4).
5. **WHAT TO DO** é montado pela página com o erro gravado e o comando certo
   para cada caso: `resume` para lane, `integrate` para barreira e integração,
   `analyze` para plano mudado (§8.3).
6. Suíte pulada por falta de comando e revisão limpa **não** são alerta;
   revisão com ressalvas é, e copia o caminho do relatório (§8.2, §8.3).
7. Agente selecionado por padrão: o primeiro que precisa de você; se nenhum
   precisa, o primeiro rodando. A seleção fica presa ao `id` entre snapshots
   (§6.2).
8. Os cinco números do herói mudam por tipo de agente; o que ainda não existe
   aparece como `—` (§6.2).
9. **Custo soma as tentativas**, barreira grava custo, o revisor entra no
   total, e task rodando sai com custo nulo (§9.2).
10. `usage5h` é gravado no estado pelo processo que dirige o agente, não lido
    do log; `edges` também vai para o estado, gravado pelo `cmdRun` (§9.1).
11. `lastTest` conta as chamadas dos subagentes e guarda o fim da saída
    (§9.1).
12. `tries` é histórico e não zera no `resume`; o TRY mostrado é o `attempts`
    (§9.1).
13. **Sprite fora do `ui.html`**, em `src/assets/operador.svg`, servido por uma
    rota `/assets/` de lista fechada, junto com a Roboto Condensed e o
    `OFL.txt` (§7.3, §9.3).
14. MAP: coluna pelo caminho mais longo com as arestas de lane implícitas; só
    arestas entre lanes diferentes são desenhadas (§6.5).
15. `#task=N` continua funcionando; o hash novo é `#tab=…&task=…` ou
    `#tab=…&agent=…` (§6.8).
16. Larguras: 1100 e 700 px como pontos de quebra (§6.9).
17. Sem stream, nada se mexe: operadores no quadro 1, onda reta, relógios
    parados. `QUIET` não congela (§6.1).

---

## 11. O que fica para quem constrói

- A ordem das tasks de página dentro do plano. As de dados do A e de §9 vêm
  antes (A §3.1).
- O desenho exato do MAP (espaçamento, curvas das arestas), desde que a regra
  de posição de §6.5 valha.
- A lista exata de runners que `lastTest` reconhece, além do `testCommand`.
- Como montar o sprite a partir dos 12 SVGs: um script de uma vez, sem virar
  dependência do `plo`.
- Onde baixar o arquivo oficial da Roboto Condensed e como guardar o
  `OFL.txt`.
- **O smoke gate.** O repositório do `plo` ainda não tem `smoke/PROJECT.md`, e
  a primeira task de página precisa passar pelo bootstrap. Hoje os testes
  montam o estado em tmpdir (`test/monitor.test.js:62-68`), e `test/fixtures`
  só tem o agente falso.

  O gate precisa de um **gerador de fixture** que escreva plano, estado e logs
  **no momento em que roda**:
  - timestamps relativos ao agora, para os casos rodando, sem sinal (mais de
    6 e mais de 15 min) e parado;
  - um processo auxiliar vivo cujo `pid` (e horário de início, A §8) vai nas
    tasks e etapas `running`, para elas não virarem `interrupted` (A §6.4);
  - um `full-suite.log` em que o gerador acrescenta linhas durante o teste.

  Tudo sem rede e sem run de verdade.

---

## 12. Como saber que funcionou

**`node --test`**

- `GET /assets/operador.svg` responde 200 com `image/svg+xml`; `OFL.txt`
  responde 200.
- `GET /assets/..%2Fpackage.json`, `GET /assets/operador.svg.bak` e
  `GET /assets/` respondem 404. O caminho `/assets/../package.json` não serve
  de teste, porque o `new URL` normaliza antes do roteamento
  (`src/serve.js:89`).
- O snapshot de um estado de fixture traz:
  - `edges` igual ao `buildDag(...).edges` de `bin/plo.js:177` para o mesmo
    plano e as mesmas sobreposições;
  - `usage5h` com o último evento gravado;
  - `lastTest` de uma chamada de teste feita por subagente;
  - `tries` com uma entrada por tentativa terminada, mantida depois de um
    `resume`;
  - `costUsd` somado entre tentativas;
  - custo e tokens nulos numa task `running`;
  - um subagente sem resultado sob uma task `failed` como `interrupted`.
- `plo run` com um agente falso que emite `rate_limit_event` grava `usage5h` no
  estado.

**Smoke gate**, no navegador, contra o `plo serve` com o fixture de §11:

- Cada aba e cada sub-aba, ao ser clicada, mostra no corpo um elemento com o
  título da sub-aba e pelo menos uma linha com um `T<n>` do fixture.
- Clicar num agente em STAT › AGENTS muda o nome no cabeçalho para o daquele
  agente, e o hash para `#tab=STAT&agent=<id>`.
- Com uma task `failed` no fixture:
  - o chip `! N ALERTS` aparece com o N da lista do fixture;
  - clicar nele abre CONDITION;
  - o COPY do bloco ERROR no INV troca o rótulo para `COPIED ✓`, e a área de
    transferência recebe o erro inteiro.
- Uma barreira `failed` no fixture oferece `plo integrate --plan …`, não
  `plo resume`.
- Clicar num nó do MAP abre a task no INV; clicar em `SUITE` abre a estação no
  RADIO.
- RADIO: a medida é a amplitude pico a pico dos primeiros 80 pontos da onda,
  em unidades do viewBox.
  - Com a suíte no ar, logo depois de o gerador acrescentar uma linha ao
    `full-suite.log`, a medida passa de 30 em pelo menos uma de 10 amostras
    seguidas (50 ms cada).
  - Com a estação fora do ar, fica em 2 ou menos em todas as amostras.
- Depois que o sprite carregou, em cada tela com operadores, avançando o
  `currentTime` das animações:
  - nunca aparecem os dois quadros;
  - nunca falta quadro;
  - todo `<use>` tem `getBBox().width > 0`.
- Derrubar o `plo serve` faz aparecer `RECONNECTING…`, e a onda e os
  operadores param.
- Abrir `/#task=4` abre a task 4 no INV.
- Com `prefers-reduced-motion`, `document.getAnimations()` não traz nenhuma
  animação rodando.
- A página não faz nenhuma requisição fora de `localhost`.
- A 390 px de largura não há rolagem horizontal da página. Só o mapa rola.
