#!/usr/bin/env python3
"""Release-Checks: Versionskonsistenz (Cache-Busting) + PWA (Service Worker, offline) + Screenshots.

 1.+2. tools/check_release.py: APP_VERSION == VERSION (sw.js) == jedes ?v= == Fallback-Tags; Precache-Liste vollständig
       (jede Datei existiert, alles was die Seite lädt steht drin).
 3. Browser: Service Worker übernimmt, danach offline neu laden -> App rendert, 0 Fehler.
 4. Update-Übergang (P2-1): neues sw.js (andere Version) während die Seite läuft -> Update wartet, alter Cache bleibt,
    CPU-Worker stehen seit dem Start; offline wird eine CPU-Ansicht (Zoom 1e31) fertig, 0 Fehler.
Aufruf: python3 tests/test_release.py
"""
import os, re, sys, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), '..')
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf8').read()

# 1.+2. statischer Teil (Versionen, Precache-Liste) – derselbe Check wie im GitHub-Workflow vor dem Deploy
import subprocess
ok = subprocess.call([sys.executable, os.path.join(ROOT, 'tools', 'check_release.py')]) == 0
app_v = re.search(r"const APP_VERSION = '([\d.]+)'", rd('js/app.js')).group(1)

with sync_playwright() as p:
    a = App(p, query='').open()
    pg = a.page
    pg.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)", timeout=30000)
    pg.wait_for_timeout(1500)
    pg.reload(wait_until='load')
    ctrl = pg.evaluate("() => !!navigator.serviceWorker.controller")
    caches = pg.evaluate("() => caches.keys()")
    a.ctx.set_offline(True)
    pg.reload(wait_until='load')
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status().done", timeout=60000)
    st = a.status()
    print('SW kontrolliert:', ctrl, '| Caches:', caches, '| offline gerendert:', st['done'], '| Fehler:', a.errors)
    ok &= ctrl and caches == ['fraktale-' + app_v] and st['done'] and not a.errors
    a.close()

    # P2-1 Update-Übergang: die laufende (kontrollierte) Seite bekommt ein sw.js mit anderer Version. Erwartet: das Update
    # wartet (kein skipWaiting), der alte Cache bleibt, die CPU-Worker stehen schon (beim Start geladen) – offline
    # rechnet die alte Seite eine CPU-Ansicht (Zoom 1e31) fertig.
    a = App(p, query='').open()
    pg = a.page
    pg.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)", timeout=30000)
    pg.wait_for_timeout(1500)
    pg.reload(wait_until='load')
    pg.wait_for_function("() => window.__fraktal && window.__fraktal.status", timeout=20000)
    pg.wait_for_timeout(1000)
    pool = pg.evaluate("() => window.__fraktal.buddhaInfo().busy.length")
    # Ein abgefangenes sw.js kommt bei Playwright nicht an (Service-Worker-Skripte umgehen page.route) -> die neue Version
    # liegt kurz als eigene Datei im Projektordner und wird für denselben Scope registriert (= Update), danach gelöscht
    tmp_sw = os.path.join(ROOT, 'sw-update-test.js')
    open(tmp_sw, 'w', encoding='utf8').write(rd('sw.js').replace("const VERSION = '%s'" % app_v, "const VERSION = '9.9.9'"))
    try:
        pg.evaluate("() => navigator.serviceWorker.register('sw-update-test.js', { updateViaCache: 'none' }).then(() => true)")
        t0, state = time.time(), None
        while time.time() - t0 < 60:
            state = pg.evaluate("() => navigator.serviceWorker.getRegistration().then(r => r ? [r.installing && r.installing.state, r.waiting && r.waiting.state, r.active && r.active.scriptURL.split('/').pop()] : null)")
            if state and state[1] == 'installed':
                break
            time.sleep(0.25)
        pg.wait_for_timeout(500)
        state = pg.evaluate("() => navigator.serviceWorker.getRegistration().then(r => [r.installing && r.installing.state, r.waiting && r.waiting.state, r.active && r.active.scriptURL.split('/').pop()])")
        caches2 = pg.evaluate("() => caches.keys()")
    finally:
        os.remove(tmp_sw)
    a.ctx.set_offline(True)
    SEA = ('-0.743643887037158704752191506114774', '0.131825904205311970493132056385139')
    a.set_view(SEA[0], SEA[1], 1e31)
    try:
        t, st = a.wait_done(60)
        done = st['done'] and st['plan']['kind'] == 'cpu'
    except TimeoutError:
        t, done = 60, False
    print('Update-Übergang: Worker beim Start', pool, '| Registrierung [installiert, wartet, aktiv]', state, '| Caches:', sorted(caches2),
          '| offline 1e31 (CPU) fertig:', done, 'in %.1f s' % t, '| Fehler:', a.errors)
    ok &= pool >= 2 and state[1] == 'installed' and state[2] == 'sw.js' and sorted(caches2) == sorted(['fraktale-' + app_v, 'fraktale-9.9.9']) and done and not a.errors
    a.close()
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
