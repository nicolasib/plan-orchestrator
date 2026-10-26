'use strict';

// Builds src/assets/operador.svg: one <symbol> per pose frame, taken from the
// vectorised bone-<pose>-<n>.svg files in ../operador/. Run once, from the
// repo root:
//   node docs/superpowers/specs/2026-10-26-painel-operador/gerar/monta-sprite.js

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'operador');
const OUT_FILE = path.join(__dirname, '..', '..', '..', '..', '..', 'src', 'assets', 'operador.svg');

const POSES = ['orgulho', 'trabalhando', 'revisando', 'travado', 'falhou', 'dormindo'];

// The layers become inline styles so the page's CSS variables colour them
// through <use>; a class inside a symbol would not see the page's rules.
const STYLE = {
  sil: 'style="fill:var(--fig)"',
  fx: 'style="fill:var(--fig)"',
  ln: 'style="fill:var(--ln)"',
};

const symbols = [];
for (const pose of POSES) {
  for (const n of [1, 2]) {
    const svg = fs.readFileSync(path.join(SRC_DIR, `bone-${pose}-${n}.svg`), 'utf8');
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
    const inner = svg
      .slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'))
      .replace(/class="(sil|ln|fx)"/g, (_, c) => STYLE[c]);
    symbols.push(`<symbol id="op-${pose}-${n}" viewBox="${viewBox}">${inner}</symbol>`);
  }
}

const out = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">'
  + `<defs>${symbols.join('')}</defs></svg>\n`;

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, out);
console.log(`wrote ${OUT_FILE} (${symbols.length} symbols, ${out.length} bytes)`);
