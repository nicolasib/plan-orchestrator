# Dashboard v2 — protótipo

`dashboard-v2.html` abre direto no navegador. Sem servidor, sem build, dados
mockados:

    open docs/prototypes/dashboard-v2.html

## O que muda em relação ao `plo serve` de hoje

A unidade da tela deixa de ser a lane e passa a ser **o agente**. Uma lane
vazia não é notícia; um agente parado há vinte minutos é.

| Bloco de hoje | Onde foi parar |
|---|---|
| Painel `Run activity` fixo na direita | atrás do botão `Activity` — recuperou 40% da largura |
| Feed sempre aberto dentro do card da lane | colapsado atrás do chevron de cada agente |
| Timeline (gantt) | fora: responde "valeu paralelizar", não "o que está acontecendo" |
| `Settled lanes` + `Barriers` + rodapé por lane | uma faixa: `Out of the way` |
| Modelo da task | no crachá do avatar, visível sem abrir nada |
| Nome do plano em 13.5px na barra | vira o título da página; a barra passa a mostrar o caminho do arquivo |

Cada linha responde de uma vez: lane, task, modelo, tempo vivo, turns, e **uma
frase** do que o agente está fazendo — não um log.

## Barreira

O chip de uma barreira carrega um ícone (duas trilhas chegando numa parede) e
um tooltip que explica o termo — ninguém que abre o dashboard pela primeira
vez sabe o que uma barreira é, e `Barrier · T6` sozinho não ensina.

## Avatares

**A cor diz a lane; o rosto diz quem.** A pele vem da letra da lane, as feições
(olhos, ângulo do topo) do hash do id, e o humor do status — quem falhou não
sorri. Assim duas lanes nunca são a mesma cor, dois agentes da mesma lane nunca
são o mesmo rosto, e nenhum dos dois pode ser confundido com um estado: nenhum
matiz da paleta encosta em `--done`, `--fail`, `--warn`, `--run` ou `--accent`.
O subagente herda a cor do pai, um passo atrás.

Anel azul enquanto trabalha; ao parar, um glifo: check no `done`, × no `failed`,
traço no `blocked`. **Forma antes de cor** — indigo/verde/vermelho é exatamente
o eixo que a deuteranopia colapsa, e a régua de fases logo acima já fazia isso
certo.

## O orb

O indicador de atividade é uma esfera de partículas em rotação 3D — a
linguagem dos *thinking orbs* de [orbs.jakubantalik.com](https://orbs.jakubantalik.com/),
reimplementada aqui em CSS puro. As partículas são posicionadas uma vez, em
espiral de Fibonacci, e quem gira é o contêiner: nenhum frame custa
JavaScript, e vinte orbs na tela não pesam mais que um.

**A forma diz que tipo de trabalho é; a cor e o ritmo dizem como ele vai.**
São dois eixos independentes, e ambos saem de dados que já existiam.

O corpo vem da família do verbo, que o `humanize()` já precisava classificar
para escolher a palavra:

| Família | Corpo | Verbos |
|---|---|---|
| `scan` | esfera regular, varrendo | ler, procurar, olhar o git, buscar na web |
| `churn` | nuvem irregular, com pontos soltos | editar, escrever, testar, buildar, commitar |
| `think` | esfera fechada e lenta | pensar, planejar |
| `orbit` | um anel em perspectiva | despachar subagente, usar skill |

O estado não troca a forma — muda a cor e o ritmo: em curso no acento; vivo
depois de uma chamada que falhou, em `--warn` e mais devagar; parado, a esfera
colapsa e o movimento cessa, em `--fail`. Imobilidade é o sinal.

Ele substitui três pontos de 3px que o comentário do próprio código chamava de
"a razão pela qual dá pra ver de longe que a run está viva", e que a três
passos de um segundo monitor não se resolviam.

## Cenários

A barra inferior troca entre os quatro. Também dá para linkar direto:

    #scn=blocked                 cenário travado
    #scn=merging                 lanes encerradas, barreira ainda não começou
    #scn=integrating             barreira rodando depois do merge
    #open=a-t1,b-t2              abre o log desses agentes
    #panel=1                     abre o firehose

`scn` aceita `running` (padrão), `blocked`, `merging`, `integrating`, `done`.

## O contrato de dados

Todo campo do mock é derivável do que o agente já escreve no log
`stream-json` e do checkpoint que o `plo` mantém. Nada aqui foi inventado:

| Campo | Origem |
|---|---|
| `tag` / `title` / `lane` / `barrier` | plano + `.plan-state-<plan>.json` |
| `status` / `startedAt` / `turns` / `outputTokens` | checkpoint (`monitor.js` → `taskView`) |
| `model` | evento `init` do log (`monitor.js:186`) |
| `doing` | última chamada de tool do log, passada por `humanize()` |
| `children` | eventos `Task` agrupados por `parent_tool_use_id` |

## O que a fase 2 precisa mudar no `monitor.js`

1. **`model` no snapshot da lista.** Hoje só sai em `taskDetail`
   (`monitor.js:639`); `taskView` não o carrega, então a lista não tem como
   mostrar quem está rodando com o quê.
2. **Árvore de subagentes.** `digestLog` reduz `parent_tool_use_id` a um
   booleano `sub` (`monitor.js:182`) e descarta o id do pai. Guardando
   `parentId` no evento e casando com o `id` do `tool_use` do `Task`
   (`monitor.js:205`), cada subagente vira um nó: vivo enquanto não chega o
   `tool_result` daquele id.
3. **Nada mais.** `humanize()` é do lado do cliente — o log já entrega nome da
   tool e alvo.
