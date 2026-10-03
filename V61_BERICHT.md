# Fraktal-Explorer 6.1.0 – Bericht „Menge und Ufer glatt wie in YouTube-Zoomvideos“

Datum 03.10.2026. Auftrag: Peters Wunsch vom 02.10. („die innere Menge ist ein Pixelhaufen – bitte wie die
vorgerenderten Zoom-Runs auf YouTube“), Standard an, abschaltbar; Deep-Zoom-Rechnung exakt, nahtloser Bildaufbau
(5.1) und 3D (6.0) nicht schlechter.

**Hinweis für Peter:** Die App ist eine PWA – einmal ganz schließen und neu öffnen (bzw. Seite neu laden), dann steht
unter „Mehr“ 6.1.0. Dort gibt es zwei neue Schalter, beide an: **„Menge glatt (wie Video)“** und **„Glatte Kanten
(wie Video)“**. Zum direkten Vergleich mit vorher: Adresse mit `?aa=0` öffnen (= Verhalten 6.0.0).

![Seepferdchen-Tal 300×, links 6.0, rechts 6.1](tests/shots/smooth/sheets/vergleich_hoch_seepferd_300_2d.jpg)

## 1. Kurzfassung

- **Die Menge ist jetzt eine geschlossene, ruhige schwarze Fläche mit glattem, kantengeglättetem Rand** – wie in den
  Video-Renderern (Kalles Fraktaler & Co.). Technik: Distanzschätzung. Punkte, die mathematisch zwar außerhalb liegen,
  aber näher als etwa ein Pixel an der Menge, bekommen die Mengenfarbe (weicher Saum über ein Pixel). Genau diese
  Punkte waren der „Pixelhaufen“: ihre Fluchtzeiten springen von Pixel zu Pixel, die Palette macht daraus Zufallsfarben.
- Das funktioniert **bei jeder Iterationszahl**; die Form kommt aus der hohen Iteration, nichts wird fälschlich schwarz
  gerechnet. Die Rechnung selbst (Iterationspuffer) ist bitgenau wie vorher, alle Wahrheitstests liefern dieselben Werte.
- **3D:** Ufer und Minibrot-Plateaus rund und glatt, keine Klötze/Facetten an den Steilwänden, Kanten geglättet; der
  See bleibt glatt und spiegelnd. Im Stillstand wird das 3D-Bild in voller Auflösung 8× leicht versetzt gezeichnet und
  gemittelt (≈ 0,25 s), danach ruht die GPU.
- Gemessen (Pixel-7-Ansicht, gegen eine 16× überabgetastete exakte Referenz): Seepferdchen bei 3000 Iterationen
  **Farbsprünge 16,7 % → 1,3 %**, Abweichung 17,4 → 0,8; Randpunkt 10⁹ **33 % → 3,7 %**, 32,7 → 1,6; Flimmern beim
  langsamen Schwenk 20,9 → 4,1.
- Kosten: Vorschau-Rechnung in Bewegung +12–20 % GPU-Zeit pro Pixel im Deep Zoom (die bestehende Regelung hält die
  Bildrate), 3D-Bild in Bewegung +4 %, fertiges Bild gleich schnell; 1 Byte mehr Speicher pro Pixel.

## 2. Was „pixelig“ war – Messung vor dem Bau

Hermes' Messung (`noise_probe.js`, f64) wurde am App-Bild nachgeprüft (`tests/measure_smooth.py`, Canvas-Pixel des
fertigen Bildes, Ausschnitt 512×512 aus der Bildmitte, Pixel 7 hoch, Canvas 824×1678, Farbzyklus eingefroren).
Die Referenz (`tests/ref_render.js`) rechnet dieselbe Ansicht in f64 mit exakt derselben Färbung wie der Display-Pass;
Probe aufs Exempel: 1-Stichprobe-Referenz gegen App-Bild 6.0 = 0,00 mittlere Abweichung (Ganz, Seepferdchen) – die
Referenz bildet die App also pixelgenau nach. „Farbsprung“ = waagrecht benachbarte, nicht mengenfarbene Pixel mit
> 96 Abstand in einem Farbkanal.

| Ansicht (6.0.0) | Iter. | Farbsprünge | Abw. zur 16×-Referenz (Ø ΔRGB / Anteil > 30) | DE < 0,5 px (Referenz) |
|---|---|---|---|---|
| Ganz 1× | 300 | 13,0 % | 3,6 / 4,3 % | 4,6 % |
| Seepferdchen 300× | 307 (auto) | 12,3 % | 16,9 / 19,9 % | 18,5 % |
| Seepferdchen 300× | 3000 | 16,7 % | 17,4 / 21,2 % | 23,5 % |
| Minibrot 3·10⁶ | 2097 | 1,8 % | 1,1 / 1,3 % | 1,8 % |
| Randpunkt 10⁹ | 4050 | 33,3 % | 32,7 / 40,1 % | 45,0 % |

Deutung wie im Auftrag: Mehr Iterationen = mehr „Rand-Punkte“, die als Zufallsfarbe erscheinen. Supersampling allein
hilft nicht – die 16×-Referenz macht daraus nur graues Mittel (siehe `tests/shots/smooth/`), die Farbsprünge sinken
dort auf 4–8 %.

**Iterationszahl (Auftrag Punkt 4)** – geprüft mit derselben Distanzschätzung (f64, 412×900): Der Anteil
„Menge + Saum“ ist von der Iterationszahl praktisch unabhängig:

| Ansicht | 300 | 600 | 1000 | 2000 | 5000 | 30 000 Iterationen |
|---|---|---|---|---|---|---|
| Ganz 1× | 34,30 % | 34,30 | 34,30 | 34,30 | 34,30 | 34,30 |
| Seepferdchen 300× | 53,23 % | 53,22 | 53,22 | 53,22 | 53,22 | 53,22 |
| Zoom 10³ | 23,07 % | 23,07 | 23,07 | 23,07 | 23,07 | 23,07 |

Die Punkte, die bei 300 Iterationen fälschlich als innen gelten, liegen alle innerhalb des Saums – mit
Distanzschätzung ist der Rand bei 300 Iterationen nicht mehr „pelzig“. **Entscheidung: autoIter bleibt wie 6.0** (mehr
Iterationen würden nur Rechenzeit und Akku kosten). Wer „Menge glatt“ ausschaltet, hat das 6.0-Verhalten.

## 3. Umsetzung

### 3.1 Distanzschätzung als zweiter Kanal (2D + 3D, GPU + CPU)
- `js/shaders.js` (computeFS): Die Ableitung `Dt = dz/dPixel` läuft in allen Rechenpässen mit (der finale Pass mit
  Fehlerschätzung hatte sie schon). Rebase lässt sie unverändert (z selbst springt nicht), BLA-Sprünge rechnen
  `Dt' = A·Dt + B·Pixel`. Ohne Fehlerschätzung wird `Dt` gegen f32-Überlauf umskaliert (log2-Versatz). Julia: Start
  `Dt = Pixel`, z³: `3z²·Dt`. Burning Ship/Tricorn: Betrag wie holomorph (die Faltungen ändern Beträge nicht) – gut
  genug für die Färbung. Newton: keine Menge, keine Schätzung.
- `DE = |z|·ln|z| / |Dt|` = Abstand zur Menge in Pufferpixeln, gespeichert als log2 in **8 bit** (Stufe 1/16 Oktave =
  4,4 %, Bereich 1/256 bis 245 Pixel) in einer **R8-Textur als zweitem Farbanhang** (MRT) jedes Rechenpuffers. Der
  R32UI-Iterationspuffer bleibt bitgenau – geprüft: `readFront` mit und ohne Distanzschätzung identisch, Wahrheitstests
  GPU + CPU an allen 16 Ansichten mit identischen okPct/maxDiff-Werten wie 6.0.
- CPU-Pfad (`js/fractal-core.js`, `js/tile-worker.js`): dieselbe Ableitung in f64 (Überlaufschutz 2⁵¹²), Kacheln
  liefern den DE-Kanal mit. Die f64-Nachrechnung unsicherer Pixel ändert nur den Iterationskanal (Streuen mit
  `drawBuffers([ATT0, NONE])`), die GPU-Schätzung bleibt – für die Färbung genau genug.
- Genauigkeit (test_smooth, je 200–300 Stichproben gegen f64): Median der Abweichung **0,015 Oktaven** (GPU direkt),
  **0,017** (GPU-Perturbation 10⁹ mit BLA), **0,016** (CPU-Pfad) – also ~1 %, kleiner als die 8-bit-Stufe.
- **Speicher:** 5 statt 4 Byte pro Pufferpixel (+25 %). Pixel 7 (824×1678): Vollbild-Ebene 6,9 statt 5,5 MB; das
  Pool-Budget (40 MB Handy) bleibt, es passen etwas weniger Reserve-Ebenen hinein (Test: „im Budget“ grün).

### 3.2 Färbung (Display-Pass)
Pro Bildschirmpixel wird die Distanz der 4 Nachbartexel bilinear interpoliert (innen = 0) und in Zielpixel
umgerechnet; Mengen-Anteil = 1 − smoothstep(0,25 px, 1,25 px). Das ergibt eine geschlossene Fläche mit
kantengeglätteter Kontur – auch bei vergrößerten Vorschauen (die Kontur wird wie eine Signed-Distance-Schrift
rekonstruiert statt texelweise). Saumbreite per `?dew=` (Standard 1, nur 2D; 3D nutzt den Saum aus der Höhentextur). Die Paletten-Optik draußen bleibt
unverändert: Mit Saum ändert sich die Farbe außerhalb höchstens um ~0,1 Palettenperiode pro Pixel (|∇μ| ≤ 1,44/px bei
DE ≥ 1 px); eine logarithmische „Beruhigung“ war damit nicht mehr nötig (Farbsprünge schon < 5 %).

### 3.3 Supersampling „wie YouTube“ (Auftrag Punkt 3) – Entscheidung nach Messung
- **2D:** Nach 1 + 2 liegt das 1-Stichproben-Bild nur noch 0,2–2,0 (Ø ΔRGB) von der 16×-Referenz entfernt, Anteil
  Pixel > 30: 0,05–0,9 %. Zeitliche Mittelung würde kaum noch etwas sehen lassen, kostet aber pro Ansicht 8–16
  Vollbild-Rechnungen (bei 10¹⁴ ≈ 1 s je Bild) und funktioniert mit dem Farbzyklus (Standard an) nicht: Mittelwerte
  von Farben lassen sich nicht weiter rotieren. **Darum in 2D keine Mittelung.**
- **3D:** Hier lohnt sie sich (Silhouetten, Felsflächen, 65-%-Auflösung beim Handy). Im Stillstand (120 ms ohne
  Änderung) wird das 3D-Bild **in voller Canvas-Auflösung** mit Subpixel-Versatz (Halton 2,3) gezeichnet und gleitend
  gemittelt – 8 Bilder (Akku-Stufe 4, `?aa=N`), danach zeichnet die App nichts mehr (test_smooth: 4 Zeichenaufrufe in
  1,5 s = nur die 48×48-Sonde). Mit Farbanimation wird weiter gemittelt, aber nur jedes zweite Bild. Wechsel aus der
  Bewegung: das letzte Bewegungsbild wird über 4 Bilder ausgeblendet (kein harter Sprung). Kommt im Stillstand eine
  vorausgerechnete Ebene dazu, wird mit dem bisherigen Bild als erstem Beitrag weitergemittelt (kein kurzes
  Aufflackern ungeglätteter Kanten). MSAA wurde verworfen: es glättet nur Dreieckskanten, nicht die Treppen in Farbe
  und Wassermaske.
- „Fertig glatt“: 2D sofort mit dem fertigen Bild (keine zusätzliche Zeit); 3D ≈ 120 ms + 8 Bilder ≈ 0,25 s bei
  60 Hz (headless mit ~5 fps Bildtakt: ~1,8 s).

### 3.4 3D-Ufer
Befund am 6.0-Bild (Ausschnitte, Hermes' Screenshots): die „Zähne“ an Plateaus sind Treppen der 65-%-Auflösung plus
Farb-Glitzer; „Vorhänge/Klötze“ sind Dreiecks-Facetten der Felsfarbe (Steilheit aus der Dreiecksnormale) und Wasser
pro Gitterpunkt.
- **Mengen-Anteil pro Pixel:** Die Höhentextur (halbe Auflösung, jetzt RGBA16F bzw. RGBA8) bekommt einen B-Kanal
  „Menge inkl. Saum“ aus der Distanzschätzung; er kommt **aus derselben Texturabfrage wie die Lichtnormale** (keine
  zusätzliche Abfrage). Farbe: Außenfarben nur untereinander interpoliert, die Menge (Seefarbe) pro Pixel darüber –
  keine texelweise Treppe mehr. Wasser: Innen-Anteil pro Pixel statt pro Gitterpunkt, an fast senkrechten Wänden kein
  Wasser (dort Fels).
- **Fels ohne Facetten:** Steilheit aus einer pro Gitterpunkt berechneten Flächennormale derselben Höhenfunktion
  (inkl. Absenkung zum See), über die Dreiecke interpoliert; Schichtung gröber/schwächer (das feine Muster flimmerte an
  den nun glatten Wänden).
- **Verworfen (gebaut, angesehen, zurückgenommen):** (a) Höhe am Rand per Distanzschätzung auf die Innenhöhe rampen –
  macht jedes Filament zur senkrechten Wand; (b) Saum auch in der Geometrie/Seemaske – dichte Zonen wurden in der Ferne
  zu Seen; (c) Saum fest in Bildschirmpixeln auch in der Ferne – ganze Uferhänge wurden mengenfarben bzw. Wasser
  (jetzt höchstens ein Texel); (d) Wasser schon ab 65° Hangneigung weglassen – der Gesamtbild-See ist eine Schüssel und
  verlor seine Spiegelung (jetzt erst ab ~80°); (e) Distanz-Abfragen pro Ebene im Farbpass – +15–35 % Bildzeit, ersetzt
  durch den B-Kanal (+4 %).
- Gitter wurde nicht verfeinert: mit glatter Normale und Pixel-Maske sind keine Gitterstufen mehr zu sehen, und mehr
  Gitterpunkte kosten auf dem Handy am meisten.

## 4. Messungen (vorher 6.0.0 → nachher 6.1.0)

Apple M1, Chromium headless mit echter GPU (ANGLE/Metal), Pixel-7-Ansicht 412×839 CSS, Canvas 824×1678.
Rohdaten: `tests/shots/smooth/v600|v610/results.json`, `tests/results_bench_smooth.json`, `tests/results_bench3d_ab.json`.

### 4.1 2D – Abweichung zur 16×-Referenz und Farbsprünge (Ausschnitt 512²)

| Ansicht | Iter. | Ø ΔRGB | Anteil > 30 | Farbsprünge (Referenz 16×) | dunkle Fläche App / Referenz |
|---|---|---|---|---|---|
| Ganz 1× | 300 | 3,62 → **0,27** | 4,3 % → **0,06 %** | 13,0 % → **1,6 %** (1,9 %) | 82,0 / 81,9 % |
| Seepferdchen 300× | 307 | 16,93 → **1,99** | 19,9 % → **0,9 %** | 12,3 % → **1,4 %** (1,5 %) | 29,6 / 29,9 % |
| Seepferdchen 300× | 3000 | 17,38 → **0,77** | 21,2 % → **0,1 %** | 16,7 % → **1,3 %** (1,5 %) | 30,4 / 29,9 % |
| Minibrot 3·10⁶ | 2097 | 1,08 → **0,21** | 1,3 % → **0,05 %** | 1,8 % → **0,4 %** (0,6 %) | 35,1 / 34,9 % |
| Randpunkt 10⁹ | 4050 | 32,69 → **1,55** | 40,1 % → **0,2 %** | 33,3 % → **3,7 %** (4,3 %) | 51,1 / 50,1 % |

Die Referenz für 6.1 nutzt dieselbe Regel (Saum in Ausgabepixeln) bei 16 Stichproben pro Pixel. Die dunkle Fläche
des App-Bilds stimmt mit ihr überein (± 1 %) – die Menge ist **nicht aufgebläht**, die Kontur stammt aus der
vollen Iteration. Seepferdchen 300 und 3000 Iterationen sehen jetzt gleich ruhig aus (29,6 / 30,4 % dunkel).

**Flimmern beim langsamen Schwenk** (Seepferdchen-Tal, 8 Schritte à ¼ Pixel, fertige Bilder, Ø ΔRGB Bild zu Bild):
20,9 → **4,1**, Anteil Pixel > 30: 16,8 % → **2,7 %**.

### 4.2 3D (Neigung 45°, Drehung 0,4)

| Ansicht | Flimmern bei Drehung um 0,002 rad (Ø ΔRGB) | Abweichung zur 48×-Referenz¹: Bewegungsbild → Stillbild 6.1 |
|---|---|---|
| Ganz 1× | 0,75 → **0,53** | 0,25 → 0,26 (Anteil > 30: 0,05 % → 0 %) |
| Seepferdchen 300× | 7,17 → **3,08** | 1,51 → **0,63** (0,36 % → 0,03 %) |
| Minibrot 3·10⁶ | 1,98 → **1,43** | 0,90 → **0,66** (0,19 % → 0,02 %) |
| Randpunkt 10⁹ | 13,38 → **5,81** | 2,55 → **0,94** (0,92 % → 0,13 %) |

¹ Referenz in derselben Sitzung und Szene: 48 versetzte Bilder in doppelter Auflösung (`settle3d({N:48, scale:2})`),
Nahbereich (untere zwei Drittel). „Bewegungsbild“ = 65 % Auflösung ohne Mittelung – so zeigte 6.0 auch den
Stillstand. Der direkte 6.0-Vergleich gegen diese Referenz ist nicht fair (andere Färbung), daher dieser Vergleich.
Die Wassermaske hat dieselbe Fläche wie 6.0 (Ganz 8,65 → 8,62 %, Seepferdchen 12,0 → 12,7 %): der See bleibt See.

Eine reine Masken-Kennzahl für „Zackigkeit“ (Konturlänge fein/geglättet, Richtungsabweichung) wurde gebaut und
verworfen: sie wertet echte Fraktal-Details am nun pixelgenauen Ufer genauso wie Treppen (6.0s weich
interpolierte Gitterpunkt-Maske schneidet dabei „besser“ ab, obwohl sie ungenau ist). Belastbar sind die Referenz-
Abweichung und die Ausschnitte: `tests/shots/smooth/sheets/vergleich_*_3d.jpg` (links 6.0, rechts 6.1).

### 4.3 Kosten

| | 6.0 | 6.1 |
|---|---|---|
| Vorschau 1/4 bzw. 1/2 Auflösung, Perturbation (Zoom > 10³; GPU, synchron gemessen) | 100 % | +12 … +20 % |
| Vorschau, direkte f32-Rechnung (Zoom < 10³, absolut klein: 0,9–3,6 ms) | 100 % | +7 … +40 % |
| fertiges Bild (mit Fehlerschätzung) | 100 % | ±0 (die Ableitung lief schon mit) |
| Display-Pass 2D (Wanduhr, 40 Bilder) | 0,07–0,085 ms | 0,08–0,097 ms (+10–15 %) |
| 3D-Bild in Bewegung (65 %, gleiche Szene, Wanduhr, Minimum aus 10×20) | 3,13–3,99 ms | 3,27–4,16 ms (**+4 %**) |
| 3D-Stillbild (volle Auflösung, je Bild, 8× dann Ruhe) | – | 6,2–7,6 ms |
| Speicher | 4 B/Pufferpixel | 5 B/Pufferpixel; 3D: Höhentextur ×2, Stillstands-Ziele +16,5 MB (beim Verlassen von 3D frei) |

Timer-Queries (`benchGPU`) streuten unter ANGLE/Metal um ±15 % und zählten eingereihte Hintergrundarbeit mit (eine
248×504-Vorschau „dauerte“ so lange wie ein Vollbild, der Display-Pass „1,1–1,8 ms“ statt 0,08 ms). Gemessen wurde daher synchron: Warteschlange per `readPixels`
leeren, rechnen, per `readPixels` auf das Ergebnis warten (`benchCompute`, `tests/bench_smooth.py`,
`tests/bench3d_ab.py`). `gl.finish()` blockiert in Chrome nicht.
Einschätzung Mittelklasse-Android: dieselben Verhältnisse; die Vorschau-Regelung aus 5.0/5.1 hält in Bewegung die
Bildrate und wählt notfalls eine Stufe gröbere Vorschau, die 3D-Regelung senkt die Bewegungsauflösung. Auf einem echten
Mittelklasse-Gerät **nicht gemessen**.

**Bildrate im sichtbaren Fenster** (M1, Chromium mit Fenster – headless liefert rAF nur mit ~15 fps):
| | 6.0.0 | 6.1.0 |
|---|---|---|
| Pinch 10³ → 10⁹ in 6 s (`measure_blend.py --headed`) | 66 fps, grobe Frames 5,3 % | 64 fps, grobe Frames 8,3 % |
| Schwenk bei 10⁷, 6 s | 67 fps, grobe Frames 18,2 % | 67 fps, grobe Frames 15,3 % |
| 3D drehen + neigen, 4 s (Seepferdchen / Randpunkt 10⁹) | 60,0 / 60,1 fps, längstes Bild 18,8 ms | 60,2 / 60,1 fps, längstes Bild 19,2 / 18,8 ms |

### 4.4 Nahtloser Bildaufbau (5.1) unverändert
`tests/measure_blend.py` (pinch, pan, tour, dtap): **0 harte Wechsel** in allen Fahrten, 0 Long Tasks
(`tests/results_blend_v610.json`); `tests/test_blend.py` grün. Tempo-Bremse, Vorausrechnen, Pufferbudget unverändert.

## 5. Tests

`tests/run_all.sh` komplett grün (Node-Kern, Release/PWA/offline, Wahrheit GPU + CPU mit identischen Werten zu 6.0,
Gesten, UI, Funktionen, Bildaufbau, 3D) plus neu **`tests/test_smooth.py`**: Farbsprünge Seepferdchen/3000 Iter.
1,3 % (< 5 %), mit Schalter aus 16,7 % (A/B funktioniert); Distanzschätzung GPU direkt / Perturbation / CPU gegen f64
(Median 0,015 / 0,017 / 0,016 Oktaven); Iterationspuffer mit/ohne Glättung identisch; 3D-Mittelung 8/8 Bilder, danach
GPU-Ruhe; Akku-Stufe 4 Bilder; `?aa=0` = 6.0; iPhone-Ersatzpfad ohne Float-Renderziel (8-bit-Höhen) im Querformat mit
3D und Glättung, 0 Fehler. Screenshots hoch + quer, 2D + 3D, inkl. Julia und Burning Ship: `tests/shots_smooth.py`,
Vergleichsblätter `tests/shots/smooth/sheets/` – selbst gesichtet: 2D wirkt wie ein vorgerenderter Deep-Zoom
(geschlossene schwarze Menge, glatter Rand, ruhige Filamente); 3D: runde Plateaus, glatte Felswände, scharfe Kanten,
spiegelnder See; dichte Gebirgszonen sind jetzt ruhig dunkel statt glitzernd.

**Fund unterwegs (nur Test-Hook betroffen):** `readBuffer(COLOR_ATTACHMENT1)` am Rechenpuffer (zum Auslesen des
DE-Kanals) ließ unter ANGLE/Metal spätere Schreibzugriffe auf dessen Iterationskanal ins Leere laufen – ein später
wiederverwendeter Puffer enthielt dann alte Werte. Der Test-Hook liest jetzt über einen eigenen Hilfs-Framebuffer; der
App-Betrieb benutzt `readBuffer` nicht. Regel für künftige Arbeit: an MRT-Framebuffern nie den Lesepuffer umschalten.

## 6. Grenzen / offen
- 3D wirkt in sehr dichten Zonen dunkler als 6.0 (Mengenfarbe statt Glitzer) – das ist die gewünschte Ruhe, aber eine
  Geschmacksfrage. Alternative, falls Peter das Glitzern in 3D vermisst: Saum nur in 2D (eine Zeile, `u_smooth`-Zweig).
- Burning Ship/Tricorn: Distanz nur genähert (Betrag wie holomorph) – sieht sauber aus, ist aber keine strenge
  Schätzung. Newton: keine Menge, unverändert.
- Echtes Mittelklasse-Handy und iPhone-Safari nicht real gemessen (iPhone-Pfad als WebGL2 ohne Float-Renderziel
  emuliert und getestet).
- A/B-Regler: `?aa=0` (6.0.0), `?aa=N` (3D-Bilder im Stillstand), `?de=0` (nur Distanzschätzung aus), `?dew=W`
  (Saumbreite in Pixeln).
