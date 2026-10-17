// 7.1.10 ⓘ-Faktenkarten (js/weltfakten.js): jede Welt hat eine Karte in DE und EN mit allen Teilen, jede Karte nennt
// mindestens eine Quelle, höchstens ~90 Wörter je Sprache
'use strict';
const F = require('../../js/weltfakten.js');
const N_WORLDS = 19;    // MODE_KEYS in js/app.js

test('jede Welt hat eine Karte (DE + EN) mit Formel, Entdeckung, 2–4 Zahlen, Bild, „Wusstest du?“', () => {
    for (let i = 0; i < N_WORLDS; i++) {
        const c = F.CARDS[i];
        assert.ok(c, 'Karte fehlt: ' + i);
        for (const l of ['de', 'en']) {
            const x = c[l];
            assert.ok(x && x.f && x.who && x.see && x.fun, `Welt ${i} ${l}: Teile fehlen`);
            assert.ok(Array.isArray(x.nums) && x.nums.length >= 2 && x.nums.length <= 4, `Welt ${i} ${l}: 2–4 Zahlen/Eigenschaften (${x.nums && x.nums.length})`);
        }
    }
});
test('jede Karte hat mindestens eine Quelle', () => {
    for (let i = 0; i < N_WORLDS; i++) assert.ok(Array.isArray(F.CARDS[i].src) && F.CARDS[i].src.length >= 1 && F.CARDS[i].src.every(s => s.length > 5), 'Quelle fehlt: ' + i);
});
test('höchstens 90 Wörter je Karte und Sprache', () => {
    for (let i = 0; i < N_WORLDS; i++) for (const l of ['de', 'en']) { const w = F.words(F.CARDS[i][l]); assert.ok(w <= 90, `Welt ${i} ${l}: ${w} Wörter`); }
});
