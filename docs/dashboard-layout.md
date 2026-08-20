# Dashboard do `plo serve` — ajustes de layout e usabilidade

Auditado em `src/ui.html` @ `6096bcf`, medido contra a run real do takz `1.11.0`
num viewport de **1728×1080**. Referências visuais coletadas no Mobbin (web).

---

## 1. O problema, em números

O layout de hoje é uma coluna centrada de 1360px, mas o conteúdo vive numa
coluna de 460px. O resto é vão.

| Onde | Largura útil | Vão à direita / no meio |
|---|---|---|
| `.board` com um card ativo | 460px | **860px** (50% do viewport) |
| `.row` de *Settled lanes* | ~330px de texto + ~240px de números | **~750px** entre os dois grupos |
| `.kv-row` de *Integration* | 150px de chave + ~80px de valor | **~1090px** |
| `.row` de *Lane plan* | duas células (`Lane A` \| `T1`) | **~1130px** |

Consequência direta: com 4 tasks e 3 lanes a página tem **~1330px de altura** e
**rola verticalmente** numa janela de 1080 — enquanto metade da largura está
vazia. A tela rola no eixo que não tem espaço e desperdiça o que tem.

Três agravantes que não são de espaço, mas o espaço piora:

- **O feed vive na coluna mais estreita da tela.** `.feed` tem `max-height: 208px`
  (8 linhas de 26px, que é exatamente o `activityLimit: 8` do snapshot) dentro de
  um card de 460px. O argumento da tool trunca em ellipsis — justo o pedaço que
  diz *qual* arquivo, *qual* comando.
- **`Integration` é a fase da run disfarçada de tabela.** merge → barriers →
  full suite → cross-lane review é uma pipeline; está renderizada como quatro
  pares chave-valor, o formato que menos comunica progresso.
- **`Lane plan` gasta 160px de altura para 8 células.** É um mapa do DAG desenhado
  como lista.

---

## 2. Referências (Mobbin)

Cinco padrões resolvem o caso. Todos vêm de ferramentas com o mesmo problema:
processos paralelos, longos, que o usuário observa sem interagir.

### A. Detalhe lado a lado — não modal com scrim

O drawer atual cobre o board e escurece o fundo. Nenhuma das ferramentas de
dados faz isso: o painel **divide** o layout e a lista continua visível e
clicável, o que permite pular de registro em registro sem fechar nada.

- [Twenty](https://mobbin.com/screens/02d0d302-bdc3-4b3c-bdda-7675ba46819e) — tabela à esquerda, painel de propriedades à direita em seções colapsáveis.
- [Dovetail](https://mobbin.com/screens/aac9827e-b12f-4fe5-908a-2efd0acfcc11) — mesma divisão, com a linha selecionada destacada na tabela.
- [Braintrust](https://mobbin.com/screens/80308e7f-102b-45b2-862a-81187d020464) — painel com blocos de código monoespaçado + atividade.
- [Railway](https://mobbin.com/screens/93e38f05-207c-42e5-b69d-5fefe81e70d6) — canvas de serviços à esquerda, detalhe com abas (Details / Build Logs / Deploy Logs) à direita.
- [Mixpanel](https://mobbin.com/screens/aa24213f-39aa-4ee1-9ae0-ca3f89ea9c01) — painel lateral com um botão `Expand` para virar tela cheia quando o conteúdo pede.

### B. Trilho cronológico de eventos

Coluna direita fixa com o que aconteceu, em ordem, com hora e ícone de status.
É a peça que o `plo` não tem: hoje o histórico existe picado dentro de cada card.

- [Render — Metrics](https://mobbin.com/screens/50504a21-dc6e-4450-a235-ce809c9d3355) — gráficos à esquerda, **Event timeline** à direita (hora · evento · ícone).
- [OpenAI Platform — Service health](https://mobbin.com/screens/d605f83d-3869-4ecc-8874-b913e09e2930) — veredito em uma frase no topo (`All systems operational`), acordeão de componentes a 2/3 e histórico de incidentes a 1/3.

### C. Barra de estágios horizontal

- [Replit](https://mobbin.com/screens/f9e16652-d7c3-4902-a9b7-a50a90c67aee) — `Provision → Security Scan → Build → Bundle → Promote` como pills largura total, a atual em destaque, log logo abaixo.
- [GitHub Actions](https://mobbin.com/screens/7ee9913f-4499-4108-8297-a603ed0056dd) — faixa horizontal de metadados (trigger · status · duração · billable · artifacts) + `Annotations` agrupando os erros.
- [Better Stack](https://mobbin.com/screens/b677964b-252f-47a8-8495-40501138635c) — três cards de KPI em faixa, largura total.

### D. Swimlanes no eixo do tempo

O `plo` é um executor paralelo. O eixo natural para o espaço horizontal é o
**tempo** — é onde se enxerga quem segurou a run e se a paralelização pagou.

- [Jira — Timeline](https://mobbin.com/screens/fc4485cf-e94d-45a9-a6ed-8a15b9095d49) e [Asana — Timeline](https://mobbin.com/screens/a11fe17a-c1d2-401f-9561-be7a352e551c) — coluna esquerda fixa com o nome da trilha, área de tempo à direita.
- [Trello](https://mobbin.com/screens/54c460cc-9895-4900-b858-2f6b30617b5d) e [Airtable](https://mobbin.com/screens/286aa805-8d70-4bcf-b636-7acd6387a630) — barras coloridas por status sobre a grade de datas.

### E. Log com toolbar própria

- [Render — Logs](https://mobbin.com/screens/1b400c9e-2ebe-45ad-9d14-83dca9bbd425) — filtro, busca, `Live tail`, fuso, expandir para tela cheia.
- [Vercel](https://mobbin.com/screens/50a79ff4-37c0-4a9b-8df3-29599652a9fb) — contagem de linhas, contadores de erro/aviso, busca dentro do log, timestamp em coluna e linha de erro com fundo próprio.
- [Laravel Cloud](https://mobbin.com/screens/f9a999ee-f498-4a02-b17f-be383d866950) — steps em linhas com status à direita, agrupados em seções colapsáveis.

---

## 3. Arquitetura proposta

Um shell de duas colunas, com o trilho direito sempre ocupado — por padrão pelo
feed da run, e pelo detalhe da task quando uma é aberta. O espaço horizontal
deixa de ser vão porque passa a ter um morador permanente.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ plo │ 1.11.0 — Uma gramática só          3/4 done  $19.67  10:01  ● live       │  topbar
├────────────────────────────────────────────────────────────────────────────────┤
│ ✕ T4 bloqueada há 6h · nada rodando · 3 lanes mergeadas       [copiar resume]  │  verdict
├────────────────────────────────────────────────────────────────────────────────┤
│  ●━━━ run ━━━●━━ merge ━━●━━ barriers ━━✕   full suite    cross-lane review     │  stage bar
├─────────────────────────────────────────────────┬──────────────────────────────┤
│ LANES                          ▸ 10:01 decorrido│  FEED DA RUN      [⌕] [erros]│
│ A ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░  T1 done             │  09:12  A  Bash   pnpm test  │
│ B ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░  T2 done             │  09:14  B  Edit   parser.js  │
│ C ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  T3 done              │  09:31  C  Read   ui.html    │
│ ⊟ ░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓  T4 blocked          │  10:44  ⊟  ✕ barrier failed  │
├─────────────────────────────────────────────────┤  …                           │
│ ┌─ Barrier ─────────────── merged tree ───────┐ │                              │
│ │ ⊟ T4  Portão consolidado, os três PRs…      │ │  (vira DETALHE DA TASK       │
│ │ 25:40 · 842 turns · 0 commits               │ │   quando uma linha é         │
│ │ ── feed largo, argumento inteiro ──────────  │ │   clicada — sem scrim)       │
│ └─────────────────────────────────────────────┘ │                              │
├─────────────────────────────────────────────────┤                              │
│ LANE   TASKS  BRANCH        TURNS  COMMITS  $   │                              │
│ A ✓    T1     main-lane-a     421       3  7.87 │                              │
│ B ✓    T2     main-lane-b     188       1  4.44 │                              │
│ C ✓    T3     main-lane-c     270       2  7.36 │                              │
│        total                  879       6 19.67 │                              │
└─────────────────────────────────────────────────┴──────────────────────────────┘
```

### Breakpoints

| Viewport | Shell | Trilho | `.board` |
|---|---|---|---|
| < 900px | uma coluna | volta a ser drawer modal (comportamento atual, correto no estreito) | 1 card |
| 900–1279 | 2 colunas | 320px, colapsável | 1 card por linha, largura da coluna |
| 1280–1679 | 2 colunas | 380px | `repeat(auto-fit, minmax(360px, 1fr))` |
| ≥ 1680 | 2 colunas | 440px | idem, `.wrap` cresce até 1800px |

```css
.wrap  { max-width: min(100% - 40px, 1800px); }        /* era 1360 fixo */
.shell { display: grid; grid-template-columns: minmax(0, 1fr) var(--rail); gap: 16px; }
.board { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }  /* era …, 460px) */
```

O `1fr` no lugar do teto de 460px é o ajuste de melhor retorno por linha de CSS:
**um card sozinho passa a ocupar a coluna inteira**, que é exatamente o estado da
run durante a integração — o caso em que a tela hoje fica mais vazia.

---

## 4. Ajustes, por prioridade

### P0 — o vão (o pedido explícito)

**1. Trilho direito permanente; drawer só no estreito.**
`aside#drawer` sai de `position: fixed` + `.scrim` e vira a segunda coluna do
`.shell` acima de 900px. `role="dialog"`/`aria-modal`/`inert`/focus trap **só**
continuam válidos no modo modal (< 900px) — num painel não-modal eles passam a
ser errados, e prender foco num painel lado a lado é pior que não ter painel.
Ref.: Twenty, Dovetail, Railway.
*Custo:* médio — mexe no CSS do shell e nas funções `showTask`/`closeDrawer`.

**2. `.board` com `1fr` no lugar do teto de 460px.**
*Custo:* uma linha. Recupera 860px na tela de integração.

**3. `.wrap` fluido até 1800px.**
Hoje 1360 trava em qualquer monitor. O texto de leitura não sofre porque
nenhuma coluna de texto passa a ocupar a largura toda — quem cresce é grade e
trilho. *Custo:* uma linha.

**4. `.row` deixa de ser flex com `margin-left: auto` e vira grade de colunas.**
`grid-template-columns: 20px 90px 1fr 90px 90px 80px 72px` alinha número,
branch, turns, commits, custo e duração **verticalmente entre linhas**. Hoje
comparar `$7.87` com `$4.44` exige varrer as duas pontas da tela; em colunas, é
uma coluna só. Ref.: Twenty, Dovetail, Vercel.
*Custo:* baixo — CSS + `rowHtml`.

### P1 — o que a tela não conta hoje

**5. Stage bar da run, largura total.**
`run → merge → barriers → full suite → cross-lane review`, cada estágio com o
anel de status que a página já desenha (`statusIcon`). Substitui a seção
`Integration` em `.kv-row`. O estado `barrier-failed` deixa de ser uma pill
dentro de uma tabela e passa a ser um X na terceira posição de uma linha.
Ref.: Replit, GitHub Actions. *Custo:* médio.

**6. Timeline de lanes (swimlanes).**
Uma faixa por lane, blocos por task posicionados por `startedAt`/`endedAt`
(dados que já estão no checkpoint), eixo compartilhado. É o único desenho que
responde "a paralelização pagou?" e "quem segurou a run?" — as duas perguntas
que justificam o `plo` existir. Substitui `Lane plan` e a `.track` de 4px.
Ref.: Jira, Asana, Trello. *Custo:* alto — é o item mais caro do documento, e o
de maior valor. Vale como fase 2.

**7. Feed unificado da run no trilho.**
Quando nenhuma task está aberta, o trilho mostra a atividade de todas as lanes
intercalada por hora, com a letra da lane em cada linha. Exige subir o
`activityLimit` do snapshot (hoje `8`) ou um endpoint `/api/feed`.
Ref.: Render Event timeline, OpenAI incident history. *Custo:* médio.

**8. Verdict line.**
Uma frase, tamanho maior, logo abaixo da topbar: *"3 de 4 concluídas · T4
bloqueada há 6h · nada rodando"*. Esta tela mora num monitor secundário; ela
precisa ser lida de longe, sem foco. Ref.: OpenAI (`All systems operational`).
*Custo:* baixo.

### P2 — densidade e leitura

**9. Feed em colunas, com o argumento inteiro.**
`hora · ícone · tool · alvo · resultado/duração`. Com o card na largura da
coluna, o path para de truncar. Linhas de erro ganham fundo próprio (`--fail-soft`),
como no Vercel. *Custo:* baixo.

**10. Toolbar do feed.**
Busca, filtro (`só erros` / `só bash` / `só edições`) e expandir. Numa run de
842 turns, uma tail de 8 linhas não é observabilidade. Ref.: Render, Vercel.
*Custo:* médio.

**11. Rodapé de totais na tabela de lanes.**
`879 turns · 6 commits · $19.67`. O número que hoje só existe na topbar passa a
fechar a coluna que o compõe. *Custo:* baixo.

### P3 — continuidade e ação

**12. A tela diagnostica mas não oferece o próximo passo.**
No banner de bloqueio, um botão que copia `plo resume --plan <plano>`; ao lado
da branch e do session id, o ícone de copiar que Render e Twenty usam. *Custo:* baixo.

**13. Deep link.**
`#task=4` no hash: recarregar a página hoje perde a task aberta. Também torna
possível colar "olha essa task" no Slack. *Custo:* baixo.

**14. Densidade compacto/confortável.**
Um toggle que troca as alturas de linha (38px → 30px) para quem deixa a tela
aberta o dia inteiro num monitor lateral. *Custo:* baixo.

---

## 5. O que **não** fazer

- **Não adicionar sidebar de navegação global.** Render, Vercel e Railway têm
  porque gerenciam N projetos. Aqui há **uma** run; uma nav seria cromo vazio
  ocupando 240px — piorando exatamente a métrica que este documento quer melhorar.
- **Não colocar gráfico de série temporal.** Não existe série: existem 4 tasks.
  Um sparkline aqui é decoração.
- **Não encher a faixa superior de KPIs.** Três métricas reais valem mais que
  seis caixas grandes; hero metrics é tell de dashboard genérico.
- **Não aninhar cards.** A tabela de lanes é uma tabela, não seis cards.
- **Não transformar em multi-plano.** O escopo do `serve` é uma run; o dia em
  que houver várias, o padrão é o de listagem — não abas dentro desta tela.

---

## 6. Ordem sugerida

1. ~~**Fase 1 — o vão**~~ **— feita em 20/08/2026** (itens 2, 3, 4, 8). Ver a
   nota ao final. Meio dia.
2. ~~**Fase 2 — o trilho**~~ **— feita em 20/08/2026** (itens 1, 7, 9). Ver a
   nota ao final.
3. ~~**Fase 3 — a pipeline**~~ **— feita em 20/08/2026** (itens 5, 10, 11, 12,
   13). Ver a nota ao final.
4. ~~**Fase 4 — a timeline**~~ **— feita em 20/08/2026** (item 6). Ver a nota
   ao final.
5. ~~**Fase 5 — a moldura**~~ **— feita em 20/08/2026**, fora do plano acima.
   A tela tinha a paleta do Linear e não a forma. Ver a nota ao final.
6. ~~**Fase 6 — o orçamento de acento**~~ **— feita em 20/08/2026**, também
   fora do plano. O acento tinha sete significados. Ver a nota ao final.

Nenhum item exige tocar em `run.js`, `spawn.js`, `state.js` ou `integrate.js`.
O item 7 é o único que mexe no servidor, e só para elevar `activityLimit`.

---

## 7. Registro — fase 1

Feito: `.board` com `1fr` (2), shell fluido até 1840px (3), linhas em colunas
alinhadas (4), verdict line (8). A página do takz `1.11.0` passou de **1330px
de altura com metade da largura vazia** para caber inteira em 1080 sem rolar.

Dois desvios do plano, ambos consequência de alargar o shell:

- **`Integration` e `Lane plan` foram pareadas em duas colunas** (`.pair`).
  Alargar o `.wrap` piorou justamente as duas seções mais vazias da página —
  a correção do vão criava um vão maior. Não antecipa os itens 5 e 6, que
  refazem o *conteúdo* dessas seções; só para de espalhá-las.
- **A tabela de lanes usa `subgrid`.** Um track `auto` só concorda consigo
  mesmo: com cada linha sendo seu próprio grid, o cabeçalho ficava 30px fora
  da coluna que rotulava. Uma armadilha registrada para quem mexer nisso: um
  subgrid com `padding` consome as tracks que herda — a coluna de 15px do
  ícone virou 1px até a margem negativa devolver o espaço.

Verificado no browser (headless, CDP) contra a run real e contra a fixture de
11 tasks: zero erro de console, zero overflow do documento em 1728/1280/900/320,
colunas do cabeçalho alinhadas às células ao pixel, `subgrid` com fallback
declarado, tabela rolando dentro de si em 320px, drawer abrindo por clique e
por teclado, e AA nos dois temas (cabeçalho 5.62:1 no escuro, 4.87:1 no claro).

---

## 8. Registro — fase 2

Feito: trilho permanente acima de 900px com o drawer modal preservado abaixo
(1), feed unificado da run (7), feed em colunas com o argumento inteiro (9).

O trilho ganhou um morador: `Run activity` é a run inteira em ordem, com hora,
lane, tool, alvo e duração. No caso da integração — o mais vazio da tela — são
60 eventos do barrier, com os `git checkout -b` que falharam em fundo vermelho.
Era a explicação do bloqueio da T4, e não estava em lugar nenhum da página.

Quatro escolhas que se afastam do que o documento propunha:

- **O feed veio pelo `snapshot`, não por `activityLimit` nem por `/api/feed`.**
  O documento oferecia as duas saídas; nenhuma serve. Subir o limite não
  resolve porque `taskView` só devolve `activity` de task *rodando* — durante a
  integração o feed nasceria vazio. E um endpoint separado leria os logs de
  novo, a cada segundo. O `snapshot` já digere todo log a cada leitura: a
  fusão sai de graça em cima do que ele já leu, e viaja no frame que já existe.
- **O trilho herda a altura da coluna; não impõe a sua.** `height: 100vh` num
  elemento sticky dentro de uma linha de grid empurra o documento para além da
  janela em toda página que caberia nela — rolagem morta depois de um trilho
  que já tinha parado, exatamente o custo que a fase 1 removeu. `align-self:
  stretch` + `contain: size` + `max-height` devolve o comportamento certo.
- **A etiqueta de lane no feed não é botão.** O wireframe sugeria clicar; 60
  botões quase idênticos são 60 paradas de tab, e a mesma task está a uma tecla
  de distância no board, nos alertas e na tabela de lanes.
- **A coluna de duração exigiu um dado que não existia.** O documento pedia
  `resultado/duração` e o log não guardava quando uma chamada voltou — só
  quando saiu. `digestLog` passa a registrar o `doneAt`. Rendeu mais do que a
  coluna: os sete `result` do log real da 1.11.0 não têm timestamp nenhum e
  empilham no mesmo relógio dizendo "Aguardando." — a duração é a única coisa
  que os separa (09:11, 04:23, 01:02, 00:47…).

Seis defeitos, todos encontrados rodando, nenhum lendo o diff:

1. `map(activityHtml)` entrega o índice como segundo argumento. O `who` ficava
   verdadeiro a partir da segunda linha e os cards desenhavam `Tundefined`
   numa coluna que eles não têm.
2. Colunas do feed desalinhadas — cada linha era o seu próprio grid. Mesma
   armadilha da tabela de lanes na fase 1, mesma correção (`subgrid`, com a
   margem negativa devolvendo o padding).
3. A rolagem vertical morta do trilho de altura fixa (acima).
4. A 320px a coluna do alvo colapsava para 15px enquanto o nome do tool ficava
   com 132: um track `auto` dimensiona pelo conteúdo mais largo e ganha de
   `1fr` quando falta espaço. `fit-content(88px)` põe o teto onde deve estar.
5. Contraste. A hora em `--text-faint` dava 2.89:1 — o token é para separador,
   não para informação. E o fundo de erro clareia a linha o bastante para
   derrubar as colunas discretas para 3.98:1 no escuro e 4.28:1 no claro; em
   claro `--text-2` e `--text-3` são o mesmo valor, então subir um degrau não
   fazia nada. Daí o token novo `--text-on-fail`.
6. O trilho sticky escorregava 52px por baixo da topbar no fim da rolagem: o
   `padding-bottom` do `.wrap` fica fora da linha do grid, então a coluna
   acabava antes da página. O padding mudou para dentro do `main`.

Verificado no browser (headless, CDP) contra a run real da 1.11.0 e contra a
fixture de 11 tasks: 102 testes passando; zero erro de console e zero overflow
horizontal em 1728/1280/900/320 nas duas runs; a página da 1.11.0 continua
cabendo exata em 1080 (`scrollHeight` 1080); colunas do feed alinhadas ao pixel
nos quatro viewports e a coluna do alvo com ≥118px em todos os breakpoints do
trilho; o trilho gruda em 59px até o fim da rolagem; AA nos dois temas com o
pior caso em 4.61:1 (dark) e 4.87:1 (light), medido compondo as camadas
translúcidas, não a cor de baixo.

E a acessibilidade que o item 1 exigia, verificada nas duas direções: acima de
900px o painel não tem `role="dialog"`, `aria-modal`, `aria-hidden` nem `inert`,
não prende Tab e não rouba o foco da linha clicada; abaixo, tem todos, o scrim
volta, o foco vai para o botão de fechar e volta para quem abriu no Esc.
Atravessar os 900px com uma task aberta mantém o painel aberto e troca só as
semânticas — nas duas direções.

---

## 9. Registro — fase 3

Feito: barra de estágios (5), toolbar do feed (10), rodapé de totais (11),
ações de cópia (12), deep link (13).

A tela passa a responder *onde* a run parou. Na 1.11.0 a barra lê
`Run ✓ 3/3 · Merge ✓ lanes A, B, C · Barriers ✗ 0/1 · Full suite ○ · Review ○`:
a falha ocupa a terceira posição de cinco e as duas seguintes estão visivelmente
intocadas. A tabela `Integration` dizia a mesma coisa com a palavra
`barrier-failed`, que só significa alguma coisa para quem já sabe a ordem.

Quatro escolhas que se afastam do que o documento propunha:

- **Os estágios são derivados no servidor, não na página.** `buildStages` mora
  no `monitor.js` e tem teste, como `buildFeed` e `settled`. O mapeamento tem
  casos que não se leem de um campo (`merge-failed` deixa tudo depois em
  `pending`; `barrier-failed` implica merge feito; suíte sem test command é
  falha, não silêncio) — regra com casos é regra que se testa, e uma página
  HTML não tem onde.
- **O plano sem barrier task tem quatro estágios, não cinco.** Um quinto
  permanentemente `done` se lê como trabalho que aconteceu.
- **"Expandir" virou um interruptor da coluna, não um estado por linha.** Sessenta
  linhas repintadas a cada segundo não têm onde guardar "esta está aberta" —
  não existe id de evento, e a chave sintética quebraria no primeiro evento
  repetido. Uma classe no container atravessa o repaint de graça.
- **Filtro em `<select>`, não em segmented control.** Quatro botões e uma busca
  não cabem em 320px de trilho sem virar duas linhas de cromo sobre o conteúdo
  que eles filtram.

E um desvio que o item 12 forçou: **o banner de bloqueio deixou de ser um
`div[role=button]`**. Um botão de copiar dentro de um `role="button"` é
interação aninhada — ARIA que o leitor de tela tem o direito de ignorar. O
banner virou texto com dois botões de verdade (`Copy resume`, `Details`), e
perdeu o "clicar em qualquer lugar" em troca de semântica que não mente.

Seis defeitos, todos encontrados rodando:

1. **Wrap não envolvia.** A linha é um `subgrid`; contra uma track implícita
   `auto` o Chrome mede o bloco como se as colunas fossem irrestritas — toda
   linha reportava 26px e o texto quebrado vazava por cima da linha de baixo.
   `grid-auto-rows: min-content` faz medir de verdade. Custo de descobrir: o
   texto *parecia* certo em uma linha só.
2. **58px de rolagem horizontal a 320px.** Os spans de leitor de tela na barra
   de estágios são `position: absolute` sem ancestral posicionado, então não
   são recortados pelo `overflow` da faixa: iam parar em x=377 e arrastavam o
   documento junto. `position: relative` na célula resolve.
3. **A faixa de estágios não cabia entre 700 e 900px** — o breakpoint que eu
   tinha chutado ficava 160px abaixo do necessário. Passou a 900 (a mesma
   largura em que o trilho desiste), e as células viraram
   `minmax(max-content, 1fr)`: preenchem quando há espaço e rolam dentro da
   borda quando não há, em vez de truncar rótulo.
4. **Contraste, de novo, e no mesmo lugar da fase 2.** `--text-3` passa contra
   `--surface` e falha (4.42:1) contra `--surface-2`, que é o fundo do rodapé
   de totais e do placeholder da busca. E a etiqueta de lane numa linha
   vermelha ficou de fora da correção da fase 2: 4.28:1 no claro. Todo dim
   numa linha de erro agora usa `--text-on-fail`.
5. **O toggle era 6px mais alto que os vizinhos.** `all: unset` devolve
   `box-sizing` para `content-box`.
6. **A branch na tabela começava 12px à direita do próprio cabeçalho.**
   `.row .mono` impõe `display: block` e ganha de `.cp-row` — o botão nunca foi
   flex, então o ícone simplesmente vinha antes do texto.

Um detalhe que não estava no plano e a captura de tela cobrou: a branch era
copiável no card da lane viva e virava texto morto na tabela quando a lane
terminava — que é exatamente quando se faz checkout dela. As duas copiam.

E uma correção de fundo que o item 12 tornou obrigatória: `drawTask` escrevia
`innerHTML` direto, uma vez por segundo, com o painel aberto. Sem foco lá
dentro isso passava; com dois botões de copiar, não. Agora passa pelo `paint`,
e a duração de uma task rodando saiu do payload para um `[data-since]` — sem
isso a assinatura mudava a cada segundo e o `paint` nunca acertaria.

Verificado no browser (headless, CDP) contra a run real da 1.11.0 e contra a
fixture de 11 tasks: 108 testes passando; 24 combinações de viewport × tema
(1728/1280/900/640/390/320 × claro/escuro × duas runs) sem um único erro de
console e sem rolagem horizontal do documento; a área de transferência conferida
de verdade — com `Browser.grantPermissions` e `readText` — recebendo
`plo resume --plan docs/superpowers/plans/…md`, a branch e o session id; o
histórico do navegador andando `feed → T9 → T2 → T9 → feed`; os totais do
rodapé alinhados às colunas que fecham em todos os viewports; e AA nos dois
temas, pior caso 4.61:1 no escuro e 4.87:1 no claro.

---

## 10. Registro — fase 4

Feito: a swimlane (6). Substitui `Lane plan` e a `.track` de 4px, e é a
primeira vez que a tela responde à pergunta que motiva o `plo`.

Na run real da `1.11.0`: as três lanes ocupam de 0 a 1294s do eixo, lado a
lado; o barrier vai de 1341 a 2881. **O trecho serial custou 1540 segundos —
mais que a fase paralela inteira.** `Lane plan` desenhava exatamente as mesmas
quatro tasks como `T1 → T2 → T3` e `T4`, e não tinha como dizer isso.

Quatro escolhas que se afastam do documento:

- **A geometria é derivada no `monitor.js`, com teste.** Mesma razão da fase 3:
  as regras têm casos. Uma task que parou sem gravar fim fecha no último evento
  do log; uma que nunca começou não tem lugar num eixo de tempo.
- **O eixo não tem fim enquanto algo roda.** O servidor manda `span: null` e a
  página estende contra o próprio relógio. Mandar `now` era uma linha a menos e
  faria toda leitura diferir da anterior — um frame por segundo empurrado por
  uma stream cujo projeto inteiro é ficar quieta. Tem teste: duas leituras
  seguidas de uma run viva têm que sair idênticas.
- **Task sem `startedAt` não vira barra.** O documento aceitava perder o plano
  junto com o `Lane plan`; inventar uma barra numa carta de tempo é mentir na
  única língua que o gráfico fala. Ela espera numa coluna `queued` ao lado do
  eixo — que é também onde ela está na run.
- **A conta acontece em CSS.** `--s` e `--e` são segundos desde a origem, `--span`
  é o eixo; uma run viva cresce com **uma escrita de propriedade por segundo** e
  nenhum nó reescrito. Verificado com o foco preso num bloco por quatro segundos
  enquanto o eixo crescia: mesmo nó, mesmo foco, assinatura de pintura intacta.

Seis defeitos que só apareceram rodando:

- **Nenhum botão da página tinha anel de foco.** `all: unset` põe
  `outline: initial` com especificidade de classe, e a regra `:focus-visible`
  estava no topo do arquivo: empate de especificidade, derrota na ordem de
  origem. Medido com `CSS.forcePseudoState`: `outline-style: none` em sete
  controles, anel intacto só no `<input>` e na linha que é `div`. A regra foi
  para o fim do arquivo, onde tem que ficar.
- **58px de rolagem horizontal a 320px, e não é da fase 4.** Medi com e sem o
  patch: `scrollWidth` 378 nos dois. É `min-width: auto` de item flex — o
  banner de erro carrega palavras como `error_during_execution`, e a maior
  delas definia a largura mínima do banner. A página rolava de lado por causa
  de um identificador numa mensagem. Também quer dizer que a varredura da fase
  3 **não cobriu essa célula**: as capturas de 320 da fixture saíram com o
  argumento trocado, e eu contei como verificadas.
- `interrupted` a **4.09:1** no tema claro — a tinta warn escurece o fundo sob
  o próprio rótulo. 16% → 10%.
- Rótulo cortado no meio do glifo em barras de 7px. Some abaixo de 24px,
  decidido por aritmética a partir de **uma** leitura de rect para o gráfico
  inteiro, não uma por nó.
- `--text-faint` em "not started" — token de separador usado para informação.
- O total entre dois horários lia como um terceiro horário. Ganhou a palavra
  `total`.

Verificado: 114 testes; 24 combinações de viewport × tema × run (1728/1280/900/
640/390/320 × claro/escuro × a run real e a fixture de 11 tasks) com zero saída
de console, zero rolagem horizontal do documento e zero interativo aninhado; AA
nos dois temas nos seis estados de bloco (pior caso 4.72:1 escuro, 4.73:1
claro); clique num bloco e num chip da fila abrindo a task e escrevendo
`#task=N`; a run real continua cabendo em 1080 sem rolar, e a fixture ficou 9px
mais baixa do que era com o `Lane plan`.

---

## 11. Registro — fase 5, a moldura (20/08/2026)

Fora do plano das quatro fases, a pedido: a tela tinha a paleta do Linear e não
tinha a **forma** dele. Três coisas denunciavam isso, e nenhuma era cor.

1. **Não havia janela.** A topbar era full-bleed com um fio embaixo e o conteúdo
   encostava na borda do viewport. No Linear sempre há fundo aparecendo em
   volta de um painel arredondado.
2. **Sopa de cards.** `Timeline`, `Barrier`, `Settled lanes` e o trilho eram
   quatro caixas com a mesma borda e o mesmo raio, separadas por 20px de vão.
   Quatro caixas iguais espaçadas é a forma de um relatório gerado; um plano
   dividido por fio é a forma de um aplicativo.
3. **Rótulos soltos.** `Timeline` e `Settled lanes` flutuavam 8px acima da
   caixa que nomeavam — cabeçalho de seção de documento, não de app.

O shell virou:

```
body                                     fundo --bg, sem rolagem
└── .frame        fixed inset:10px · raio 12 · border --line · --surface · shadow-lg
    ├── header.topbar                    linha fixa; o fio embaixo é o único cromo
    └── .frame-body                      grid: [ scroller 1fr | rail ]
        ├── .scroller   overflow:auto    ← o único lugar que rola
        └── aside#panel                  border-left, rola por dentro
```

Abaixo de 900px a moldura **dissolve**: sem inset, sem raio, o documento volta
a rolar e a topbar volta a ser sticky. É a mesma fronteira em que o trilho já
virava drawer modal — uma fronteira, um comportamento, sem breakpoint novo (a
fase 3 registrou o custo de chutar um).

### O que isso apagou

`aside#panel` saiu de dentro do `.shell` e virou coluna do `.frame`. Com isso
**três remendos das fases 2 e 4 deixaram de existir**: o `top: calc(var(--top)
+ 10px)`, o `contain: size` e o `max-height: calc(100vh - var(--top) - 30px)`.
Todos existiam para fazer uma caixa dentro de um documento que rola se
comportar como coluna de uma janela. Agora ela é uma. O token `--top` sumiu
junto, porque não sobrou quem o lesse.

### Cinco escolhas que se afastam do que eu tinha proposto

- **O teto de 1840px do `.wrap` não foi mantido — foi removido.** A moldura já
  é o teto: ela nasce recuada da janela. Um `max-width` dentro dela terminaria
  todo fio full-bleed no ar, com painel dos dois lados — uma régua que para
  antes da borda que ela divide.
- **Os divisores entre cards são sombra, não borda.** O board troca de eixo:
  três lanes são colunas a 1728 e uma pilha a 900, e `+ .card { border-left }`
  não desenha nada quando elas empilham. Cada card leva `box-shadow: -1px 0 0,
  0 -1px 0`; a sombra esquerda de um card que abre uma fileira cai um pixel
  fora da faixa, onde a moldura recorta. Uma declaração, dois eixos, e nenhum
  fio espúrio no primeiro card de uma fileira quebrada.
- **O separador é `border-top`, nunca `border-bottom`.** Quase toda seção desta
  página fica escondida quase o tempo todo (`[hidden]`, `:empty`). Com a régua
  em cima, uma seção escondida leva a régua junto e a pilha nunca termina num
  fio pendurado em painel vazio.
- **`.subline` entrou dentro de `.summary`.** O veredito e a linha embaixo dele
  são uma afirmação só sobre a run; separados viravam duas faixas, e o fio
  entre elas dizia que não tinham relação.
- **`--bg` no tema claro deixou de ser branco.** Era o mesmo `#ffffff` de
  `--surface` — inofensivo numa página sem moldura, fatal no instante em que
  ela ganha uma: o painel flutuaria sobre a própria cor. `#eceef1` é o único
  token que esta passagem precisou inventar.

### O que apareceu rodando

1. **Cards empilhados sem divisor.** A 900 e a 1280 o board quebra em uma ou
   duas colunas e `Lane C` cai na segunda fileira; com `border-left` só, o
   corte entre `Lane B` e `Lane C` simplesmente não existia. Veio da captura,
   não do diff — no viewport onde eu tinha olhado primeiro cabiam três colunas
   e o defeito não tinha como aparecer.
2. **Contraste, e desta vez para melhor.** A auditoria composta rodou também
   contra o arquivo **antes** da mudança, que é a única forma de saber o que é
   regressão e o que é herança. O feed dentro do card saiu de `--surface-2`
   para `--surface` e subiu de 4.42 para 4.63 — `span.at`, `span.arg`,
   `span.took`, `span.say` e `div.empty` deixaram de falhar sozinhos. Sobrou o
   mesmo par em três lugares que a fase 3 não varreu: o chip de branch, o
   rodapé do card e o cabeçalho/total da tabela. Todos subiram um degrau para
   `--text-2` (5.73:1). No tema claro `--text-2` e `--text-3` são o mesmo
   valor, então o degrau custou zero lá e comprou a coluna escura inteira.
3. **O `·` caiu de 3.16 para 3.02 no escuro** porque o chão dele mudou de
   `--bg` para `--surface`. É `--text-faint`, que o arquivo declara decorativo
   ("separators, empty glyphs"), e reprovava AA no arquivo original também
   (3.16 e 2.64). Fica registrado como o único número desta passagem que
   piorou, e como o motivo de ele não ser um defeito: um ponto médio entre duas
   frases não carrega informação que o espaço já não carregue.

E dois defeitos que eram do meu instrumento, não da página, registrados porque
custaram tempo: `getComputedStyle(el, ':focus-visible')` volta vazio — pseudo-
**classe** não é pseudo-elemento, e a única medida que vale é
`CSS.forcePseudoState`, como a fase 4 já tinha descoberto. E medir "a moldura
não se move ao rolar" num viewport onde a run **cabe** não mede nada: o teste
passava com `scrollRange = 0`.

### Verificado

116 testes. Varredura por CDP contra a run real da 1.11.0 e contra uma fixture
de três lanes vivas, em 1728/1280/900/640/390/320 × claro/escuro — 24
combinações com zero saída de console e zero rolagem horizontal do documento.
A moldura, a topbar e o trilho ficam parados ao pixel ao longo de 562px de
rolagem do conteúdo, com `documentElement.scrollTop` em 0 e a altura do
documento igual à da janela. O trilho rola dentro de si e termina dentro da
moldura. AA nos dois temas em todo texto informativo, medido compondo as
camadas translúcidas. Anel de foco de 2px presente nos doze controles
(distribuídos entre as duas runs, porque nem todos existem na mesma). Clique
numa linha abre a task no trilho, escreve `#task=1` e **não** rouba o foco da
linha; atravessar os 900px com essa task aberta troca só as semânticas, nas
duas direções; e no telefone o Esc fecha o drawer e devolve o foco a quem
abriu.

---

## 12. Registro — fase 6, o orçamento de acento (20/08/2026)

Numa run terminada, contei **doze discos roxos idênticos** numa dobra: o
veredito, três estágios, duas lanes, cinco chips de task — e o badge. Todos o
mesmo `statusIcon('done')`: disco `--accent` preenchido, check branco. Contra
eles, **um** anel vermelho para a única coisa que precisava de atenção.

A causa não é o desenho do ícone, é o orçamento. O acento significava sete
coisas ao mesmo tempo: a marca, o estado `done`, a barra concluída da timeline,
o barrier, a pill `live`, o toggle pressionado e o anel de foco. Sete
significados é o mesmo que nenhum — a cor parou de apontar para qualquer coisa.

### O defeito que a contagem revelou

`renderSettled` desenhava `statusIcon('done')` **literal** em toda linha da
tabela. Mas `settled` é `tasks.every(isTerminal)` (`monitor.js:548`), e terminal
inclui `failed`, `blocked` e `interrupted`. Uma lane que assentou com uma task
quebrada exibia um check de concluído. A coluna não era só redundante em três
casos de quatro: no quarto ela mentia. Foi deletada — quem carrega o estado
passam a ser os chips, que são por task e não têm como mentir.

### O que mudou

- **`done` perde o disco e o acento, e vira o check verde que o feed já
  desenha.** Um glifo, um significado, duas escalas: o `resultIcon` de uma
  chamada que voltou e o `statusIcon` de uma task concluída passam a ser a
  mesma marca a 11 e a 15px.
- **Chip `done` fica só com o número.** `running`, `failed` e `blocked` mantêm
  o glifo — então um glifo dentro de um chip volta a significar "este, não os
  outros". Na tabela de lanes de uma run quebrada, o X de uma task é agora o
  único ícone da tabela inteira.
- **A coluna de status da tabela sumiu**, com a track de 15px do `--lane-cols`.
- **O badge deixou de soletrar o nome que o `h1` diz ao lado.** Virou a seta de
  proa: a run tem direção e uma posição atual, que é a única coisa sobre a qual
  esta página fala. O favicon recebeu a mesma marca — um ícone de aba diferente
  do badge é outro aplicativo na tira de abas.

E o texto: `base main at 9142925` era uma frase com três literais dentro, em
monospace nu no meio de uma linha sans. Duas famílias discutindo baseline, com
x-height e largura diferentes e nenhuma fronteira dizendo onde o literal
começa. `<code>` ganhou preenchimento cinza e raio 4 — o trabalho que o código
inline do Slack faz, em cinza no lugar do laranja. `.92em` e não um tamanho
fixo, para o chip escalar com a linha em que cair; e a tinta é `--text`, não
`--text-2`, porque o literal é a carga e a palavra antes dele é o rótulo.
`.mono` ficou de fora: aquilo já mora dentro de um botão de copiar, e um chip
dentro de um botão é caixa dentro de caixa.

### O que **não** mudou, de propósito

As barras concluídas da timeline continuam em `--accent-soft`. Elas não são
glifo de estado repetido — são um trecho de tempo, e são o corpo do gráfico:
pintá-las de verde trocaria um excesso por outro, e apagá-las tiraria do
gráfico a única cor que separa uma task de um vão. O acento agora significa
quatro coisas — a marca, o barrier, o bloco de timeline e o foco — e nenhuma
delas se repete doze vezes numa dobra.

Um custo aceito de olhos abertos: **verde passa a ser a cor mais repetida da
tela**, porque o feed já desenha ~40 checks verdes. A troca foi escolhida
sabendo disso; o que ela compra é que a barra de estágios de uma run quebrada
tem exatamente uma cor forte, e ela está na posição que quebrou.

### Verificado

116 testes. Três runs — a 1.11.0 bloqueada, uma fixture de três lanes vivas e a
1.12.0 inteira concluída, que é o pior caso desta contagem — em 1728/1280/900/
640/390/320 × claro/escuro: zero saída de console e zero rolagem horizontal do
documento em todas. Contraste composto nas três runs × três viewports × dois
temas: o único par abaixo de AA continua sendo o `·` de `--text-faint`, herdado
e decorativo. As seis colunas da tabela seguem alinhadas ao pixel entre
cabeçalho, corpo e rodapé nos seis viewports depois de perder uma track do
subgrid, e o número dentro do chip sem glifo ficou centrado (9px dos dois
lados).

---

## 13. Nota — o custo vira tokens (20/08/2026)

Fora do plano, a pedido: `$19.67 spent` na topbar e a coluna `COST` da tabela
passam a contar **output tokens**. `total_cost_usd` é preço de API; quem roda
isto numa assinatura não paga aquilo, então era um número sobre a conta de
outra pessoa. Token é o que a run gasta e é a unidade em que um limite de uso
é contado.

O número não existia. `spawn.js` já lia `usage` do evento `result` e não usava;
agora `run.js` grava no checkpoint ao lado do `costUsd`, **somado entre as
tentativas** — uma task que o loop de correção rodou cinco vezes gastou cinco
spawns.

Uma armadilha registrada: **não dá para contar isso lendo o log**. Uma task
escreve 51MB e o digest lê os últimos 512KB, então somar `usage` mensagem a
mensagem reporta uma fração. Medido num barrier bloqueado cujo tail não tem
evento `result`: a soma dizia **377 output tokens para 842 turns**. O único
número confiável é o que o evento `result` carrega, e ele fica no fim do
arquivo — dentro do tail. Runs gravadas antes desta mudança continuam
mostrando um número por causa disso; a task que morreu antes de emitir o
`result` mostra `—`, que é a verdade.

