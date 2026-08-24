---
target: docs/prototypes/dashboard-v2.html
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-24T15-58-56Z
slug: docs-prototypes-dashboard-v2-html
---
Method: dual-agent (A: design review isolado · B: detector + evidência de browser isolado). Sem degradação.
Modo da superfície: Operate. Target: docs/prototypes/dashboard-v2.html (protótipo v2 do dashboard do plo).

## Design Health Score — 21/40 (Needs work)

| # | Heurística | Score | Questão-chave |
|---|---|---|---|
| 1 | Visibilidade do estado | 3 | O vazio não diz a causa: "nobody working right now" com Merge rodando 50px acima |
| 2 | Correspondência com o mundo real | 3 | humanize() é excelente; crachá O/S/H é código privado sem legenda |
| 3 | Controle e liberdade | 1 | Zero alvos de cópia; o incumbente tinha quatro e o v2 manteve só o CSS |
| 4 | Consistência e padrões | 3 | Duas sarjetas: --pad 14px nos títulos vs 13px fixo em .ag-row/.qrow/.strip |
| 5 | Prevenção de erro | 2 | .ag-doing.bad dispara no resultado da última tool, não no status do agente |
| 6 | Reconhecer em vez de lembrar | 2 | 8 peles para tripulação ilimitada; colisão provável a partir de 4 agentes |
| 7 | Flexibilidade e eficiência | 1 | Nenhum atalho além de Esc; sem ordenação, filtro ou densidade |
| 8 | Estético e minimalista | 3 | Firehose eliminado de verdade; done/integrating deixam 400-600px vazios |
| 9 | Diagnóstico e recuperação | 1 | Motivo do bloqueio cortado no meio da palavra em 130 chars; completo só num title |
| 10 | Ajuda e documentação | 2 | Tooltip da barreira ensina bem e está quebrado nas duas posições |

## Veredito de especificidade

~70% autoral. IA é resposta real a esta ferramenta (régua de fases com "Barriers", humanize() sobre o vocabulário de tools do Claude Code, coluna `after` expressando o DAG). Vira genérico na camada de personalidade: identidade do avatar é hash(id) % 8, sem correlação com nada que o usuário precise; lane não colore nada; duas das oito peles são os próprios tokens de status (#4cb782 = --done).

Detector: exit 0, zero achados (passe real — o mesmo binário acusa flat-type-hierarchy em src/ui.html). Mas o CLI só roda o engine estático (~15 regras); low-contrast, tiny-text e undersized-ui-text nunca executaram. Exit 0 não é atestado de contraste.

Overlay visível: inexistente (extensão do Chrome desconectada; tudo medido em headless sobre cópia).

## Priority Issues

**[P0] O estado travado é um beco sem saída.** gist(a.error, 130) corta o motivo no meio da palavra; texto completo só num title nativo. Zero alvos de cópia contra os quatro do incumbente (resume, branch, session, log), com todo o CSS deles mantido. Fix: chevron do agente parado abre log + relatório inteiro reusando .md; botão de copiar `plo resume --plan <plan>` no alerta. Comando: /impeccable harden

**[P1] Vermelho gasto em falha transitória de tool.** No cenário saudável, 2 de 4 agentes exibem verbo vermelho com anel indigo e veredito sem problema. Vermelho é o único sinal pré-atentivo da tela. Fix: condicionar .ag-doing.bad a a.status, não a doing.ok. Comando: /impeccable colorize

**[P1] A única afordância de expansão usa token "decorative only".** .chev mede 2,64:1 no tema claro (reprova o limiar de 3:1 não-texto) e 3,02:1 no escuro; usa --text-faint, que src/ui.html:31 marca como decorativo. Log expandido roda a 4,42:1 (.feed .at ×34, .say ×8, .log-head ×2), reprovando AA — herdado, mas o v2 alarga o alcance com .log-head e feed sobre fundo tingido. Comando: /impeccable audit

**[P2] Identidade colapsa na escala do próprio tool.** ~9 agentes em --max-lanes 3 contra 8 peles; o comentário do código afirma unicidade que é falsa no padrão da ferramenta. Fix: pele do pai derivada da letra da lane, subagente em variante dessaturada. Comando: /impeccable colorize

**[P2] O único ensino da página quebrado em quatro frentes.** Tooltip clipado por .list{overflow:hidden} (13px na penúltima linha, 49,5px de 51,75px na última); chip focável de 17px contra o mínimo 24px do WCAG 2.5.8; texto só em data-tip via content: do CSS, zero ARIA; em #scn=integrating o chip tabindex=0 fica dentro do <button> da linha (HTML inválido). Comando: /impeccable audit

## Persona Red Flags

**Baixa visão, segundo monitor a ~1m:** seis fatos da linha entre 10,5-11,5px; crachá do modelo em 9px; prova de vida em três pontos de 3px e pip de 6px — o próprio comentário do CSS afirma que os pontos são visíveis de longe, e não são.

**Daltônico (deuteranopia/protanopia):** anel do avatar separa running/done/failed só por matiz, no eixo que colapsa. done ganhou check; failed se distingue por cor mais 7px de curva de boca. A régua de fases ao lado faz certo, por forma.

**Primeiro contato:** O/S sem legenda; "lane", "turns", "Out of the way" nunca definidos; o tooltip que ensinaria o termo mais difícil está cortado pela metade na linha onde um novato mais hovera.

## Minor Observations

- [P3] Fim e vazio são vácuos: done deixa ~600px sem custo, sem relógio de parede vs tempo somado, sem achados da revisão cross-lane. A pergunta "valeu paralelizar" era respondida pela timeline cortada e hoje não é respondida.
- Expandir o pai inverte a árvore: .ag-log e .kids dividem --surface-2 com um fio, e o log renderiza entre pai e filhos.
- No painel Activity a identidade some: dois implementer sob rótulo idêntico, sem avatar nem pai.
- Painel fecha em qualquer clique fora — impossível segurar uma linha do feed contra a linha do agente.
- Duas sarjetas na página inteira (14px títulos, 13px conteúdo).
- ~500 linhas de CSS herdado mortas; .md e .cp mortas porque as superfícies foram dropadas — o P0 com outro chapéu.

## Falso positivo adjudicado

O review cobrou a volta do custo em dólar. Verificado contra src/ui.html:1118-1126: a remoção foi deliberada e documentada — total_cost_usd é preço de API, quem roda em assinatura não paga aquilo, era número sem referente. Tokens são o gasto real e a unidade do limite de uso. Decisão mantida.

## Verified passes

Detector exit 0 nas regras alcançáveis por CLI; zero overflow horizontal em 500/680/900/1440; sem níveis de heading pulados; landmarks e 2 regiões aria-live presentes; :focus-visible definido; gaveta fechada fora da ordem de tabulação; prefers-reduced-motion suprime 21/21 animações e 7/7 transições.

## Questions

1. Se a unidade da tela é o agente, por que a lane não colore nada e o id colore tudo?
2. As duas provas de vida têm menos de 6px. Qual é o menor elemento resolvível a três passos?
3. done e integrating deixam meia tela vazia. O que merece o espaço: timeline, achados da revisão cross-lane, ou o diff combinado?
4. Se o card travado tivesse exatamente um botão, o que ele diz?
5. Modelo é fato de relance, ou fato que só importa quando a tarefa vai mal?
