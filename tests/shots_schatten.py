#!/usr/bin/env python3
"""6.7 E4: Schattenschritte je Stufe im SELBEN Bild (nur shN/shR/shK umgeschaltet, alles andere wie Ausgewogen):
Akku 3, Ausgewogen 6, Maximal 10 + weicher Halbschatten -> tests/shots/technik/schatten_hoch[_ausschnitt].jpg
Aufruf (Server :8472): python3 tests/shots_schatten.py"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shots_tech import *
with sync_playwright() as p:
    a, pg = open3d(p, False, '')
    rows = []
    for wn, v, tilt, head, lk in (('tal', SEA, 50, 0.6, dict(setcol='black', palette='neon')), ('alpin', GANZ, 40, 2.6, dict(setcol='white', alpine=True, valley='forest', palette='alpine'))):
        look(pg, **lk); a.set_view(*v); a.wait_done(120); cam(pg, tilt, head); sun(pg, 2.35, 0.3); settle(a, pg, 3); settle(a, pg, 1.5)
        r = []
        for q in ('eco', 'balanced', 'max'):
            pg.evaluate(f"""() => {{ const A = window.__fraktal, T = A.T3, X = self.FK3DTech; const b = X.stage('balanced', T.flags), s = X.stage('{q}', T.flags);
                T.stage = Object.assign({{}}, b, {{ shN: s.shN, shR: s.shR, shK: s.shK }}); A.V3.accKey = null; A.invalidate(); }}""")
            settle(a, pg, 0.5)
            r.append(shot(pg, f'{OUT}/roh/schatten_hoch_{wn}_{q}.jpg'))
        rows.append(r)
    grid(rows, f'{OUT}/schatten_hoch.jpg', s=0.32, labels=['Akku (3 Schritte)', 'Ausgewogen (6)', 'Maximal (10, weich)'], rlabels=['tal', 'alpin'])
    grid([[crop(f, (0.1, 0.45, 0.9, 0.8)) for f in r] for r in rows], f'{OUT}/schatten_hoch_ausschnitt.jpg', s=0.7, labels=['Akku (3)', 'Ausgewogen (6)', 'Maximal (10)'], rlabels=['tal', 'alpin'])
    print(a.errors); a.close()
