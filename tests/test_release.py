#!/usr/bin/env python3
"""Release-Checks: Versionskonsistenz (Cache-Busting) + PWA (Service Worker, offline) + Screenshots.

 1. APP_VERSION (js/app.js) == VERSION (sw.js) == jedes ?v= in index.html/manifest == Fallback-Tag.
 2. Jede Precache-Datei aus sw.js existiert.
 3. Browser: Service Worker übernimmt, danach offline neu laden -> App rendert, 0 Fehler.
Aufruf: python3 tests/test_release.py
"""
import os, re, sys, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), '..')
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf8').read()

ok = True
app_v = re.search(r"const APP_VERSION = '([\d.]+)'", rd('js/app.js')).group(1)
sw = rd('sw.js')
sw_v = re.search(r"const VERSION = '([\d.]+)'", sw).group(1)
html = rd('index.html')
qs = set(re.findall(r"\?v=([\d.]+)", html)) | set(re.findall(r"\?v=([\d.]+)", rd('manifest.webmanifest')))
fallback = re.search(r'id="info-version"[^>]*>([\d.]+)<', html).group(1)
print('APP_VERSION', app_v, '| sw.js', sw_v, '| ?v= in html/manifest', sorted(qs), '| Fallback', fallback)
ok &= app_v == sw_v == fallback and qs == {app_v}
listed = re.findall(r"^\s+'([^']+)',?$", sw.split('const ASSETS = [')[1].split(']')[0], re.M)
missing = [f for f in listed if not os.path.exists(os.path.join(ROOT, f))]
print('Precache-Dateien', len(listed), 'fehlend', missing)
ok &= not missing and len(listed) > 20

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
