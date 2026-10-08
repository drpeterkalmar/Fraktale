#!/usr/bin/env python3
"""6.7 Technik: Bilder für die Sichtprüfung (Pixel 7, echte GPU), Collagen nach tests/shots/technik/.

  --part=tone    Endpass: je Look (Standard, Gletscher = weiße Menge, Alpin) × Stimmung (Morgen/Mittag/Abend) die Varianten
                 „wie 6.6“ (alle Regler aus), Neutral (Standard 6.7) und AgX -> tone_<look>_<ori>.jpg
  --part=ao      Tal mit Horizont-AO an/aus (und Bild „wie 6.6“) an zwei Orten + vergrößerte Ausschnitte -> ao_<ori>.jpg
  --part=detail  Tiefflug-Ansicht (steile Neigung, Vordergrund) Detail-Normalen an/aus + Ausschnitte -> detail_<ori>.jpg
  --part=stufen  dieselbe Ansicht in Akku/Ausgewogen/Maximal (Schatten, AO, Detail, Bloom je Stufe) -> stufen_<ori>.jpg
  --part=gebirge Gebirge vorher (alle Regler aus) / nachher an drei Orten -> gebirge_<ori>.jpg
Aufruf (Server auf :8472): python3 tests/shots_tech.py --part=tone [--land] [--query=…]
Die Oberfläche wird für die Bilder ausgeblendet (nur das Bild der Landschaft).
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'technik')
SEA = ('-0.7453', '0.1127', 300)
RAND = ('-0.743637214380908705', '0.131822306549061970', 1e6)
GANZ = ('-0.6', '0', 1)
MOODS = [('morgen', 0.8, 0.18), ('mittag', 2.35, 0.5), ('abend', 3.9, 0.15)]
OLD = 'tone=0&hao=0&detail=0&scharf=0&gpuwahl=0'       # Bild wie 6.6 (eigener Seitenaufruf)
# Varianten im SELBEN Seitenaufruf (gleiche Ebenen, gleiche Szene – zwischen zwei Seitenaufrufen unterscheiden sich die
# fernen Reserve-Ebenen je nach Rechenstand, das verfälschte den ersten Vergleich): Regler zur Laufzeit umgestellt.
# AO/Detail „aus“ = Stärke 0 (der übersetzte Code rechnet dann exakt wie ohne), Ton 0 = Endpass wie 6.6.
V66 = dict(tone=0, scharf=False, bloom=False, hao=False, detail=False)
VNEU = dict(tone=1, scharf=True, bloom=True, hao=True, detail=True)
VAGX = dict(VNEU, tone=2)
HIDE = "() => { const s = document.createElement('style'); s.textContent = '.chrome, #toast, #sheet, #sheet-backdrop, #minimap { visibility: hidden !important; }'; document.head.appendChild(s); }"


def arg(n, d=None):
    for a in sys.argv[1:]:
        if a.startswith('--' + n + '='): return a.split('=', 1)[1]
        if a == '--' + n: return True
    return d


def font(sz):
    for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default()


def grid(rows, out, s=0.5, labels=None, rlabels=None):
    """rows: Liste von Zeilen (Liste von Bildpfaden bzw. PIL-Bildern); Spaltenüberschriften labels, Zeilennamen rlabels."""
    ims = [[(Image.open(p) if isinstance(p, str) else p).convert('RGB') for p in r] for r in rows]
    w, h = ims[0][0].size
    tw, th = int(w * s), int(h * s)
    top = 44 if labels else 0
    left = 0
    sh = Image.new('RGB', (left + tw * max(len(r) for r in ims), top + th * len(ims)), (20, 20, 20))
    d = ImageDraw.Draw(sh); f = font(28)
    for j, r in enumerate(ims):
        for i, im in enumerate(r):
            sh.paste(im.resize((tw, th), Image.LANCZOS), (left + i * tw, top + j * th))
        if rlabels: d.text((left + 8, top + j * th + 8), rlabels[j], fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
    if labels:
        for i, l in enumerate(labels): d.text((left + i * tw + 8, 8), l, fill=(255, 255, 255), font=f)
    sh.save(out, quality=88)
    return out


def crop(path, box):
    """box relativ (x0, y0, x1, y1) -> PIL-Bild in Originalauflösung"""
    im = Image.open(path).convert('RGB'); W, H = im.size
    return im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))


def look(pg, setcol='black', alpine=False, valley='forest', palette=None):
    pg.evaluate("""([sc, al, va, pal]) => { const A = window.__fraktal, S = A.S; S.setCol = sc; S.alpine = !!al; S.valley = va;
        if (pal) S.palette = A.PAL.indexOf(pal); A.invalidate(); A.emit('settings'); }""", [setcol, alpine, valley, palette])


def sun(pg, az, el):
    pg.evaluate(f"() => {{ const A = window.__fraktal; if ('sunEl' in A.T3) {{ A.T3.sunAz = {az}; A.T3.sunEl = {el}; }} A.V3.accKey = null; A.invalidate(); }}")


def cam(pg, tilt=None, heading=None):
    pg.evaluate(f"() => {{ const A = window.__fraktal; {'' if tilt is None else f'A.V3.tilt = {tilt} * Math.PI / 180;'} {'' if heading is None else f'A.V3.heading = {heading};'} A.V3.accKey = null; A.invalidate(); }}")


def settle(a, pg, wait=1.0):
    time.sleep(wait); a.wait_done(120); time.sleep(0.3)
    pg.evaluate("() => window.__fraktal.settle3d()"); time.sleep(0.15)


def open3d(p, land, query, quality=None):
    q = 'nosw&noanim' + ('&' + query if query else '')
    a = App(p, landscape=land, query=q).open(); pg = a.page
    pg.evaluate(HIDE)
    if quality: pg.evaluate(f"() => {{ const A = window.__fraktal; A.S.quality = '{quality}'; A.resize(); A.invalidate(); }}")
    a.set_view(*SEA); a.wait_done(120)
    pg.evaluate("() => window.__fraktal.set3d(true)"); a.wait_3d(40); a.wait_done(120)
    return a, pg


def variant(pg, v):
    pg.evaluate("""(v) => { const A = window.__fraktal, T = A.T3, F = T.flags;
        F.tone = v.tone; F.scharf = v.scharf; F.bloom = v.bloom; F.hao = v.hao; F.detail = v.detail;
        T.stage = self.FK3DTech.stage(T.stageName || 'balanced', F); A.V3.accKey = null; A.invalidate(); }""", v)


def shot(pg, fn):
    pg.screenshot(path=fn, type='jpeg', quality=90)
    return fn


def part_tone(p, land, ori, extra, errs):
    looks = [('standard', dict(setcol='black', palette='neon')), ('gletscher', dict(setcol='white', palette='neon')),
             ('alpin', dict(setcol='white', alpine=True, valley='forest', palette='alpine'))]
    variants = [('wie 6.6', V66), ('6.7 Neutral', VNEU), ('6.7 AgX', VAGX)]
    files = {}
    a, pg = open3d(p, land, extra)
    for ln, lk in looks:
        look(pg, **lk); time.sleep(0.8); a.wait_done(120); time.sleep(1.5)
        for mn, az, el in MOODS:
            sun(pg, az, el)
            for vn, vv in variants:
                variant(pg, vv); settle(a, pg, 0.4)
                files[(ln, mn, vn)] = shot(pg, os.path.join(OUT, 'roh', f'tone_{ori}_{ln}_{mn}_{vn.replace(" ", "").replace(".", "")}.jpg'))
    errs['tone'] = a.errors; a.close()
    outs = []
    for ln, _ in looks:
        rows = [[files[(ln, mn, vn)] for vn, _ in variants] for mn, *_ in MOODS]
        outs.append(grid(rows, os.path.join(OUT, f'tone_{ln}_{ori}.jpg'), s=0.32 if not land else 0.25,
                         labels=[vn for vn, _ in variants], rlabels=[mn for mn, *_ in MOODS]))
    return outs


def part_ab(p, land, ori, extra, errs, name, variants, views, crops, quality=None):
    """variants: [(Name, Query)], views: [(Name, (cx, cy, z), tilt, heading, Look-dict)], crops: [(x0,y0,x1,y1)] je Ansicht"""
    files = {}
    a, pg = open3d(p, land, extra, quality)
    for wn, v, tilt, head, lk in views:
        look(pg, **lk); a.set_view(*v); a.wait_done(120); cam(pg, tilt, head); settle(a, pg, 3.0); settle(a, pg, 1.5)   # ferne Reserve-Ebenen abwarten
        for vn, vv in variants:
            variant(pg, vv); settle(a, pg, 0.4)
            files[(wn, vn)] = shot(pg, os.path.join(OUT, 'roh', f'{name}_{ori}_{wn}_{vn.replace(" ", "").replace(".", "")}.jpg'))
    errs[name] = a.errors; a.close()
    rows = [[files[(wn, vn)] for vn, _ in variants] for wn, *_ in views]
    outs = [grid(rows, os.path.join(OUT, f'{name}_{ori}.jpg'), s=0.32 if not land else 0.25, labels=[vn for vn, _ in variants],
                 rlabels=[wn for wn, *_ in views])]
    if crops:
        crows = [[crop(files[(wn, vn)], crops[k]) for vn, _ in variants] for k, (wn, *_) in enumerate(views)]
        outs.append(grid(crows, os.path.join(OUT, f'{name}_{ori}_ausschnitt.jpg'), s=0.8, labels=[vn for vn, _ in variants],
                         rlabels=[wn for wn, *_ in views]))
    return outs


def main():
    part = arg('part', 'tone'); land = bool(arg('land', False)); extra = arg('query', '')
    ori = 'quer' if land else 'hoch'
    os.makedirs(os.path.join(OUT, 'roh'), exist_ok=True)
    errs = {}
    std = dict(setcol='black', palette='neon')
    alp = dict(setcol='white', alpine=True, valley='forest', palette='alpine')
    with sync_playwright() as p:
        if part == 'tone':
            outs = part_tone(p, land, ori, extra, errs)
        elif part == 'ao':
            outs = part_ab(p, land, ori, extra, errs, 'ao', [('wie 6.6', V66), ('6.7 ohne AO', dict(VNEU, hao=False)), ('6.7 mit AO', VNEU)],
                           [('tal', SEA, 50, 0.6, std), ('rand', RAND, 50, 2.4, std), ('alpin', GANZ, 45, 0.3, alp)],
                           [(0.1, 0.45, 0.9, 0.85), (0.1, 0.45, 0.9, 0.85), (0.1, 0.45, 0.9, 0.85)])
        elif part == 'detail':
            outs = part_ab(p, land, ori, extra, errs, 'detail', [('6.7 ohne Detail', dict(VNEU, detail=False)), ('6.7 mit Detail', VNEU)],
                           [('tal', SEA, 60, 0.6, std), ('rand', RAND, 60, 2.4, std), ('alpin', GANZ, 60, 0.3, alp)],
                           [(0.15, 0.62, 0.85, 0.98)] * 3)
        elif part == 'stufen':
            outs = []
            for q in ('eco', 'balanced', 'max'):
                outs += part_ab(p, land, ori, extra, errs, 'stufe_' + q, [(q, VNEU)],
                                [('tal', SEA, 50, 0.6, std), ('alpin', GANZ, 45, 0.3, alp)], None, quality=q)
            rows = [[os.path.join(OUT, 'roh', f'stufe_{q}_{ori}_{wn}_{q}.jpg') for q in ('eco', 'balanced', 'max')] for wn in ('tal', 'alpin')]
            outs.append(grid(rows, os.path.join(OUT, f'stufen_{ori}.jpg'), s=0.32 if not land else 0.25, labels=['Akku', 'Ausgewogen', 'Maximal'], rlabels=['tal', 'alpin']))
        elif part == 'endpass':
            # Bloom: Gegenlicht zur tiefen Sonne (Abend); CAS: Bewegungsbild (Renderskala 0,65 des Handys) ohne/mit Schärfen
            outs = []
            a, pg = open3d(p, land, extra)
            look(pg, setcol='white', alpine=True, valley='forest', palette='alpine'); a.set_view(*GANZ); a.wait_done(120)
            sun(pg, 2.35, 0.06); cam(pg, 60, -0.78); settle(a, pg, 3.0); settle(a, pg, 1.5)
            fb = []
            for vn, vv in (('ohne Bloom', dict(VNEU, bloom=False)), ('mit Bloom', VNEU)):
                variant(pg, vv); settle(a, pg, 0.4); fb.append(shot(pg, os.path.join(OUT, 'roh', f'bloom_{ori}_{vn.replace(" ", "")}.jpg')))
            outs.append(grid([fb], os.path.join(OUT, f'bloom_{ori}.jpg'), s=0.4 if not land else 0.3, labels=['ohne Bloom', 'mit Bloom']))
            outs.append(grid([[crop(f, (0.0, 0.25, 1.0, 0.6)) for f in fb]], os.path.join(OUT, f'bloom_{ori}_ausschnitt.jpg'), s=0.6, labels=['ohne Bloom', 'mit Bloom']))
            sun(pg, 2.35, 0.5); look(pg, setcol='black', palette='neon'); a.set_view(*SEA); a.wait_done(120); cam(pg, 50, 0.6); settle(a, pg, 3.0); settle(a, pg, 1.5)
            fc = []
            for vn, vv in (('gemittelt (Stillstand)', VNEU), ('Bewegung linear', dict(VNEU, scharf=False)), ('Bewegung CAS', VNEU)):
                variant(pg, vv)
                if 'Bewegung' in vn: pg.evaluate("() => { const A = window.__fraktal; A.settle3d({ N: 0 }); }"); time.sleep(0.5)
                else: settle(a, pg, 0.4)
                fc.append(shot(pg, os.path.join(OUT, 'roh', f'cas_{ori}_{vn.split()[0]}{vn.split()[-1]}.jpg')))
            pg.evaluate("() => { const A = window.__fraktal; A.V3.testStill = null; A.V3.accKey = null; A.invalidate(); }")
            outs.append(grid([[crop(f, (0.3, 0.45, 0.7, 0.65)) for f in fc]], os.path.join(OUT, f'cas_{ori}_ausschnitt.jpg'), s=1.0,
                             labels=['gemittelt', 'Bewegung linear', 'Bewegung CAS']))
            errs['endpass'] = a.errors; a.close()
        elif part == 'gebirge':
            outs = part_ab(p, land, ori, extra, errs, 'gebirge', [('vorher (6.6)', V66), ('nachher (6.7)', VNEU)],
                           [('ganz', GANZ, 42, 0.0, std), ('tal', SEA, 50, 0.6, std), ('rand', RAND, 55, 2.4, std), ('alpin', GANZ, 45, 0.3, alp)], None)
        else:
            raise SystemExit('unbekannter Teil ' + part)
    print('Bilder:', *outs, sep='\n  ')
    bad = {k: v for k, v in errs.items() if v}
    print('Fehler:', bad or 'keine')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
