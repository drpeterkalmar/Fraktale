// js/orbit-worker.js: Protokoll mit gefälschtem Worker-self (postMessage sammelt, importScripts lädt per require)
'use strict';
const path = require('path');
require('../../js/hp.js');
const HP = self.FKHP;

function loadWorker() {
    const out = [];
    const saved = { pm: self.postMessage, is: self.importScripts, loc: self.location, om: self.onmessage };
    self.postMessage = (m) => out.push(m);
    self.importScripts = (...files) => { for (const f of files) require(path.join(__dirname, '..', '..', 'js', f.split('?')[0])); };
    self.location = { search: '' };
    const file = require.resolve('../../js/orbit-worker.js');
    delete require.cache[file];
    require(file);
    const onmessage = self.onmessage;
    Object.assign(self, { postMessage: saved.pm, importScripts: saved.is, location: saved.loc, onmessage: saved.om });
    // Antworten des Workers laufen über den gefälschten postMessage
    return { out, send: (q) => { const pm = self.postMessage; self.postMessage = (m) => out.push(m); try { onmessage({ data: q }); } finally { self.postMessage = pm; } } };
}
const SEA = ['-0.743643887037158704752191506114774', '0.131825904205311970493132056385139'];
const refReq = (id, zoom) => ({ type: 'ref', id, formula: 0, cx: HP.fromString(SEA[0]).toString(), cy: HP.fromString(SEA[1]).toString(), jx: '0', jy: '0',
                                zoom, maxIter: 600, halfW: 1.5 / zoom, halfH: 1.5 / zoom, pixel: 3 / zoom / 800, cmax: 0, want64: true });

test('ref -> Antwort mit Orbit + BLA; bla für die letzte Referenz -> neue Tabelle', () => {
    const W = loadWorker();
    W.send(refReq(1, 1e3));
    assert.equal(W.out.length, 1);
    const r = W.out[0];
    assert.equal(r.type, 'ref'); assert.equal(r.id, 1);
    assert.ok(r.orbit32 instanceof Float32Array && r.orbit64 instanceof Float64Array && r.bla32 && r.bla64);
    W.send({ type: 'bla', refId: 1, cmax: r.blaCmax * 4, want64: true });
    assert.equal(W.out.length, 2);
    assert.equal(W.out[1].type, 'bla'); assert.equal(W.out[1].refId, 1); assert.ok(W.out[1].bla32);
});

test('ref A -> ref B -> bla für A: Antwort (ignored), sonst bleibt blaPending der App hängen (bis 6.5.2 keine Antwort)', () => {
    const W = loadWorker();
    W.send(refReq(1, 1e3));
    W.send(refReq(2, 4e3));
    const n = W.out.length;
    W.send({ type: 'bla', refId: 1, cmax: 1e-3, want64: true });
    assert.equal(W.out.length, n + 1, 'keine Antwort auf bla für eine fremde Referenz');
    const m = W.out[n];
    assert.equal(m.type, 'bla'); assert.equal(m.refId, 1); assert.equal(m.ignored, true);
});

test('Fehler im Worker -> type error', () => {
    const W = loadWorker();
    W.send({ type: 'ref', id: 7, formula: 0, cx: 'kaputt', cy: '0', zoom: 1, maxIter: 10, halfW: 1, halfH: 1 });
    assert.equal(W.out.length, 1);
    assert.equal(W.out[0].type, 'error'); assert.equal(W.out[0].id, 7);
});
