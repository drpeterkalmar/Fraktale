// js/gestures.js: Gestenautomat mit gefälschtem Element, gefälschter Uhr und gefälschten Timern
'use strict';
require('../../js/gestures.js');

// Uhr + Timer (gestures.js liest performance.now/setTimeout zur Laufzeit global)
function fakeTime() {
    const saved = { perf: Object.getOwnPropertyDescriptor(globalThis, 'performance'), st: globalThis.setTimeout, ct: globalThis.clearTimeout };
    const T = { now: 0, timers: [], seq: 0 };
    Object.defineProperty(globalThis, 'performance', { value: { now: () => T.now }, configurable: true, writable: true });
    globalThis.setTimeout = (fn, ms) => { const id = ++T.seq; T.timers.push({ id, at: T.now + ms, fn }); return id; };
    globalThis.clearTimeout = (id) => { T.timers = T.timers.filter(t => t.id !== id); };
    T.advance = (ms) => {
        const end = T.now + ms;
        for (;;) {
            T.timers.sort((a, b) => a.at - b.at);
            const t = T.timers[0];
            if (!t || t.at > end) break;
            T.timers.shift(); T.now = t.at; t.fn();
        }
        T.now = end;
    };
    T.restore = () => { Object.defineProperty(globalThis, 'performance', saved.perf); globalThis.setTimeout = saved.st; globalThis.clearTimeout = saved.ct; };
    return T;
}
function setup() {
    const T = fakeTime();
    const H = {}, calls = [];
    const el = { addEventListener: (type, fn) => { H[type] = fn; }, setPointerCapture() {} };
    const rec = (name) => (...a) => calls.push([name, ...a]);
    self.FKGestures.attach(el, { onStart: rec('start'), onTransform: rec('transform'), onEnd: rec('end'), onTap: rec('tap'), onDoubleTap: rec('doubletap'),
                                 onTwoFingerTap: rec('twofingertap'), onLongPress: rec('longpress'), onWheel: rec('wheel') });
    const ev = (type, id, x, y) => H[type]({ type, pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, shiftKey: false });
    const G = {
        calls, T,
        at(ms) { T.advance(ms - T.now); return G; },
        down(id, x, y) { ev('pointerdown', id, x, y); return G; },
        move(id, x, y) { ev('pointermove', id, x, y); return G; },
        up(id, x, y) { ev('pointerup', id, x, y); return G; },
        names: () => calls.map(c => c[0]).filter(n => n !== 'start' && n !== 'transform'),
    };
    return G;
}
function run(fn) { const G = setup(); try { fn(G); } finally { G.T.restore(); } return G; }

test('Tipp', () => {
    const G = run(G => { G.down(1, 100, 100).at(90).up(1, 100, 100).at(500); });
    assert.deepEqual(G.names(), ['tap']);
});

test('Doppeltipp', () => {
    const G = run(G => { G.down(1, 100, 100).at(80).up(1, 100, 100).at(200).down(1, 104, 102).at(260).up(1, 104, 102).at(800); });
    assert.deepEqual(G.names(), ['doubletap']);
});

test('Langdruck (550 ms)', () => {
    const G = run(G => { G.down(1, 150, 250).at(549); assert.deepEqual(G.names(), []); G.at(560).up(1, 150, 250).at(1200); });
    assert.equal(G.names()[0], 'longpress');
    assert.deepEqual(G.calls.find(c => c[0] === 'longpress').slice(1), [150, 250]);
});

test('Zwei-Finger-Tipp ohne pointermove', () => {
    const G = run(G => { G.down(1, 100, 200).at(20).down(2, 200, 200).at(120).up(2, 200, 200).at(130).up(1, 100, 200).at(800); });
    assert.deepEqual(G.names(), ['twofingertap']);
});

known('1.1', 'Zwei-Finger-Tipp mit einem pointermove des zweiten Fingers an Ort', () => {
    const G = run(G => { G.down(1, 100, 200).at(20).down(2, 200, 200).at(40).move(2, 200, 200).at(120).up(2, 200, 200).at(130).up(1, 100, 200).at(800); });
    assert.deepEqual(G.names(), ['twofingertap']);
});

test('Pinch: Skala und Drehung relativ zum Beginn', () => {
    const G = run(G => { G.down(1, 100, 300).at(10).down(2, 200, 300).at(30).move(2, 300, 300); });
    const tr = G.calls.filter(c => c[0] === 'transform').pop();
    // onTransform(ax0, ay0, ax, ay, scale, rot, n)
    assert.equal(tr[5], 2);
    assert.equal(tr[6], 0);
    assert.equal(tr[7], 2);
    assert.deepEqual(tr.slice(1, 5), [150, 300, 200, 300]);
});

test('Pan mit Trägheit: onEnd mit Geschwindigkeit', () => {
    const G = run(G => {
        G.down(1, 100, 100);
        for (let k = 1; k <= 8; k++) G.at(16 * k).move(1, 100 + 10 * k, 100);
        G.at(16 * 8 + 5).up(1, 180, 100);
    });
    const e = G.calls.find(c => c[0] === 'end');
    assert.ok(e, 'onEnd gerufen');
    assert.ok(e[1] > 500 && e[1] < 700, 'vx ≈ 625 px/s: ' + e[1]);
    assert.equal(e[2], 0);
    assert.deepEqual(G.names(), ['end']);
});
