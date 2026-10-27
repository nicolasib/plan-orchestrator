"""Folha de modelo (3x2) -> um SVG por pose, com duas camadas: silhueta e traço.

Uso: vetoriza.py FOLHA.png SAIDA_DIR PREFIXO
A silhueta é tudo que não é fundo branco (buracos pequenos, como olho e dente, são preenchidos;
vãos grandes, como o do braço na cintura, ficam vazados). O traço é o preto.
"""
import os, re, sys, tempfile
from collections import deque
from PIL import Image, ImageFilter
import potrace

POSES = ["orgulho", "trabalhando", "revisando", "travado", "falhou", "dormindo"]


def components(mask, w, h):
    """Componentes conexas (4-viz) dos pixels True. Devolve lista de listas de índices."""
    seen = bytearray(w * h)
    out = []
    for start in range(w * h):
        if not mask[start] or seen[start]:
            continue
        comp, q = [], deque([start])
        seen[start] = 1
        while q:
            i = q.popleft()
            comp.append(i)
            x, y = i % w, i // w
            for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, (i - w) if y > 0 else -1, (i + w) if y < h - 1 else -1):
                if j >= 0 and mask[j] and not seen[j]:
                    seen[j] = 1
                    q.append(j)
        out.append(comp)
    return out


def trace(mask, w, h):
    """Máscara -> um único d (todas as curvas; usar fill-rule evenodd) via potrace."""
    img = Image.new("L", (w, h), 255)
    img.putdata([0 if m else 255 for m in mask])
    curves = potrace.Bitmap(img).trace(turdsize=6, alphamax=1.0, opticurve=True, opttolerance=0.3)
    f = lambda p: f"{p.x:.1f} {p.y:.1f}"
    parts = []
    for c in curves:
        d = "M" + f(c.start_point)
        for sgm in c.segments:
            d += ("L" + f(sgm.c) + "L" + f(sgm.end_point)) if sgm.is_corner else ("C" + f(sgm.c1) + " " + f(sgm.c2) + " " + f(sgm.end_point))
        parts.append(d + "Z")
    return "".join(parts)


def ink_box(sheet, k):
    W, H = sheet.size
    cw, ch = W // 3, H // 2
    cx, cy = (k % 3) * cw, (k // 3) * ch
    # o "!" e os "Z" da linha de baixo sobem até a borda: a linha de cima para antes, a de baixo começa um pouco acima
    top, bot = (cy + 4, cy + ch - 12) if k < 3 else (cy - 12, cy + ch - 4)
    cell = sheet.crop((cx + 4, top, cx + cw - 4, bot))
    w = cell.size[0]
    ink = [p < 238 for p in cell.get_flattened_data()]
    xs = [i % w for i, v in enumerate(ink) if v]
    ys = [i // w for i, v in enumerate(ink) if v]
    return (cx + 4 + min(xs) - 6, top + min(ys) - 6, cx + 4 + max(xs) + 7, top + max(ys) + 7)


def cell_svg(sheet, box):
    cell = sheet.crop(box)
    w, h = cell.size
    px = list(cell.get_flattened_data())
    # fundo = branco ligado à borda; buraco branco pequeno vira silhueta, grande fica vazado
    white = [p >= 238 for p in px]
    sil = [not v for v in white]
    limit = 0.012 * w * h
    for comp in components(white, w, h):
        border = any(i % w in (0, w - 1) or i // w in (0, h - 1) for i in comp)
        if not border and len(comp) < limit:
            for i in comp:
                sil[i] = True
    # encolhe a silhueta 2 px para ela ficar por baixo do contorno preto (sem auréola verde por fora)
    m = Image.new("L", (w, h)); m.putdata([255 if v else 0 for v in sil])
    sil = [v > 127 for v in m.filter(ImageFilter.MinFilter(5)).get_flattened_data()]
    line = [p < 96 for p in px]
    # o que flutua solto do corpo ("!", "Z", estrelas, gota) é efeito: sai da silhueta e do traço e pinta de verde
    comps = sorted(components([p < 238 for p in px], w, h), key=len)
    fx = [False] * (w * h)
    for comp in comps[:-1]:
        for i in comp:
            fx[i] = px[i] < 160
            sil[i] = line[i] = False
    layers = [f'<path class="{cls}" fill-rule="evenodd" d="{trace(mask, w, h)}"/>' for cls, mask in (("sil", sil), ("ln", line), ("fx", fx))]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">' + "".join(layers) + "</svg>"


def main():
    """vetoriza.py FOLHA.png [FOLHA_QUADRO2.png] SAIDA_DIR PREFIXO
    Com duas folhas, cada pose sai em -1.svg e -2.svg recortadas com a mesma moldura (os quadros não pulam)."""
    args = sys.argv[1:]
    sheets = [Image.open(a).convert("L") for a in args[:-2]]
    out_dir, prefix = args[-2:]
    os.makedirs(out_dir, exist_ok=True)
    for k, name in enumerate(POSES):
        boxes = [ink_box(sh, k) for sh in sheets]
        box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
        for n, sh in enumerate(sheets, 1):
            out = os.path.join(out_dir, f"{prefix}-{name}" + (f"-{n}" if len(sheets) > 1 else "") + ".svg")
            open(out, "w").write(cell_svg(sh, box))
            print(out)


if __name__ == "__main__":
    main()
