// png-worker.js — 6.8.1 PNG-Kodierer für sehr große Screenshots (Kachel-Rendern, js/capture.js): nimmt das Bild Streifen
// für Streifen entgegen (RGBA, Zeilen von oben), filtert jede Zeile (Paeth, RGB ohne Alpha) und schickt sie durch
// CompressionStream('deflate') (zlib, wie PNG verlangt). Jedes Stück komprimierter Daten wird sofort ein IDAT-Block – das
// ganze Bild liegt nie unkomprimiert im Speicher (16k × 9k wären 590 MB RGBA). Ergebnis: Blob (image/png).
// Nachrichten: { type: 'begin', W, H } · { type: 'strip', rows, data (ArrayBuffer, übertragen) } -> { type: 'ack' } ·
// { type: 'end' } -> { type: 'done', blob, bytes } · Fehler -> { type: 'error', message }
'use strict';

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(crc, buf) {
    let c = crc ^ 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const head = new Uint8Array(8), tail = new Uint8Array(4);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    const c = crc32(crc32(0, head.subarray(4)), data);
    new DataView(tail.buffer).setUint32(0, c);
    return [head, data, tail];
}

let st = null;
self.onmessage = async (e) => {
    const m = e.data;
    try {
        if (m.type === 'begin') {
            const cs = new CompressionStream('deflate');
            st = { W: m.W, H: m.H, parts: [], bytes: 0, prev: new Uint8Array(m.W * 3), cur: new Uint8Array(m.W * 3), writer: cs.writable.getWriter(), reader: cs.readable.getReader(), rows: 0 };
            const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
            dv.setUint32(0, m.W); dv.setUint32(4, m.H);
            ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bit, RGB, deflate, Filter je Zeile, ohne Interlace
            st.parts.push(sig, ...chunk('IHDR', ihdr));
            st.bytes += 8 + 25;
            // komprimierte Daten laufend abholen und als IDAT-Blöcke ablegen
            st.pump = (async () => {
                for (;;) {
                    const r = await st.reader.read();
                    if (r.done) break;
                    const d = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value);
                    if (!d.length) continue;
                    st.parts.push(...chunk('IDAT', d));
                    st.bytes += d.length + 12;
                }
            })();
            return;
        }
        if (m.type === 'strip') {
            const W = st.W, src = new Uint8Array(m.data), rows = m.rows;
            const out = new Uint8Array(rows * (1 + W * 3));
            let o = 0;
            for (let r = 0; r < rows; r++) {
                const cur = st.cur, prev = st.prev;
                for (let x = 0, i = r * W * 4, k = 0; x < W; x++, i += 4, k += 3) { cur[k] = src[i]; cur[k + 1] = src[i + 1]; cur[k + 2] = src[i + 2]; }
                out[o++] = 4;                                           // Paeth
                for (let k = 0; k < W * 3; k++) {
                    const a = k >= 3 ? cur[k - 3] : 0, b = prev[k], c = k >= 3 ? prev[k - 3] : 0;
                    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                    out[o++] = (cur[k] - pr) & 255;
                }
                st.prev = cur; st.cur = prev;
            }
            st.rows += rows;
            await st.writer.write(out);
            self.postMessage({ type: 'ack', rows: st.rows });
            return;
        }
        if (m.type === 'end') {
            await st.writer.close();
            await st.pump;
            st.parts.push(...chunk('IEND', new Uint8Array(0)));
            st.bytes += 12;
            const blob = new Blob(st.parts, { type: 'image/png' });
            const bytes = st.bytes;
            st = null;
            self.postMessage({ type: 'done', blob, bytes });
        }
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
};
