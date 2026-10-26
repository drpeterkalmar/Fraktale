#!/usr/bin/env python3
"""7.3.0 df64-Exoten am rog messen (Windows, Chrome/ANGLE D3D11 + FXC, RTX 3070 Ti in Peters Sitzung) – Brief fraktale-v7-2-exoten-df64.

Fährt Hermes, sobald Peter „rog online“ meldet. Voraussetzungen wie tests/measure_fxc_rog.py: lokaler Server dieses Stands auf
:8472 (python3 tools/serve.py 8472), am rog startit.ps1 / killfk.ps1 / q3i.ps1 (tests/rog/) und der geplante Task „fk-gltest“.
Schritte (Ergebnis tests/results_df64_rog.json + Tabelle):
  1 FXC-Zeit je neuer Rechen-Variante (frisches Profil, Salz gegen Cache): Selbsttest, Multibrot, Phoenix, Nova, Magnet I/II,
    Lyapunov, mit Färbe-Stil; f32-Gegenstücke. Pflicht: jede ≤ 10 s, keine defekt, kein Kontextverlust
  2 App: df64-Selbsttest (Zustand 2, größter Fehler ≤ 16 · 2^-48), Rechenweg gpu/df64, Wahrheit gegen CPU-f64 an 400 Stichproben
    (tests/test_v730.py CMP) bei Phoenix/Magnet II/Lyapunov 10⁶ und 10⁹, Rechenzeit GPU-df64 gegen Prozessor (Screenshot 960×540)
  3 Flug: Tour zu tiefen Exoten-Zielen (Phoenix, Magnet II, Multibrot 5; 30 s) mit df64 und mit ?df64=0, 2D-Flug Phoenix ab 3·10⁴ (20 s):
    Anteil grober Bilder, Bildrate, Bremsanteil (tests/measure_lava.py)
Aufruf: python3 -u tests/rog/measure_df64_rog.py [schritte=1,2,3]
"""
import sys, os, json, time, subprocess, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import measure_lava as M
import test_v730 as T
from playwright.sync_api import sync_playwright

STEPS = (sys.argv[1] if len(sys.argv) > 1 else '1,2,3').split(',')
BASE = 'http://127.0.0.1:8472/index.html'
OUT = os.path.join(os.path.dirname(HERE), 'results_df64_rog.json')
res = {'t': time.strftime('%Y-%m-%d %H:%M')}


def ssh(cmd):
    return subprocess.run(['ssh', '-o', 'ConnectTimeout=10', 'rog', cmd], capture_output=True, text=True, errors='replace')


def chrome():
    """frischer Chrome headless in Peters Sitzung (echte NVIDIA), Tunnel CDP 9333 hin, Server 8472 zurück"""
    ssh(r'powershell -NoProfile -ExecutionPolicy Bypass -File $env:USERPROFILE\startit.ps1')
    if subprocess.run(['pgrep', '-f', 'L 9333:127.0.0.1:9333'], capture_output=True).returncode != 0:
        subprocess.run(['ssh', '-f', '-N', '-o', 'ExitOnForwardFailure=yes', '-L', '9333:127.0.0.1:9333', '-R', '8472:127.0.0.1:8472', 'rog'])
    for _ in range(40):
        try:
            urllib.request.urlopen('http://127.0.0.1:9333/json/version', timeout=2).read(); return True
        except Exception:
            time.sleep(1)
    return False


def page(p, hash_, query='nosw&noanim', size=(1600, 900)):
    b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
    pg = b.contexts[0].new_page(); pg.set_viewport_size({'width': size[0], 'height': size[1]})
    errs = []
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)[:200]))
    pg.goto(BASE + '?' + query + '#' + hash_, wait_until='load', timeout=240000)
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=240000)
    return b, pg, errs


def wait_done(pg, timeout=300):
    t0 = time.time(); time.sleep(0.3)
    while time.time() - t0 < timeout:
        st = pg.evaluate("() => window.__fraktal.status()")
        if st['done']:
            return time.time() - t0, st
        time.sleep(0.2)
    raise TimeoutError('nicht fertig')


def step1():
    names = 'dfTest,dfMulti,dfPhoenix,dfNova,dfMagnet1,dfMagnet2,dfLya,dfPhoenixS,dfMagnet2S,exPhoenix,exMagnet2'
    r = subprocess.run([sys.executable, '-u', os.path.join(os.path.dirname(HERE), 'measure_fxc_rog.py'), names, '-', '300'], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        d = {'error': r.stdout[-500:] + r.stderr[-500:]}
    res['fxc'] = d
    for k, v in d.items():
        if isinstance(v, dict):
            print(f"  FXC {k:12s} {v.get('ms')} ms ok={v.get('ok')} {v.get('log') or ''}", flush=True)
    print('  Kontextverlust:', d.get('_lost'), flush=True)


def step2(p):
    res['app'] = []
    views = [('Phoenix 1e6', 'm=11&x=0.755715446865423024&y=-0.466920850049038216&z=1e6'), ('Phoenix 1e9', 'm=11&x=0.755715446865423024&y=-0.466920850049038216&z=1e9'),
             ('Magnet II 1e6', 'm=13&x=-0.131243619308578779&y=-0.190348596093646183&z=1e6&wp=v1'), ('Magnet II 1e9', 'm=13&x=-0.131243619308578779&y=-0.190348596093646183&z=1e9&wp=v1'),
             ('Lyapunov 1e9', 'm=10&x=3.133211104921020063&y=3.560428816801084473&z=1e9')]
    for name, h in views:
        chrome()
        b, pg, errs = page(p, h)
        t, st = wait_done(pg)
        r = pg.evaluate(T.CMP, [400, 4242, T.QBITS])
        s = pg.evaluate(T.SHOTCMP.replace('other();', '(' + T.TO_CPU + ')();'), [{'W': 960, 'H': 540, 'label': False}, None])
        rec = {'name': name, 'sec': round(t, 1), 'plan': st['plan'], 'df64': st['df64'], 'ok': r['ok'], 'ref': r['ref'], 'raw': r['raw'], 'cond': r['cond'],
               'shotGPU_ms': s['ms1'], 'shotCPU_ms': s['ms2'], 'colorMean': s['mean'], 'errors': errs[:3],
               'renderer': pg.evaluate("() => { const gl = window.__fraktal.R.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); }")}
        res['app'].append(rec)
        print(f"  {name:14s} {st['plan']} Selbsttest {st['df64']} gleich {r['ok'] * 100:.1f} % (42 bit {r['ref'] * 100:.1f} %, roh {r['raw'] * 100:.1f} %), "
              f"Bild {t:.1f} s, Screenshot GPU {s['ms1']} ms / CPU {s['ms2']} ms, Farbe {s['mean']}/255 {errs[:2]}", flush=True)
        pg.close(); b.close()


def step3(p):
    res['fly'] = []
    for query in ['', 'df64=0']:
        for name in ['tour_phoenix', 'tour_magnet2', 'tour_multi', 'phoenix']:
            sp = M.SPEC[name]
            chrome()
            b, pg, errs = page(p, sp['hash'], 'nosw&noanim' + ('&' + query if query else ''), size=(1600, 900))
            try: wait_done(pg, 120)
            except Exception: pass
            if sp['kind'] == 'tour':
                pg.evaluate("(p) => window.__fraktal.startTour(p)", sp['place'])
                secs = 30
            else:
                pg.evaluate("() => { const A = window.__fraktal; A.S.flySpeed = 0.3; A.startFly(undefined, { d3: false }); }")
                secs = 20
            d = pg.evaluate(M.REC, secs * 1000)
            r = M.analyse(d, sp['kind'])
            r.update(name=name, query=query, plan=pg.evaluate("() => window.__fraktal.status().plan"), errors=errs[:3])
            res['fly'].append(r)
            print(f"  {name:13s} {query or 'df64':7s} grob {r['coarse'] * 100:.1f} %, {r['fps']} Bilder/s, Bremsen {r['brake'] * 100:.0f} %, Zoom 10^{r['lz0']} -> 10^{r['lz1']}, "
                  f"steht {r['still'] * 100:.1f} % {errs[:2]}", flush=True)
            pg.close(); b.close()


def main():
    if ssh('echo ok').stdout.strip() != 'ok':
        print('rog nicht erreichbar (ssh rog)'); sys.exit(2)
    if '1' in STEPS:
        print('1 FXC-Zeiten (df64-Varianten)', flush=True); step1()
    with sync_playwright() as p:
        if '2' in STEPS:
            print('2 App: Selbsttest, Wahrheit, Rechenzeit', flush=True); step2(p)
        if '3' in STEPS:
            print('3 Flug (Tour + 2D-Flug), df64 und ?df64=0', flush=True); step3(p)
    ssh(r'powershell -NoProfile -ExecutionPolicy Bypass -File $env:USERPROFILE\killfk.ps1')
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print('->', OUT)


if __name__ == '__main__':
    main()
