# Vorbau `fraktale-v6-7-technik` (Leicht-Spur, 07.10.2026)

Branch: `vorbau/fraktale-v6-7-technik` (von `origin/main` 3bbf65e, 6.6.0). `main` ist unberührt, die Version steht weiter auf
**6.6.0** (Versionsnummer, Cache-Busting und Service-Worker-Version macht der Heavy-Job). Nichts davon lief in einem Browser.

## Kurzfassung für den Heavy-Job

1. **Vorher-Messung auf `main` zuerst** (vor dem Merge dieses Branches): `tests/measure_tech.py` aus diesem Branch nach
   `main` holen (`git show vorbau/fraktale-v6-7-technik:tests/measure_tech.py > tests/measure_tech.py`) – das Skript nutzt
   nur Hooks, die es in 6.6.0 schon gibt.
2. Dann den Branch übernehmen (Fast-Forward möglich, solange `main` nicht weiterläuft) und im Browser abnehmen: Abschnitt
   „Abnahme im Browser“ je Etappe unten.
3. Alles ist hinter URL-Reglern. Standard: alles an **außer TAA** (`?taa=1` schaltet TAA ein).

| Regler | Standard | Wirkung |
|---|---|---|
| `?tone=0` / `?tone=agx` | Neutral-Schulter an | 0 = Endpass exakt wie 6.6 (auch ohne Bloom); `agx` = AgX statt Neutral |
| `?bloom=0` | an (nicht in Akku) | nur der Bloom aus |
| `?scharf=0` | an | CAS-Nachschärfen beim Hochskalieren aus (linear wie 6.6) |
| `?hao=0` | an | Horizont-AO nicht übersetzt (Vertex-Shader wie 6.6) |
| `?detail=0` | an (nicht in Akku) | Detail-Normalen nicht übersetzt; Standard-Look braucht dann keine Rauschtextur |
| `?gpuwahl=0` | an | Gitterteiler nach Bildschirmgröße wie 6.6 (Handy 8, sonst 6), keine Timer-Queries |
| `?taa=1` | **aus** | TAA im Bewegungsbild + Flug-Renderskala 0,7 (`?taas=0.6` zum Abstimmen) |

Für den Pixelvergleich „wie 6.6“: `?tone=0&hao=0&detail=0&scharf=0&gpuwahl=0` (Schatten in „Ausgewogen“ sind ohnehin
bit-gleich; in Akku/Maximal ändern sich die Schattenschritte absichtlich – E4).

## Dateien

| Datei | Inhalt |
|---|---|
| `js/three-tech.js` (neu, in `index.html` vor `three.js`, im `sw.js`-Precache) | reine Funktionen: Regler, Stufentabelle, AO, Belichtung, Tonemapping (JS-Spiegel), CAS, Gitter aus GPU-Zeit, TAA-Mathe |
| `js/three.js` | Shader + Ablauf (Endpass, AO, Detail, Stufen-Uniforms, TAA-Pass, Bloom-Pässe, GPU-Messung, Rückfälle) |
| `js/app.js` | Regler `TECH` → `FK3D.create(R, TECH)`, `T3.setStage(S.quality)` je Bild, `T3.applyGrid()` beim 3D-Start, TAA-Flugskala, `bench3d` setzt `T3.benchBusy`, `__fraktal.TECH` |
| `tests/unit/tech3d.test.js` | 13 Tests der reinen Funktionen |
| `tests/unit/shader3d.test.js` + `glsl-lint.js` | alle 6 Gelände-Varianten × 5 Regler-Kombinationen + Hilfspässe durch einen kleinen GLSL-Prüfer (Präprozessor, Klammern, Uniforms/Varyings, unbekannte Funktionen, int-Literale in float-Funktionen) |
| `tests/unit/three-mock.test.js` + `webgl-mock.js` | ganzer 3D-Ablauf gegen einen nachgebildeten WebGL-Kontext: Laufzeitfehler, Rückkopplungen (Ziel-Textur auf Sampler), gelöschte Texturen, aktive Uniforms je Stufe, Gitter-Messung, Shader-Rückfälle |
| `tests/measure_tech.py` | E0/E5-Messung (nicht ausgeführt) |
| `tests/test_shader_fail.py` | neue Fälle (e), (f) (nicht ausgeführt) |

Geprüft: `node tests/unit/run.js` → **48 ok, 0 FAIL** (main: 23), `node tests/node_core_test.js` ALL PASS,
`python3 tools/check_release.py` PASS, `node --check` aller geänderten JS, `py_compile` der Python-Skripte.
Gegenproben: Der GLSL-Prüfer meldet eingebaute Tippfehler (unbekannte Funktion, undeklariertes Uniform, int-Literal,
Varying-Typ, Klammern); der Mock-Test meldet eingebaute Rückkopplungen (TAA liest/schreibt dieselbe History, Bloom A→A)
und den unten beschriebenen echten Fehler. **Kein echter GLSL-Compiler** (kein glslangValidator auf dem Mac): gemischte
`int`/`float`-Rechnung erkennt der Prüfer nicht – die neuen Zeilen habe ich dafür einzeln von Hand gegengelesen.

Ladegröße Code (html, css, translations, manifest, sw, js/*.js): 498,8 KB → 544,4 KB (**+45,6 KB**, Budget +100 KB).
Ein Großteil davon sind Kommentare.

---

## E0 Messung vorher – Skript fertig, NICHT ausgeführt

`tests/measure_tech.py`: Profil Mittelklasse-Android (Pixel 7, DPR 2,6, CPU ×4, 4 Kerne), hoch (`--land` = quer), je Stufe
eco/balanced/max die Szenen 2D-Zoom (goTo ×1000, 6 s), 3D-Stillstand (rAF 3 s + `bench3d(5, true)` / `bench3d(5, false)`)
und 3D-Flug 10 s (rAF + `bench3d(3)` am Ende + Zoomtiefe). Ausgabe p50/p95/max, fps, Bilder > 50 ms, GPU min/max,
Renderskala/Gitter (`T3.info()`), Ladegröße → `tests/results_tech_<tag>_<hoch|quer>_thr4.json`.
`--compare=a.json,b.json` druckt die Tabelle vorher/nachher. `--shots` (+ `--moods` nur ab 6.7) legt Standbilder nach
`tests/shots/technik/`.

Abnahme: `FK_HEADED=1 python3 tests/measure_tech.py --tag=vorher` und `--land` auf `main`, danach `--tag=nachher` auf dem
Branch. Risiko: `goTo` als „2D-Zoom“ ist ein Flug mit eigener Dauer – falls er vor 6 s endet, misst der Rest Stillstand
(`--zsecs` anpassen). `bench3d` zeichnet Zusatzbilder; die rAF-Werte des Flugs sind davon nicht betroffen (bench läuft danach).

## E1 Endpass – fertig (Code), Regler `?tone`, `?bloom`, `?scharf`

- **Tonemapping in `post()`** (Himmel + Gelände, also vor dem 8-bit-Ziel und vor der Stillstands-Mittelung): nach der
  Gamma-Anhebung von 6.6 → Belichtung × Farbstich nach Sonnenhöhe → Tonemapping → leichtes Split-Toning.
  `u_tone = 0` rechnet exakt wie 6.6 (Test prüft die Reihenfolge).
  - **Neutral-Schulter** (Standard): wie Khronos PBR Neutral, aber **ohne Fuß-Versatz** – die Farben von 6.6 sind bereits
    Anzeigewerte; der Fuß hätte alle Mitteltöne um 0,04 abgedunkelt. Unter dem Knie 0,7 unverändert, darüber C¹-stetig
    auf Weiß bei 1,6, sehr helle Werte entsättigen Richtung Weiß. Schnee 0,95/1,05/1,15/1,3 → deutlich verschiedene
    Werte statt alles 1,0 (Test). Werte: 0,8→0,778 · 1,0→0,867 · 1,2→0,922 · 1,4→0,964.
  - **AgX** (`?tone=agx`, Minimal-Polynom nach Wrensch): verändert auch die Mitteltöne (0,6→0,603, 1,0→0,787) – nur als
    Vergleich gedacht.
  - Belichtung `FK3DTech.exposure(el)` = 1 bei der Sonne von 6.6 (0,5 rad); tiefe Sonne heller + wärmer (`sunTint`).
    Die Sonne ist im Programm fest – darum gibt es die Test-Hooks `T3.sunEl` / `T3.sunAz` (Morgen 0,8/0,18, Mittag
    2,35/0,5, Abend 3,9/0,15 in `measure_tech.py --moods`).
- **Bloom** aus halber Auflösung: Vorfilter (4 bilineare Abgriffe = 4×4-Box, weiche Schwelle ab Anzeigewert 0,78) →
  Gauß waagrecht → senkrecht (je 5 bilineare Abgriffe), Screen-Mischung im Blit (brennt nicht aus). Stufe Akku: aus.
  Wird pro gezeichnetem Bild aus dem fertigen Quellbild gerechnet (Bewegung: fbo bzw. TAA-Ausgabe; Stillstand: Mittelung).
- **CAS** (AMD FidelityFX CAS vereinfacht) im Blit auf den Canvas: Schärfe nach Renderskala (`sharpForScale`: volle
  Auflösung 0,2; Skala 0,65 → 0,57; max. 0,8); auch das Bewegungsbild in der Stillstands-Überblendung (`mix2`) wird mit
  seiner Skala geschärft – sonst spränge die Schärfe beim Übergang.

**Abnahme im Browser:** Standbilder je Stimmung (Morgen/Mittag/Abend) mit `?tone=0` gegen Standard und `?tone=agx`,
Alpin-Look mit Schnee + Gletscher-Menge (Weiß) – Schnee muss Zeichnung haben, Mitteltöne sollen gleich bleiben.
Bloom: Sonnenhof/Schnee im Licht leicht, keine Halos um Kämme. CAS bei Skala 0,65 (Handy): keine Säume, kein Flimmern im
Flug. **Startwerte, nur am Bild abstimmbar (TODO):** `TONE_KNEE 0.7`, `TONE_WHITE 1.6`, `TONE_DESAT 0.15`,
`BLOOM {thr 0.78, k 0.12, spread 1.5}`, `sharpForScale` (0,2 / 0,3 + 0,5·(1/s − 1)), Split-Toning-Farben in `grade()`,
`exposure`/`sunTint`. Alle in `js/three-tech.js` bzw. `grade()` in `js/three.js`.
Risiko: In „Ausgewogen/Maximal“ wird der Weißbereich etwas dunkler (1,0 → 0,87) – falls Peter das als „grauer“ empfindet,
Knie auf 0,75 oder Weißpunkt auf 1,4 setzen.

## E2 Horizont-AO + Detail – fertig (Code), Regler `?hao`, `?detail`

- **Horizont-AO pro Gitterpunkt** (wie die Schatten, `#if HAO` im Vertex-Shader): je Richtung (fest in der Welt, 45°
  gedreht) der höchste Horizont aus `aoS` Höhenabfragen (Abstand 0,03·2,6^i, mindestens 1,5 Gitterzellen), **gemessen über
  der Tangentialebene** der Gitter-Normale – gleichmäßige Hänge bleiben unverändert (deren Himmelslicht steckt schon in
  n.z), nur Mulden/Täler/Rinnen werden dunkler; Kämme frei (Tests). Im Fragment-Shader dämpft AO das Himmelslicht voll und
  das direkte Licht zu 30 %; Schnee: Himmelslicht-Anteil. Stärke `AO_K = 0.9` (V-Tal Neigung 0,5 → 0,73; 0,8 → 0,56).
  Stufen: Akku 2 Richtungen × 2 Schritte, Ausgewogen/Maximal 4 × 3.
- **Detail-Normalen** (`#if DET`, nur Fragment-Shader): Steigung eines weltverankerten Rauschens in 3 Oktaven feiner
  als `wnoise` (gleiche Zoom-Überblendung sin²(π·t/3), Summe konstant), über die vorhandene Rauschtextur (`u_noise`,
  3 Abgriffe je Oktave, `textureGrad`). Zu feine Oktaven blenden über den Fußabdruck aus, zusätzlich mit dem Abstand
  (2…5 lokale Einheiten). Stärke: Fels 0,35, Boden 0,18, Schnee halb, Wasser 0. Akku: aus (`u_det = 0`).
  Folge: Mit `?detail` braucht **jede** Gelände-Variante die Rauschtextur (`t3noise` in `needs()`).
- **Fehler im ersten Vorbau-Stand gefunden und behoben:** `noiseUniforms` brach im Standard-Look früh ab (dort ist `u_noff`
  inaktiv) – `u_nfr`/`u_doff` der Detail-Normalen wären nie gesetzt worden. Jetzt `worldOffsets()`; der Mock-Test prüft es.

**Abnahme im Browser:** Tal mit AO an/aus (`?hao=0`) – Tiefe in Rinnen, keine dunklen Flecken auf Hängen, keine
Gitterfacetten (AO ist pro Gitterpunkt interpoliert). Tiefflug Detail an/aus (`?detail=0`): Fels nicht mehr glatt,
**kein Flimmern/Schwimmen beim Zoomen** (Oktaven-Überblendung), keine Kachelmuster. **Kosten:** Vertex-Shader in
Ausgewogen von 13 auf 25 Höhenabfragen je Gitterpunkt (+12 AO), Maximal 29 (Schatten 10 + AO 12), Akku 14 (Schatten 3 +
AO 4) – das ist der größte Kostenposten des Vorbaus. Reißt Ausgewogen das p95-Budget: zuerst `aoS` 3 → 2, dann
`aoN` 4 → 2 (Tabelle `STAGES` in `js/three-tech.js`). Detail: bis 9 Textur-Abgriffe je Pixel, nur im Nahbereich.
TODO am Bild: `AO_K`, Abstände (0,03 · 2,6^i), Detail-Stärken und Abstands-Ausblendung.

## E3 TAA – Gerüst fertig, Standard AUS (`?taa=1`)

- Bewegungsziel mit **Tiefen-Textur** (DEPTH_COMPONENT24, NEAREST), Bewegungsbilder mit Halton-Jitter (8er-Folge).
- TAA-Pass (`t3taa`) in Renderauflösung, History-Pingpong RGBA16F (ohne Float-Ziel RGBA8; Alpha = log-kodierter Abstand):
  Tiefe → Punkt in lokalen Einheiten → **lokale Einheiten des vorigen Bilds** (`P' = P·u/u' + (Fokus − Fokus')/u'`,
  Höhe bleibt – im Flug wechseln Zoom und Fokus jedes Bild) → vorige Kamera; Himmel nur über die Drehung.
  History bikubisch (Catmull-Rom, 5 Abgriffe), geklemmt auf Min/Max ∩ Mittel ± 1,25·σ der 3×3-Nachbarschaft;
  verworfen bei Abstandsabweichung > 10 % (Disocclusion), außerhalb des Bilds, Zoomsprung > √2, nach Stillstands-Bildern
  oder Größenwechsel. Gewicht des neuen Bilds 0,1 → 0,4 mit der Bewegung (2…24 px/Bild).
- Flug mit `?taa=1`: Renderskala höchstens 0,7 (`?taas=`), danach wird die Skala von vorher wiederhergestellt; die Deko
  zählt die TAA-Skala nicht als Drosselung.
- Reprojektions-Mathe als JS-Spiegel getestet (ruhende Kamera, Drehung + Zoom + Fokuswechsel, Himmel, Tiefen-Kodierung).

**Abnahme im Browser (K.-o.-Kriterium Ghosting):** 10-s-Flug mit `?taa=1` als Frame-Serie gegen `?taa=0` bei gleicher
Skala, Kanten der Kämme gegen den Himmel und am Horizont, schnelle Drehung, Zoomwechsel; die ersten Bilder nach einem
Stillstand (Reset: kurz gejittertes Rohbild). Fällt TAA durch, bleibt `?taa=0` Standard (ist es schon) und der Bericht
erklärt warum. **TODO am Bild:** `TAA {alpha 0.1, alphaMax 0.4, velLo 2, velHi 24, reject 0.1, gamma 1.25, flyScale 0.7}`.
Risiken: (1) Die Höhe eines Fraktalpunkts ändert sich im Flug leicht (Normierung `V3.L`/`cdf` gleitet nach) – die
10-%-Schwelle sollte das tragen, sonst `reject` erhöhen. (2) Wasser mit animierten Wellen/Spiegelung ist zeitlich
veränderlich – Clamp sollte Schlieren verhindern, ansehen. (3) Mit RGBA8-History (Gerät ohne Float-Ziel) kann die 0,1-Mischung
in dunklen Verläufen hängen bleiben.

## E4 Stufen + Gerätewahl – fertig (Code), Regler `?gpuwahl`

- **Schattenschritte je Stufe**: Akku 3, Ausgewogen 6, Maximal 10 bei **gleicher Reichweite** (Schrittweite
  0,024·1,95^(i·6/N)); Maximal mit weicherem Halbschatten (Härte 3,2 statt 5). Ausgewogen ist bit-gleich zu 6.6.
- **Gitterdichte aus der GPU-Zeit**: beim ersten 3D-Start eines Geräts misst eine Timer-Query nur den Gelände-Pass in
  6 Bewegungsbildern des Übergangs (mix > 0,3), Median → `gridDivFromGpu(ms, d0, Budget)` mit Modell
  `ms(d) = ms0·(0,4 + 0,6·(d0/d)²)`, halbe Schritte, Grenzen 5…12, Hysterese 1. Budget je Stufe: Akku 5 ms,
  Ausgewogen 7 ms, Maximal 10 ms (Startwerte, TODO aus Handy-Messung). Ergebnis (ms, d0) je GPU-Name + Bildgröße in
  `localStorage` (`fk3d_grid_v1`, max. 8 Geräte); der Teiler wird für die jeweilige Stufe daraus neu berechnet.
  Angewandt **nur während des Übergangs 2D→3D oder beim nächsten 3D-Start** (kein Geometriesprung im Stillstand).
  Ohne `EXT_disjoint_timer_query_webgl2` (auf vielen Android-Chromes nicht verfügbar!) bleibt die 6.6-Regel.
  Stufenwechsel wirkt beim nächsten 3D-Start. `bench3d` schaltet die Messung ab (Queries lassen sich nicht schachteln).

**Abnahme im Browser:** `__fraktal.T3.gridInfo()` nach dem ersten 3D-Start (state `done`, Teiler plausibel), zweiter
Start nutzt den gespeicherten Wert; Schatten Akku/Maximal am Bild (Akku darf gröber sein, keine Streifen). **Achtung bei
den bestehenden Messungen/Tests:** Auf dem M1 wird die Messung vermutlich ein feineres Gitter wählen (mehr Dreiecke) und
mitten im Übergang umschalten – für Pop-Metrik (`measure_blend.py`), Shader-Vergleich (`compare_3d_shader.py`) und
vorher/nachher-Vergleiche bei gleichem Gitter `?gpuwahl=0` setzen bzw. bewusst beides messen.

## Robustheit (Gutachten-Thema Shader-Fehler)

- TAA- oder Bloom-Programm scheitert → nur dieser Teil wird abgeschaltet, 3D läuft (`optionalOff`).
- Gelände-Variante mit AO/Detail scheitert → einmal ohne beides neu übersetzen (Programmnamen `…_66`), 3D läuft wie 6.6
  (`T3.info().fallback`). Scheitert auch das, wie bisher Toast + 3D aus.
- `T.reset()` (Kontextverlust) vergisst History, Bloom-Ziele und offene Queries; Timer-Erweiterung wird neu geholt.
- `freeStill()` (3D verlassen) gibt TAA-History und Bloom-Ziele frei (`test_memory3d.py` ansehen).

## Was der Heavy-Job im Browser konkret tun muss

1. E0 auf `main` messen (hoch + quer, `FK_HEADED=1`), JSON committen.
2. Branch übernehmen, `node tests/unit/run.js`, dann die Browser-Suite (`tests/run_all.sh`), besonders `test_3d.py`,
   `test_blend.py`, `test_shader_fail.py` (inkl. neuer Fälle e/f), `test_context_loss.py`, `test_memory3d.py`,
   `test_shader_async.py` (mehr Programme: `t3bloom`, mit Detail auch `t3noise` im Standard-Look). Pixel-Erwartungen in
   3D-Tests können sich durch Tonemapping/AO verschieben – mit `?tone=0&hao=0&detail=0&scharf=0&gpuwahl=0` gegenprüfen,
   ob es am neuen Look liegt.
3. 0 pageerrors / keine Shader-Warnungen auf ANGLE/Metal; GPU-Zeit je Stufe gegen das Budget (p95 gleich oder besser).
4. Bilder: Stimmungen, Tal mit AO, Tiefflug Detail, Flug-Frames TAA → `tests/shots/technik/`, selbst ansehen.
5. Konstanten abstimmen (Liste oben, alle TODO), Version 6.7.0, Cache-Busting, Bericht, Push, Live-Check.

## Nicht angefangen / bewusst offen

- **Kein Browser-Lauf, keine Messung, keine Bilder** (Leicht-Spur) – alle Abstimm-Konstanten sind Startwerte.
- **TAAU** (TAA + Hochskalieren in einem Pass): nicht gebaut; TAA läuft in Renderauflösung, danach CAS-Hochskalierung.
- **Bloom-Stärke weich an die Deko gekoppelt** (Ein-/Ausblenden bei Stufenwechsel): nicht gebaut – Bloom schaltet mit der
  Stufe hart um (Nutzeraktion, daher vertretbar; ggf. wie `DK.m` überblenden).
- `?deko=0` („Aussehen bis 6.4.1“) schaltet die 6.7-Teile nicht mit ab – dafür die eigenen Regler nutzen.
- Versionsnummer, `?v=`, `sw.js`-VERSION, README-Changelog, `TECHNIK_BERICHT.md`: Heavy-Job.
