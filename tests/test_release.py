#!/usr/bin/env python3
"""Release-Checks: Versionskonsistenz (Cache-Busting) + PWA (Service Worker, offline) + Screenshots.

 1.+2. tools/check_release.py: APP_VERSION == VERSION (sw.js) == jedes ?v= == Fallback-Tags; Precache-Liste vollständig
       (jede Datei existiert, alles was die Seite lädt steht drin).
 3. Browser: Service Worker übernimmt, danach offline neu laden -> App rendert, 0 Fehler.
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
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
