// weltfakten.js — 7.1.10 ⓘ-Faktenkarte je Welt (Peter 10.10.2026: „im Eck jedes Welt-Buttons ein kleines Informationszeichen,
// welches beim Draufttippen genaue Fakten zu dieser Welt erzählt“).
// Regel: nur belegte Fakten – jede Karte nennt ihre Quellen (src, auch sichtbar am Kartenende); Unsicheres ist weggelassen,
// eigene Varianten/Mischungen der App sind als solche gekennzeichnet. Je Karte: Formel bzw. Regel (f), Entdeckung (who),
// 2–4 Zahlen/Eigenschaften (nums), was man sieht und wo sich das Zoomen lohnt – Verweis auf die Tour-Orte (see), „Wusstest du?“
// (fun). Höchstens ~90 Wörter je Sprache (tests/test_v7110.py zählt nach). Schlüssel = Formel-Nummer (MODE_KEYS in app.js).
(function (root) {
'use strict';

const CARDS = {
    // Mandelbrot – Wikipedia „Mandelbrot set“ (Fläche ≈ 1,50659, numerisch; Brooks & Matelski 1978; Boll 1991);
    // Douady & Hubbard, C. R. Acad. Sci. Paris 294 (1982) – zusammenhängend; Shishikura, Annals of Math. 147 (1998) – Rand Dimension 2
    0: {
        src: ['Wikipedia: Mandelbrot set', 'Douady & Hubbard 1982', 'Shishikura 1998, Annals of Math. 147'],
        de: { f: 'z ↦ z² + c, Start z = 0 – c gehört dazu, wenn z beschränkt bleibt', who: 'Erste Bilder: Brooks & Matelski 1978; bekannt durch Benoît Mandelbrot 1980.',
              nums: ['Fläche ≈ 1,5066 (numerisch geschätzt)', 'Rand hat die Hausdorff-Dimension 2 (Shishikura 1998)', 'zusammenhängend (Douady & Hubbard 1982)', 'liegt ganz im Kreis mit Radius 2'],
              see: 'Herzförmiger Hauptkörper mit Knospen, am Rand unendlich viele Mini-Mandelbrote. Lohnend: Seepferdchental, Elefantental, Mini-Mandelbrot.',
              fun: 'Im Seepferdchental steckt π: nahe c = −0,75 ergibt Iterationszahl mal Abstand immer genauer π (Boll 1991).' },
        en: { f: 'z ↦ z² + c, start z = 0 – c belongs to the set if z stays bounded', who: 'First pictures: Brooks & Matelski 1978; made famous by Benoît Mandelbrot in 1980.',
              nums: ['area ≈ 1.5066 (numerical estimate)', 'its boundary has Hausdorff dimension 2 (Shishikura 1998)', 'connected (Douady & Hubbard 1982)', 'lies entirely inside the circle of radius 2'],
              see: 'A heart-shaped main body with buds, infinitely many mini Mandelbrots along the edge. Worth a visit: Seahorse Valley, Elephant Valley, Mini Mandelbrot.',
              fun: 'π hides in Seahorse Valley: near c = −0.75, iterations times distance approach π (Boll 1991).' }
    },
    // Julia – Wikipedia „Julia set“ (Fatou/Julia, Zusammenhang ⇔ c ∈ M, c = i Dendrit, c = 0 Kreis), „Gaston Julia“ (1918, 25 Jahre, 199 Seiten)
    1: {
        src: ['Wikipedia: Julia set', 'Wikipedia: Gaston Julia'],
        de: { f: 'z ↦ z² + c mit festem c – gefärbt wird jeder Startwert z', who: 'Gaston Julia (1918) und Pierre Fatou (1917–1920), lange vor Computerbildern.',
              nums: ['zusammenhängend genau dann, wenn c in der Mandelbrot-Menge liegt – sonst Staub (Cantor-Menge)', 'c = i: ein Dendrit ohne Innenraum', 'c = 0: der Einheitskreis'],
              see: 'Jedes c ergibt ein anderes Bild: Spiralen, Kaninchen, Bäume. Lohnend: Douadys Kaninchen, Dendrit, Siegel-Scheibe.',
              fun: 'Julia schrieb seine 199-seitige Arbeit mit 25 Jahren, nach einer schweren Kriegsverletzung.' },
        en: { f: 'z ↦ z² + c with c fixed – every starting value z is coloured', who: 'Gaston Julia (1918) and Pierre Fatou (1917–1920), long before computer pictures.',
              nums: ['connected exactly when c lies in the Mandelbrot set – otherwise dust (a Cantor set)', 'c = i: a dendrite without interior', 'c = 0: the unit circle'],
              see: 'Every c gives a different picture: spirals, rabbits, trees. Worth a visit: Douady’s rabbit, Dendrite, Siegel disk.',
              fun: 'Julia wrote his 199-page memoir at 25, after a severe war injury.' }
    },
    // Burning Ship – Wikipedia „Burning Ship fractal“; Michelitsch & Rössler, Computers & Graphics 16(4) (1992)
    2: {
        src: ['Wikipedia: Burning Ship fractal', 'Michelitsch & Rössler 1992, Computers & Graphics 16'],
        de: { f: 'z ↦ (|Re z| + i·|Im z|)² + c', who: 'Michael Michelitsch und Otto E. Rössler, 1992.',
              nums: ['durch den Betrag nicht holomorph – daher kantiger als die Mandelbrot-Menge', 'Celtic, Senkrecht, Büffel: weitere Abwandlungen der Formel (Variante der App)'],
              see: 'Links auf der reellen Achse liegt das „brennende Schiff“ mit Masten, daneben ganze Flotten. Lohnend: Armada, Kathedrale, Laternen, Fackel.',
              fun: 'Ohne die beiden Betragsstriche wäre es genau die Mandelbrot-Menge.' },
        en: { f: 'z ↦ (|Re z| + i·|Im z|)² + c', who: 'Michael Michelitsch and Otto E. Rössler, 1992.',
              nums: ['not holomorphic because of the absolute values – hence sharper edges than the Mandelbrot set', 'Celtic, Perpendicular, Buffalo: further variations of the formula (variant of this app)'],
              see: 'On the real axis to the left lies the “burning ship” with masts, beside it whole fleets. Worth a visit: Armada, Cathedral, Lanterns, Torch.',
              fun: 'Without the absolute values it would be exactly the Mandelbrot set.' }
    },
    // Tricorn – Wikipedia „Tricorn (mathematics)“; Crowe, Hasson, Rippon, Strain-Clark, Nonlinearity 2 (1989); Hubbard & Schleicher,
    // „Multicorns are not path connected“ (2014); Milnor (kubische Polynome)
    3: {
        src: ['Wikipedia: Tricorn (mathematics)', 'Crowe et al. 1989, Nonlinearity 2', 'Hubbard & Schleicher 2014'],
        de: { f: 'z ↦ z̄² + c (z̄: Imaginärteil umgedreht)', who: 'Als „Mandelbar-Menge“ untersucht von Crowe, Hasson, Rippon und Strain-Clark (1989); John Milnor fand sie bei kubischen Polynomen wieder.',
              nums: ['dreizählige Drehsymmetrie', 'nicht wegzusammenhängend (Hubbard & Schleicher 2014)'],
              see: 'Drei Spitzen statt Herzform, am Rand Federn statt Seepferdchen. Lohnend: Federn, Federtal, Wellenbrecher.',
              fun: '„Tricorn“ heißt Dreispitz – wie der Hut.' },
        en: { f: 'z ↦ z̄² + c (z̄: imaginary part flipped)', who: 'Studied as the “Mandelbar set” by Crowe, Hasson, Rippon and Strain-Clark (1989); John Milnor found it again in cubic polynomials.',
              nums: ['threefold rotational symmetry', 'not path connected (Hubbard & Schleicher 2014)'],
              see: 'Three points instead of a heart shape, feathers instead of seahorses. Worth a visit: Feathers, Feather valley, Breakers.',
              fun: '“Tricorn” is the three-cornered hat – and that is its shape.' }
    },
    // Multibrot – Wikipedia „Multibrot set“ (Symmetrie (n − 1)-zählig, Grenzfall großer n: Einheitskreisscheibe)
    4: {
        src: ['Wikipedia: Multibrot set'],
        de: { f: 'z ↦ zⁿ + c, hier n = 2 … 8, auch gebrochen', who: 'Verallgemeinerung der Mandelbrot-Menge (n = 2).',
              nums: ['ganzzahliges n: (n − 1)-zählige Drehsymmetrie', 'gebrochenes n: sichtbare Naht am Schnitt der Potenz (Variante der App)', 'Morph: n wandert langsam zwischen 2 und 6 (Variante der App)'],
              see: 'Mit wachsendem n mehr Arme und eine rundere Gestalt. Lohnend: Zwillinge (z³), Vierblatt (z⁵), Spiralküste.',
              fun: 'Für sehr große n nähert sich die Menge der Kreisscheibe mit Radius 1.' },
        en: { f: 'z ↦ zⁿ + c, here n = 2 … 8, fractional too', who: 'Generalisation of the Mandelbrot set (n = 2).',
              nums: ['integer n: (n − 1)-fold rotational symmetry', 'fractional n: a visible seam at the branch cut of the power (variant of this app)', 'Morph: n slowly wanders between 2 and 6 (variant of this app)'],
              see: 'As n grows: more arms and a rounder outline. Worth a visit: Twins (z³), Four-leaf (z⁵), Spiral coast.',
              fun: 'For very large n the set approaches the disc of radius 1.' }
    },
    // Newton – Wikipedia „Newton fractal“, „Newton's method“ (z³ − 2z + 2: Zyklus 0 ↔ 1); Cayley, „The Newton–Fourier imaginary problem“,
    // Amer. J. Math. 2 (1879)
    5: {
        src: ['Wikipedia: Newton fractal', 'Wikipedia: Newton’s method', 'Cayley 1879, Amer. J. Math. 2'],
        de: { f: 'z ↦ z − p(z)/p′(z), z. B. p = z³ − 1', who: 'Newton-Verfahren (17. Jh.); Arthur Cayley fragte 1879 nach den Einzugsgebieten in der komplexen Ebene.',
              nums: ['z³ − 1: drei Nullstellen, drei Farben', 'jeder Randpunkt grenzt an alle drei Einzugsgebiete', 'z³ − 2z + 2: von 0 aus pendelt das Verfahren zwischen 0 und 1 – schwarze Inseln'],
              see: 'Farbe = zu welcher Nullstelle ein Startwert läuft, Helligkeit = wie schnell. Lohnend: Achtstern, Blüte, Schwarze Inseln.',
              fun: 'Cayley löste den Fall z² − 1 – an z³ − 1 scheiterte er. Das Bild zeigt, warum.' },
        en: { f: 'z ↦ z − p(z)/p′(z), e.g. p = z³ − 1', who: 'Newton’s method (17th century); Arthur Cayley asked about its basins in the complex plane in 1879.',
              nums: ['z³ − 1: three roots, three colours', 'every boundary point touches all three basins', 'z³ − 2z + 2: starting at 0 the method cycles between 0 and 1 – black islands'],
              see: 'Colour = which root a starting value runs to, brightness = how fast. Worth a visit: Eight-star, Blossom, Black islands.',
              fun: 'Cayley solved z² − 1 – z³ − 1 defeated him. The picture shows why.' }
    },
    // Mandelbulb – Wikipedia „Mandelbulb“ (White & Nylander 2009, Exponent 8, kein echtes 3D-Analogon der komplexen Zahlen)
    6: {
        src: ['Wikipedia: Mandelbulb'],
        de: { f: '3D: Potenz in Kugelkoordinaten (Radius⁸, Winkel × 8) + c', who: 'Daniel White und Paul Nylander, 2009.',
              nums: ['Exponent 8 ist der übliche (hier 2–16, „Atmen“ lässt ihn schwingen)', 'kein „echtes“ 3D-Mandelbrot: es gibt keine 3D-Zahlen mit den Eigenschaften der komplexen Zahlen'],
              see: 'Knospen über Knospen, Schluchten, Höhlen. Lohnend: Knospen-Garten, Exponent 4: Gewölbe. Flug: 🔍 Tauchen bis zur Rechengenauigkeit, dabei gleitet er über die Oberfläche.',
              fun: 'Die Formel dreht und streckt Punkte im Raum – eine „Triplex“-Potenz statt Zahlen-Multiplikation.' },
        en: { f: '3D: a power in spherical coordinates (radius⁸, angles × 8) + c', who: 'Daniel White and Paul Nylander, 2009.',
              nums: ['power 8 is the usual one (here 2–16, “breathe” lets it swing)', 'not a “true” 3D Mandelbrot: there are no 3D numbers with the properties of complex numbers'],
              see: 'Buds upon buds, gorges, caves. Worth a visit: Bud garden, Power 4: vaults. Flight: 🔍 dive down to the precision limit, gliding over the surface.',
              fun: 'The formula rotates and stretches points in space – a “triplex” power instead of a multiplication of numbers.' }
    },
    // Buddhabrot – Wikipedia „Buddhabrot“ (Melinda Green 1993; Nebulabrot: drei Grenzen als RGB; Anti-Buddhabrot)
    7: {
        src: ['Wikipedia: Buddhabrot'],
        de: { f: 'Dichte der Bahnen von z ↦ z² + c aller Punkte, die fliehen', who: 'Melinda Green, 1993.',
              nums: ['dieselbe Formel wie Mandelbrot – gezeigt wird, wo die Bahnen entlanglaufen', 'Nebulabrot: drei Iterationsgrenzen als Rot, Grün, Blau', 'Anti-Buddhabrot: Bahnen der Punkte, die nie fliehen'],
              see: 'Aufrecht gedreht erinnert die Form an einen sitzenden Buddha. Lohnend: Nebulabrot, Anti-Buddhabrot.',
              fun: 'Das Bild wächst wie eine Langzeitbelichtung – je länger, desto feiner die Schleier.' },
        en: { f: 'density of the orbits of z ↦ z² + c of all points that escape', who: 'Melinda Green, 1993.',
              nums: ['the same formula as Mandelbrot – it shows where the orbits travel', 'Nebulabrot: three iteration limits as red, green, blue', 'Anti-Buddhabrot: orbits of the points that never escape'],
              see: 'Turned upright the shape recalls a seated Buddha. Worth a visit: Nebulabrot, Anti-Buddhabrot.',
              fun: 'The picture grows like a long exposure – the longer, the finer the veils.' }
    },
    // Mandelbox – Wikipedia „Mandelbox“ (Tom Lowe 2010, Kasten- und Kugelfaltung, Skalierung 2 bzw. −1,5)
    8: {
        src: ['Wikipedia: Mandelbox'],
        de: { f: 'Kastenfaltung, Kugelfaltung, × Skalierung + c – wiederholt', who: 'Tom Lowe, 2010.',
              nums: ['bekannteste Skalierungen: 2 und −1,5 (Regler −3 … 3)', 'entsteht nur aus Spiegeln, Umstülpen und Strecken des Raums'],
              see: 'Türme, Säle, Gitter, Monde. Lohnend: Türme, Mondlandschaft, Korridor. Flug: ✈ Durchflug an Kanten und durch Hohlräume.',
              fun: 'Entdeckt 2010 von einem Liebhaber im Forum fractalforums.com – neue Fraktale findet nicht nur die Wissenschaft.' },
        en: { f: 'box fold, sphere fold, × scale + c – repeated', who: 'Tom Lowe, 2010.',
              nums: ['best-known scales: 2 and −1.5 (slider −3 … 3)', 'made only of mirroring, inverting and stretching space'],
              see: 'Towers, halls, grids, moons. Worth a visit: Towers, Moonscape, Corridor. Flight: ✈ fly-through along edges and through cavities.',
              fun: 'Discovered in 2010 by an enthusiast on fractalforums.com – new fractals are not only found by scientists.' }
    },
    // Menger-Schwamm – Wikipedia „Menger sponge“ (Karl Menger 1926, Dimension ln 20/ln 3 ≈ 2,727, Volumen 0, Oberfläche ∞,
    // universelle Kurve, Seitenflächen = Sierpiński-Teppich)
    9: {
        src: ['Wikipedia: Menger sponge'],
        de: { f: 'Würfel in 27 Teilwürfel teilen, die 7 mittleren entfernen – unendlich oft', who: 'Karl Menger, 1926.',
              nums: ['Dimension ln 20 / ln 3 ≈ 2,727', 'Volumen → 0, Oberfläche → unendlich', 'jede Kurve lässt sich in ihn einbetten (universelle Kurve)'],
              see: 'Je Stufe bleiben 20 von 27 Würfeln – Gänge kreuzen sich in allen Größen. Lohnend: Durchblick, Ecke. Flug: ✈ Durchflug durch die Gänge.',
              fun: 'Jede Seitenfläche ist ein Sierpiński-Teppich.' },
        en: { f: 'split a cube into 27, remove the 7 middle ones – forever', who: 'Karl Menger, 1926.',
              nums: ['dimension ln 20 / ln 3 ≈ 2.727', 'volume → 0, surface → infinity', 'every curve can be embedded in it (universal curve)'],
              see: 'Each step keeps 20 of 27 cubes – corridors cross at every size. Worth a visit: Vista, Corner. Flight: ✈ fly-through the corridors.',
              fun: 'Every face is a Sierpiński carpet.' }
    },
    // Lyapunov – Wikipedia „Lyapunov fractal“ (Markus & Hess 1989, logistische Gleichung, Exponent, „Zircon Zity“ BBBBBBAAAAAA)
    10: {
        src: ['Wikipedia: Lyapunov fractal', 'Markus & Hess 1989, Computers & Graphics 13'],
        de: { f: 'x ↦ r·x(1 − x), r wechselt nach einer Folge (A/B)', who: 'Mario Markus und Benno Hess, 1989.',
              nums: ['Farbe = Lyapunov-Exponent: kleiner 0 stabil, größer 0 Chaos (schwarz)', 'Zirkon-Stadt: Folge BBBBBBAAAAAA'],
              see: 'Glatte, wie gegossene Flächen, gefaltet an den Chaos-Rändern. Lohnend: Zirkon-Stadt, Goldene Falten, Schwingen.',
              fun: 'Die logistische Gleichung stammt aus der Biologie: sie beschreibt Tierbestände.' },
        en: { f: 'x ↦ r·x(1 − x), r alternates by a sequence (A/B)', who: 'Mario Markus and Benno Hess, 1989.',
              nums: ['colour = Lyapunov exponent: below 0 stable, above 0 chaos (black)', 'Zircon City: sequence BBBBBBAAAAAA'],
              see: 'Smooth, cast-looking surfaces, folded at the edges of chaos. Worth a visit: Zircon City, Golden folds, Wings.',
              fun: 'The logistic equation comes from biology: it models animal populations.' }
    },
    // Phoenix – Ushiki, „Phoenix“, IEEE Trans. Circuits and Systems 35(7) (1988); übliche Werte c = 0,5667, p = −0,5
    11: {
        src: ['Ushiki 1988, IEEE Trans. Circuits and Systems 35'],
        de: { f: 'zₙ₊₁ = zₙ² + c + p·zₙ₋₁', who: 'Shigehiro Ushiki, 1988.',
              nums: ['Gedächtnis: der vorletzte Wert wirkt mit (Faktor p)', 'p = 0: gewöhnliche Julia-Menge', 'Mandelbrot-Form der App: c variiert über das Bild (Variante der App)'],
              see: 'Federn, Flügel und Flammen. Lohnend: Federkleid, Flügelspitze, Feuerspirale.',
              fun: 'Klassische Werte: c = 0,5667 und p = −0,5.' },
        en: { f: 'zₙ₊₁ = zₙ² + c + p·zₙ₋₁', who: 'Shigehiro Ushiki, 1988.',
              nums: ['memory: the previous value takes part (factor p)', 'p = 0: an ordinary Julia set', 'the app’s Mandelbrot form: c varies across the picture (variant of this app)'],
              see: 'Feathers, wings and flames. Worth a visit: Plumage, Wing tip, Fire spiral.',
              fun: 'Classic values: c = 0.5667 and p = −0.5.' }
    },
    // Nova – Wikipedia „Newton fractal“, Abschnitt „Nova fractal“ (Paul Derbyshire, Mitte der 1990er, Newton + c)
    12: {
        src: ['Wikipedia: Newton fractal (Nova fractal)'],
        de: { f: 'z ↦ z − R·(z³ − 1)/(3z²) + c', who: 'Paul Derbyshire, Mitte der 1990er – eine Erweiterung des Newton-Verfahrens.',
              nums: ['R: Relaxation (unter 1 bremst, über 1 schießt über)', 'Mandelbrot- und Julia-Form (Variante der App)'],
              see: 'Newton-Blüten mit Mandelbrot-Inseln dazwischen. Lohnend: Insel im Strom, Perlenkette, Nova-Kern.',
              fun: 'Mit R = 1 und c = 0 ist es genau das Newton-Verfahren für z³ − 1.' },
        en: { f: 'z ↦ z − R·(z³ − 1)/(3z²) + c', who: 'Paul Derbyshire, mid-1990s – an extension of Newton’s method.',
              nums: ['R: relaxation (below 1 brakes, above 1 overshoots)', 'Mandelbrot and Julia forms (variant of this app)'],
              see: 'Newton blossoms with Mandelbrot islands in between. Worth a visit: Island in the stream, String of pearls, Nova core.',
              fun: 'With R = 1 and c = 0 it is exactly Newton’s method for z³ − 1.' }
    },
    // Magnet – Peitgen & Richter, „The Beauty of Fractals“, Springer 1986 (Renormierung, Ising-Modell, Magnet I/II)
    13: {
        src: ['Peitgen & Richter 1986, The Beauty of Fractals'],
        de: { f: 'Magnet I: z ↦ ((z² + c − 1)/(2z + c − 2))²', who: 'Aus der Renormierung von Magnet-Modellen (Ising); bekannt durch Peitgen & Richter (1986).',
              nums: ['Punkte fliehen ins Unendliche oder landen bei z = 1', 'Magnet II: dieselbe Idee eine Ordnung höher (kubisch)'],
              see: 'Seepferdchen und Blasen wie bei Mandelbrot, aber verzerrt. Lohnend: Blasenriff, Magnet-Seepferdchen, Spiralen.',
              fun: 'Die Formel stammt aus der Physik der Phasenübergänge – dort, wo ein Magnet seine Magnetisierung verliert.' },
        en: { f: 'Magnet I: z ↦ ((z² + c − 1)/(2z + c − 2))²', who: 'From the renormalisation of magnet models (Ising); popularised by Peitgen & Richter (1986).',
              nums: ['points escape to infinity or land at z = 1', 'Magnet II: the same idea one order higher (cubic)'],
              see: 'Seahorses and bubbles like Mandelbrot, but distorted. Worth a visit: Bubble reef, Magnet seahorse, Spirals.',
              fun: 'The formula comes from the physics of phase transitions – where a magnet loses its magnetisation.' }
    },
    // Fraktal-Flammen – Wikipedia „Fractal flame“ (Scott Draves 1992, Log-Dichte, Electric Sheep 1999); Draves & Reckase 2003
    14: {
        src: ['Wikipedia: Fractal flame', 'Draves & Reckase 2003, The Fractal Flame Algorithm'],
        de: { f: 'Zufallsspiel mit wenigen Abbildungen und nichtlinearen „Variationen“', who: 'Scott Draves, 1992.',
              nums: ['Helligkeit = Logarithmus der Trefferdichte', 'Electric Sheep (1999): ein Bildschirmschoner, mit dem viele Rechner Flammen gemeinsam „züchten“'],
              see: 'Seidige Leuchtschleier. Lohnend: Galerie (Eisblume, Galaxie, Portal), dazu Zufällig und Mutieren.',
              fun: 'Die Farbe kommt von den zuletzt benutzten Abbildungen, nicht aus einer Formel je Pixel.' },
        en: { f: 'a random game with a few maps and non-linear “variations”', who: 'Scott Draves, 1992.',
              nums: ['brightness = logarithm of the hit density', 'Electric Sheep (1999): a screensaver with which many computers “breed” flames together'],
              see: 'Silky veils of light. Worth a visit: gallery (Frost flower, Galaxy, Portal), plus Random and Mutate.',
              fun: 'The colour comes from the most recently used maps, not from a formula per pixel.' }
    },
    // Attraktoren – Wikipedia „Lorenz system“ (Lorenz 1963, σ = 10, ρ = 28, β = 8/3, Vortrag 1972 „Schmetterlingseffekt“);
    // Pickover, „Chaos in Wonderland“ (1994) – Clifford-Attraktor; Bourke, paulbourke.net („Clifford Attractors“, „Peter de Jong Attractors“)
    15: {
        src: ['Wikipedia: Lorenz system', 'Pickover 1994, Chaos in Wonderland', 'paulbourke.net: Clifford / Peter de Jong attractors'],
        de: { f: 'Clifford: x′ = sin(a·y) + c·cos(a·x), y′ = sin(b·x) + d·cos(b·y)', who: 'Clifford-Attraktor: Clifford Pickover; Lorenz-Attraktor: Edward Lorenz 1963, aus einem Wettermodell.',
              nums: ['Lorenz: klassische Werte σ = 10, ρ = 28, β = 8/3', 'die Bahn kommt nie zur Ruhe und füllt doch eine feste Form'],
              see: 'Fein verschlungene Bahnen. Lohnend: Clifford-Fächer, De-Jong-Welle, Svensson-Blume, Lorenz-Schmetterling.',
              fun: 'Lorenz’ Vortrag von 1972 machte den „Schmetterlingseffekt“ bekannt.' },
        en: { f: 'Clifford: x′ = sin(a·y) + c·cos(a·x), y′ = sin(b·x) + d·cos(b·y)', who: 'Clifford attractor: Clifford Pickover; Lorenz attractor: Edward Lorenz 1963, from a weather model.',
              nums: ['Lorenz: classic values σ = 10, ρ = 28, β = 8/3', 'the orbit never settles, yet fills a fixed shape'],
              see: 'Finely tangled orbits. Worth a visit: Clifford fan, De Jong wave, Svensson flower, Lorenz butterfly.',
              fun: 'Lorenz’s 1972 talk made the “butterfly effect” famous.' }
    },
    // Quaternionen-Julia – Wikipedia „Quaternion“ (Hamilton 1843, Brougham Bridge, i² = j² = k² = ijk = −1); Norton, „Generation and
    // display of geometric fractals in 3-D“, SIGGRAPH 1982; Hart, Sandin & Kauffman, „Ray tracing deterministic 3-D fractals“ (1989)
    16: {
        src: ['Wikipedia: Quaternion', 'Norton 1982, SIGGRAPH', 'Hart, Sandin & Kauffman 1989, SIGGRAPH'],
        de: { f: 'q ↦ q² + c mit Quaternionen (4D) – gezeigt wird ein 3D-Schnitt', who: 'Quaternionen: William R. Hamilton 1843; erste Bilder solcher Julia-Mengen: Alan Norton 1982.',
              nums: ['Quaternionen haben vier Teile: 1, i, j, k', 'i² = j² = k² = ijk = −1', 'gerendert per Distanzschätzung (Hart, Sandin & Kauffman 1989)'],
              see: 'Glatte, verschlungene Formen; „c wandert“ lässt sie fließen. Lohnend: Drache, Spirale, Wolke.',
              fun: 'Hamilton ritzte die Formel 1843 in die Brougham Bridge in Dublin.' },
        en: { f: 'q ↦ q² + c with quaternions (4D) – a 3D slice is shown', who: 'Quaternions: William R. Hamilton 1843; first pictures of such Julia sets: Alan Norton 1982.',
              nums: ['quaternions have four parts: 1, i, j, k', 'i² = j² = k² = ijk = −1', 'rendered by distance estimation (Hart, Sandin & Kauffman 1989)'],
              see: 'Smooth, entwined shapes; “c wanders” makes them flow. Worth a visit: Dragon, Spiral, Cloud.',
              fun: 'Hamilton carved the formula into Brougham Bridge in Dublin in 1843.' }
    },
    // Kaleidoskop-IFS – Knighty, fractalforums.com, „Kaleidoscopic (escape time) IFS“ (2010)
    17: {
        src: ['fractalforums.com: Knighty, Kaleidoscopic (escape time) IFS, 2010'],
        de: { f: 'drehen, spiegeln/sortieren (Kaleidoskop), skalieren – wiederholt', who: 'Knighty, fractalforums.com, 2010; hier mit Skalierung und zwei Winkeln (Variante der App).',
              nums: ['die Faltung wirft den ganzen Raum in einen Keil – wie ein Kaleidoskop', 'Abstand: Würfel der letzten Stufe, geteilt durch die Gesamtskalierung'],
              see: 'Kristalle, Felsen, Tempel – je nach Winkeln. Lohnend: Kristall, Fels, Tempel. Flug: ✈ Durchflug an Felswänden entlang.',
              fun: 'Mit denselben drei Schritten entstehen auch Menger-Schwamm und Sierpiński-Tetraeder.' },
        en: { f: 'rotate, mirror/sort (kaleidoscope), scale – repeated', who: 'Knighty, fractalforums.com, 2010; here with a scale and two angles (variant of this app).',
              nums: ['the fold throws all of space into one wedge – like a kaleidoscope', 'distance: the cube of the last step divided by the total scale'],
              see: 'Crystals, rocks, temples – depending on the angles. Worth a visit: Crystal, Rock, Temple. Flight: ✈ fly-through along cliffs.',
              fun: 'The same three steps also build the Menger sponge and the Sierpiński tetrahedron.' }
    },
    // Apollonian – Wikipedia „Apollonian gasket“ (Apollonios von Perge, Dimension ≈ 1,3057, ganzzahlige Packung −1, 2, 2, 3);
    // Inigo Quilez, iquilezles.org (3D-Kugelschaum, Grundlage der App-Variante)
    18: {
        src: ['Wikipedia: Apollonian gasket', 'iquilezles.org (Inigo Quilez)'],
        de: { f: 'in eine Würfelzelle falten, an einer Kugel spiegeln (invertieren) – wiederholt', who: 'Kreispackung nach Apollonios von Perge (um 200 v. Chr.); der 3D-Kugelschaum ist eine Variante der App nach Inigo Quilez.',
              nums: ['2D-Kreispackung: Dimension ≈ 1,3057', 'unendlich viele Kugeln, die einander berühren'],
              see: 'Hallen aus Kugeln, Bögen, endlose Gänge. Lohnend: Kugelhallen, Bögen, Tiefe Gänge. Flug: ✈ Durchflug durch die Hallen.',
              fun: 'Bei der Packung mit den Krümmungen −1, 2, 2, 3 sind alle Krümmungen ganze Zahlen.' },
        en: { f: 'fold into a cubic cell, invert in a sphere – repeated', who: 'Circle packing after Apollonius of Perga (c. 200 BC); the 3D sphere foam is a variant of this app after Inigo Quilez.',
              nums: ['2D packing: dimension ≈ 1.3057', 'infinitely many spheres touching each other'],
              see: 'Halls of spheres, arches, endless corridors. Worth a visit: Sphere halls, Arches, Deep corridors. Flight: ✈ fly-through the halls.',
              fun: 'In the packing with curvatures −1, 2, 2, 3 every curvature is a whole number.' }
    }
};

// Wörter einer Karte (Prüfung ≤ ~90 Wörter)
function words(c) { return [c.f, c.who, ...c.nums, c.see, c.fun].join(' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length; }

root.FKFacts = { CARDS, words };
if (typeof module !== 'undefined') module.exports = root.FKFacts;
})(typeof self !== 'undefined' ? self : this);
