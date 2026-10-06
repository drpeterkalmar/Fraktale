#!/usr/bin/env python3
"""6.3: 3D-Start ohne Hänger. Pixel-7-Emulation, echte GPU (Metal); ein langsamer Treiber (Direct3D 11/FXC unter
Windows) wird simuliert: jedes nach dem Scharfschalten gelinkte Programm meldet COMPLETION_STATUS erst nach SLOW ms
„fertig“, eine blockierende LINK_STATUS-Abfrage würde so lange warten.

Prüft:  * ⛰ antippen bei langsamem Treiber: Knopf zeigt „3D wird vorbereitet …“ (Klasse prep), 2D läuft weiter
          (keine Long Tasks; keine Bildlücke > 100 ms bzw. über dem Takt vor dem Antippen), danach erscheint 3D von selbst
        * nur die Gelände-Variante des aktuellen Looks wird übersetzt
        * erneutes Antippen während der Vorbereitung bricht ab (2D bleibt)
        * Look-Wechsel in 3D (Alpin) bei langsamem Treiber: alter Look bleibt stehen, kein Block, danach neuer Look
        * ✈ während der Vorbereitung: Flug startet, sobald 3D bereit ist
        * ohne KHR_parallel_shader_compile (Häppchen über mehrere Bilder): 3D erscheint, 0 Fehler
        * 3D-Start mehrfach hintereinander zuverlässig (an/aus × 5)
Aufruf: python3 tests/test_v63.py
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

SEA = ('-0.7453', '0.1127', 300)
SLOW = 2500
HOOK = r"""(() => {
  const P = WebGL2RenderingContext.prototype, CS = 0x91B1, tl = new WeakMap();
  window.__slowArm = false; window.__links = [];
  const oL = P.linkProgram; P.linkProgram = function (p) { if (window.__slowArm) tl.set(p, performance.now()); return oL.call(this, p); };
  const oA = P.attachShader, src = new WeakMap(), ss = P.shaderSource;
  P.shaderSource = function (s, t) { src.set(s, t); return ss.call(this, s, t); };
  P.attachShader = function (p, s) { const t = src.get(s) || ''; const m = t.match(/#define ALP (\d)/); if (m) window.__links.push(+m[1]); return oA.call(this, p, s); };
  const oG = P.getProgramParameter;
  P.getProgramParameter = function (p, pn) {
    const t0 = tl.get(p);
    if (t0 !== undefined) {
      if (pn === CS && performance.now() < t0 + __SLOW__) return false;
      if (pn === this.LINK_STATUS) while (performance.now() < t0 + __SLOW__) {}
    }
    return oG.call(this, p, pn);
  };
  window.__fr = []; const loop = () => { window.__fr.push(performance.now()); if (window.__fr.length > 5000) window.__fr.shift(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
})();""".replace('__SLOW__', str(SLOW))
NOEXT = r"""(() => { const g = WebGL2RenderingContext.prototype.getExtension;
  WebGL2RenderingContext.prototype.getExtension = function (n) { return n === 'KHR_parallel_shader_compile' ? null : g.call(this, n); }; })()"""
GAPS = "(t0) => { const f = window.__fr.filter(t => t >= t0); let m = 0; for (let i = 1; i < f.length; i++) m = Math.max(m, f[i] - f[i - 1]); return { maxGap: Math.round(m), frames: f.length, longTasks: window.__lt.length }; }"


def main():
    res, ok = {}, True
    chk = []
    def need(c, what):
        nonlocal ok
        chk.append(('ok ' if c else 'FAIL ') + what); ok &= bool(c)
    info = lambda pg: pg.evaluate("() => { const v = window.__fraktal.view3dInfo(); return { on: v.on, prep: v.prep, mix: v.mix, cls: document.getElementById('btn-3d').className, title: document.getElementById('btn-3d').title, fly: v.fly.on }; }")
    with sync_playwright() as p:
        a = App(p, query='nosw&noanim&s3d=0.5')
        a.page.add_init_script(HOOK)
        a.open(); pg = a.page
        a.set_view(*SEA); a.wait_done(90); time.sleep(1)
        # --- langsamer Treiber: Antippen -> Vorbereitung, 2D flüssig, dann 3D
        # Grundlinie: Bildtakt vor dem Antippen (headless hängt er von der Systemlage ab, z. B. Bildschirm aus)
        tb = pg.evaluate("() => performance.now()"); time.sleep(2.0)
        base = pg.evaluate(GAPS, tb)['maxGap']
        lim = max(100, round(1.3 * base + 20))
        res['baselineGap'] = base
        pg.evaluate("() => { window.__slowArm = true; window.__lt.length = 0; window.__links.length = 0; }")
        t0 = pg.evaluate("() => performance.now()")
        pg.click('#btn-3d')
        time.sleep(0.4)
        s1 = info(pg)
        need(s1['prep'] and not s1['on'] and 'prep' in s1['cls'] and 'vorbereitet' in s1['title'], f'Vorbereitung sichtbar: {s1}')
        # 2D während der Vorbereitung bedienbar: schieben
        pg.evaluate("() => { const A = window.__fraktal; const c = A.S.cam; A.setCam(c.cx + A.HP.fromNumber(0.3 * 1.5 / c.zoom), c.cy, c.zoom); }")
        tw = time.time()
        while time.time() - tw < SLOW / 1000 + 8 and not info(pg)['on']: time.sleep(0.1)
        s2 = info(pg)
        dt = round(time.time() - tw + 0.4, 2)
        time.sleep(1.0)
        g = pg.evaluate(GAPS, t0)
        res['slowStart'] = dict(prep=s1, after=s2, secs=dt, **g)
        need(s2['on'] and not s2['prep'] and 'prep' not in s2['cls'], f'3D erscheint nach der Übersetzung von selbst ({dt} s, Simulation {SLOW / 1000} s)')
        need(g['maxGap'] < lim and g['longTasks'] == 0, f'kein Block: längste Bildlücke {g["maxGap"]} ms < {lim} (Grundlinie {base} ms), Long Tasks {g["longTasks"]}')
        links = pg.evaluate("() => window.__links")
        need(links == [0], f'nur die Gelände-Variante des Looks übersetzt (ALP {links})')
        # --- Look-Wechsel in 3D: alter Look bleibt, kein Block, dann Alpin
        a.wait_done(90); time.sleep(1)
        pg.evaluate("() => { window.__lt.length = 0; window.__links.length = 0; }")
        t1 = pg.evaluate("() => performance.now()")
        pg.evaluate("() => { const A = window.__fraktal; A.S.alpine = true; A.S.valley = 'forest'; A.S.setCol = 'white'; A.emit('settings'); A.RC.dirty = true; }")
        time.sleep(0.6)
        v0 = pg.evaluate("() => ({ variant: window.__fraktal.T3.variant, waiting: window.__fraktal.T3.waiting })")
        tw = time.time()
        while time.time() - tw < SLOW / 1000 + 8 and pg.evaluate("() => window.__fraktal.T3.variant") != 't3terrX': time.sleep(0.1)
        time.sleep(0.5)
        v1 = pg.evaluate("() => ({ variant: window.__fraktal.T3.variant, waiting: window.__fraktal.T3.waiting })")
        g = pg.evaluate(GAPS, t1)
        res['lookSwitch'] = dict(before=v0, after=v1, **g)
        need(v0['variant'] == 't3terr' and v0['waiting'] and v1['variant'] == 't3terrX' and not v1['waiting'], f'Look-Wechsel: erst alter Look weiter, dann Alpin {v0} -> {v1}')
        need(g['maxGap'] < lim and g['longTasks'] == 0, f'Look-Wechsel ohne Block: {g["maxGap"]} ms < {lim}, Long Tasks {g["longTasks"]}')
        pg.evaluate("() => { const A = window.__fraktal; A.S.alpine = false; A.S.setCol = 'black'; A.emit('settings'); A.RC.dirty = true; }")
        a.errors_slow = list(a.errors)
        need(not a.errors, f'0 Fehler (langsamer Treiber) {a.errors[:3]}')
        a.close()

        # --- frische Seite: Abbrechen + Flug während der Vorbereitung
        a = App(p, query='nosw&noanim&s3d=0.5')
        a.page.add_init_script(HOOK)
        a.open(); pg = a.page
        a.set_view(*SEA); a.wait_done(90); time.sleep(0.5)
        pg.evaluate("() => { window.__slowArm = true; }")
        pg.click('#btn-3d'); time.sleep(0.3)
        pg.click('#btn-3d'); time.sleep(SLOW / 1000 + 1.5)
        s3 = info(pg)
        res['cancel'] = s3
        need(not s3['on'] and not s3['prep'] and 'prep' not in s3['cls'], f'zweites Antippen bricht ab, 2D bleibt: {s3}')
        # Weiß = noch nicht übersetzte Gelände-Variante -> ✈ trifft auf eine laufende Vorbereitung
        # (seit 6.6 fliegt startFly() ohne Angabe im aktuellen Modus – hier also ausdrücklich der 3D-Flug wie der ✈ der 3D-Leiste)
        pg.evaluate("() => { const A = window.__fraktal; A.S.setCol = 'white'; A.emit('settings'); A.startFly(undefined, { d3: true }); }"); time.sleep(0.2)
        s4 = info(pg)
        tw = time.time()
        while time.time() - tw < 10 and not info(pg)['fly']: time.sleep(0.1)
        time.sleep(1.5)
        s5 = info(pg)
        res['flyDuringPrep'] = dict(during=s4, after=s5)
        need(s4['prep'] and not s4['fly'] and s5['on'] and s5['fly'], f'✈ während der Vorbereitung: Flug startet danach (prep={s4["prep"]} -> 3D={s5["on"]}, Flug={s5["fly"]})')
        pg.evaluate("() => { const A = window.__fraktal; A.stopFly(); A.S.setCol = 'black'; A.emit('settings'); }")
        need(not a.errors, f'0 Fehler (Abbrechen/Flug) {a.errors[:3]}')
        a.close()

        # --- ohne KHR_parallel_shader_compile: Häppchen über mehrere Bilder
        a = App(p, query='nosw&noanim&s3d=0.5')
        a.page.add_init_script(NOEXT)
        a.open(); pg = a.page
        a.set_view(*SEA); a.wait_done(90); time.sleep(0.5)
        par = pg.evaluate("() => window.__fraktal.R.parallelCompile")
        pg.click('#btn-3d')
        tw = time.time()
        while time.time() - tw < 15 and not info(pg)['on']: time.sleep(0.1)
        s6 = info(pg)
        res['noExt'] = dict(parallel=par, secs=round(time.time() - tw, 2), **s6)
        need(par is False and s6['on'], f'ohne Erweiterung: 3D erscheint ({res["noExt"]["secs"]} s)')
        a.wait_done(90)
        # --- mehrfach an/aus
        good = 0
        for k in range(5):
            pg.evaluate("() => window.__fraktal.set3d(false)"); time.sleep(1.0)
            pg.click('#btn-3d'); time.sleep(1.5)
            good += 1 if info(pg)['on'] else 0
        res['repeat'] = good
        need(good == 5, f'3D an/aus 5× zuverlässig ({good}/5)')
        need(not a.errors, f'0 Fehler (ohne Erweiterung) {a.errors[:3]}')
        a.close()
    print(json.dumps(res, indent=1))
    print('\n'.join(chk))
    print('RESULT', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
