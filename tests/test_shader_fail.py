"""Defekte Shader-Varianten (fremder Treiber) – Gutachten P1-2, ab 6.5.3.

Ein Init-Skript ersetzt vor dem Laden den Quelltext bestimmter Shader durch Unsinn (Übersetzungsfehler wie auf einem
fremden Treiber). Erwartet: Meldung (Toast), Rückfall nur für die Sitzung, Bild wird fertig, kein pageerror und kein
console.error (die einmalige console.warn je defektem Programm ist erlaubt), die Hauptschleife friert nicht ein.
  (a) Bunt-Variante (#define IN 1) defekt -> Bunt einschalten: Toast, Menge schwarz, fertig
  (b) Perturbation mit Fehlerschätzung defekt -> Seepferdchen 1e9: Toast, CPU-Perturbation, fertig
  (c) direkte Variante mit Fehlerschätzung defekt -> Gesamtbild: Toast, CPU-Rechenweg, fertig
  (d) Gelände-Shader (TERRAIN_VS) defekt -> 3D-Knopf: Toast, 3D bleibt aus, 2D läuft weiter
Aufruf: python3 tests/test_shader_fail.py [--only=a,b,c,d]
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

ONLY = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def breaker(markers):
    """Init-Skript: Quelltexte, die ALLE Marker eines Eintrags enthalten, werden unübersetzbar."""
    return """(() => {
  const M = %s, orig = WebGL2RenderingContext.prototype.shaderSource;
  window.__broken = [];
  WebGL2RenderingContext.prototype.shaderSource = function (sh, src) {
    if (M.some(ms => ms.every(m => src.includes(m)))) { window.__broken.push(src.slice(0, 40)); src = '#version 300 es\\nthis is not glsl;'; }
    return orig.call(this, sh, src);
  };
})();""" % json.dumps(markers)


def open_app(p, markers):
    a = App(p)
    a.page.add_init_script(breaker(markers))
    a.warns = []
    a.page.on('console', lambda m: a.warns.append(m.text) if m.type == 'warning' else None)
    return a.open()


def toast_text(pg):
    return pg.evaluate("() => { const n = document.getElementById('toast'); return n.classList.contains('show') ? n.textContent : ''; }")


def wait_toast(pg, sec=15):
    t0 = time.time()
    while time.time() - t0 < sec:
        tx = toast_text(pg)
        if 'Grafikfehler' in tx or '3D-Landschaft' in tx:
            return tx
        time.sleep(0.05)
    return toast_text(pg)


def frames_advance(pg):
    f0 = pg.evaluate("() => window.__fraktal.status().fps")
    n0 = pg.evaluate("() => { let n = 0; window.__fc = 0; const f = () => { window.__fc++; requestAnimationFrame(f); }; requestAnimationFrame(f); return 0; }")
    time.sleep(1.0)
    return pg.evaluate("() => window.__fc")


def case_a(p):
    print('(a) Bunt-Variante defekt')
    a = open_app(p, [['#define IN 1']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => { const A = window.__fraktal; A.S.setCol = 'bunt'; A.invalidate(); }")
    tx = wait_toast(pg)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(60)
    li = pg.evaluate("() => window.__fraktal.layerInfo()")
    check(st['done'] and all('|in' not in l['sig'] for l in li['layers'] if l['front']), 'Bild fertig, Menge ohne Bunt-Information')
    check(pg.evaluate("() => Object.keys(window.__fraktal.R.broken)") != [], 'R.broken gesetzt')
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}').setCol || null")
    check(saved in (None, 'black'), 'nichts dauerhaft verstellt (%s)' % saved)
    check(frames_advance(pg) > 3, 'Hauptschleife läuft')
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    check(sum('defekt' in w for w in a.warns) == 1, 'genau eine Warnung (%d)' % sum('defekt' in w for w in a.warns))
    a.close()


def case_b(p):
    print('(b) Perturbation mit Fehlerschätzung defekt')
    a = open_app(p, [['#define ERR 1', 'u_offset']])
    pg = a.page
    a.set_view(SEA[0], SEA[1], 1e9)
    tx = wait_toast(pg, 30)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(120)
    check(st['done'] and st['plan']['kind'] == 'cpu' and not st['gpuPerturbOK'], 'fertig auf der CPU (%s, gpuPerturbOK=%s)' % (st['plan'], st['gpuPerturbOK']))
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_c(p):
    print('(c) direkte Variante mit Fehlerschätzung defekt')
    a = open_app(p, [['#define ERR 1', '#define F 0']])
    pg = a.page
    tx = wait_toast(pg, 30)
    check('Grafikfehler' in tx, 'Toast: %r' % tx)
    t, st = a.wait_done(120)
    check(st['done'] and st['plan']['kind'] == 'cpu', 'fertig auf dem CPU-Rechenweg (%s)' % st['plan'])
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_settings') || '{}').renderer || null")
    check(saved in (None, 'auto'), 'Rechenweg nicht gespeichert (%s)' % saved)
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


def case_d(p):
    print('(d) Gelände-Shader defekt')
    a = open_app(p, [['uniform vec2 u_yr;']])
    pg = a.page
    a.wait_done(60)
    pg.evaluate("() => window.__fraktal.set3d(true)")
    tx = wait_toast(pg, 30)
    check('3D-Landschaft' in tx, 'Toast: %r' % tx)
    time.sleep(1.0)
    v = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(not v['on'] and not v['prep'], '3D aus, keine Vorbereitung mehr (%s/%s)' % (v['on'], v['prep']))
    check(pg.evaluate("() => document.getElementById('btn-3d').getAttribute('aria-pressed')") != 'true', '3D-Knopf nicht gedrückt')
    a.set_view(SEA[0], SEA[1], 1e5)
    t, st = a.wait_done(60)
    check(st['done'], '2D rechnet weiter')
    # Flug-Start mit defektem Gelände ebenso
    pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: true })")
    time.sleep(2.0)
    v = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(not v['on'] and not v['fly']['on'], 'Flug startet nicht in kaputtes 3D')
    # 6.6: der 2D-Flug braucht kein Gelände – er geht auch, wenn 3D auf diesem Treiber defekt ist
    pg.evaluate("() => window.__fraktal.startFly(undefined, { d3: false })")
    time.sleep(2.0)
    v = pg.evaluate("() => window.__fraktal.view3dInfo()")
    check(not v['on'] and v['fly']['on'] and not v['fly']['d3'], '2D-Flug geht trotz defektem 3D')
    pg.evaluate("() => window.__fraktal.stopFly()")
    check(not a.errors, 'keine Fehler %s' % a.errors[:3])
    a.close()


with sync_playwright() as p:
    for k, fn in [('a', case_a), ('b', case_b), ('c', case_c), ('d', case_d)]:
        if ONLY and k not in ONLY:
            continue
        try:
            fn(p)
        except Exception as e:
            fails.append('%s: %r' % (k, e))
            print('  FAIL Ausnahme', repr(e)[:300])
print('ALL PASS' if not fails else 'FAILED: %d' % len(fails))
sys.exit(1 if fails else 0)
