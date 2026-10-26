# Painel do operador — desenho (documento B)

> **Status:** aguardando aprovação.
> Branch `feat/esforco-e-painel-pipboy`.
> **Documento irmão:** `2026-10-26-esforco-por-task-e-fim-do-run-design.md`
> (documento A). O A diz **o que** a página precisa mostrar — os dados do
> snapshot e os estados (§6.5 e §6.6 do A). Este documento diz **como** aparece.
> Os dois viram **um plano só** (A §3.1).
> **Protótipo aprovado:** `2026-10-26-painel-operador/prototipo.html` (abre
> direto no navegador, com dados de exemplo e três cenários).

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

**Não-metas**

- Tema claro. O fósforo verde é escuro por natureza (§4).
- Comandar o run pela página (pausar, retomar, editar o plano). O `plo serve`
  continua só leitura; a página entrega o comando pronto para copiar, como hoje.
- Dados novos além dos de §9. O que o A entrega é a base.

**Anti-metas** — o que faria isto falhar mesmo funcionando:

- O operador animado e a onda mexendo **com o stream caído**. Uma página que
  parece viva sem saber do run é pior que a de hoje (§6.1).
- Um processo morto aparecendo como rodando. O A grava o `pid`; a página usa
  `interrupted` (§8).
- O operador lembrar o Vault Boy, ou a página usar o nome Pip-Boy, a fonte ou o
  logotipo do jogo (§7.4).
- Os bonecos piscando ou reiniciando a animação a cada snapshot (§10).

---

## 4. Restrições

- **Zero dependências e sem build** (A §4). A página continua um arquivo só,
  `src/ui.html`, lido a cada requisição (`src/serve.js:97-106`). Os ativos
  binários (o desenho do operador e a fonte) vão em arquivos ao lado, servidos
  por uma rota nova e fechada (§9.2).
- **Sem requisição externa.** O protótipo puxa a Roboto Condensed do Google
  Fonts; a página não pode. A fonte vai no repositório (§9.2). Hoje a página
  usa as fontes do sistema (`src/ui.html:117`).
- **Só tema escuro** — *decisão minha*. Hoje existe o tema claro
  (`src/ui.html:72`). O fósforo verde sobre fundo claro não existe no jogo e
  perde o contraste que faz o tema funcionar.
- **Movimento reduzido** é respeitado, como hoje (`src/ui.html:231`, `477`):
  com `prefers-reduced-motion`, o operador fica no quadro 1, nada pisca, e a
  onda do rádio só muda quando chega linha nova, sem animação contínua.
- **Propriedade intelectual** (§7.4).

---

## 5. Inventário: o que a página de hoje faz e para onde vai

Cada linha é um compromisso: quem constrói não pode deixar nenhuma de fora.

| Hoje | Onde está | Na página nova |
|---|---|---|
| Título da aba do navegador com `⚠` e `feitas/total` | `src/ui.html:1957-1959` | Igual. |
| Nome do plano; base `branch` @ commit; comando de teste; lanes · máximo | `src/ui.html:1927`, `1948-1953` | DATA › NÚMEROS, painel RUN. O nome do plano também fica na barra das abas. |
| Veredito em uma frase (feitas, quem parou, quantos agentes trabalhando) | `src/ui.html:1980-1998` | Rodapé e STAT › CONDIÇÃO. |
| Faixa de etapas (lanes, merge, barreiras, suíte, revisão) | `src/ui.html:2007-2016` | MAP (fim da trilha) e rodapé (§6.1). |
| Alertas com o comando copiável: limite de uso, plano mudou, task falhou ou travou (com `plo resume` e "Read it") | `src/ui.html:2022-2041` | STAT › CONDIÇÃO, lista ALERTAS; o chip `! N ALERTS` no topo leva até ela. Cada alerta mantém o botão COPY do comando. |
| Tripulação: agentes vivos e parados, subagentes aninhados, o que cada um faz, relógio, turnos, tokens, tentativa | `src/ui.html:2077-2207` | STAT › AGENTES (§6.2). |
| Gaveta do agente: relato do erro em markdown, copiar `resume` e branch, últimos eventos, "Task record" | `src/ui.html:2168-2190` | STAT › AGENTES, coluna da direita; o link "open in INV" faz o papel do "Task record". |
| Fila com o que segura cada task | `src/ui.html:2260-2270`, `queueAfter` em `1831` | INV › QUEUE, coluna WAITING ON. |
| Resultado: relógio contra tempo de agente, ganho ×, tokens, commits, suíte, veredito da revisão | `src/ui.html:2278-2299` | DATA › NÚMEROS. |
| Feitas, com tokens e commits | `src/ui.html:2302-2311` | INV › DONE. |
| Feed do run com busca, filtro (erros, Bash, edições) e quebra de linha | `src/ui.html:2319-2341`, `2554-2560` | DATA › LOG, com os mesmos três controles. |
| Ficha da task (`/api/task`): status, lane, duração, turnos, tentativas, tokens, modelo, sessão e log com copiar, commits, erro, resultado do agente, escritas declaradas, excluídas, passos do plano, atividade | `src/ui.html:2351-2411` | INV, painel da direita da task selecionada — todos os campos, mais o esforço e as tentativas (§6.3). |
| Link `#task=4` que sobrevive a reload e cola no Slack | `src/ui.html:2441-2457` | Continua abrindo a task, agora no INV (§6.8). |
| Teclado: Esc fecha, foco preso no painel modal | `src/ui.html:2500-2552` | Não há mais modal. Toda área clicável é `<button>` com foco visível; Esc volta da task para a lista (§6.8). |
| Relógios vivos (`data-since`), corrigidos pela hora do servidor | `src/ui.html:2584-2597`, `skew` em `2610` | Igual. |
| Indicador do stream: ao vivo, reconectando, quieto há N | `src/ui.html:2601-2623` | Canto direito da barra das abas (§6.1). |
| Estado vazio ("No state file yet — run `plo analyze`…") | `src/ui.html:1929-1943` | A tela mostra a mensagem e o comando com COPY, com o operador dormindo. |
| Avatares gerados por agente, cor por lane | `src/ui.html:1606-1671` | Saem. O operador mostra o estado (§7) e a lane é dita por extenso (`LANE A`). Com uma cor só na tela, a cor não carrega mais a lane. |
| Dica da barreira (`BARRIER_TIP`) | `src/ui.html:1446` | INV, na coluna LANE (`BARRIER`), com a mesma frase como dica. |
| Layout por largura | `src/ui.html:287`, `394`, `402` | §6.9. |

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
- **Chip `! N ALERTS`** em âmbar, quando N > 0: leva a STAT › CONDIÇÃO. N é a
  contagem de §8.2, a mesma do rodapé.
- **Sinal do stream**, à direita das abas: `● LIVE`, `QUIET 2m` (sem evento há
  30 s ou mais, como hoje, `src/ui.html:2622`) ou `RECONNECTING…` em âmbar.
  **Sem stream, nada se mexe:** com a conexão caída (`RECONNECTING…`), os
  operadores param no quadro 1, a onda do rádio fica reta e os relógios
  param. `QUIET` não para nada: o stream só manda snapshot quando algo muda
  (`src/serve.js:66-72`) e manda `ping` nos intervalos, então quieto ainda é
  conectado.
- **Rodapé**, da esquerda para a direita:
  - `TASKS feitas/total`.
  - `N NEED YOU` em âmbar, só quando N > 0.
  - A barra do run, que muda de texto pela fase:
    - durante as lanes, `RUN · N LANES`;
    - com as tasks feitas e a integração rodando, `END OF RUN · <etapa> <há
      quanto> — not over yet` (A §6.6, estado 1);
    - só com `runOver`, `RUN OVER`.

    O preenchimento conta tasks e etapas feitas sobre o total das duas.
  - `5H LIMIT` com barrinha e porcentagem, em âmbar a partir de 80%, e com a
    hora em que zera na dica (§9.1).
  - Custo.
  - Relógio do run. Ele conta enquanto `totals.active` for `true` e para em
    `runOver` (A §6.5).

### 6.2 STAT › AGENTS e STAT › CONDITION

**AGENTS** tem três colunas.

1. **Lista de agentes.** Fica agrupada como na tripulação de hoje: cabeçalho
   `LANE A · T7 <título>`, a controladora e os subagentes indentados embaixo.
   Depois vem o grupo das barreiras e, com a integração rodando, o grupo `END
   OF RUN`, com a suíte e o revisor entre lanes (`snapshot.reviewer`, A §6.5)
   e os subagentes dele. Entram os agentes vivos e os parados — o mesmo filtro
   de hoje (`src/ui.html:1882-1884`) — mais a suíte e o revisor.
2. **O agente selecionado.** Mostra:
   - o operador na pose do estado (§7);
   - `T7 · IMPLEMENTER`, a etiqueta de estado e o que está fazendo agora (o
     último evento, como o `doing` de hoje, `src/ui.html:1801`);
   - cinco números: EFFORT (com `↑` quando a tentativa subiu o nível, A §5.6),
     TRY `n/3`, TURNS, OUTPUT e COST.
3. **Detalhes.** De cima para baixo:
   - `WHAT TO DO`, para quem parou (§8.3), com COPY do comando;
   - `LAST ACTIONS`, a atividade, com hora, ferramenta e alvo;
   - `SUBAGENTS`;
   - o cartão da task (título, arquivos · commits), com os links `open in INV`
     e `see quest`;
   - na suíte, `LIVE OUTPUT` com as últimas linhas de `suiteLive.lines` e o
     link para o RADIO.

**Quem vem selecionado** — *decisão minha*: o primeiro agente que precisa de
você (§8.2); se nenhum precisa, o primeiro que está rodando. A seleção fica
presa ao `id` do agente entre os snapshots. O operador do cabeçalho não pode
mudar de agente sozinho a cada segundo.

**CONDITION** (no protótipo, CONDIÇÃO). No centro fica o operador grande: em
`orgulho` quando nada precisa de você, em `travado` quando algo precisa. Em
volta, as lanes, com `feitas/total` ou o estado da task que parou, a fase do fim
do run em cima e a próxima barreira embaixo; cada uma é clicável. Embaixo vem a
lista ALERTS (§8.2): uma linha por alerta, com o que aconteceu, a etiqueta e o
COPY do comando que resolve.

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

- **EFFORT**, com o nível e o motivo vindos do plano (§9.1).
- **TRIES**, a corrente das tentativas, como `medium failed › high failed ›
  xhigh failed` (§9.1).

O erro aparece no bloco `ERROR` (ou `WHY IT STOPPED`, para `blocked`), em
âmbar e renderizado como markdown, como hoje (`src/ui.html:2390`). O COPY fica
no cabeçalho do bloco.

### 6.4 DATA — MISSÕES, LOG, NÚMEROS

- **QUESTS** (no protótipo, MISSÕES). As tasks são missões, separadas em `IN
  PROGRESS`, `QUEUED` e `DONE`. Os objetivos da missão selecionada são **os
  passos do próprio plano**, com o checkbox marcado ou não, vindos da ficha da
  task (`/api/task`, `steps`, `src/ui.html:2401-2403`). Quando a task parou, o
  bloco `WHY IT STOPPED` mostra o erro, com COPY.
- **LOG** (no protótipo, REGISTRO). É o feed do run de hoje (`snapshot.feed`),
  linha a linha, com hora, quem (`T7 › implementer`), ferramenta e alvo. Tem a
  busca, o filtro (all, errors, Bash, edits) e o botão de quebrar linha.
- **NUMBERS** (no protótipo, NÚMEROS). Traz:
  - custo por lane, em barras;
  - quantas tasks em cada nível de esforço;
  - o painel RUN: base, comando de teste, lanes · máximo, relógio contra tempo
    de agente, ganho ×, tokens, commits, suíte, veredito da revisão.

### 6.5 MAP — o mapa de missão

As lanes viram trilhas horizontais, uma por lane, com as tasks como nós na
ordem do estado (`st.lanes[].tasks`). As arestas de dependência entre lanes
aparecem tracejadas (§9.1). As trilhas convergem em `MERGE`, que segue pelas
barreiras em ordem, depois `SUITE` e por fim `REVIEW`.

- Um nó feito fica cheio; um rodando pisca; um que parou fica em âmbar.
- Sobre os nós que estão rodando ou parados fica um operador pequeno na pose
  do estado; sobre `SUITE` e `REVIEW` também, enquanto rodam.
- Clicar numa task abre no INV; clicar em `SUITE` ou `REVIEW` abre a estação no
  RADIO.
- A legenda mostra as cinco poses.

A posição de cada nó é calculada: a coluna vem da profundidade no grafo, a
linha vem da lane. Nada é posicionado à mão.

### 6.6 RADIO — as estações

Cada estação é uma fonte de saída ao vivo:

| Estação | No ar quando | Mostra |
|---|---|---|
| `FULL SUITE` | `suiteLive != null` (A §6.5) | `suiteLive.lines`. Depois que termina, o `integration.suite.summary` e o resultado. Antes, `no signal — starts after the merge`. |
| `CROSS-LANE REVIEW` | `reviewer.status === 'running'` | A atividade do revisor, uma linha por evento. |
| `T<n> · LANE TESTS` | a task está rodando e tem `lastTest` (§9.1) | O último comando de teste que o agente rodou dentro da task e o resultado dele. |

**A onda** fica sobre um eixo em L: base com marcações para cima e régua
vertical à direita, sem caixa e sem grade.

- **No ar:** a onda é uma mistura de senos com picos que nascem na esquerda e
  andam para a direita perdendo força. Cada linha ou evento novo que chega dá
  um estouro de picos.
- **Fora do ar:** a onda fica reta, com um chiado de 1 px.
- **Quando atualiza:** a 50 ms, e só com a aba RADIO aberta e o documento
  visível.

O protótipo tem o algoritmo pronto.

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

O estado da página vai no hash, como `#tab=INV&task=4` ou `#tab=STAT&agent=T7`,
e sobrevive a reload. `#task=4`, o formato de hoje, continua abrindo a task 4
no INV: links já colados em algum lugar não podem quebrar.

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
| `revisando` | o revisor entre lanes, e subagente cujo `agentType` tem "review" | a lupa vira | 1,8 s, metade cada |
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
pausadas e o `currentTime` avançado em mais de 20 instantes por tela, nunca apareceram os dois
quadros nem nenhum.

### 7.3 O arquivo

Os 12 quadros estão em `2026-10-26-painel-operador/operador/` (de 16 a 20 KB
cada). Eles viram **um arquivo de sprite**, `src/assets/operador.svg`, com 12
`<symbol id="op-<pose>-<1|2>">`. As camadas levam o preenchimento em estilo
inline: `fill:var(--fig)` na silhueta e nos efeitos, `fill:var(--ln)` no traço.
Assim a cor vem de quem usa o `<use>`.

A página busca o arquivo uma vez e o injeta escondido no documento.

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

**A partir de 15 minutos**, também entra na contagem de §8.2.

Os dois números vêm da espera cega da controladora, `sleep 300` (A §1). Com 5
minutos, todo ciclo normal de espera viraria alarme. Com 6, o usuário vê a
espera, mas não é chamado por ela.

A conta é feita na página, com a hora do servidor (`skew`), sem campo novo no
snapshot.

### 8.2 O que precisa de você

Uma lista só, que alimenta o chip `! N ALERTS`, o `N NEED YOU` do rodapé e a
lista ALERTS:

- task ou barreira `failed`, `blocked`, `needs-verify` ou `interrupted`;
- agente sem sinal há 15 minutos ou mais;
- etapa da integração `failed` ou `interrupted` (A §6.5);
- limite de uso com status diferente de `allowed` (`snapshot.rateLimit`, como
  hoje, `src/monitor.js:693`);
- plano mudado depois do `init` (`snapshot.planChanged`).

### 8.3 WHAT TO DO — *decisão minha*

O texto é montado pela página a partir do que o run gravou; nenhum modelo
escreve conselho. O comando vem do mesmo `cmd` de hoje (`src/ui.html:1763`).

| Situação | Texto | Comando |
|---|---|---|
| `failed` / `blocked` / `needs-verify` | o erro gravado | `plo resume --plan …` |
| `interrupted` | "the process that drove it stopped" | `plo resume --plan …` |
| sem sinal | "no event for N min — last: <última ação>" | nenhum |
| limite de uso | "usage limit — resets at HH:MM" | `plo resume --plan …` |
| plano mudado | "the plan changed after init — re-run analyze" | `plo analyze --plan …` |

---

## 9. Dados e servidor

### 9.1 O que este documento acrescenta ao contrato do snapshot

O A §3.1 deixa o B acrescentar campos ao contrato de §6.5, sem remover nenhum.
Estes são os acrescentados:

| Campo | O que é | De onde |
|---|---|---|
| `edges` | `[{ from, to }]`, as arestas de dependência do plano, para o MAP. | O `monitor` já parseia o plano a cada snapshot (A §5.8); calcula as arestas como o `cmdRun` faz em `bin/plo.js:177`, com as mesmas sobreposições de lane. |
| `usage5h` | `{ utilization, resetsAt }` da janela de 5 h, ou `null`. | O `rate_limit_event` traz `unifiedWindows.five_hour` em todos os 98 logs de `plo` conferidos em 26/10. O digest já guarda o `rate_limit_info` inteiro (`src/monitor.js:206-207`); vale o da task com o `lastActivityAt` mais recente. Hoje o snapshot só sobe o limite quando ele **não** é `allowed` (`src/monitor.js:693`); este campo sobe sempre. |
| `tasks[].lastTest` | `{ command, at, ok, text }` do último comando de teste que o agente rodou na task, ou `null`. | O digest já guarda as chamadas de Bash e o `preview` do resultado (`src/monitor.js:232`, `254-257`). O teste é reconhecido pelo comando de teste do estado (`st.testCommand`) ou por um padrão de runner (vitest, jest, `node --test`, pytest, `go test`). Sai do digest, não da atividade cortada em 8. |
| `tasks[].tries` | `[{ effort, status }]`, uma entrada por tentativa terminada. | Gravado no registro da task no fim de cada tentativa, junto com o `effort` que o A já grava (A §5.8). |
| `tasks[].effort.reason` | O motivo da linha `**Effort:**` do plano. | O parser do A já guarda o motivo (A §5.3). |

### 9.2 Rota de ativos — *decisão minha*

O `serve.js` ganha `GET /assets/<nome>`. A rota responde **só** aos nomes de
uma lista fixa:

- `operador.svg` (`image/svg+xml`);
- a Roboto Condensed (`font/ttf`, o arquivo variável oficial, sem conversão),
  com a licença `OFL.txt` ao lado.

Qualquer outro nome leva 404, e nada da URL vira caminho de arquivo. Hoje
qualquer rota fora das quatro conhecidas já leva 404 (`src/serve.js:157`).

A fonte é a Roboto Condensed por ser a do protótipo aprovado. A licença SIL
Open Font License deixa distribuí-la junto com o código, desde que o arquivo de
licença vá junto.

### 9.3 Render sem reiniciar animação

O stream manda um snapshot inteiro sempre que o poll acha mudança
(`src/serve.js:66-80`, `130-155`), ou seja, quase todo segundo durante um run. Trocar o
`innerHTML` de um operador reinicia a animação dele. Por isso:

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
3. **Sem sinal a partir de 6 min** sem evento, e conta como "precisa de você" a
   partir de 15 min, por causa do `sleep 300` da controladora (§8.1).
4. `interrupted` usa a pose `dormindo`, não `falhou`. A etiqueta diferencia de
   "sem sinal" (§7.1).
5. **WHAT TO DO** é montado pela página com o erro gravado e o comando, sem
   texto de modelo (§8.3).
6. Agente selecionado por padrão: o primeiro que precisa de você; se nenhum
   precisa, o primeiro rodando. A seleção fica presa ao `id` entre snapshots
   (§6.2).
7. **Sprite fora do `ui.html`**, em `src/assets/operador.svg`, servido por uma
   rota `/assets/` de lista fechada, junto com a Roboto Condensed e a licença
   dela (§7.3, §9.2).
8. Campos novos no snapshot: `edges`, `usage5h`, `tasks[].lastTest`,
   `tasks[].tries` e `tasks[].effort.reason` (§9.1).
9. `#task=N` continua funcionando; o hash novo é `#tab=…&task=…` (§6.8).
10. Larguras: 1100 e 700 px como pontos de quebra (§6.9).
11. Sem stream, nada se mexe: operadores no quadro 1, onda reta, relógios
    parados. `QUIET` não congela (§6.1).

---

## 11. O que fica para quem constrói

- A ordem das tasks de página dentro do plano. As de dados do A vêm antes (A
  §3.1).
- O desenho exato de cada número no MAP (espaçamento, curvas das arestas),
  desde que a posição seja calculada e não à mão.
- O padrão exato de reconhecimento de comando de teste em `lastTest`.
- Como montar o sprite a partir dos 12 SVGs: um script de uma vez, sem virar
  dependência do `plo`.
- Onde baixar o arquivo oficial da Roboto Condensed e como guardar o
  `OFL.txt`.
- **O smoke gate.** O repositório do `plo` ainda não tem `smoke/PROJECT.md`, e
  a primeira task de página precisa passar pelo bootstrap. A página roda
  contra o `plo serve` com um plano e um estado de fixture (`test/fixtures`),
  sem rede e sem run de verdade.

---

## 12. Como saber que funcionou

**`node --test`**

- `GET /assets/operador.svg` responde 200 com `image/svg+xml`.
- `GET /assets/../package.json` e qualquer nome fora da lista respondem 404.
- O snapshot de um estado de fixture traz `edges` iguais às do `buildDag` do
  `cmdRun`, `usage5h` com a janela de 5 h do log mais recente, `lastTest` da
  última chamada de teste e `tries` com uma entrada por tentativa.

**Smoke gate**, no navegador, contra o `plo serve` com fixture:

- Cada aba e cada sub-aba abre e mostra dados. Clicar num agente em STAT ›
  AGENTS muda o cabeçalho para aquele agente.
- Com uma task `failed` no fixture:
  - o chip `! N ALERTS` aparece;
  - clicar nele abre CONDITION;
  - o COPY do bloco ERROR no INV troca o rótulo para `COPIED ✓`.
- Clicar num nó do MAP abre a task no INV; clicar em `SUITE` abre a estação no
  RADIO.
- RADIO com a suíte no ar: a amplitude da onda passa de 20 px em amostras
  seguidas. Com a estação fora do ar, fica abaixo de 2 px.
- Em cada tela com operadores, avançando o `currentTime` das animações:
  - nunca aparecem os dois quadros;
  - nunca falta quadro;
  - nenhum `<use>` fica vazio.
- Derrubar o `plo serve` faz aparecer `RECONNECTING…`, e a onda e os
  operadores param.
- Abrir `/#task=4` abre a task 4 no INV.
- Com `prefers-reduced-motion`, nenhuma animação contínua roda.
- A página não faz nenhuma requisição fora de `localhost`.
- A 390 px de largura não há rolagem horizontal da página. Só o mapa rola.
