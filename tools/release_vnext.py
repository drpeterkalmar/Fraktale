#!/usr/bin/env python3
"""Version beim Zusammenführen vergeben (Queue: claude_job.py zusammenfuehren --vorher): nächste freie Nummer nach dem Stand von
main (nach dem Rebase), überall setzen (tools/bump_version.py), „Version VNEXT“ in README.md ersetzen und committen.

  --mindest X.Y.Z   kleinste Version (z. B. 7.4.0 für eine neue Unterversion); liegt main schon darüber: Patch + 1
Aufruf: python3 tools/release_vnext.py --mindest 7.4.0 "Kurzbeschreibung für die Commit-Nachricht"
"""
import os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def main():
    args = sys.argv[1:]
    mind = None
    if '--mindest' in args:
        i = args.index('--mindest'); mind = args[i + 1]; del args[i:i + 2]
    msg = ' '.join(args).strip() or 'Release'
    app = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()
    cur = [int(x) for x in re.search(r"const APP_VERSION = '([\d.]+)'", app).group(1).split('.')]
    nxt = [cur[0], cur[1], cur[2] + 1]
    if mind:
        m = [int(x) for x in mind.split('.')]
        if m > cur: nxt = m
    v = '%d.%d.%d' % tuple(nxt)
    readme = os.path.join(ROOT, 'README.md')
    s = open(readme, encoding='utf-8').read()
    if 'Version VNEXT' not in s:
        sys.exit('README.md: kein „Version VNEXT“')
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'tools', 'bump_version.py'), v])
    open(readme, 'w', encoding='utf-8').write(s.replace('Version VNEXT', 'Version ' + v, 1))
    subprocess.check_call(['git', 'commit', '-q', '-am', v + ': ' + msg + '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'], cwd=ROOT)
    print('Version', v)


if __name__ == '__main__':
    main()
