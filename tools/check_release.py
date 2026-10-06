#!/usr/bin/env python3
"""Statischer Release-Check (ohne Browser) – läuft lokal und im GitHub-Workflow vor dem Deploy.

 1. Versionsgleichheit: APP_VERSION (js/app.js) == VERSION (sw.js) == jedes ?v= in index.html und Manifest
    == Fallback-Texte in index.html (info-version, version-line).
 2. Jede Datei der Precache-Liste (sw.js) existiert.
 3. Alles, was die Seite lädt, steht in der Precache-Liste (sonst fehlt es offline): <script src>,
    <link rel=stylesheet|manifest|icon|apple-touch-icon>, die Icons im Manifest, die Worker-Skripte (new Worker in
    allen js/*.js) und deren importScripts.
 4. Diese Verweise tragen ?v=<Version> (Cache-Busting; Worker/importScripts bekommen sie zur Laufzeit).
Aufruf: python3 tools/check_release.py [--root=_site]   (Exit 0 = ok)
"""
import os, re, sys, json

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
# --root=_site: das gesammelte Deploy-Artefakt prüfen (Workflow) – dort muss jede Datei der Precache-Liste liegen
ROOT = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--root=')), ROOT)


def rd(p):
    return open(os.path.join(ROOT, p), encoding='utf8').read()


def main():
    errs = []
    html, sw, man, app = rd('index.html'), rd('sw.js'), rd('manifest.webmanifest'), rd('js/app.js')
    app_v = re.search(r"const APP_VERSION = '([\d.]+)'", app).group(1)
    sw_v = re.search(r"const VERSION = '([\d.]+)'", sw).group(1)
    qs = set(re.findall(r"\?v=([\d.]+)", html)) | set(re.findall(r"\?v=([\d.]+)", man))
    fallbacks = re.findall(r'id="(?:info-version|version-line)"[^>]*>([\d.]+)<', html)
    print('APP_VERSION', app_v, '| sw.js', sw_v, '| ?v= in html/manifest', sorted(qs), '| Fallback', fallbacks)
    if not (app_v == sw_v and qs == {app_v} and len(fallbacks) == 2 and set(fallbacks) == {app_v}):
        errs.append('Versionen uneinheitlich')

    listed = re.findall(r"^\s+'([^']+)',?$", sw.split('const ASSETS = [')[1].split(']')[0], re.M)
    missing = [f for f in listed if not os.path.exists(os.path.join(ROOT, f))]
    print('Precache-Dateien', len(listed), '| fehlend', missing)
    if missing or len(listed) < 20:
        errs.append('Precache-Liste unvollständig: %s' % missing)

    refs = []   # (Datei, mit ?v= erwartet)
    refs += [(u, True) for u in re.findall(r'<script\s+src="([^"]+)"', html)]
    refs += [(u, True) for u in re.findall(r'<link\s+rel="(?:stylesheet|manifest|icon|apple-touch-icon)"\s+href="([^"]+)"', html)]
    refs += [(i['src'], True) for i in json.loads(man).get('icons', [])]
    # Worker werden in mehreren Modulen angelegt (seit 6.5.4 js/cpu-pool.js, js/refs.js) -> alle Skripte durchsuchen
    workers = sorted({w for f in sorted(os.listdir(os.path.join(ROOT, 'js'))) if f.endswith('.js')
                      for w in re.findall(r"new Worker\('([^']+)'", rd('js/' + f))})
    refs += [(u, False) for u in workers]
    for w in workers:
        src = rd(w.split('?')[0])
        for m in re.findall(r"importScripts\(([^)]*)\)", src):
            refs += [(os.path.join(os.path.dirname(w), f), False) for f in re.findall(r"'([^']+)'", m)]
    bad_v, not_cached = [], []
    for u, need_v in refs:
        path = u.split('?')[0]
        if need_v and not re.search(r'\?v=' + re.escape(app_v) + r'$', u):
            bad_v.append(u)
        if path not in listed:
            not_cached.append(path)
    print('geladene Dateien', len(refs), '| Worker', workers, '| ohne ?v=', bad_v, '| nicht im Precache', sorted(set(not_cached)))
    if len(workers) < 2:
        errs.append('Worker-Skripte nicht gefunden (erwartet tile-worker + orbit-worker): %s' % workers)
    if bad_v:
        errs.append('Verweise ohne ?v=%s: %s' % (app_v, bad_v))
    if not_cached:
        errs.append('nicht im Precache: %s' % sorted(set(not_cached)))
    for e in errs:
        print('FEHLER', e)
    print('RESULT', 'PASS' if not errs else 'FAIL')
    return 0 if not errs else 1


if __name__ == '__main__':
    sys.exit(main())
