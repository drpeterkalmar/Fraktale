// ui.js — Oberfläche: HUD, Dock, Bottom-Sheet, Karten, Paletten, c-Pad, Minimap, Teilen, Tastatur.
// Liest/schreibt nur über window.__fraktal (app.js). Alle Texte via translations.js (t()).
(function () {
'use strict';
const A = self.__fraktal;
if (!A) return;
const { S, HP, PAL, t } = A;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const V = '?v=' + A.APP_VERSION;

// ------------------------------------------------------------------ i18n
function applyI18n() {
    document.documentElement.lang = S.lang;
    document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); n.setAttribute('aria-label', t(n.dataset.i18nTitle)); });
    $('sheet-close').setAttribute('aria-label', t('close') !== 'close' ? t('close') : '×');
    buildModes(); buildUserPlaces(); buildSights();
    hudUpdate(true);
}

// ------------------------------------------------------------------ Toast
let toastTimer = 0;
function toast(msg, ms) {
    const n = $('toast');
    n.textContent = msg;
    n.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => n.classList.remove('show'), ms || 2600);
}

// ------------------------------------------------------------------ 6.5 Deko: weiche Übergänge
// Beim Wechsel von Welt/Farbe/Look: Schnappschuss des aktuellen Bilds (frisch gezeichnet, im selben Task lesbar) liegt
// als Ebene über dem Canvas und blendet aus, während darunter schon das neue Bild steht. Einmalig pro Wechsel (kein
// Dauer-Loop); die Ebene wird danach freigegeben. ?deko=0 = harter Wechsel wie bis 6.4.1.
let fadeCv = null, fadeT = 0;
function crossfade(ms) {
    if (!A.DEKO || document.hidden) return;
    const src = A.R.canvas;
    if (!src.width || !src.height) return;
    try { A.freshFrame(); } catch (e) { return; }
    if (!fadeCv) { fadeCv = document.createElement('canvas'); fadeCv.id = 'xfade'; src.after(fadeCv); }
    fadeCv.width = src.width; fadeCv.height = src.height;
    fadeCv.getContext('2d').drawImage(src, 0, 0);
    fadeCv.hidden = false;
    fadeCv.style.transition = 'none'; fadeCv.style.opacity = '1';
    clearTimeout(fadeT);
    const dur = A.RM.matches ? 150 : ms;
    // zwei Bilder warten: das neue Bild steht dann schon unter der Ebene
    requestAnimationFrame(() => requestAnimationFrame(() => { fadeCv.style.transition = `opacity ${dur}ms cubic-bezier(.4, 0, .2, 1)`; fadeCv.style.opacity = '0'; }));
    fadeT = setTimeout(() => { fadeCv.hidden = true; fadeCv.width = fadeCv.height = 1; }, dur + 120);
}
function flash() {
    if (!A.DEKO || A.RM.matches) return;
    let f = $('flash');
    if (!f) { f = el('div'); f.id = 'flash'; document.body.appendChild(f); }
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

// ------------------------------------------------------------------ HUD
let hudT = 0, busyT0 = 0, sweepT = 0;
const MODE_NAMES = () => A.MODE_KEYS.map(k => t(k));
function hudUpdate(force) {
    const now = performance.now();
    if (!force && now - hudT < 200) return;
    hudT = now;
    const names = MODE_NAMES();
    $('hud-mode').textContent = cap(names[S.formula]);
    $('hud-zoom').textContent = A.fmtZoom(S.cam.zoom);
    const st = A.status();
    const prog = $('hud-progress');
    const job = A.RC.job;
    let p = null;
    if (job && now - job.t0 > 250) p = job.kind === 'gpu' ? job.row / job.h : job.tilesDone / Math.max(1, job.tilesTotal);
    const fx = A.RC.fix;
    if (p === null && fx) p = fx.total ? 0.5 + 0.5 * fx.done / fx.total : 0.5;   // Präzisionskorrektur = zweite Hälfte
    prog.style.transform = p === null ? 'scaleX(0)' : `scaleX(${Math.max(0.04, p).toFixed(3)})`;
    prog.classList.toggle('on', p !== null);
    const pill = $('hud-pill');
    if (A.DEKO) {   // 6.5: fertig nach > 0,6 s Rechnen → einmal Lichtschweif (höchstens alle 4 s, nicht im Flug)
        if (p !== null && !busyT0) busyT0 = now;
        else if (p === null && busyT0) {
            if (now - busyT0 > 600 && now - sweepT > 4000 && !A.FLY.on) { sweepT = now; pill.classList.remove('done'); void pill.offsetWidth; pill.classList.add('done'); }
            busyT0 = 0;
        }
    }
    pill.classList.toggle('busy', p !== null);
    if (!$('hud-details').hidden) {
        const d = HP.digitsForZoom(S.cam.zoom);
        $('d-re').textContent = HP.toString(S.cam.cx, d).replace('-', '−');
        $('d-im').textContent = HP.toString(S.cam.cy, d).replace('-', '−');
        $('d-zoom').textContent = A.fmtZoom(S.cam.zoom) + '  ⇄';
        $('d-iter').textContent = A.currentMaxIter();
        $('d-iter-auto').classList.toggle('on', !S.iterManual);
        $('d-engine').textContent = engineText(st);
        $('d-time').textContent = st.lastFullMs ? (st.lastFullMs / 1000).toFixed(2) + ' s' : '–';
        $('d-fps').textContent = st.fps || '–';
    }
    $('m-iter').textContent = A.currentMaxIter();
    $('t-iter-auto').checked = !S.iterManual;
    if (!$('sheet').hidden && currentTab === 'more') $('engine-info').textContent = engineText(st) + ' · ' + A.R.info().renderer;
    drawMinimap();
    updateJuliaChip();
}
function engineText(st) {
    const p = st.plan;
    if (p.kind === 'bulb') return 'GPU Raymarching';
    if (p.kind === 'buddha') return 'CPU Buddhabrot';
    let s = p.kind === 'gpu' ? (p.mode === 'direct' ? t('engine_gpu_direct') : t('engine_gpu_perturb')) : t('engine_cpu') + (p.mode === 'perturb' ? ' Perturbation' : ' f64');
    if (p.mode === 'perturb' && st.useBLA) s += ' ' + t('engine_bla');
    if (p.mode === 'perturb' && st.ref) s += ` · Ref ${st.ref.method}${st.ref.period ? ' p=' + st.ref.period : ''}`;
    return s;
}
const cap = (s) => s ? s.toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/Z³/g, 'z³') : s;

$('hud-pill').addEventListener('click', () => {
    const d = $('hud-details');
    d.hidden = !d.hidden;
    $('hud-pill').setAttribute('aria-expanded', String(!d.hidden));
    hudUpdate(true);
});
$('d-zoom').addEventListener('click', () => { S.zoomFormat = S.zoomFormat === 'words' ? 'sci' : 'words'; A.saveSettings(); hudUpdate(true); });
$('d-iter-up').addEventListener('click', () => A.changeIter(1.25));
$('d-iter-down').addEventListener('click', () => A.changeIter(0.8));
$('d-iter-auto').addEventListener('click', () => A.setIterAuto(true));
$('m-iter-up').addEventListener('click', () => A.changeIter(1.25));
$('m-iter-down').addEventListener('click', () => A.changeIter(0.8));
$('t-iter-auto').addEventListener('change', (e) => A.setIterAuto(e.target.checked));

// ------------------------------------------------------------------ Chrome ein/aus
function setChrome(on) {
    S.chrome = on;
    document.body.classList.toggle('immersive', !on);
}

// ------------------------------------------------------------------ Bottom-Sheet
const sheet = $('sheet');
let currentTab = null;
sheet.hidden = true;
function openSheet(tab) {
    if (!S.chrome) setChrome(true);
    currentTab = tab;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => sheet.classList.add('open'));
    document.querySelectorAll('#sheet-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.dock-btn[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
    requestAnimationFrame(moveInk);
    $('share-pop').hidden = true;
    document.body.classList.add('sheet-open');
    if (tab === 'worlds') { buildModes(); drawCpad(); if (A.DENS) A.DENS.prewarm(); }     // 7.1: Lichtbilder-Shader im Hintergrund übersetzen
    if (tab === 'more') syncShot();
    if (tab === 'more') hudUpdate(true);
}
// 6.5: gleitender Leuchtbalken unter dem aktiven Reiter
const ink = el('span'); ink.id = 'tab-ink'; $('sheet-tabs').prepend(ink);
function moveInk() {
    const b = document.querySelector('#sheet-tabs [role=tab].on');
    if (!b || !b.offsetWidth) return;
    ink.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    ink.style.width = b.offsetWidth + 'px';
}
addEventListener('resize', () => requestAnimationFrame(moveInk));
function closeSheet() {
    sheet.classList.remove('open', 'full');
    sheet.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('on'));
    document.body.classList.remove('sheet-open');
    currentTab = null;
    setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
}
document.querySelectorAll('.dock-btn[data-tab]').forEach(b => b.addEventListener('click', () => {
    if (currentTab === b.dataset.tab) closeSheet(); else openSheet(b.dataset.tab);
}));
document.querySelectorAll('#sheet-tabs [data-tab]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.tab)));
$('sheet-close').addEventListener('click', closeSheet);

// Ziehen am Griff: runter = schließen, hoch = groß
(function sheetDrag() {
    const grab = $('sheet-grab');
    let y0 = null, t0 = 0, dy = 0;
    const start = (e) => { y0 = e.clientY; t0 = performance.now(); dy = 0; sheet.style.transition = 'none'; grab.setPointerCapture(e.pointerId); };
    const move = (e) => {
        if (y0 === null) return;
        dy = e.clientY - y0;
        const land = matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
        if (!land) sheet.style.transform = `translateY(${Math.max(-80, dy)}px)`;
    };
    const end = () => {
        if (y0 === null) return;
        const v = dy / Math.max(1, performance.now() - t0);
        sheet.style.transition = ''; sheet.style.transform = '';
        if (dy > 90 || v > 0.6) closeSheet();
        else if (dy < -40 || v < -0.5) sheet.classList.add('full');
        else if (dy > 30) sheet.classList.remove('full');
        y0 = null;
    };
    grab.addEventListener('pointerdown', start);
    grab.addEventListener('pointermove', move);
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    grab.addEventListener('click', () => sheet.classList.toggle('full'));
})();

A.on((w) => {
    if (w === 'tap') {
        if (!sheet.hidden && sheet.classList.contains('open')) closeSheet();
        else if (!$('share-pop').hidden) $('share-pop').hidden = true;
        else if (!$('hud-details').hidden) { $('hud-details').hidden = true; $('hud-pill').setAttribute('aria-expanded', 'false'); }
        else if (hudless()) hudHide(true);         // 6.8: Vollbild/Kino-Modus – Tipp auf das Bild blendet die Bedienung wieder aus
        else setChrome(!S.chrome);
    } else if (w === 'frame') hudUpdate(false);
    else if (w === 'mode') { buildModes(); updateJuliaPanel(); hudUpdate(true); minimapBase = null; sync3d(); syncShot(); syncSet(); syncLook(); buildSights(); }
    else if (w === 'julia') { updateJuliaPanel(); }
    else if (w === 'bulb') syncBulb();
    else if (w === 'wp') { syncLook(); syncSet(); }
    else if (w === 'iter') hudUpdate(true);
    else if (w === 'settings') syncControls();
    else if (w === '3d' || w === 'fly') { sync3d(); if (w === '3d') syncShot(); }
    else if (w === '3dprep') prep3dProgress();
    else if (w && w.toast) toast(w.toast, w.ms);
});

// ------------------------------------------------------------------ Welten
// 7.1: Welten in Gruppen (Klassiker, Exoten, 3D, Lichtbilder) mit Überschrift
function buildModes() {
    const g = $('mode-grid');
    g.innerHTML = '';
    const names = MODE_NAMES();
    for (const [gk, list] of A.MODE_GROUPS) {
        g.appendChild(el('h4', 'mode-group', t(gk)));
        for (const i of list) {
            const k = A.MODE_KEYS[i];
            const b = el('button', 'mode-card' + (i === S.formula ? ' on' : ''));
            b.innerHTML = `<span class="thumb" style="background-image:url('assets/modes/${i}.jpg${V}')"></span><span class="name">${cap(names[i])}</span><span class="formula">${t('f_' + k)}</span>`;
            b.addEventListener('click', () => { if (i !== S.formula) crossfade(650); A.setMode(i); buildModes(); });
            g.appendChild(b);
        }
    }
}
// 7.1 Parameter der Welt: Burning-Ship-Familie, Multibrot (Exponent, Morph), Newton (Polynom), Lyapunov (Folge), Phoenix,
// Nova, Magnet. Änderungen rechnen sofort neu (wie das c-Pad); Regler live, gespeichert beim Loslassen
const LYA_SEQ = ['AB', 'AABAB', 'BBBBBBAAAAAA', 'AABB', 'ABBAB', 'BBABAA'];
const NEWTON_NAMES = ['z³ − 1', 'z⁴ − 1', 'z⁵ − 1', 'z³ − 2z + 2', 'z⁶ + z³ − 1', 'z⁸ + 15z⁴ − 16'];
function wpSeg(key, opts, cls) {
    const w = S.wp[S.formula] || {};
    return `<div class="seg seg-grid ${cls || ''}" data-wp="${key}">${opts.map(([v, lbl]) => `<button data-v="${v}" class="${String(w[key]) === String(v) ? 'on' : ''}">${lbl}</button>`).join('')}</div>`;
}
function wpSlider(key, lbl, min, max, step) {
    const w = S.wp[S.formula] || {};
    return `<label class="slider"><span>${lbl}</span><input type="range" data-wps="${key}" min="${min}" max="${max}" step="${step}" value="${w[key]}"><output>${(+w[key]).toFixed(step < 0.01 ? 4 : 2)}</output></label>`;
}
function wpToggle(key, lbl) {
    const w = S.wp[S.formula] || {};
    return `<label class="toggle"><span>${lbl}</span><input type="checkbox" data-wpt="${key}" ${w[key] ? 'checked' : ''}><i></i></label>`;
}
let wpBuilt = -1;
function syncWP(force) {
    const f = S.formula, P = $('wp-panel');
    const has = A.WP_DEF[f] !== undefined;
    P.hidden = !has;
    if (!has) { wpBuilt = -1; return; }
    if (wpBuilt === f && !force) return;
    wpBuilt = f;
    $('wp-title').textContent = cap(MODE_NAMES()[f]);
    const w = S.wp[f] || {};
    let h = '';
    if (f === 1) h = wpToggle('m', t('jm_morph')) + (w.m ? `<label class="slider"><span>${t('jm_speed')}</span><input type="range" id="jm-speed" min="-1.5" max="1.5" step="0.05" value="${S.flySpeed}"><output>${(+S.flySpeed).toFixed(2)}</output></label>` : '');
    else if (f === 2) h = wpSeg('v', [[0, t('bs_ship')], [1, 'Celtic'], [2, t('bs_perp')], [3, t('bs_buffalo')]]);
    else if (f === 4) h = wpSlider('e', t('m_exp'), 2, 8, 0.01) + wpToggle('m', t('m_morph'));
    else if (f === 5) h = wpSeg('p', NEWTON_NAMES.map((n, i) => [i, n]), 'c3');
    else if (f === 10) h = wpSeg('s', LYA_SEQ.map(q => [q, q.length > 6 ? q.slice(0, 6) + '…' : q]), 'c3') + `<input class="seq" id="wp-seq" maxlength="24" autocomplete="off" spellcheck="false" value="${A.lyaSeq(w.s).s}" aria-label="${t('lya_seq')}">`;
    else if (f === 11) h = wpSeg('v', [[0, 'Julia'], [1, 'Mandel']], 'c2') + wpSlider('cr', 'c (Re)', -1, 1, 0.0001) + wpSlider('ci', 'c (Im)', -1, 1, 0.0001) + wpSlider('pr', 'p (Re)', -1, 1, 0.0001) + wpSlider('pi', 'p (Im)', -1, 1, 0.0001);
    else if (f === 12) h = wpSeg('v', [[0, 'Mandel'], [1, 'Julia']], 'c2') + wpSlider('r', t('nova_r'), 0.2, 2, 0.01) + (w.v ? wpSlider('cr', 'c (Re)', -1.5, 1.5, 0.0001) + wpSlider('ci', 'c (Im)', -1.5, 1.5, 0.0001) : '');
    else if (f === 13) h = wpSeg('v', [[0, 'Magnet I'], [1, 'Magnet II']], 'c2');
    else if (f === 7) h = wpSeg('v', [[0, 'Buddhabrot'], [1, 'Nebulabrot'], [2, 'Anti']], 'c3');
    else if (f === 14) {
        const G = self.FKDensity.GALLERY;
        h = `<div class="seg seg-grid c3" data-wp="g">${G.map((F, i) => `<button data-v="${i}" class="${!w.d && (w.g | 0) === i ? 'on' : ''}">${t(F.n || 'flm') || 'Nr. ' + (i + 1)}</button>`).join('')}</div>`
          + `<div class="seg seg-grid c2"><button id="fl-rand">🎲 ${t('fl_random')}</button><button id="fl-mut">✨ ${t('fl_mutate')}</button></div>`
          + wpToggle('a', t('fl_anim'));
    }
    else if (f === 15) {
        const D = self.FKDensity, T = w.t | 0;
        const R = [[[-3, 3], [-3, 3], [-3, 3], [-3, 3]], [[-3, 3], [-3, 3], [-3, 3], [-3, 3]], [[-3, 3], [-3, 3], [-3, 3], [-8, 8]], [[4, 16], [10, 40], [1, 4], [0.001, 0.01]]][T];
        h = wpSeg('t', [[0, 'Clifford'], [1, 'De Jong'], [2, 'Svensson'], [3, 'Lorenz']], '') + ['a', 'b', 'c', 'd'].map((n, i) => wpSlider(n, T === 3 ? ['σ', 'ρ', 'β', 'dt'][i] : n, R[i][0], R[i][1], T === 3 && i === 3 ? 0.0001 : 0.001)).join('');
    }
    $('wp-body').innerHTML = h;
    $('wp-hint').textContent = t('wp_hint_' + f);
    $('wp-body').querySelectorAll('[data-wp] button').forEach(b => b.addEventListener('click', () => {
        const key = b.parentNode.dataset.wp, v = key === 's' ? b.dataset.v : +b.dataset.v;
        if (String((S.wp[f] || {})[key]) === String(v) && !(f === 14 && (S.wp[14] || {}).d)) return;
        crossfade(420);
        // Attraktor-Art: Parameter auf die Vorgabe der Art; Flammen-Galerie: eigene Flamme verwerfen, Ansicht der Flamme
        if (f === 15 && key === 't') { const P = self.FKDensity.ATT[v].p; A.setWP(f, { t: v, a: P[0], b: P[1], c: P[2], d: P[3] }); A.goHome(); }
        else if (f === 14 && key === 'g') { A.setWP(f, { g: v, d: '' }); A.goHome(); }
        else A.setWP(f, { [key]: v });
        syncWP(true);
    }));
    const fr = $('fl-rand'), fm = $('fl-mut');
    if (fr) fr.addEventListener('click', () => { crossfade(420); A.flameRandom(); syncWP(true); });
    if (fm) fm.addEventListener('click', () => { crossfade(300); A.flameMutate(); syncWP(true); });
    $('wp-body').querySelectorAll('input[data-wps]').forEach(r => {
        r.addEventListener('input', () => {
            let v = +r.value;
            if (r.dataset.wps === 'e' && Math.abs(v - Math.round(v)) < 0.04) v = Math.round(v);     // Exponent rastet bei ganzen Zahlen ein
            A.setWP(f, { [r.dataset.wps]: v }, true);
            r.nextElementSibling.textContent = v.toFixed(+r.step < 0.01 ? 4 : 2);
        });
        r.addEventListener('change', () => A.saveSettings());
    });
    $('wp-body').querySelectorAll('input[data-wpt]').forEach(c => c.addEventListener('change', () => { A.setWP(f, { [c.dataset.wpt]: c.checked ? 1 : 0 }); syncWP(true); }));
    // 7.1 Julia-Morph: Tempo = derselbe Wert wie der Flug-Tempo-Regler (negativ = rückwärts am Rand entlang)
    const js_ = $('jm-speed');
    if (js_) {
        js_.addEventListener('input', () => { S.flySpeed = Math.abs(+js_.value) < 0.05 ? 0 : +js_.value; js_.nextElementSibling.textContent = S.flySpeed.toFixed(2); });
        js_.addEventListener('change', () => A.saveSettings());
    }
    const sq = $('wp-seq');
    if (sq) {
        sq.addEventListener('input', () => {
            const q = A.lyaSeq(sq.value);
            if (/^[ABab]+$/.test(sq.value) && q.s !== A.lyaSeq((S.wp[10] || {}).s).s) A.setWP(10, { s: q.s }, true);
        });
        sq.addEventListener('change', () => { sq.value = A.lyaSeq(sq.value).s; A.setWP(10, { s: sq.value }); syncWP(true); });
    }
}
// 7.0 Mandelbulb-Panel (Welten-Tab): Exponent, Atmen, Stil, Julia-Bulb, Nebel, Tiefenunschärfe
function syncBulb() {
    const BU = A.BULB, on = A.isRay();
    $('bulb-panel').hidden = !on;
    if (!on || !BU) return;
    // 7.0 Etappe 7: Regler je Art – Mandelbulb Exponent 2–16, Mandelbox Skalierung −3…3, Menger ohne Parameter/Julia
    const k = BU.kindOf(), sp = $('s-bpow');
    $('bulb-panel').querySelector('h3').textContent = cap(MODE_NAMES()[S.formula] || 'Mandelbulb');
    sp.closest('label').hidden = k >= 2;
    syncBulbExtra(k);
    sp.closest('label').querySelector('span').textContent = t(k === 1 ? 'bulb_scale' : 'bulb_power');
    if (k === 1) { sp.min = -3; sp.max = 3; sp.value = BU.B.boxS; $('o-bpow').textContent = BU.B.boxS.toFixed(2); }
    else { sp.min = 2; sp.max = 16; sp.value = BU.B.power0; $('o-bpow').textContent = BU.B.power0.toFixed(2); }
    $('t-bbreathe').closest('label').hidden = k !== 0;
    $('t-bjulia').closest('label').hidden = k >= 2;
    $('t-bbreathe').checked = S.bulbBreathe;
    $('t-bjulia').checked = BU.B.julia;
    document.querySelectorAll('#seg-bstyle button').forEach(b => b.classList.toggle('on', +b.dataset.v === S.bulbStyle));
    $('s-bfog').value = S.bulbFog; $('o-bfog').textContent = Math.round(S.bulbFog * 100) + ' %';
    $('s-bdof').value = S.bulbDof; $('o-bdof').textContent = S.bulbDof > 0 ? Math.round(S.bulbDof * 100) + ' %' : t('off');
}
// 7.1 Regler der neuen 3D-Arten: Quaternionen-Julia c (4D) + Animation, Kaleidoskop-IFS Skalierung/Winkel, Apollonian Stärke
let bxBuilt = -1;
function syncBulbExtra(k) {
    const box = $('bulb-extra'), BU = A.BULB, B = BU.B;
    if (k < 3) { box.innerHTML = ''; bxBuilt = -1; return; }
    const sl = (id, lbl, min, max, step, val, dig) => `<label class="slider"><span>${lbl}</span><input type="range" data-bx="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${(+val).toFixed(dig)}</output></label>`;
    if (bxBuilt !== k) {
        bxBuilt = k;
        const q = B.qc0 || B.qc;
        box.innerHTML = k === 3 ? ['1', 'i', 'j', 'k'].map((n, i) => sl('q' + i, 'c · ' + n, -1, 1, 0.001, q[i], 3)).join('') + `<label class="toggle"><span>${t('qj_anim')}</span><input type="checkbox" id="t-qa"${B.qa ? ' checked' : ''}><i></i></label>`
            : k === 4 ? sl('k0', t('bulb_scale'), 1.4, 3.2, 0.01, B.kp[0], 2) + sl('k1', t('kifs_a1'), -3.1416, 3.1416, 0.001, B.kp[1], 2) + sl('k2', t('kifs_a2'), -3.1416, 3.1416, 0.001, B.kp[2], 2)
            : sl('a0', t('apol_s'), 0.95, 1.5, 0.001, B.ap, 3);
        box.querySelectorAll('input[data-bx]').forEach(r => r.addEventListener('input', () => {
            const id = r.dataset.bx, v = +r.value;
            if (id[0] === 'q') { const q2 = (B.qc0 || B.qc).slice(); q2[+id[1]] = v; if (B.qc0) B.qc0 = q2; else B.qc = q2; }
            else if (id[0] === 'k') { B.kp = B.kp.slice(); B.kp[+id[1]] = v; }
            else B.ap = v;
            r.nextElementSibling.textContent = v.toFixed(+r.step < 0.01 ? 3 : 2);
            BU.invalidate(); A.RC.dirty = true;
        }));
        const qa = $('t-qa');
        if (qa) qa.addEventListener('change', () => { B.qa = qa.checked; BU.invalidate(); A.RC.dirty = true; });
    }
}
$('s-bpow').addEventListener('input', (e) => {
    const BU = A.BULB, v = +e.target.value;
    if (BU.kindOf() === 1) BU.setBoxS(Math.abs(v) < 1.05 ? (v < 0 ? -1.05 : 1.05) : v);      // |s| ≤ 1 ergibt keinen Körper
    else { BU.B.power0 = BU.B.power = v; BU.invalidate(); }
    A.RC.dirty = true; syncBulb();
});
$('t-bbreathe').addEventListener('change', (e) => { S.bulbBreathe = e.target.checked; A.saveSettings(); A.RC.dirty = true; syncBulb(); });
$('t-bjulia').addEventListener('change', (e) => { const BU = A.BULB; BU.B.julia = e.target.checked; BU.invalidate(); A.RC.dirty = true; if (e.target.checked) toast(t('bulb_julia_hint'), 3000); syncBulb(); });
document.querySelectorAll('#seg-bstyle button').forEach(b => b.addEventListener('click', () => { if (S.bulbStyle !== +b.dataset.v) crossfade(420); S.bulbStyle = +b.dataset.v; A.saveSettings(); A.RC.dirty = true; syncBulb(); }));
$('s-bfog').addEventListener('input', (e) => { S.bulbFog = +e.target.value; A.RC.dirty = true; syncBulb(); });
$('s-bfog').addEventListener('change', () => A.saveSettings());
$('s-bdof').addEventListener('input', (e) => { S.bulbDof = +e.target.value; A.RC.dirty = true; syncBulb(); });
$('s-bdof').addEventListener('change', () => A.saveSettings());
function updateJuliaPanel() {
    syncBulb(); syncWP();
    $('julia-panel').hidden = S.formula !== 1;
    $('jx').textContent = HP.toString(S.julia.x, 5).replace('-', '−');
    $('jy').textContent = HP.toString(S.julia.y, 5).replace('-', '−');
    drawCpad();
    updateJuliaChip();
}
function updateJuliaChip() {
    const c = $('julia-chip');
    c.hidden = S.formula !== 1;
    document.body.classList.toggle('julia-on', !c.hidden);
    if (!c.hidden) $('julia-chip-text').textContent = 'c = ' + A.fmtC(S.julia.x, S.julia.y);
}
$('julia-chip').addEventListener('click', () => { openSheet('worlds'); setTimeout(() => $('julia-panel').scrollIntoView({ block: 'start', behavior: 'smooth' }), 380); });
let jstep = 0.01;
document.querySelectorAll('#jstep button').forEach(b => b.addEventListener('click', () => {
    jstep = parseFloat(b.dataset.v);
    document.querySelectorAll('#jstep button').forEach(x => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.step, d = HP.fromNumber(k.endsWith('+') ? jstep : -jstep);
    if (k[0] === 'x') A.setJulia(S.julia.x + d, S.julia.y); else A.setJulia(S.julia.x, S.julia.y + d);
}));

// c-Pad: Mandelbrot-Übersicht, Punkt ziehen = Julia-c live
const cpad = $('cpad');
const CP = { x0: -2.1, x1: 0.9, y0: -1.125, y1: 1.125 };
let cpadImg = null;
function drawCpad() {
    if (S.formula !== 1 || !cpad.isConnected) return;
    const ctx = cpad.getContext('2d');
    const w = cpad.width, h = cpad.height;
    if (!cpadImg) cpadImg = mandelImage(ctx, w, h, CP, [120, 90, 200]);
    ctx.putImageData(cpadImg, 0, 0);
    const jx = HP.toNumber(S.julia.x), jy = HP.toNumber(S.julia.y);
    const px = (jx - CP.x0) / (CP.x1 - CP.x0) * w, py = (CP.y1 - jy) / (CP.y1 - CP.y0) * h;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.stroke();
    ctx.fillStyle = '#f0abfc'; ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
}
function mandelImage(ctx, w, h, box, tint) {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const cx = box.x0 + (x + 0.5) / w * (box.x1 - box.x0), cy = box.y1 - (y + 0.5) / h * (box.y1 - box.y0);
        let zx = 0, zy = 0, i = 0;
        for (; i < 60; i++) { const x2 = zx * zx, y2 = zy * zy; if (x2 + y2 > 4) break; zy = 2 * zx * zy + cy; zx = x2 - y2 + cx; }
        const o = (y * w + x) * 4;
        const v = i === 60 ? 0 : Math.sqrt(i / 60);
        img.data[o] = 12 + tint[0] * v; img.data[o + 1] = 14 + tint[1] * v; img.data[o + 2] = 30 + tint[2] * v; img.data[o + 3] = 255;
    }
    return img;
}
(function cpadDrag() {
    let on = false;
    const set = (e) => {
        const r = cpad.getBoundingClientRect();
        const x = CP.x0 + (e.clientX - r.left) / r.width * (CP.x1 - CP.x0);
        const y = CP.y1 - (e.clientY - r.top) / r.height * (CP.y1 - CP.y0);
        A.setJulia(HP.fromNumber(+x.toFixed(6)), HP.fromNumber(+y.toFixed(6)));
    };
    cpad.addEventListener('pointerdown', (e) => { on = true; cpad.setPointerCapture(e.pointerId); set(e); });
    cpad.addEventListener('pointermove', (e) => { if (on) set(e); });
    cpad.addEventListener('pointerup', () => { on = false; });
    cpad.addEventListener('pointercancel', () => { on = false; });
})();

// ------------------------------------------------------------------ Minimap
const mm = $('minimap-canvas');
let minimapBase = null;
function drawMinimap() {
    $('minimap').hidden = !S.minimap || !A.is2dW(S.formula);
    if ($('minimap').hidden) return;
    const ctx = mm.getContext('2d');
    const w = mm.width, h = mm.height;
    const home = A.MODE_HOME[S.formula];
    const hx = parseFloat(home[0]), hy = parseFloat(home[1]);
    const box = { x0: hx - 2, x1: hx + 2, y0: hy - 1.5, y1: hy + 1.5 };
    if (!minimapBase) {
        if (S.formula === 0 || S.formula === 1) minimapBase = mandelImage(ctx, w, h, box, [110, 100, 210]);
        else { minimapBase = ctx.createImageData(w, h); for (let i = 0; i < minimapBase.data.length; i += 4) { minimapBase.data[i] = 20; minimapBase.data[i + 1] = 22; minimapBase.data[i + 2] = 40; minimapBase.data[i + 3] = 255; } }
    }
    ctx.putImageData(minimapBase, 0, 0);
    const cx = HP.toNumber(S.cam.cx), cy = HP.toNumber(S.cam.cy);
    const vw = 3 / S.cam.zoom * (innerWidth / innerHeight), vh = 3 / S.cam.zoom;
    const px = (cx - box.x0) / (box.x1 - box.x0) * w, py = (box.y1 - cy) / (box.y1 - box.y0) * h;
    const rw = vw / (box.x1 - box.x0) * w, rh = vh / (box.y1 - box.y0) * h;
    ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 1.5;
    if (rw > 4) { ctx.fillStyle = 'rgba(167,139,250,0.18)'; ctx.fillRect(px - rw / 2, py - rh / 2, rw, rh); ctx.strokeRect(px - rw / 2, py - rh / 2, rw, rh); }
    else { ctx.beginPath(); ctx.moveTo(px - 8, py); ctx.lineTo(px - 3, py); ctx.moveTo(px + 3, py); ctx.lineTo(px + 8, py); ctx.moveTo(px, py - 8); ctx.lineTo(px, py - 3); ctx.moveTo(px, py + 3); ctx.lineTo(px, py + 8); ctx.stroke(); }
}
mm.addEventListener('click', (e) => {
    const r = mm.getBoundingClientRect();
    const home = A.MODE_HOME[S.formula];
    const x = parseFloat(home[0]) - 2 + (e.clientX - r.left) / r.width * 4, y = parseFloat(home[1]) + 1.5 - (e.clientY - r.top) / r.height * 3;
    A.flyTo(HP.fromNumber(x), HP.fromNumber(y), Math.max(1, Math.min(S.cam.zoom, 1e4)));
});

// ------------------------------------------------------------------ Farben
function buildPalettes() {
    const g = $('palette-grid');
    g.innerHTML = '';
    PAL.list.forEach((p, i) => {
        const b = el('button', 'swatch' + (i === S.palette ? ' on' : ''));
        b.innerHTML = `<span class="bar" style="background:${PAL.gradientCSS(p)}"></span><span class="name">${p.custom ? t('custom_palette') : p.name}</span>`;
        if (i === S.palette) b.style.setProperty('--glow', PAL.cssOf(PAL.setRGB('light', S.setHex, p)) || '');
        b.addEventListener('click', () => { if (i !== S.palette) crossfade(420); S.palette = i; A.saveSettings(); A.invalidate(); buildPalettes(); syncSet(); });
        g.appendChild(b);
    });
    $('custom-bar').style.background = PAL.gradientCSS(PAL.list[PAL.list.length - 1], 24);
    syncSet();
}
for (let i = 0; i < 6; i++) {
    const inp = $('custom-color-' + i);
    inp.value = PAL.custom[i];
    const apply = () => { if (!/^#[0-9a-fA-F]{6}$/.test(inp.value)) return; PAL.setCustom(i, inp.value); S.palette = PAL.list.length - 1; A.invalidate(); buildPalettes(); };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', () => { apply(); PAL.saveCustom(); A.saveSettings(); });
}
// 6.2 Farbe der Menge + Alpin-Look
function syncSet() {
    const p = PAL.list[S.palette];
    document.querySelectorAll('#seg-setcol button').forEach(b => {
        b.classList.toggle('on', b.dataset.v === S.setCol);
        b.querySelector('.sdot').style.background = b.dataset.v === 'bunt' ? PAL.gradientCSS(p, 6) : PAL.cssOf(PAL.setRGB(b.dataset.v, S.setHex, p));
    });
    // 6.4 Bunte Menge: Modus Inseln/Ringe
    $('seg-inmode').hidden = $('in-hint').hidden = S.setCol !== 'bunt';
    document.querySelectorAll('#seg-inmode button').forEach(b => b.classList.toggle('on', +b.dataset.v === (S.inMode === 2 ? 2 : 1)));
    $('set-color-custom').hidden = S.setCol !== 'custom';
    $('set-color-custom').value = S.setHex;
    // 6.9 Außen: Palette / Grenznah (+ Saumbreite) / Schwarz – nur in den 2D-Welten mit Menge
    const outOK = A.hasSetW(S.formula) || A.isRay();
    document.querySelectorAll('#seg-out button').forEach(b => { b.classList.toggle('on', b.dataset.v === S.outMode); b.disabled = !outOK; });
    $('seg-out').classList.toggle('dim', !outOK);
    $('l-edgew').hidden = S.outMode !== 'edge' || !outOK;
    $('out-hint').textContent = !outOK ? t('out_hint_na') : A.isRay() ? t('out_hint_bulb') : t('out_hint_' + S.outMode) + (S.alpine && S.outMode !== 'pal' ? ' ' + t('out_hint_alp') : '');
    $('t-alpine').checked = S.alpine;
    $('seg-valley').hidden = !S.alpine;
    document.querySelectorAll('#seg-valley button').forEach(b => b.classList.toggle('on', b.dataset.v === S.valley));
}
document.querySelectorAll('#seg-setcol button').forEach(b => b.addEventListener('click', () => {
    if (S.setCol !== b.dataset.v) crossfade(420);
    S.setCol = b.dataset.v; outPrevSet = null;
    // 6.9: schwarze Menge bei schwarzem Außen = nichts zu sehen -> Außen wieder Palette
    if (S.outMode === 'black' && setTooDark()) { S.outMode = 'pal'; toast(t('out_auto_pal'), 3200); }
    A.saveSettings(); A.invalidate(); syncSet();
}));
// 6.9 Außen. „Schwarz“ (Unendlichkeit schwarz) mit schwarzer/fast schwarzer Menge -> Menge automatisch „Bunt“ (kurz
// angezeigt); zurück auf Palette/Grenznah stellt die vorige Mengenfarbe wieder her, solange sie nicht geändert wurde
let outPrevSet = null;
function setTooDark() {
    if (S.setCol === 'bunt') return false;
    const c = PAL.setRGB(S.setCol, S.setHex, PAL.list[S.palette]);
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 0.06;
}
document.querySelectorAll('#seg-out button').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (S.outMode === v) return;
    crossfade(420);
    S.outMode = v;
    if (v === 'black' && A.hasSetW(S.formula) && setTooDark()) { outPrevSet = S.setCol; S.setCol = 'bunt'; toast(t('out_auto_bunt'), 3200); }
    else if (v !== 'black' && outPrevSet && S.setCol === 'bunt') { S.setCol = outPrevSet; outPrevSet = null; }
    A.saveSettings(); A.invalidate(); syncSet();
}));
// 7.1 Look: Färbe-Stil (Standard, Seide = Streifen-Mittel, Dreieck-Mittel, Fallen Punkt/Kreis/Kreuz, Pickover-Stängel),
// Stärke, Streifenzahl (nur Seide). Gilt in den 2D-Welten mit Fluchtzeit; sonst gesperrt mit Hinweis
function syncLook() {
    const ok = A.styleOK();
    document.querySelectorAll('#seg-style button').forEach(b => { b.classList.toggle('on', +b.dataset.v === (S.style | 0)); b.disabled = !ok; });
    $('seg-style').classList.toggle('dim', !ok);
    $('l-stmix').hidden = !ok || !S.style;
    $('l-sts').hidden = !ok || S.style !== 1;
    $('s-stmix').value = S.stMix; $('o-stmix').textContent = Math.round(S.stMix * 100) + ' %';
    $('s-sts').value = S.stS; $('o-sts').textContent = String(S.stS);
    $('st-hint').textContent = !ok ? t('st_hint_na') : t('st_hint_' + (S.style | 0));
}
document.querySelectorAll('#seg-style button').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.v;
    if ((S.style | 0) === v) return;
    crossfade(420);
    S.style = v; A.saveSettings(); A.invalidate(); syncLook();
}));
$('s-stmix').addEventListener('input', (e) => { S.stMix = +e.target.value; A.RC.dirty = true; syncLook(); });     // nur Darstellung
$('s-stmix').addEventListener('change', () => A.saveSettings());
$('s-sts').addEventListener('input', (e) => { S.stS = +e.target.value; A.invalidate(); syncLook(); });
$('s-sts').addEventListener('change', () => A.saveSettings());
// Saumbreite 2–80 CSS-Pixel, logarithmisch (Regler 0..1)
const edgeGet = () => S.edgeW; edgeGet.raw = () => Math.log(S.edgeW / 2) / Math.log(40);
const syncEdge = bindRange('s-edgew', 'o-edgew', edgeGet, (v) => { S.edgeW = Math.round(2 * Math.pow(40, v) * 10) / 10; }, (v) => Math.round(v) + ' px');
document.querySelectorAll('#seg-inmode button').forEach(b => b.addEventListener('click', () => {
    if (S.inMode !== +b.dataset.v) crossfade(420);
    S.inMode = +b.dataset.v; A.saveSettings(); A.RC.dirty = true; syncSet();    // nur Darstellung, keine Neuberechnung
}));
$('set-color-custom').addEventListener('input', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { S.setHex = e.target.value.toLowerCase(); S.setCol = 'custom'; A.invalidate(); syncSet(); } });
$('set-color-custom').addEventListener('change', () => A.saveSettings());
$('t-alpine').addEventListener('change', (e) => {
    crossfade(500);
    S.alpine = e.target.checked;
    if (S.alpine) { S.setCol = 'white'; S.palette = PAL.indexOf('alpine'); buildPalettes(); }   // Voreinstellung: Gletscher + Alpin-Palette (2D)
    A.saveSettings(); A.invalidate(); syncSet();
});
document.querySelectorAll('#seg-valley button').forEach(b => b.addEventListener('click', () => { if (S.valley !== b.dataset.v) crossfade(420); S.valley = b.dataset.v; A.saveSettings(); A.invalidate(); syncSet(); }));
function bindRange(id, out, get, set, fmt) {
    const r = $(id);
    const upd = () => { $(out).textContent = fmt(get()); };
    r.addEventListener('input', () => { set(parseFloat(r.value)); upd(); A.invalidate(); });
    r.addEventListener('change', () => A.saveSettings());
    return () => { r.value = get.raw ? get.raw() : get(); upd(); };
}
const densGet = () => S.density; densGet.raw = () => Math.log2(S.density);
const syncDensity = bindRange('s-density', 'o-density', densGet, (v) => { S.density = Math.pow(2, v); }, (v) => v.toFixed(2) + '×');
// 6.9: Tempo logarithmisch 0,002–0,8 Paletten-Runden pro Sekunde (bis 6.8: 0,02–0,8 linear), angezeigt als Dauer einer Runde
const speedGet = () => S.speed; speedGet.raw = () => Math.log(S.speed / 0.002) / Math.log(400);
const syncSpeed = bindRange('s-speed', 'o-speed', speedGet, (v) => { S.speed = +(0.002 * Math.pow(400, v)).toPrecision(3); }, (v) => {
    const s = 1 / Math.max(v, 1e-4), num = (x) => (x < 10 ? x.toFixed(1) : Math.round(x).toString()).replace('.', S.lang === 'de' || S.lang === 'hu' || S.lang === 'es' || S.lang === 'fr' || S.lang === 'pt' ? ',' : '.');
    return t('anim_round').replace('{t}', s < 60 ? num(s) + '\u00a0s' : num(s / 60) + '\u00a0min');
});
const syncRelief = bindRange('s-relief', 'o-relief', () => S.reliefStrength, (v) => { S.reliefStrength = v; }, (v) => v.toFixed(2));
function bindToggle(id, get, set) {
    const c = $(id);
    c.addEventListener('change', () => { set(c.checked); A.saveSettings(); A.invalidate(); syncControls(); });
    return () => { c.checked = get(); };
}
const toggles = [
    bindToggle('t-anim', () => S.anim, (v) => { S.anim = v; }),
    bindToggle('t-relief', () => S.relief, (v) => { S.relief = v; }),
    bindToggle('t-smooth', () => !S.banded, (v) => { S.banded = !v; }),
    bindToggle('t-particles', () => S.particles, (v) => { S.particles = v; }),
    bindToggle('t-minimap', () => S.minimap, (v) => { S.minimap = v; }),
    bindToggle('t-rect', () => S.rectMode, (v) => { S.rectMode = v; }),
    bindToggle('t-precise', () => S.precise, (v) => { S.precise = v; }),
    bindToggle('t-governor', () => S.governor, (v) => { S.governor = v; }),
    bindToggle('t-deon', () => S.deOn, (v) => { S.deOn = v; }),
    bindToggle('t-aa', () => S.aa, (v) => { S.aa = v; }),
    bindToggle('t-hudfs', () => S.hudFs, (v) => { S.hudFs = v; hudApply(); }),
];
function bindSeg(id, get, set) {
    const g = $(id);
    g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); A.saveSettings(); syncControls(); }));
    return () => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === get()));
}
const segs = [
    bindSeg('seg-quality', () => S.quality, (v) => { S.quality = v; A.resize(); }),
    bindSeg('seg-renderer', () => S.renderer, (v) => { S.renderer = v; A.invalidate(); }),
];
function syncControls() {
    syncDensity(); syncSpeed(); syncRelief(); syncEdge(); syncSet(); syncBulb(); syncLook();
    toggles.forEach(f => f()); segs.forEach(f => f());
    $('s-speed').closest('label').classList.toggle('dim', !S.anim);
    $('s-relief').closest('label').classList.toggle('dim', !S.relief);
    hudUpdate(true);
    syncShot();
}

// Sprache
(function langSelect() {
    const s = $('sel-lang');
    for (const k of Object.keys(TRANSLATIONS)) { const o = el('option'); o.value = k; o.textContent = TRANSLATIONS[k].lang_name || k; s.appendChild(o); }
    s.value = S.lang;
    s.addEventListener('change', () => { S.lang = s.value; A.saveSettings(); applyI18n(); syncControls(); });
})();

// ------------------------------------------------------------------ Orte
function placeCard(p, opts) {
    const c = el('div', 'place');
    const name = opts.name || t(p.key);
    const thumb = opts.thumb ? `url('${opts.thumb}')` : 'none';
    c.innerHTML = `<button class="place-main"><span class="thumb" style="background-image:${thumb}"></span>
        <span class="meta"><span class="name"></span><span class="zoom mono">${A.fmtZoom(+p.zoom, 'sci')}</span></span></button>
        <div class="place-actions"><button class="chip tour">▶ ${t('tour')}</button>${A.canFly(p.formula || 0) ? `<button class="chip fly">✈ ${t('fly_place')}</button>` : ''}${opts.onDelete ? `<button class="chip del" aria-label="${t('delete')}">✕</button>` : ''}</div>`;
    c.querySelector('.name').textContent = name;
    c.querySelector('.place-main').addEventListener('click', () => { A.stopRound(); A.goTo(p); if (innerWidth < 700) closeSheet(); });
    c.querySelector('.tour').addEventListener('click', () => { A.stopRound(); A.startTour(p); closeSheet(); });
    const fb = c.querySelector('.fly');
    if (fb) fb.addEventListener('click', () => { A.startFly(p); closeSheet(); });     // 6.6: im aktuellen Modus (2D oder 3D)
    if (opts.onDelete) c.querySelector('.del').addEventListener('click', opts.onDelete);
    return c;
}
// 7.1 Sehenswürdigkeiten der aktuellen Welt (kuratiert, js/app.js SIGHTS) mit ▶ Tour, ✈ Flug und ▶ Rundgang durch alle
function buildSights() {
    const box = $('sights');
    box.innerHTML = '';
    const list = A.SIGHTS[S.formula];
    if (!list || !list.length) return;
    box.appendChild(el('h3', '', t('sights_title') + ' · ' + cap(MODE_NAMES()[S.formula])));
    const rb = el('button', 'wide-btn round-btn', `<span aria-hidden="true">▶</span><span>${t('round_all')}</span>`);
    rb.addEventListener('click', () => { A.startRound(list); closeSheet(); toast(t('round_hint'), 3000); });
    box.appendChild(rb);
    list.forEach(p => box.appendChild(placeCard(p, { thumb: `assets/sights/${p.k}.jpg${V}` })));
}
function loadPlaces() { try { return JSON.parse(localStorage.getItem('fraktal_v5_places') || '[]'); } catch (e) { return []; } }
function savePlaces(a) { try { localStorage.setItem('fraktal_v5_places', JSON.stringify(a)); } catch (e) { toast('Speicher voll'); } }
function buildUserPlaces() {
    const box = $('user-places');
    box.innerHTML = '';
    const list = loadPlaces();
    if (!list.length) { box.appendChild(el('p', 'hint', t('places_empty'))); return; }
    box.appendChild(el('h3', '', t('my_places')));
    list.forEach((p, i) => box.appendChild(placeCard(p, { name: p.name, thumb: p.thumb, onDelete: () => { const a = loadPlaces(); a.splice(i, 1); savePlaces(a); buildUserPlaces(); } })));
}
$('btn-save-place').addEventListener('click', () => {
    const v = A.viewState();
    A.snapshot();      // P3-8: frisch zeichnen – in 3D das 3D-Bild (presentNow zeichnete das 2D-Bild darüber)
    const c = document.createElement('canvas');
    c.width = 176; c.height = 110;
    const src = A.R.canvas;
    const sw = src.width, sh = src.height, a = c.width / c.height;
    let w = sw, h = sw / a; if (h > sh) { h = sh; w = sh * a; }
    c.getContext('2d').drawImage(src, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, c.width, c.height);
    const list = loadPlaces();
    list.unshift(Object.assign(v, { id: 'u' + Date.now(), name: `${cap(MODE_NAMES()[S.formula])} · ${A.fmtZoom(S.cam.zoom, 'sci')}`, thumb: c.toDataURL('image/jpeg', 0.8) }));
    savePlaces(list.slice(0, 40));
    buildUserPlaces();
    flash();
    if (A.DEKO) { const f = document.querySelector('#user-places .place'); if (f) f.classList.add('fresh'); }
    toast(t('saved'));
});

// ------------------------------------------------------------------ Teilen
$('btn-share').addEventListener('click', () => { const p = $('share-pop'); p.hidden = !p.hidden; if (!p.hidden) closeSheet(); });
$('share-image').addEventListener('click', () => shareImage());
// Datei teilen (Teilen-Menü des Geräts) oder herunterladen; how: 'auto' | 'share' | 'save'
async function deliver(file, how) {
    try {
        if (how !== 'save' && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Fraktal-Explorer', text: A.stateURL() });
            return;
        }
    } catch (e) { if (e && e.name === 'AbortError') return; if (how === 'share') { toast(t('share_failed')); return; } }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(t('image_saved'));
}

// ------------------------------------------------------------------ 6.8.1 Screenshot in hoher Auflösung
// Einstellung „Screenshot-Auflösung“ (Bildschirm, 2×, 4×, 8K, Eigene) und „Beschriftung im Screenshot“; vor dem Start Größe,
// geschätzte Dauer und Dateigröße (Handy > 100 MP: Warnung), dann Fortschritt „Rendere Kachel 12/64 …“ mit Abbrechen.
// Ist die Nutzer-Geste nach langem Rechnen verfallen (Teilen/Herunterladen brauchen eine), fragt die Leiste mit Teilen/Speichern.
const decS = (x, n) => { const v = x.toFixed(n); return S.lang === 'de' ? v.replace('.', ',') : v; };
const fmtDur = (ms) => { const s = ms / 1000; return s < 1 ? '< 1 s' : s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : decS(s / 3600, 1) + ' h'; };
const fmtBytes = (b) => b < 1e6 ? Math.max(1, Math.round(b / 1e3)) + ' kB' : b < 1e9 ? (b < 1e7 ? decS(b / 1e6, 1) : Math.round(b / 1e6)) + ' MB' : decS(b / 1e9, 1) + ' GB';
function shotInfo(P) { return `${P.W} × ${P.H} px · ${decS(P.est.mp, P.est.mp < 10 ? 1 : 0)} MP · ${t('shot_about')} ${fmtDur(P.est.ms)} · ${t('shot_about')} ${fmtBytes(P.est.bytes)}`; }
function syncShot() {
    if (!A.shot) return;
    const buddha = A.shot.kind() === 'buddha';
    document.querySelectorAll('#seg-shot button').forEach(b => { b.classList.toggle('on', b.dataset.v === S.shotRes); b.disabled = buddha && b.dataset.v !== 'screen'; });
    document.querySelectorAll('#seg-shot-aspect button').forEach(b => b.classList.toggle('on', b.dataset.v === (S.shotAspect === 'free' ? 'free' : 'screen')));
    $('shot-custom').hidden = S.shotRes !== 'custom' || buddha;
    const [w, h] = A.shot.size({ shotRes: 'custom' });
    if (document.activeElement !== $('shot-w')) $('shot-w').value = w;
    if (document.activeElement !== $('shot-h')) $('shot-h').value = h;
    $('shot-h').disabled = S.shotAspect !== 'free';
    $('shot-buddha').hidden = !buddha;
    $('t-shotlabel').checked = S.shotLabel;
    try { $('shot-info').textContent = buddha ? A.R.canvas.width + ' × ' + A.R.canvas.height + ' px' : shotInfo(A.shot.plan()); } catch (e) { $('shot-info').textContent = ''; }
}
document.querySelectorAll('#seg-shot button').forEach(b => b.addEventListener('click', () => { S.shotRes = b.dataset.v; A.saveSettings(); syncShot(); }));
document.querySelectorAll('#seg-shot-aspect button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.v === 'free' && S.shotAspect !== 'free') { const [w, h] = A.shot.size({ shotRes: 'custom' }); S.shotW = w; S.shotH = h; }
    S.shotAspect = b.dataset.v; A.saveSettings(); syncShot();
}));
for (const id of ['shot-w', 'shot-h']) {
    const inp = $(id);
    const apply = () => { const v = Math.round(+inp.value); if (!(v >= 16)) return; if (id === 'shot-w') S.shotW = Math.min(65535, v); else S.shotH = Math.min(65535, v); A.saveSettings(); syncShot(); };
    inp.addEventListener('change', () => { apply(); inp.blur(); syncShot(); });
    inp.addEventListener('input', () => { const v = Math.round(+inp.value); if (v >= 16) { if (id === 'shot-w') S.shotW = Math.min(65535, v); else S.shotH = Math.min(65535, v); const P = A.shot.plan(); $('shot-info').textContent = shotInfo(P); } });
}
$('t-shotlabel').addEventListener('change', (e) => { S.shotLabel = e.target.checked; A.saveSettings(); });

const SP = { mode: '', resolve: null, file: null };
function shotShow(mode, o) {
    o = o || {};
    SP.mode = mode;
    $('shot-block').hidden = false; $('shot-panel').hidden = false;
    $('shot-go').hidden = mode !== 'ask';
    $('shot-share').hidden = mode !== 'done' || !(navigator.canShare && o.file && navigator.canShare({ files: [o.file] }));
    $('shot-save').hidden = mode !== 'done';
    $('shot-x').textContent = t(mode === 'done' ? 'close' : 'shot_cancel');
    $('shot-bar').hidden = mode !== 'run';
    $('shot-warn').hidden = !o.warn;
    if (o.warn) $('shot-warn').textContent = t('shot_warn');
    if (o.title !== undefined) $('shot-title').textContent = o.title;
    if (o.sub !== undefined) $('shot-sub').textContent = o.sub;
    if (mode === 'run') $('shot-bar').firstElementChild.style.width = '0%';
}
function shotHide() { SP.mode = ''; SP.file = null; $('shot-block').hidden = true; $('shot-panel').hidden = true; }
function shotProgress(p) {
    if (SP.mode !== 'run') return;
    const title = p.phase === 'encode' ? t('shot_encode') : p.phase === 'ref' ? t('shot_ref') : p.phase === 'settle' ? t('shot_settle') : p.phase === 'prep' ? t('shot_prep') : t('shot_tile').replace('{i}', p.i).replace('{n}', p.n);
    $('shot-title').textContent = title;
    $('shot-sub').textContent = `${p.W} × ${p.H} px · ${Math.round(p.frac * 100)} % · ${t('shot_rest').replace('{t}', fmtDur(p.restMs))}`;
    $('shot-bar').firstElementChild.style.width = (p.frac * 100).toFixed(1) + '%';
}
$('shot-go').addEventListener('click', () => { const r = SP.resolve; SP.resolve = null; if (r) r(true); });
$('shot-x').addEventListener('click', () => {
    if (SP.mode === 'ask') { const r = SP.resolve; SP.resolve = null; shotHide(); if (r) r(false); }
    else if (SP.mode === 'run') A.shot.cancel();
    else shotHide();
});
$('shot-share').addEventListener('click', () => { const f = SP.file; shotHide(); if (f) deliver(f, 'share'); });
$('shot-save').addEventListener('click', () => { const f = SP.file; shotHide(); if (f) deliver(f, 'save'); });
async function shareImage() {
    $('share-pop').hidden = true;
    if (A.shot.busy() || SP.mode) return;
    const P = A.shot.plan();
    if (P.kind !== 'buddha' && S.shotRes !== 'screen') {
        shotShow('ask', { title: t('shot_res') + (S.shotRes === '8k' ? ' 8K' : S.shotRes === 'custom' ? '' : ' ' + ({ '2x': '2×', '4x': '4×' }[S.shotRes] || '')), sub: shotInfo(P), warn: P.warn });
        const go = await new Promise((res) => { SP.resolve = res; });
        if (!go) return;
    }
    shotShow('run', { title: t('shot_prep'), sub: `${P.W} × ${P.H} px` });
    let r;
    try { r = await A.captureShot({ plan: P, onProgress: shotProgress }); }
    catch (e) {
        shotHide();
        const m = String(e && e.message || e);
        toast(t(m === 'cancelled' ? 'shot_cancelled' : m === 'lost' ? 'shot_lost' : 'shot_failed'), m === 'cancelled' ? 2200 : 5000);
        if (m !== 'cancelled' && m !== 'lost') console.warn('Screenshot:', e);
        return;
    }
    if (!r || !r.blob) { shotHide(); toast(t('share_failed')); return; }
    const file = new File([r.blob], A.fileName(r.W, r.H), { type: 'image/png' });
    A.lastShot = { name: file.name, W: r.W, H: r.H, bytes: r.blob.size, ms: r.ms };     // (Test)
    const ua = navigator.userActivation;
    if (!ua || ua.isActive) { shotHide(); await deliver(file, 'auto'); return; }
    SP.file = file;
    shotShow('done', { file, title: t('shot_done'), sub: `${r.W} × ${r.H} px · ${fmtBytes(r.blob.size)} · ${fmtDur(r.ms)}` });
}
async function shareLink() {
    $('share-pop').hidden = true;
    const url = A.stateURL();
    try { if (navigator.share) { await navigator.share({ title: 'Fraktal-Explorer', url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast(t('link_copied')); } catch (e) { prompt('Link', url); }
}
$('share-link').addEventListener('click', shareLink);
$('btn-link').addEventListener('click', shareLink);

// ------------------------------------------------------------------ Mehr
// 6.8: ohne Vollbild-Schnittstelle (iPhone, auch als installierte App) ist derselbe Knopf der Kino-Modus: HUD aus wie im
// Vollbild, nur ohne echtes Vollbild (bis 6.7 war der Knopf dort ausgeblendet, P3-7)
const FS_API = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
function toggleFullscreen() {
    const d = document;
    A.noteResize();                // 6.8.1: ein laufender Flug geht ohne Sprung durch den Wechsel
    if (!FS_API) { setCinema(!HUD.cine); return; }
    if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
    else d.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('btn-fullscreen2').addEventListener('click', () => { closeSheet(); toggleFullscreen(); });
if (!FS_API) {
    $('btn-fullscreen').dataset.i18nTitle = 'cinema';
    $('btn-fullscreen2').querySelector('[data-i18n]').dataset.i18n = 'cinema';
}

// ------------------------------------------------------------------ 6.8 HUD im Vollbild / Kino-Modus
// Im Vollbild (Einstellung „HUD im Vollbild ausblenden“, Standard an) und im Kino-Modus verschwinden alle Bedienelemente
// weich (0,3 s, CSS body.hudless: alles außer dem Bild) – Leisten, Dock, Knöpfe, Flug-Leiste, Zoom-Anzeige, Hinweise, Toasts.
// Ein kurzer Tipp (ohne Wischen; app.js fragt A.tapHook) bzw. eine Mausbewegung zeigt sie für 3 s (body.hud-peek). Gesten
// (Zoomen, Schieben, Flug-Lenkung) holen sie nicht zurück, ein laufender Flug läuft weiter (der Tipp pausiert ihn dann nicht).
// Solange ein Menü offen ist oder die Maus über der Bedienung steht, bleibt sie sichtbar. Esc/F verlassen Vollbild bzw. Kino.
const HUD = { fs: false, cine: false, peekT: 0, mx: -1, my: -1, over: false, overT: 0, hinted: false };
const hudless = () => (HUD.fs && S.hudFs) || HUD.cine;
const peeking = () => document.body.classList.contains('hud-peek');
function hudApply() {
    const on = hudless(), b = document.body, was = b.classList.contains('hudless');
    if (on && !was) {
        closeSheet(); closeModal(); $('share-pop').hidden = true;
        $('hud-details').hidden = true; $('hud-pill').setAttribute('aria-expanded', 'false');
        if (!S.chrome) setChrome(true);
    }
    b.classList.toggle('hudless', on);
    if (!on) { b.classList.remove('hud-peek'); clearTimeout(HUD.peekT); }
    else if (!was && !HUD.hinted) { HUD.hinted = true; hudPeek(2200); toast(t('hud_hint'), 2200); }     // einmal pro Sitzung: kurz zeigen, wie es zurückkommt
    const fb = $('btn-fullscreen'), act = HUD.fs || HUD.cine;
    fb.classList.toggle('on', act); fb.setAttribute('aria-pressed', String(act));
}
function hudPeek(ms) {
    if (!hudless()) return;
    document.body.classList.add('hud-peek');
    clearTimeout(HUD.peekT);
    HUD.peekT = setTimeout(hudHide, ms || 3000);
}
function hudHide(force) {
    clearTimeout(HUD.peekT);
    // (Maus über der Bedienung zählt nur, solange sie sich bewegt – eine ruhende Maus auf dem Vollbild-Knopf hielte sonst alles fest)
    const busy = !sheet.hidden || !$('share-pop').hidden || !$('modal').hidden || !$('hud-details').hidden || (HUD.over && performance.now() - HUD.overT < 3000);
    if (!force && busy) { HUD.peekT = setTimeout(hudHide, 1000); return; }
    document.body.classList.remove('hud-peek');
}
function setCinema(on) { A.noteResize(); HUD.cine = !!on; hudApply(); }
// Tipp auf das Bild: ausgeblendet -> nur zeigen (true = erledigt); sichtbar im Flug -> pausieren wie immer, Zeit neu
A.tapHook = () => {
    if (!hudless()) return false;
    if (!peeking()) { hudPeek(); return true; }
    if (A.FLY.on) hudPeek();
    return false;
};
// 6.8.1: Doppeltipp bei ausgeblendetem HUD = Flug an/aus (sonst wie bisher: hineinzoomen) – im Vollbild/Kino-Modus ohne Knopf
A.dblTapHook = () => {
    if (!hudless() || peeking() || !A.canFly()) return false;
    if (A.FLY.on) A.stopFly(); else A.startFly();
    return true;
};
const onFsChange = () => { A.noteResize(); HUD.fs = !!(document.fullscreenElement || document.webkitFullscreenElement); hudApply(); };
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    HUD.over = e.target !== A.R.canvas && !!(e.target.closest && e.target.closest('body > :not(#gl):not(#xfade)'));
    if (HUD.over) HUD.overT = performance.now();
    if (e.buttons || !hudless()) { HUD.mx = e.clientX; HUD.my = e.clientY; return; }    // Ziehen mit der Maus ist eine Geste
    if (HUD.mx >= 0 && Math.hypot(e.clientX - HUD.mx, e.clientY - HUD.my) > 4) hudPeek();
    HUD.mx = e.clientX; HUD.my = e.clientY;
}, { passive: true });
// Bedienung angefasst (Knopf, Regler, Menü): sichtbar lassen, Zeit neu
addEventListener('pointerdown', (e) => { if (hudless() && peeking() && e.target !== A.R.canvas) hudPeek(); }, { passive: true, capture: true });
$('btn-reset').addEventListener('click', () => { A.goHome(); });
$('btn-help').addEventListener('click', () => openModal('help'));
$('btn-gestures').addEventListener('click', () => openModal('gestures'));
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btn-install').hidden = false; });
$('btn-install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; $('btn-install').hidden = true; });

// ------------------------------------------------------------------ Hilfe-Modal
function openModal(kind) {
    const b = $('modal-body');
    const g = `<div class="info-section"><h3>${t('gestures_title')}</h3><ul class="gest">
        <li>${t('g_pan')}</li><li>${t('g_pinch')}</li><li>${t('g_dtap')}</li><li>${t('g_2tap')}</li><li>${t('g_long')}</li><li>${t('g_tap')}</li><li>${t('g_3d')}</li><li>${t('g_fly2d')}</li><li>${t('g_rev')}</li><li>${t('g_desk')}</li></ul>
        <p class="hint">${t('deep_note')}</p></div>`;
    if (kind === 'gestures') b.innerHTML = g;
    else {
        const cards = A.MODE_KEYS.map(k => `<div class="fractal-card"><div class="fractal-card-header">${t(k)}</div><p>${t('help_' + k)}</p></div>`).join('');
        b.innerHTML = `<h2>${t('what_is_fractal')}</h2><p>${t('fractal_desc')}</p>
            <div class="info-section"><h3>${t('magic_formula')}</h3><p>${t('magic_desc')}</p></div>
            <div class="info-section"><h3>${t('why_black')}</h3><p>${t('black_desc')}</p>
              <ul><li><strong>${t('trapped')}:</strong> ${t('trapped_desc')}</li><li><strong>${t('escape')}:</strong> ${t('escape_desc')}</li></ul></div>
            <div class="info-section"><h3>${t('color_origin')}</h3><p>${t('color_desc')}</p></div>
            ${g}
            <div class="info-section"><h3>${t('help_fractals_title')}</h3>${cards}</div>`;
    }
    $('modal').hidden = false;
    requestAnimationFrame(() => $('modal').classList.add('open'));
}
function closeModal() { $('modal').classList.remove('open'); setTimeout(() => { $('modal').hidden = true; }, 250); }
$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

// ------------------------------------------------------------------ Tastatur (Desktop)
const KEY = { space: false };
window.addEventListener('keyup', (e) => { if ((e.key === ' ' || e.key === 'Spacebar') && KEY.space) { e.preventDefault(); KEY.space = false; } });
window.addEventListener('keydown', (e) => {
    if (SP.mode) { if (e.key === 'Escape') $('shot-x').click(); else if (e.key === 'Enter' && SP.mode === 'ask') $('shot-go').click(); return; }   // 6.8.1 Screenshot-Leiste
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (A.V3.on && e.shiftKey && k.startsWith('Arrow')) {      // 3D: Shift+Pfeile drehen/neigen
        if (k === 'ArrowLeft' || k === 'ArrowRight') A.V3.heading += (k === 'ArrowLeft' ? 1 : -1) * 0.12;
        else A.V3.tilt = Math.max(0, Math.min(A.MAX_TILT, A.V3.tilt + (k === 'ArrowUp' ? 0.07 : -0.07)));
        A.RC.dirty = true; return;
    }
    // 6.8 im Flug: R = Richtung wechseln, Pfeil ↑/↓ = Tempo, U = Umdrehen (3D); sonst wie bisher (R = Zurücksetzen, Pfeile schieben)
    if (A.FLY.on && A.RUECK) {
        const kl = k.toLowerCase();
        if (kl === 'r') { A.reverseFly(); A.saveSettings(); return; }
        if (kl === 'u') { A.turnFly(); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); A.setFlySpeed(S.flySpeed + (k === 'ArrowUp' ? 0.1 : -0.1)); A.saveSettings(); return; }
    }
    // 6.8.1 Leertaste = Flug an/aus (im aktuellen Modus, auch im Vollbild bei ausgeblendetem HUD); ein fokussierter Knopf
    // (z. B. Vollbild) wird dabei nicht mit ausgelöst
    if (k === ' ' || k === 'Spacebar') {
        e.preventDefault(); KEY.space = true;
        if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
        if (A.FLY.on) A.stopFly(); else if (A.canFly()) A.startFly();
        return;
    }
    const pan = (dx, dy) => { A.stopFly(); if (A.isRay()) { A.BULB.keyOrbit(-dx, dy); return; } const s = 3 / (S.cam.zoom * innerHeight) * innerHeight * 0.15; A.flyTo(S.cam.cx + HP.fromNumber(dx * s), S.cam.cy + HP.fromNumber(dy * s), S.cam.zoom, { duration: 0.25 }); };
    switch (k) {
        case 'ArrowLeft': pan(-1, 0); break; case 'ArrowRight': pan(1, 0); break;
        case 'ArrowUp': pan(0, 1); break; case 'ArrowDown': pan(0, -1); break;
        case 'PageUp': A.stopFly(); A.zoomAt(innerWidth / 2, innerHeight / 2, 2); break;
        case 'PageDown': A.stopFly(); A.zoomAt(innerWidth / 2, innerHeight / 2, 0.5); break;
        case '+': case '=': A.changeIter(1.25); break;
        case '-': case '_': A.changeIter(0.8); break;
        default:
            switch (k.toLowerCase()) {
                case 'm': case 'j': case 'b': case 't': case '3': case 'n': {
                    const m = 'mjbt3n'.indexOf(k.toLowerCase()); if (m !== S.formula) crossfade(650); A.setMode(m); break; }
                case 'p': crossfade(420); S.palette = (S.palette + 1) % PAL.list.length; A.saveSettings(); A.invalidate(); buildPalettes(); break;
                case 'r': A.goHome(); break;
                case 's': $('share-image').click(); break;
                case 'z': S.rectMode = !S.rectMode; syncControls(); break;
                case 'f': if (HUD.cine) setCinema(false); else toggleFullscreen(); break;
                case 'i': setChrome(!S.chrome); break;
                case 'h': case '?': openModal('help'); break;
                case 'l': { const ks = Object.keys(TRANSLATIONS); S.lang = ks[(ks.indexOf(S.lang) + 1) % ks.length]; $('sel-lang').value = S.lang; A.saveSettings(); applyI18n(); break; }
                case 'escape': closeSheet(); closeModal(); if (HUD.cine) setCinema(false); break;
                case 'd': toggle3d(); break;
                case 'v': if (A.FLY.on) A.stopFly(); else A.startFly(); break;      // 6.6: fliegt im aktuellen Modus
            }
    }
});

// ------------------------------------------------------------------ Service Worker (PWA)
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('update_ready'), 4000); });
            });
        }).catch(() => {});
    });
}

// ------------------------------------------------------------------ 3D-Landschaft + Flug
let hint3d = false, want3dHint = false, prepToastT = 0;
function toggle3d() {
    if (!A.can3d()) { toast(t('d3_na')); return; }
    // 6.3: Antippen während der Vorbereitung bricht sie ab
    const on = !(A.V3.on && A.V3.dir >= 0) && !A.V3.prep;
    if (on && !hint3d) want3dHint = true;
    A.set3d(on);
}
function prep3dProgress() {
    const pi = A.view3dInfo().prepInfo;
    // Fortschritt: fertige Programme (das große Gelände-Programm zählt halb – es kommt meist zuletzt)
    if (pi && pi.total) $('btn-3d').style.setProperty('--p', String(Math.max(0.08, Math.min(0.92, pi.done / (pi.total + 1)))));
}
$('btn-3d').addEventListener('click', toggle3d);
$('btn-3d').addEventListener('pointerdown', () => A.prewarm3d());
$('btn-fly').addEventListener('click', () => { if (A.FLY.on) A.stopFly(); else A.startFly(); });
$('btn-fly2d').addEventListener('click', () => A.startFly(undefined, { d3: false }));
$('btn-north').addEventListener('click', () => A.north3d());
$('r-height').addEventListener('input', (e) => { S.h3d = +e.target.value; A.RC.dirty = true; });
$('r-height').addEventListener('change', () => A.saveSettings());
// 6.8: Tempo −1,5 … +1,5 mit Einrasten bei 0 (A.setFlySpeed), ⇄ = Richtung wechseln (weich), ↶ = Umdrehen (3D)
$('r-speed').addEventListener('input', (e) => { const v = A.setFlySpeed(+e.target.value); if (+e.target.value !== v) e.target.value = v; });
$('r-speed').addEventListener('change', () => A.saveSettings());
if (!A.RUECK) $('r-speed').min = '0.1';
$('btn-rev').addEventListener('click', () => { A.reverseFly(); A.saveSettings(); });
$('btn-turn').addEventListener('click', () => A.turnFly());
let hintFly2d = false;
function sync3d() {
    const can = A.can3d(), on = A.V3.on && A.V3.dir >= 0, fly = A.FLY.on, prep = !!A.V3.prep && !A.V3.on;
    // 6.6: ✈ auch in 2D (eigener Knopf); während eines 2D-Flugs zeigt die Flug-Leiste Stopp und Tempo
    const fly2d = fly && !A.V3.on;
    $('btn-fly2d').hidden = !A.canFly2d() || A.V3.on || fly;
    if (fly2d && !hintFly2d) { hintFly2d = true; toast(t('fly2d_hint'), 3800); }
    $('btn-3d').hidden = !can;
    // 6.3: „3D wird vorbereitet …“ (Shader werden übersetzt, 2D bleibt bedienbar)
    const b3 = $('btn-3d');
    b3.classList.toggle('prep', prep);
    b3.title = t(prep ? 'd3_prep' : 'd3_title');
    b3.setAttribute('aria-label', b3.title);
    b3.setAttribute('aria-busy', String(prep));
    if (prep) { prep3dProgress(); if (!prepToastT) prepToastT = setTimeout(() => { if (A.V3.prep && !A.V3.on) toast(t('d3_prep'), 2600); }, 400); }
    else if (prepToastT) { clearTimeout(prepToastT); prepToastT = 0; }
    if (on && want3dHint) { want3dHint = false; hint3d = true; toast(t('d3_hint'), 3800); }
    $('btn-3d').classList.toggle('on', on);
    $('btn-3d').setAttribute('aria-pressed', String(on));
    $('bar3d').hidden = !on && !fly;
    $('btn-north').hidden = !on;
    $('btn-fly').classList.toggle('on', fly);
    $('fly-icon').textContent = fly ? '■' : '✈';
    $('fly-label').textContent = t(fly ? 'fly_stop' : 'fly');
    $('lbl-height').hidden = fly;
    $('lbl-speed').hidden = !fly;
    $('r-height').value = S.h3d;
    $('r-speed').value = S.flySpeed;
    // 6.8: ⏪ rückwärts, ⏩ vorwärts, ⏸ Schweben; ⇄ im Flug, ↶ im 3D-Flug
    $('speed-icon').textContent = S.flySpeed > 0 ? '⏩' : S.flySpeed < 0 ? '⏪' : '⏸';
    $('btn-rev').hidden = !fly || !A.RUECK;
    $('btn-turn').hidden = !fly || !on || !A.RUECK;
    $('btn-turn').classList.toggle('on', !!A.V3.turnT);
    $('bar3d').classList.toggle('full', fly && on && A.RUECK);      // 3D-Flug: fünf Elemente – Stopp nur als Symbol (CSS)
    $('btn-fly').title = t(fly ? 'fly_stop' : 'fly');
    $('btn-turn').setAttribute('aria-pressed', String(!!A.V3.turnT));
}

// ------------------------------------------------------------------ Start
buildPalettes();
syncControls();
applyI18n();
updateJuliaPanel();
sync3d();
$('info-version').textContent = A.APP_VERSION;
$('version-line').textContent = A.APP_VERSION;
document.body.classList.add('ready');
})();
