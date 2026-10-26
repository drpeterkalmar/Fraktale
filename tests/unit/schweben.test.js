// 7.4 Schweben am Rand: kurzer Lauf der Simulation tests/sim_schweben.js (echter 2D-Flug aus js/flight.js, Sonde auf dem
// Prozessor) – im Schweben/Herauszoomen/Warten liegt die Bildmitte am Mengenrand, besser als mit der Drift bis 7.4.0
'use strict';
const SIM = require('../sim_schweben.js');
test('Schweben am Rand: Bildmitte ≥ 90 % im Rand-Korridor, seltener im Schwarzen als ?randschweb=0, ohne Hin und Her', () => {
    const P = [SIM.PLACES[2], SIM.PLACES[4]];          // Elefantental 10³, Kardioide 30× (bis 7.4.0: Mitte oft im Inneren)
    for (const pl of P) {
        const neu = SIM.run(pl, 'neu', 60), alt = SIM.run(pl, 'alt', 60);
        assert.ok(neu.n > 200, pl.name + ': Sonden ' + neu.n);
        assert.ok(neu.centerIn012 >= 0.9, `${pl.name}: Mitte im Korridor ${neu.centerIn012} (bis 7.4.0: ${alt.centerIn012})`);
        assert.ok(neu.centerInside <= alt.centerInside && neu.imgInside <= alt.imgInside + 0.02, `${pl.name}: innen ${neu.centerInside}/${neu.imgInside} (bis 7.4.0 ${alt.centerInside}/${alt.imgInside})`);
        assert.equal(neu.flips, 0);
    }
});
