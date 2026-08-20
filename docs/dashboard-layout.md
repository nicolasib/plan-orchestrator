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
2. **Fase 2 — o trilho** (itens 1, 7, 9): o painel lado a lado e o feed da run.
   É onde a tela deixa de ser um relatório e vira um monitor.
3. **Fase 3 — a pipeline** (itens 5, 10, 11, 12, 13): estágios, busca no log,
   totais, ações.
4. **Fase 4 — a timeline** (item 6): a swimlane. Cara, e a única que responde à
   pergunta que motiva o `plo`.

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
