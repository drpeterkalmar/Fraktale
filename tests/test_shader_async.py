"""2D-Rechen-Shader werden nicht blockierend übersetzt (Gutachten P2-7, ab 6.5.3).

Simulierter langsamer Treiber (wie tests/measure_3d_start.py --slow): jedes nach dem Startsignal gelinkte Programm gilt
erst SLOW ms nach dem Link als fertig – COMPLETION_STATUS_KHR meldet so lange „nicht fertig“, eine blockierende
LINK_STATUS-Abfrage wartet so lange (so verhält sich Direct3D/FXC unter Windows). Dann Wechsel auf Burning Ship
(neue Rechen-Varianten: Vorschau und finale Stufe mit Fehlerschätzung).
Erwartet: keine Long Task > 50 ms (vorher: eine pro neuer Variante, ~SLOW ms), größte Lücke zwischen zwei Bildern
< 100 ms bzw. < 1,5 × der Leerlauf-Lücke (headless gedrosselter Bildtakt), das Bild wird fertig, 0 Fehler. Messwerte -> tests/results_shader_async.json
Aufruf: python3 tests/test_shader_async.py [--slow=2000] [--tag=…]
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

SLOW = float(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--slow=')), 2000))
TAG = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--tag=')), '')
HOOK = r"""
(() => {
  const SLOW = %d, P = WebGL2RenderingContext.prototype, CS = 0x91B1;
  const M = window.__sa = { on: false, t0: 0, longtasks: [], frames: [], links: [] };
  const tl = new WeakMap();
  const oSS = P.shaderSource; P.shaderSource = function (s, src) {   // ab dem Startsignal: Shader-Caches umgehen
    if (M.on && !/gl_Position/.test(src)) src = src.replace('void main() {', 'void main() {\n    if (gl_FragCoord.x < -' + (Math.random() * 1e6 + 1e6).toFixed(3) + ') discard;');
    return oSS.call(this, s, src);
  };
  const oLink = P.linkProgram; P.linkProgram = function (p) { if (M.on) { tl.set(p, performance.now()); M.links.push(+(performance.now() - M.t0).toFixed(1)); } return oLink.call(this, p); };
  const oGPP = P.getProgramParameter; P.getProgramParameter = function (p, pn) {
    const t = tl.get(p);
    if (t !== undefined) {
      if (pn === CS && performance.now() < t + SLOW) return false;
      if (pn === this.LINK_STATUS) while (performance.now() < t + SLOW) {}
    }
    return oGPP.call(this, p, pn);
  };
  const loop = () => { if (M.on) M.frames.push(performance.now()); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (M.on) M.longtasks.push({ t: +(e.startTime - M.t0).toFixed(1), ms: +e.duration.toFixed(1) }); }).observe({ entryTypes: ['longtask'] });
})();
""" % SLOW

with sync_playwright() as p:
    a = App(p)
    a.page.add_init_script(HOOK)
    a.open()
    pg = a.page
    a.wait_done(60)
    # Vergleich: Bildlücken im Leerlauf (headless drosselt macOS den Bildtakt zeitweise auf ~8 Bilder/s)
    idle = pg.evaluate("() => new Promise((res) => { const f = []; const l = (t) => { f.push(t); if (f.length < 40) requestAnimationFrame(l); else res(Math.max(...f.slice(1).map((x, i) => x - f[i]))); }; requestAnimationFrame(l); })")
    time.sleep(0.5)
    pg.evaluate("() => { const M = window.__sa; M.on = true; M.t0 = performance.now(); window.__fraktal.setMode(2); }")
    t, st = a.wait_done(120)
    time.sleep(0.5)
    M = pg.evaluate("() => { const M = window.__sa; M.on = false; return { lt: M.longtasks, links: M.links, gaps: M.frames.slice(1).map((f, i) => f - M.frames[i]) }; }")
    gap = max(M['gaps']) if M['gaps'] else 0
    lt = [x for x in M['lt'] if x['ms'] > 50]
    ver = pg.evaluate("() => window.__fraktal.APP_VERSION")
    r = dict(version=ver, slowSimMs=SLOW, doneS=round(t, 2), done=st['done'], longTasksOver50=lt, maxFrameGapMs=round(gap, 1), idleMaxGapMs=round(idle, 1), links=M['links'], errors=a.errors)
    print(json.dumps(r, ensure_ascii=False))
    out = os.path.join(os.path.dirname(__file__), 'results_shader_async%s.json' % ('_' + TAG if TAG else ''))
    json.dump(r, open(out, 'w'), indent=1, ensure_ascii=False)
    ok = st['done'] and not lt and gap < max(100, 1.5 * idle) and not a.errors
    a.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
