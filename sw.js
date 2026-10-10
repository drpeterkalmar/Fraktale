// sw.js — Service Worker: offline-fähig, sauberes Cache-Busting.
// Regeln (Lehre aus v4: Browser cachen Worker-Skripte hartnäckig):
//  * Jede Ressource wird mit ?v=VERSION geladen; der Cache-Name enthält die Version.
//  * Neue Version -> neuer sw.js-Inhalt -> Browser installiert neu; aktiv (und alte Caches gelöscht) erst beim nächsten Start.
//  * HTML (Navigation) immer zuerst frisch aus dem Netz (no-cache), offline aus dem Cache.
//  * VERSION MUSS APP_VERSION in js/app.js entsprechen (tests/test_release.py prüft das).
const VERSION = '7.1.5';
const CACHE = 'fraktale-' + VERSION;
const Q = '?v=' + VERSION;
const ASSETS = [
    'style.css',
    'translations.js',
    'manifest.webmanifest',
    'js/app.js',
    'js/bulb.js',
    'js/capture.js',
    'js/cpu-pool.js',
    'js/density.js',
    'js/flames.js',
    'js/flight.js',
    'js/fractal-core.js',
    'js/gestures.js',
    'js/hp.js',
    'js/layers.js',
    'js/orbit-worker.js',
    'js/palettes.js',
    'js/png-worker.js',
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
    'assets/modes/7.jpg',
    'assets/modes/8.jpg',
    'assets/modes/9.jpg',
    'assets/modes/10.jpg',
    'assets/modes/11.jpg',
    'assets/modes/12.jpg',
    'assets/modes/13.jpg',
    'assets/modes/15.jpg',
    'assets/modes/14.jpg',
    'assets/sights/bs_armada.jpg',
    'assets/sights/bs_cathedral.jpg',
    'assets/sights/bs_lanterns.jpg',
    'assets/sights/bs_torch.jpg',
    'assets/sights/j_dendrite.jpg',
    'assets/sights/j_galaxy.jpg',
    'assets/sights/j_lightning.jpg',
    'assets/sights/j_rabbit.jpg',
    'assets/sights/j_siegel.jpg',
    'assets/sights/j_spiral.jpg',
    'assets/sights/mb_antenna.jpg',
    'assets/sights/mb_deep.jpg',
    'assets/sights/mb_elephant.jpg',
    'assets/sights/mb_mini.jpg',
    'assets/sights/mb_scepter.jpg',
    'assets/sights/mb_seahorse.jpg',
    'assets/sights/mu_coast.jpg',
    'assets/sights/mu_four.jpg',
    'assets/sights/mu_twins.jpg',
    'assets/sights/nw_eight.jpg',
    'assets/sights/nw_islands.jpg',
    'assets/sights/nw_z5.jpg',
    'assets/sights/nw_z6.jpg',
    'assets/sights/tri_breakers.jpg',
    'assets/sights/tri_feathers.jpg',
    'assets/sights/tri_valley.jpg',
    'assets/sights/tri_whole.jpg',
    'assets/sights/box_corridor.jpg',
    'assets/sights/box_moon.jpg',
    'assets/sights/box_tower.jpg',
    'assets/sights/bud_anti.jpg',
    'assets/sights/bud_classic.jpg',
    'assets/sights/bud_nebula.jpg',
    'assets/sights/bulb_close.jpg',
    'assets/sights/bulb_four.jpg',
    'assets/sights/bulb_whole.jpg',
    'assets/sights/men_corner.jpg',
    'assets/sights/men_cube.jpg',
    'assets/sights/men_view.jpg',
    'assets/sights/men_wall.jpg',
    'assets/sights/lya_aabab.jpg',
    'assets/sights/lya_ab.jpg',
    'assets/sights/lya_abbab.jpg',
    'assets/sights/lya_bbabaa.jpg',
    'assets/sights/lya_zircon.jpg',
    'assets/sights/mag_perlen.jpg',
    'assets/sights/mag_riff.jpg',
    'assets/sights/mag_seepferd.jpg',
    'assets/sights/mag_spiralen.jpg',
    'assets/sights/nova_insel.jpg',
    'assets/sights/nova_julia.jpg',
    'assets/sights/nova_kette.jpg',
    'assets/sights/nova_tief.jpg',
    'assets/sights/phx_federn.jpg',
    'assets/sights/phx_fluegel.jpg',
    'assets/sights/phx_locken.jpg',
    'assets/sights/phx_spirale.jpg'
,
    'assets/sights/att_clifford.jpg',
    'assets/sights/att_clifford2.jpg',
    'assets/sights/att_dejong.jpg',
    'assets/sights/att_dejong2.jpg',
    'assets/sights/att_lorenz.jpg',
    'assets/sights/att_svensson.jpg',
    'assets/sights/flm_eisblume.jpg',
    'assets/sights/flm_farn.jpg',
    'assets/sights/flm_galaxie.jpg',
    'assets/sights/flm_juwel.jpg',
    'assets/sights/flm_kranz.jpg',
    'assets/sights/flm_nebel.jpg',
    'assets/sights/flm_portal.jpg',
    'assets/sights/flm_ringe.jpg',
    'assets/sights/flm_sichel.jpg',
    'assets/sights/flm_stern.jpg',
    'assets/sights/flm_wolke.jpg',
    'assets/sights/flm_yinyang.jpg',
    'assets/modes/16.jpg',
    'assets/modes/17.jpg',
    'assets/modes/18.jpg',
    'assets/sights/apol_bogen.jpg',
    'assets/sights/apol_hallen.jpg',
    'assets/sights/apol_tief.jpg',
    'assets/sights/kifs_fels.jpg',
    'assets/sights/kifs_kristall.jpg',
    'assets/sights/kifs_tempel.jpg',
    'assets/sights/qj_drache.jpg',
    'assets/sights/qj_spirale.jpg',
    'assets/sights/qj_wolke.jpg'
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
