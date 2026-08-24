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

Identidade (cor, olhos, ângulo do topo) sai do hash do id do agente: o mesmo
agente é o mesmo rosto do começo ao fim da run. O **humor sai do status** —
quem falhou não sorri. É a única feição que o id não escolhe.

Anel azul enquanto trabalha, check verde quando termina. O anel verde sozinho
era a mesma forma numa cor diferente — a diferença que menos se nota de
relance.

## Cenários

A barra inferior troca entre os quatro. Também dá para linkar direto:

    #scn=blocked                 cenário travado
    #scn=integrating             barreira rodando depois do merge
    #open=a-t1,b-t2              abre o log desses agentes
    #panel=1                     abre o firehose

`scn` aceita `running` (padrão), `blocked`, `integrating`, `done`.

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
