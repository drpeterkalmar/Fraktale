#!/usr/bin/env python3
"""7.1 Bilder: Färbe-Stile und neue Welten (Startbild + Orte, hoch und quer) – zum Ansehen und für den Bericht.
Aufruf: python3 tests/shots_v71.py <gruppe> [hoch|quer]   (Server: python3 tools/serve.py 8472)
Gruppen: styles (Färbe-Stile), ...
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), 'shots', 'v71')
os.makedirs(OUT, exist_ok=True)


def shot(app, name, hash_=None, wait=90, settle=0.4):
    if hash_ is not None:
        app.page.evaluate("(h) => { location.hash = h; }", hash_)
    try:
        app.wait_done(wait)
    except Exception as e:
        print('  (nicht fertig:', str(e)[:120], ')')
    time.sleep(settle)
    app.page.evaluate("() => window.__fraktal.snapshot()")
    p = os.path.join(OUT, name + '.png')
    app.page.screenshot(path=p)
    print('  ->', p, flush=True)
    return p


def book(p, quer, cases, wait=150, js=None):
    """Mehrere Bilder in EINEM Browser: cases = [(name, hash, query[, js])]; Seite je Bild neu geladen."""
    sfx = '_quer' if quer else '_hoch'
    a = App(p, landscape=quer)
    out = []
    for c in cases:
        nm, h, q = c[0], c[1], c[2]
        a.query = q
        a.page.goto('about:blank')
        a.open(h)
        if len(c) > 3 and c[3]:
            a.page.evaluate(c[3])
        out.append(shot(a, nm + sfx, wait=wait))
        if a.errors: print('  Fehler:', a.errors[:3]); a.errors.clear()
    a.close()
    return out


def open_app(p, quer, query='nosw&noanim'):
    a = App(p, landscape=quer, query=query)
    return a


def styles(p, quer):
    sfx = '_quer' if quer else '_hoch'
    views = [
        ('mb_ganz', 'm=0&x=-0.75&y=0&z=1.1&p=neon'),
        ('mb_seepferd', 'm=0&x=-0.7453&y=0.1127&z=180&p=neon'),
        ('mb_tief', 'm=0&x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139&z=3e9&p=neon'),
    ]
    for st in ['0', '1_85_5', '2_85', '3_85', '4_85', '5_85', '6_85']:
        for nm, h in views:
            a = open_app(p, quer)
            a.open(h + '&st=' + st)
            shot(a, f'st{st[0]}_{nm}{sfx}')
            if a.errors: print('  Fehler:', a.errors[:3])
            a.close()



def styles2(p, quer):
    """Stile in anderen Welten, mit Relief, CPU-Rechenweg, Außen-Modi"""
    sfx = '_quer' if quer else '_hoch'
    cases = [
        ('st2_seep', 'm=0&x=-0.7453&y=0.1127&z=180&p=neon&st=2_85', 'nosw&noanim'),
        ('st3_seep', 'm=0&x=-0.7453&y=0.1127&z=180&p=neon&st=3_85', 'nosw&noanim'),
        ('st3_tief', 'm=0&x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139&z=3e9&p=neon&st=3_85', 'nosw&noanim'),
        ('st1_relief', 'm=0&x=-0.7453&y=0.1127&z=180&p=gold&st=1_85_5', 'nosw&noanim&relief=1'),
        ('st1_julia', 'm=1&x=0&y=0&z=1&p=aurora&jx=-0.8&jy=0.156&st=1_85_4', 'nosw&noanim'),
        ('st5_ship', 'm=2&x=-1.762&y=-0.028&z=40&p=inferno&st=5_85', 'nosw&noanim'),
        ('st4_tricorn', 'm=3&x=-0.3&y=0&z=1&p=ocean&st=4_85', 'nosw&noanim'),
        ('st1_edge', 'm=0&x=-0.7453&y=0.1127&z=180&p=neon&st=1_85_5&ou=e24', 'nosw&noanim'),
        ('st1_cpu', 'm=0&x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139&z=3e9&p=neon&st=1_85_5', 'nosw&noanim&renderer=cpu'),
        ('st1_gpu', 'm=0&x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139&z=3e9&p=neon&st=1_85_5', 'nosw&noanim'),
    ]
    for nm, h, q in cases:
        a = open_app(p, quer, q)
        a.open(h)
        if 'relief=1' in q:
            a.page.evaluate("() => { const A = window.__fraktal; A.S.relief = true; A.invalidate(); }")
        shot(a, nm + sfx, wait=150)
        if a.errors: print('  Fehler:', a.errors[:3])
        a.close()



SEA = 'x=-0.743643887037158704752191506114774&y=0.131825904205311970493132056385139'
def look1(p, quer):
    Q = 'nosw&noanim'
    cases = [(f'L_st{st[0]}_{nm}', h + '&st=' + st, Q) for st in ['1_85_5', '2_85', '3_85', '4_85', '5_85', '6_85']
             for nm, h in [('seep', 'm=0&x=-0.7453&y=0.1127&z=180&p=neon'), ('tief', 'm=0&' + SEA + '&z=3e9&p=neon')]]
    book(p, quer, cases)



def tune(p, quer):
    """Abstimmung Seide/Dreieck: Fenster K × Kontrast G"""
    cases = []
    for st in ['1_85_5', '2_85']:
        for k, g in [(24, 4), (10, 3), (6, 2), (4, 1.5)]:
            for nm, h in [('seep', 'm=0&x=-0.7453&y=0.1127&z=180&p=neon'), ('tief', 'm=0&' + SEA + '&z=3e9&p=neon')]:
                cases.append((f'T_st{st[0]}_k{k}_g{g}_{nm}', h + '&st=' + st, f'nosw&noanim&stk={k}&stg={g}'))
    book(p, quer, cases)


if __name__ == '__main__':
    grp = sys.argv[1] if len(sys.argv) > 1 else 'styles'
    quer = len(sys.argv) > 2 and sys.argv[2] == 'quer'
    with sync_playwright() as p:
        globals()[grp](p, quer)
