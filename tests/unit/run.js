#!/usr/bin/env node
// Unit-Tests in purem Node (keine Abhängigkeiten): führt alle tests/unit/*.test.js aus.
// Module werden per require geladen; sie hängen sich an globalThis (= self im Browser/Worker).
// API in den Testdateien: test(name, fn) – fn darf async sein; assert (node:assert/strict);
// known(step, name, fn): dokumentierter Fehler, der erst mit Umbau-Schritt <step> behoben wird – rot ist dann
// „erwartet“ (zählt nicht als Fehler); wird er grün, schlägt der Lauf fehl, damit die Markierung entfernt wird.
// Aufruf: node tests/unit/run.js [Filter]
'use strict';
const fs = require('fs'), path = require('path');
globalThis.self = globalThis;
globalThis.assert = require('assert/strict');
const tests = [];
globalThis.test = (name, fn) => tests.push({ name, fn });
globalThis.known = (step, name, fn) => tests.push({ name, fn, known: step });

const dir = __dirname, filter = process.argv[2] || '';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort();
(async () => {
    const t0 = Date.now();
    let fail = 0, pass = 0, red = 0;
    for (const f of files) {
        const n0 = tests.length;
        require(path.join(dir, f));
        console.log('# ' + f);
        for (const t of tests.slice(n0)) {
            let err = null;
            try { await t.fn(); } catch (e) { err = e; }
            if (t.known) {
                if (err) { red++; console.log(`  rot (erwartet bis Schritt ${t.known}) ${t.name}: ${String(err.message || err).split('\n')[0]}`); }
                else { fail++; console.log(`  FAIL ${t.name}: ist grün – Markierung known('${t.known}') entfernen`); }
            } else if (err) { fail++; console.log(`  FAIL ${t.name}\n       ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n       ')}`); }
            else { pass++; console.log(`  ok   ${t.name}`); }
        }
    }
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${pass} ok, ${fail} FAIL, ${red} erwartet rot · ${s} s`);
    process.exit(fail ? 1 : 0);
})();
