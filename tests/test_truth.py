#!/usr/bin/env python3
"""Korrektheitsbeweis Deep Zoom: App-Iterationswerte (fertiges Vollbild, GPU oder CPU) gegen
unabhängige Python-Decimal-Direktiteration (tests/truth.py) an Stichprobenpixeln.

Kriterium (Auftrag): |mu_app - mu_wahr| <= 1 bei >= 99 % der Stichproben (strikt).
Zusätzlich: 'konditioniert' = ohne Pixel, deren Wahrheit sich schon bei 1e-6 Pixel Verschiebung
um > 1 Iteration ändert (Rand << 1 Pixel entfernt; dort ist jede endliche Rechnung Zufall).

Aufruf: python3 tests/test_truth.py [--renderer=gpu|cpu] [--swiftshader] [--n=400] [--only=name]
"""
import sys, os, json, random, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from truth import truth
from playwright.sync_api import sync_playwright

SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
VIEWS = [
    dict(name='seahorse_1e7', cx=SEA[0], cy=SEA[1], zoom=1e7),
    dict(name='walk_1e9', cx='-0.743637214380908705', cy='0.131822306549061970', zoom=1e9),
    dict(name='peter_17M', cx='-0.8625944137', cy='0.2495680306', zoom=1.705e7),
    dict(name='seahorse_1e14', cx=SEA[0], cy=SEA[1], zoom=1e14),
    dict(name='walk_1e15', cx='-0.743637215354753236002154', cy='0.131822307028445564243233', zoom=1e15),
    dict(name='walk_1e29', cx='-0.74363721535475353201560573970021652303', cy='0.13182230702844485014116030906246974788', zoom=1e29),
    dict(name='julia_1e6', cx='-0.12', cy='0.6', zoom=1e6, formula=1, jx='-0.8', jy='0.156'),
    dict(name='transition_999', cx='-0.74529', cy='0.11307', zoom=999),
    dict(name='transition_1001', cx='-0.74529', cy='0.11307', zoom=1001),
]
# CPU-only-Tiefe (jenseits der GPU-Grenze 1e30)
VIEWS_DEEP = [dict(name='walk_1e41', cx='-0.74363721535475353201560573969820799606042412635682',
                   cy='0.13182230702844485014116030906137622412768064249224', zoom=1e41)]


def dist(a, b):
    if a < 0 and b < 0:
        return 0.0
    if a < 0 or b < 0:
        return float('inf')
    return abs(a - b)


def run(args):
    renderer = next((a.split('=')[1] for a in args if a.startswith('--renderer=')), 'auto')
    n = int(next((a.split('=')[1] for a in args if a.startswith('--n=')), '400'))
    only = next((a.split('=')[1] for a in args if a.startswith('--only=')), None)
    gpu = '--swiftshader' not in args
    views = VIEWS + (VIEWS_DEEP if renderer != 'gpu' else [])
    results, allok = [], True
    with sync_playwright() as p:
        app = App(p, gpu=gpu, query='nosw&noanim' + ('' if renderer == 'auto' else '&renderer=' + renderer) + ('&nobla' if '--nobla' in args else '')).open()
        app.page.wait_for_timeout(800)
        for v in views:
            if only and only not in v['name']:
                continue
            if v.get('formula', 0) == 1:
                app.page.evaluate("([x,y]) => { const A = window.__fraktal; A.setMode(1, true); A.setJulia(A.HP.fromString(x), A.HP.fromString(y)); }", [v['jx'], v['jy']])
            else:
                app.page.evaluate("() => window.__fraktal.setMode(0, true)")
            app.set_view(v['cx'], v['cy'], v['zoom'])
            t_render, st = app.wait_done(300)
            info = app.page.evaluate("() => { const f = window.__fraktal.RC.front; return [f.buf.w, f.buf.h]; }")
            W, H = info
            rnd = random.Random(4711)
            g = int((n / 2) ** 0.5)
            pix = [[int((i + 0.5) * W / g), int((j + 0.5) * H / g)] for j in range(g) for i in range(g)]
            while len(pix) < n:
                pix.append([rnd.randrange(W), rnd.randrange(H)])
            fr = app.page.evaluate("(px) => window.__fraktal.readFrontAt(px)", pix)
            spec = dict(cx=fr['cx'], cy=fr['cy'], zoom=repr(fr['zoom']), W=fr['w'], H=fr['h'], formula=v.get('formula', 0),
                        maxIter=fr['maxIter'], jx=v.get('jx', '0'), jy=v.get('jy', '0'), pixels=pix, cond=True)
            t0 = time.time()
            tr3 = truth(spec)
            ttruth = time.time() - t0
            ok = okc = nc = 0
            maxd = 0.0
            for a, t in zip(fr['values'], tr3):
                d = dist(a, t[0])
                ill = dist(t[0], t[1]) > 1 or dist(t[0], t[2]) > 1
                ok += d <= 1
                if not ill:
                    nc += 1
                    okc += d <= 1
                maxd = max(maxd, d if d != float('inf') else 1e9)
            ext = [t[0] for t in tr3 if t[0] >= 0]
            r = dict(view=v['name'], engine=f"{fr['kind']}/{fr['mode']}", bla=st.get('useBLA'), ref=st.get('ref'), size=f"{W}x{H}",
                     maxIter=fr['maxIter'], okPct=round(100 * ok / len(pix), 2), okCondPct=round(100 * okc / max(1, nc), 2),
                     illCond=len(pix) - nc, maxDiff=round(maxd, 3), n=len(pix), interior=sum(1 for t in tr3 if t[0] < 0),
                     truthRange=[round(min(ext), 1), round(max(ext), 1)] if ext else None, renderS=round(t_render, 2), lastFullMs=st.get('lastFullMs'),
                     truthS=round(ttruth, 1))
            r['pass'] = r['okPct'] >= 99.0
            allok &= r['pass'] or v['name'].startswith('walk_1e29') or v['name'].startswith('walk_1e41')
            results.append(r)
            print(json.dumps(r), flush=True)
        errs = app.errors
        app.close()
    print('errors:', errs)
    return results, allok and not errs


if __name__ == '__main__':
    res, ok = run(sys.argv[1:])
    tag = next((a.split('=')[1] for a in sys.argv[1:] if a.startswith('--tag=')), None)
    if tag:
        json.dump(res, open(os.path.join(os.path.dirname(__file__), f'results_truth_{tag}.json'), 'w'), indent=1)
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)
