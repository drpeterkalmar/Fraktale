# Fraktal-Explorer 7.0.0 – Mandelbulb richtig (Licht, Tiefe, Zoom, Flug, Varianten) + Mandelbox + Menger-Schwamm

Auftrag 09./10.10.2026 („Kann man aus Mandelbulb noch mehr rausholen?“). Vorher als eigener Release: 6.9.0 „Außen“
(`V69_BERICHT.md`). Zwischenstand 6.9.1 (Etappen 1–6 im Kern), Abschluss 7.0.0 (Feinschliff, Etappe 7, Messung, Bericht).

## Kurzfassung

- Der Mandelbulb ist jetzt ein beleuchtetes 3D-Rendering: Haupt-, Himmels- und Rückstreulicht, weiche Schatten, Ambient
  Occlusion, Glanzlicht, Fresnel-Randlicht, filmische Tonkurve; Farbe nach Struktur (Orbit-Traps) in jeder App-Palette,
  vier Stile (Klassisch, Stein, Metall, Glas/Neon), Leuchten in Rissen, Hintergrund mit Verlauf und Sternen (bzw. nach
  „Außen“ schwarz mit Leuchtrand oder ganz schwarz).
- **Echtes Hineinzoomen bis ≈ 8·10⁴** mit neuen Details: Treffer-Epsilon je Pixelkegel, Iterationen/Schritte wachsen mit dem
  Zoom, ab Zoom ~60 ein Taylor-Anker für die erste Iteration. Gemessen am Bild: mit Anker bei 7,9·10⁴ sauber, ohne Anker
  körnig/blockig (`tests/shots/v70/praezision_*.png`); bei 1,6·10⁵ auch mit Anker körnig – dort hält die Kamera mit Hinweis.
- Freie Kamera (Orbit um die Stelle in der Bildmitte, Zoom zur Stelle unter den Fingern, Doppeltipp = hinfliegen), ✈ Flug
  an der Oberfläche (Rückwärts auf demselben Weg, Pause, Lenken, Vollbild-fest), Exponent 2–16 + Atmen, Julia-Bulb per
  Langdruck, Nebel, Tiefenunschärfe mit Fokus per Tipp, Link/Orte mit allen Parametern, Ruhebild-Mittelung, Screenshot in
  beliebiger Auflösung (Kacheln bitgleich).
- **Neue Welten:** Mandelbox 3D (Skalierung −3…3) und Menger-Schwamm 3D mit derselben Technik.
- **Leistung** (Mittelklasse-Profil wie 6.7): alle Bewegungen ≥ 42 Bilder/s, auch mit simulierter 4× langsamerer GPU;
  Ruhebild nach 0,6–2,1 s fertig.
- Eigene Sichtbewertung („wirkt wie ein hochwertiges 3D-Fraktal-Rendering – Licht, Tiefe, Details?“): Gesamtansicht 8/10,
  Nahzoom 10²/10⁴ 8/10, Menger 9/10, Mandelbox 8/10, Flugbilder 7–8/10 (im Flug gröbere Auflösung). Vorher (6.9): 3/10.

## Technik (js/bulb.js)

**Marsch-Pass** (`BULB_FS`, ein Programm für alle drei Fraktale, Art per Uniform):
- Strahl je Pixel aus der Kamera (Position/Gieren/Nicken in f64, an den Shader als f32), Bildwinkel 50° auf der kürzeren
  Seite (hoch/quer gleich), Kachel-Lage `u_vp` wie 6.8.1 → Screenshot-Kacheln rechnen exakt dieselben Strahlen.
- Schnitt mit umhüllender Kugel (Mandelbulb 1,45–2,2 je Exponent, Mandelbox aus einer Abtastung der Ausdehnung, Menger 1,75),
  Raymarching mit Schrittfaktor 0,75–1,0, Treffer bei Abstand < k · Pixelkegel (Bewegung k = 1,0–1,6, Ruhebild 0,5).
  Strahlen, deren Schritte aufgebraucht sind (streifender Blick), werden als ferne, dunstige Fläche gezeichnet, nicht als Loch.
- Mandelbulb-Distanzschätzung 0,5·r·ln r / dr, Triplex-Potenz; **Exponent 8 als Polynom ohne Winkelfunktionen** (nach
  I. Quilez, gegen die Winkel-Form in JS auf 6 Stellen geprüft) – Bewegungsbild ~2× schneller.
- **Taylor-Anker** (nur Mandelbulb): P0 = Oberflächenpunkt in der Bildmitte (in f32 darstellbar), F(P0), Jacobi J und
  Hesse-Matrizen H_k in JS per Differenzen in f64; im Shader innerhalb |δ| < 6·10⁻⁴: w₁ = F(P0) + J·δ + ½ δᵀH_kδ, c = P0 + δ,
  dr₁ aus |P0|. Die Rundung der Position (≈ 6·10⁻⁸) fällt weg; es bleibt die Rundung von w₁ geteilt durch |F′| ≈ 4·10⁻⁹.
- Normale per Tetraeder (Schrittweite 0,6 Pixelkegel), weicher Schatten (Penumbra, Reichweite relativ zur Szene), AO mit
  4–6 Proben entlang der Normale, Glanz (Blinn), Fresnel; Orbit-Trap (min |x|, |y|, |z|, |w|²) → Paletten-Index.
- Drei Ausgaben (RGBA16F): diffuses Licht (RGB) + Index × Deckung, Zusatzlicht (Glanz, Rand, Himmel/Nebel) + Metallglanz,
  Leuchten/Halo/Deckung. **Die Palette kommt erst im Post-Pass** → Farbanimation und Palettenwechsel ohne neues Marschieren,
  Mittelung bleibt linear.

**Bewegung und Ruhebild:**
- Bewegungsbild in Skala 0,22–0,85 der Canvas-Auflösung (je Stufe), Skala folgt der Bildrate; weiche Schatten mit 5–12
  großen Schritten, 2–3 AO-Proben (ohne Schatten war das Bewegungsbild sichtbar heller als das Ruhebild).
- Stillstand: volle Auflösung, Subpixel-Versatz (Halton 2/3), wechselnde AO-/Schatten-Proben, Linsenpunkte bei
  Tiefenunschärfe, Gewicht 1/(k+1) per Konstant-Blending. In Streifen über App-Bilder verteilt; **Streifenhöhe über
  GPU-Fences** (ist der Streifen des letzten Bilds fertig → mehr, sonst weniger und ein Bild Pause) – unabhängig von der
  Bildrate des Browsers. Zahl der Durchgänge: so viele, dass das Bild nach ≈ 2,5 s fertig ist (6 … 6/12/24 je Stufe).

**Kamera und Gesten (f64 in JS):** Orbit um den Drehpunkt (Übersicht: Ursprung, nah: Oberfläche in der Bildmitte), Pinch
bewegt die Kamera auf den Punkt unter den Fingern zu (bleibt an seiner Bildstelle), Doppeltipp fliegt mit Blickdrehung
hin, Mausrad zum Mauszeiger, Kollision (Mindestabstand aus der Pixelgröße), Zoomzahl = Abstand der Startansicht /
Distanzschätzung an der Kamera. Antippen, Zoom und Flug nutzen dieselbe Distanzschätzung in JS wie das Ruhebild.

**Flug:** Zielpunkt auf der Oberfläche, Abstand schrumpft um das Tempo (Zehnerpotenzen/s) – endloser Zoom; Sonde 5×5 Strahlen
um die Bildmitte, Wertung nach Rauheit (Tiefensprünge zu den Nachbarn), Strukturdichte, Mitte (Hysterese); Schrägsicht
~30° zur Normale, Kollision 12 % des Zielabstands. Die erste Fassung (3×3-Sonde nach Schrittzahl, 30 % Kollision) landete in
glatten „Sahne“-Zonen und verlor Zoom durch Ausweichen (10 → 33 → 14× in 20 s); jetzt 25 s → 8,6·10³. Rückwärts auf dem
aufgezeichneten Weg (je 1/100 Zehnerpotenz), sonst vom Ziel weg bis „Ganz draußen“.

**Etappe 7:** Mandelbox (Kastenfaltung, Kugelfaltung r²<0,25/r²<1, Skalierung s, Abstand |z|/|dr|), Menger-Schwamm
(Würfel minus Kreuze je Stufe). Ohne Taylor-Anker; Zoomgrenze per Pixelgröße (×12 bzw. ×8 gegenüber dem Mandelbulb).
Ausdehnung der Mandelbox hängt von s ab (s = 2: Würfel ±6, Ecke 10,4; s = −1,5: ±3,5) – die erste Fassung schnitt den
Würfel mit einer zu kleinen Kugel ab (Bild: Kugel mit Muster); jetzt per Abtastung aus 14 Richtungen.

**Rückfall:** ohne `EXT_color_buffer_float` oder bei Übersetzungsfehler das einfache Bild bis 6.9 (`presentBulb`), Hinweis
„Grafikfehler …“, Drehen/Zoomen/Screenshot gehen weiter (`test_shader_fail` Fall g). `?bulb=0` erzwingt es (Vergleich).

## Messung

`tests/measure_bulb.py`, M1 (echte GPU), Pixel-7-Ansicht, **Profil Mittelklasse-Android wie 6.7: CPU ×4 + 4 Kerne, DPR 2,6**,
sichtbares Fenster, Stufe Ausgewogen. Die GPU des Macs lässt sich nicht drosseln – `?bulbslow=4` rechnet jeden Marsch-Pass
4× (≈ 4× langsamere GPU). Rohdaten `tests/results_bulb_v700a_{hoch,quer}.json`.

| | hoch | quer | hoch, GPU ×4 | quer, GPU ×4 |
|---|---|---|---|---|
| Drehen Gesamtansicht (Bilder/s, p95 ms) | 60,0 / 18,1 | 60,0 / 18,1 | 56,9 / 31,3 | 56,5 / 33,2 |
| Drehen nah (~300×) | 48,7 / 33,5 | 49,8 / 33,5 | 47,0 / 33,8 | 46,6 / 34,0 |
| Flug 12 s (Bilder/s, erreichter Zoom) | 51,5 / 918× | 50,2 / 2848× | 47,5 / 455× | 42,8 / 1293× |
| Skala Bewegungsbild (nah / Flug) | 0,69 / 0,33 | 0,70 / 0,28 | 0,35 / 0,31 | 0,36 / 0,28 |
| Ruhebild: erstes / fertig (s), Durchgänge | 0,21 / 0,59, 12 (nah 0,25 / 2,05) | 0,13 / 0,58 (nah 0,31 / 1,56) | 0,32 / 2,29 (nah 1,39 / 7,43, 6) | 1,16 / 2,50 (nah 0,89 / 4,68, 6) |

GPU-Zeit (Timer-Query, M1, Streuung hoch): Bewegungsbild Gesamt 7,4 ms bei 577×1175 Pixeln, nah ~13–49 ms (Taktverhalten),
ein Ruhebild-Durchgang 31 ms (Gesamt) bzw. 140–190 ms (nah, 824×1678). Vor der Optimierung (Winkel-Form, mehr Schritte,
Schatten im Bewegungsbild): nah, Skala 0,5: 42 ms → danach 15 ms.

**Einordnung:** Auf einer Mittelklasse-GPU (etwa 4–8× langsamer als der M1) sinkt die Auflösung des Bewegungsbilds bis zur
Untergrenze 0,22 (Ausgewogen) – die Bildrate bleibt ≥ 30, das Bewegungsbild wird weicher; das Ruhebild braucht dort länger
(mit weniger Durchgängen). Ob 0,22 auf Peters Handy reicht, zeigt erst eine Messung am Gerät (`__fraktal.BULB.info()` zeigt
Skala, Durchgänge, Streifenhöhe).

## Prüfung

- `tests/test_v70.py` (neu): Start + Ruhebild trotz Farbanimation, Zoom 3,7·10⁴ mit Anker, Grenze (Hinweis, Abstand ≥
  Mindestabstand), Taste R, Flug (Zoom steigt, Pause, Vollbild-/Größenwechsel, Rückflug bis „Ganz draußen“), Link b= exakt
  (4,8·10⁻¹³), alter Link 6.9, Ort-Rundflug exakt (4,3·10⁻¹³), Langdruck Julia-Bulb, Fokus per Tipp – PASS.
- `tests/test_shot.py`: Naht Mandelbulb 15 Kacheln gegen ein Stück 0 abweichende Werte (zuerst 107 176 – das Rauschen für
  AO/Schatten hing an Kachel- statt Bildkoordinaten).
- `tests/test_shader_fail.py` Fall g (Marsch-Shader defekt) – PASS; `test_fly2d` (✈ im Mandelbulb jetzt vorhanden), `test_v69`
  (Außen im Mandelbulb wählbar) angepasst.
- Bilder (`tests/shots/v70/`, selbst angesehen): `blatt_hoch.jpg`, `blatt_quer.jpg` (Gesamt, Zoom 10²/10⁴, Stile, Außen,
  Exponent 4/12, Julia-Bulb, Tiefenunschärfe, Mandelbox s = 2/−1,5, Menger), `vergleich_{hoch,quer}.jpg` (6.9 / 7.0),
  `praezision_*.png` (mit/ohne Anker). Skript `tests/shots_v70.py`.
- Vollständige Testsuite `tests/run_all.sh` (31 Gruppen, 24:45 min): 28 grün; `test_v63` (eine Long Task beim 3D-Start), `test_v64`
  (GPU-Werte der Bunt-Variante einmal falsch gelesen) und `test_rueck` (Tastentempo) im Gesamtlauf rot, danach einzeln alle drei
  grün – Ausreißer durch Last im langen Lauf, nicht durch 7.0 (die drei Tests berühren den Mandelbulb nicht).

## Grenzen / offen

- Zoomgrenze Mandelbulb ≈ 8·10⁴ (float32 + Anker); darüber bräuchte es doppelte Genauigkeit in der ganzen Iteration.
  Mandelbox ohne Anker früher (~10³–10⁴ je nach Stelle).
- Der Mandelbulb hat bei Exponent 8 glatte, „verschmierte“ Zonen (Äquator) – das ist seine Geometrie; der Flug meidet sie über
  die Rauheits-Sonde, Doppeltipp dorthin zeigt sie.
- Bewegungsbild auf schwachen GPUs weicher (adaptive Auflösung); TAA wie in 6.7 wurde nicht übertragen.
- Messung am echten Mittelklasse-Handy steht aus (GPU nicht simulierbar außer per `?bulbslow`).
