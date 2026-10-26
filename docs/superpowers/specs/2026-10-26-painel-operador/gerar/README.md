# Como o operador foi feito

O mascote do painel não é desenhado à mão. Ele sai de duas imagens geradas e
vetorizadas, e é isso que permite pedir uma pose nova no mesmo traço.

1. **Folha de modelo.** `jobs.json` tem três pedidos (boné, cabelo reto, cabelo
   de lado); o escolhido foi `folha-bone`. Cada um pede uma folha 3x2
   (1536x1024) com seis poses, traço preto e preenchimento cinza chapado
   `#C8C8C8` sobre branco — sem sombra nem textura, para vetorizar limpo. O
   prompt descreve um mascote **original** de propaganda dos anos 1950 e não
   cita nenhum personagem existente.
2. **Segundo quadro.** `jobs-quadro2.json` edita a própria folha
   (`/images/edits`, "keep everything else exactly") e muda só o que anima:
   piscada, lápis, lupa, mão acenando, estrelas, cabeça caindo de sono.
3. **Vetorização.** `vetoriza.py FOLHA.png FOLHA_QUADRO2.png SAIDA PREFIXO`
   (Pillow + `potracer`, Python puro) gera, por pose, `-1.svg` e `-2.svg`
   recortados com a mesma moldura, com três camadas: `sil` (silhueta), `ln`
   (traço) e `fx` (o que flutua: "!", Z, estrelas, gota).

4. **Sprite.** `monta-sprite.js` lê os doze `../operador/bone-<pose>-<1|2>.svg`,
   troca as classes `sil`, `ln` e `fx` por estilos com `var(--fig)` e `var(--ln)`
   e escreve `src/assets/operador.svg`, um `<symbol id="op-<pose>-<n>">` por
   quadro. Rode da raiz do repositório:
   `node docs/superpowers/specs/2026-10-26-painel-operador/gerar/monta-sprite.js`

Modelo usado: `gpt-image-2.5-sunburst` (OpenAI Images), qualidade `high`. O
`vtracer` dá segfault no Python 3.14; o `potracer` não.

Os SVGs prontos estão em `../operador/`.
