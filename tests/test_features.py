#!/usr/bin/env python3
"""Funktionstest: Deeplink, Auto-Zoom-Tour, eigene Orte, Bild-Export, Iterations-Override,
keine History-Einträge (Back-Geste des Browsers bleibt unangetastet).
Aufruf: python3 tests/test_features.py
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from e2e_lib import App
from playwright.sync_api import sync_playwright

res, ok = {}, True
with sync_playwright() as p:
    a = App(p).open('m=0&x=-0.8625944137&y=0.2495680306&z=1.705e7&p=gold')
    pg = a.page
    t, st = a.wait_done(60)
    v = pg.evaluate("() => window.__fraktal.viewState()")
    res['deeplink'] = dict(cx=v['cx'][:13], zoom=v['zoom'], palette=v['palette'], renderS=round(t, 2))
    ok &= v['cx'].startswith('-0.8625944137') and abs(v['zoom'] - 1.705e7) < 1 and v['palette'] == 'gold'
    h0 = pg.evaluate("() => history.length")

    # Iterationen: manuell +25 %, dann Auto zurück
    it0 = pg.evaluate("() => window.__fraktal.currentMaxIter()")
    pg.click('#hud-pill'); pg.click('#d-iter-up'); pg.wait_for_timeout(200)
    it1 = pg.evaluate("() => [window.__fraktal.currentMaxIter(), window.__fraktal.S.iterManual]")
    pg.click('#d-iter-auto'); pg.click('#hud-pill')
    it2 = pg.evaluate("() => [window.__fraktal.currentMaxIter(), window.__fraktal.S.iterManual]")
    res['iterations'] = dict(auto=it0, afterPlus=it1, afterAuto=it2)
    ok &= it1[0] == round(it0 * 1.25) and it1[1] is True and it2 == [it0, False]

    # eigener Ort speichern -> Karte erscheint
    a.wait_done(60)
    pg.click('.dock-btn[data-tab=places]'); pg.wait_for_timeout(400)
    pg.click('#btn-save-place'); pg.wait_for_timeout(400)
    n = pg.evaluate("() => JSON.parse(localStorage.getItem('fraktal_v5_places') || '[]').length")
    cards = pg.locator('#user-places .place').count()
    res['user_place'] = dict(stored=n, cards=cards)
    ok &= n == 1 and cards == 1

    # Tour zum Preset "Seepferdchen-Tiefe" (1e9): endet am Ziel
    pg.locator('#preset-places .place').nth(8).locator('.tour').click()
    pg.wait_for_function("() => !window.__fraktal.isMoving() && window.__fraktal.S.cam.zoom > 9e8", timeout=60000, polling=200)
    t2, st2 = a.wait_done(120)
    z = pg.evaluate("() => window.__fraktal.S.cam.zoom")
    res['tour'] = dict(zoom=z, finalRender=round(t2, 2))
    ok &= abs(z / 1e9 - 1) < 1e-6

    # Bild-Export (Screenshot mit Beschriftung)
    size = pg.evaluate("() => window.__fraktal.captureBlob().then(b => b ? b.size : 0)")
    res['capture_png_bytes'] = size
    ok &= size > 50000

    res['history_length_unchanged'] = pg.evaluate("() => history.length") == h0
    ok &= res['history_length_unchanged']
    res['url_hash'] = pg.evaluate("() => location.hash.slice(0, 60)")
    res['errors'] = a.errors
    ok &= not a.errors
    a.close()
print(json.dumps(res, indent=1))
print('RESULT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
