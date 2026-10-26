// 7.4.2 Start immer am Rand: kurzer Lauf von tests/sim_randstart.js (echter Zufallsstart aus js/zufall.js, CPU-Sonde)
'use strict';
const SIM = require('../sim_randstart.js');
test('Zufallsstart: Rand in der Bildmitte (Mandelbrot, Burning Ship, Phoenix, Lyapunov je 12 Starts), ?randstart=0 wie bisher', () => {
    for (const w of [0, 2, 11, 10]) {
        const neu = SIM.runWorld(w, '', 12), alt = SIM.runWorld(w, 'randstart=0', 12);
        assert.equal(neu.onEdge, 1, `Welt ${w}: Rand in der Mitte ${neu.onEdge} (bis 7.4.1: ${alt.onEdge})`);
        assert.ok(alt.onEdge < 1, `Welt ${w}: ?randstart=0 unverändert (${alt.onEdge})`);
        assert.ok(neu.msMean < 120, `Welt ${w}: Würfeln ${neu.msMean} ms`);
    }
});
