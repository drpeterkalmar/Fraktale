// sw.js — Service Worker: offline-fähig, sauberes Cache-Busting.
// Regeln (Lehre aus v4: Browser cachen Worker-Skripte hartnäckig):
//  * Jede Ressource wird mit ?v=VERSION geladen; der Cache-Name enthält die Version.
//  * Neue Version -> neuer sw.js-Inhalt -> Browser installiert neu; aktiv (und alte Caches gelöscht) erst beim nächsten Start.
//  * HTML (Navigation) immer zuerst frisch aus dem Netz (no-cache), offline aus dem Cache.
//  * VERSION MUSS APP_VERSION in js/app.js entsprechen (tests/test_release.py prüft das).
const VERSION = '6.7.0';
const CACHE = 'fraktale-' + VERSION;
const Q = '?v=' + VERSION;
const ASSETS = [
    'style.css',
    'translations.js',
    'manifest.webmanifest',
    'js/app.js',
    'js/cpu-pool.js',
    'js/flight.js',
    'js/fractal-core.js',
    'js/gestures.js',
    'js/hp.js',
    'js/layers.js',
    'js/orbit-worker.js',
    'js/palettes.js',
    'js/refs.js',
    'js/renderer.js',
    'js/scheduler.js',
    'js/shaders.js',
    'js/three-tech.js',
    'js/three.js',
    'js/tile-worker.js',
    'js/ui.js',
    'js/url-state.js',
    'assets/icons/icon-180.png',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
    'assets/icons/icon-maskable-512.png',
    'assets/modes/0.jpg',
    'assets/modes/1.jpg',
    'assets/modes/2.jpg',
    'assets/modes/3.jpg',
    'assets/modes/4.jpg',
    'assets/modes/5.jpg',
    'assets/modes/6.jpg',
    'assets/modes/7.jpg'
].map(u => u + Q).concat(['./', 'index.html']);

self.addEventListener('install', (e) => {
    // kein skipWaiting (P2-1): eine neue Version übernimmt erst beim nächsten Start – eine laufende Seite behält ihre
    // Dateien und ihren Cache (vorher übernahm das Update sofort und löschte den alten Cache unter der laufenden Seite)
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('fraktale-') && k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== location.origin) return;
    if (req.mode === 'navigate') {
        e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('index.html', copy));
            return res;
        }).catch(() => caches.match('index.html')));
        return;
    }
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then((res) => {
        if (res.ok && url.search.includes('v=' + VERSION)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
    })));
});
