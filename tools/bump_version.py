#!/usr/bin/env python3
"""Version an allen Stellen konsistent setzen (Gutachten P3-12) und danach tools/check_release.py laufen lassen.

Stellen: APP_VERSION in js/app.js, VERSION in sw.js, jedes ?v=<alt> in index.html und manifest.webmanifest, die
Fallback-Texte in index.html (info-version, version-line, noscript). Kommentare mit älteren Versionsnummern bleiben.
Aufruf: python3 tools/bump_version.py 6.5.4 [--dry]
"""
import os, re, sys, subprocess

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r'\d+\.\d+\.\d+', sys.argv[1]):
        sys.exit('Aufruf: python3 tools/bump_version.py X.Y.Z [--dry]')
    new, dry = sys.argv[1], '--dry' in sys.argv
    p = lambda f: os.path.join(ROOT, f)
    app = open(p('js/app.js'), encoding='utf-8').read()
    old = re.search(r"const APP_VERSION = '([\d.]+)'", app).group(1)
    q = re.escape(old)
    edits = {
        'js/app.js': [(r"const APP_VERSION = '" + q + "'", "const APP_VERSION = '%s'" % new)],
        'sw.js': [(r"const VERSION = '" + q + "'", "const VERSION = '%s'" % new)],
        'index.html': [(r'\?v=' + q + r'(?![\d.])', '?v=' + new), (r'(id="(?:info-version|version-line)"[^>]*>)' + q + '<', r'\g<1>' + new + '<'),
                       (r'Fraktal-Explorer ' + q + r'(?![\d.])', 'Fraktal-Explorer ' + new)],
        'manifest.webmanifest': [(r'\?v=' + q + r'(?![\d.])', '?v=' + new)],
    }
    total = 0
    for f, rules in edits.items():
        s = open(p(f), encoding='utf-8').read()
        n_f = 0
        for pat, rep in rules:
            s, n = re.subn(pat, rep, s)
            n_f += n
        print('%-22s %2d Stellen' % (f, n_f))
        total += n_f
        if not dry:
            open(p(f), 'w', encoding='utf-8').write(s)
    print('%s -> %s: %d Stellen%s' % (old, new, total, ' (Probelauf)' if dry else ''))
    if not dry:
        sys.exit(subprocess.call([sys.executable, p('tools/check_release.py')]))


if __name__ == '__main__':
    main()
