# Fraktal-Explorer 6.6.0 – Flug auch in 2D

Auftrag `fraktale-v6-6-flug-2d` (Wunsch von Peter, 05.10.2026: „Fraktal: auch in 2D Flüge ermöglichen“). Stand 06.10.2026,
live unter https://drpeterkalmar.github.io/Fraktale/ (Version 6.6.0 geprüft).

## Kurz für Peter

- In der flachen Ansicht gibt es jetzt einen runden **✈-Knopf**: hochkant unten rechts über der Leiste, quer unten links
  (Daumenzone, 48 px). Ein Tipp, und das Bild taucht wie ein endloses Zoom-Video ruhig in die Tiefe. Der Zoompunkt
  gleitet dabei am Rand der Menge entlang (Filamente, Spiralen, Minibrot-Ränder), die Bildmitte folgt ihm weich.
  Berge und Neigung gibt es dabei nicht.
- **Tippen = Pause**, **ein Finger ziehen = Bild schieben** (der Flug taucht an der neuen Stelle weiter), zwei Finger
  beenden den Flug. Unten zeigt die Leiste **■ Stopp** und den Tempo-Regler.
- **⛰ während des Flugs** wechselt nahtlos in den 3D-Flug, und ⛰ aus im 3D-Flug fliegt flach weiter (bisher endete der
  Flug dann).
- **Orte → „✈ Flug“** fliegt im aktuellen Modus und landet exakt; die Taste `V` ebenso.
- Der 2D-Flug fliegt **über die GPU-Tiefe 10³⁰ hinaus** mit der Prozessor-Rechnung weiter. Dort wird er langsamer und
  das Bild etwas weicher (siehe Messung). Der 3D-Flug endet wie bisher bei 10²⁸.
- Clip (5 s): `tests/shots/flug2d/flug2d.mp4`. Bilder: `tests/shots/flug2d/`.
- Vergleich mit dem alten Verhalten (Flug nur in 3D): Link mit `?fly2d=0`.

## Umsetzung

**Eine Steuerung für beide Modi** (`js/flight.js`). `startFly(place, { d3 })` fliegt ohne Angabe im aktuellen Modus;
mit `?fly2d=0` immer in 3D wie bis 6.5. Die Randsteuerung `flyEdgeSteer` (6.2/6.4.1) ist dieselbe Funktion. Ihre
Eingänge sind nur die Sonde und die Geometrie des Modus:

| | 3D (unverändert) | 2D |
|---|---|---|
| Zoompunkt | 0,25–0,7 Bildhälften vor dem Fokus, ±90° um den Kurs | 0–0,6 um die Bildmitte, Mitte bevorzugt |
| Bewegung | Kurs dreht gedämpft zum Zoompunkt, Schräglage | kein Kurs; die Bildmitte gleitet weich zum Zoompunkt (35 %/s, verloren schneller) |
| Datenlücke prüfen | Vorwärtsbereich | sichtbares Bild nahe der Mitte |
| Lenken | Wischen dreht Zoompunkt + Ziel (±35° für 3 s) | Schieben verschiebt das Bild, 3 s lang Randsuche nur nahe dem Zoompunkt |
| Ende | 10²⁸ | Tiefengrenze der Welt (Mandelbrot 10²⁹⁰, Newton 10¹³) |

Unverändert gelten für beide Modi: Distanzband `FLY_DE`, Hysterese, gedämpftes Nachführen, vorausschauende
Zoombremse, „verloren“ → zum Randstück gleiten, Tempo-Bremse (`GOV.g`, im Flug bis 30 %).

**Sonde in 2D** (`js/app.js` `probe2d`, `js/three.js` `T.probeReady`): Es ist dieselbe `T3.probe`, sie liest nur die
Iterationspuffer. Sie braucht kein 3D-Gelände und keine 3D-Initialisierung, nur ihr eigenes kleines Programm. Dieses wird
nicht blockierend übersetzt (`R.programReady`); bis es fertig ist (wenige Bilder), taucht der Flug geradeaus. Das
Fenster ist das sichtbare Bild (±max(1, Breite/Höhe) Bildhälften), alle 150 ms wie im 3D-Flug. Geprüft: Nach 20 s
2D-Flug ist nur `t3probe` übersetzt, kein Gelände-, Himmel- oder Höhenprogramm, und es lief keine 3D-Vorbereitung.
Deshalb geht der 2D-Flug auch auf Treibern, auf denen die 3D-Landschaft defekt ist (geprüft in `test_shader_fail`).

**Wechsel 2D ↔ 3D im Flug:** Der Flugschritt läuft jetzt in der Hauptschleife statt in `update3d`. `flyMode()` erkennt
den Wechsel. 2D → 3D: der Zoompunkt geht vor den Fokus, der Kurs bleibt. 3D → 2D: der Zoompunkt bleibt, die Bildmitte
gleitet zu ihm. `set3d(false)` und der 3D-Ausfall `fail3d` beenden den Flug nicht mehr (mit `?fly2d=0` wie bisher).

**Ruckeln behoben** (`js/scheduler.js` `pumpCtl`): Im ersten Messlauf hatte der 2D-Flug 52,6 Bilder/s. Ab 10⁹ kam etwa
alle 100 ms ein Bild von 40–75 ms, ohne lange JavaScript-Arbeit. Ursache: Der Häppchen-Regler durfte in 2D bis zu
8 Bildtakte Reserve nehmen. Im Dauerrechnen des Flugs warten die „Leerlauf“-Bilder aber nur auf die GPU und blähen das
Budget auf. Das ist derselbe Befund wie 6.2 in 3D. Im Flug gilt jetzt auch in 2D höchstens ein Bildtakt: **52,6 → 57–60
Bilder/s**, die Tiefe bleibt gleich (19,1 → 19,2 Zehnerpotenzen in 40 s).

**Gesten im 2D-Flug:** Tippen = Pause. Ein Finger verschiebt das Bild; der Inhalt folgt dem Finger, der Flug läuft weiter.
Zwei Finger beenden den Flug, und die Geste zoomt nahtlos ab der aktuellen Lage weiter. Doppeltipp, Mausrad, Pfeiltasten
und Bild↑/↓ beenden den Flug ebenfalls (vorher hätten sie gegen ihn gearbeitet). Lange drücken (Julia) ist im Flug aus.

**Oberfläche:** neuer Knopf `#btn-fly2d` (`index.html`, `style.css`). Die Flug-Leiste `#bar3d` erscheint in 3D und
während eines 2D-Flugs; „Ausrichten“ gibt es nur in 3D. Beim ersten 2D-Flug kommt ein Hinweis („tippen = Pause, ziehen =
lenken, ⛰ = in 3D weiterfliegen“), die Gesten-Hilfe hat eine neue Zeile. Neue Texte gibt es in allen 9 Sprachen. Die
bisherigen Flug-Texte (Flug, Stopp, Tempo, Pause …) waren nur auf Deutsch und Englisch da und sind jetzt in allen Sprachen.

**Kleine Korrekturen nebenbei:**
- Ein 3D-Flug, der auf die Shader-Vorbereitung wartet, startet danach ausdrücklich in 3D. Der neue Standard „aktueller
  Modus“ hätte ihn sonst flach gestartet; der Fehler wurde von `test_v63` gefunden.
- Ein Flug endet jetzt auch an der Tiefengrenze der Welt. Newton 10¹³ betrifft auch 3D, dort stand der Flug vorher
  still.

## Messung

`tests/measure_fly2d.py`, Apple M1, Chromium mit echter GPU (Metal), Pixel-7-Ansicht 412×839, sichtbares Fenster.
Pro Lauf ein Zufallsflug über 2 min, Tempo 0,5, an drei Startorten (Gesamtbild, Seepferdchen-Tal 300×, Randpunkt 10⁶),
hoch und quer. Mittelklasse-Profil: CPU 4× gedrosselt, 4 Kerne, 60 s (die GPU lässt sich nicht drosseln).
Rohdaten: `tests/results_fly2d_v660_*.json`.

Mittel über die drei Startorte:

| | 2D hoch | 2D quer | 2D Mittelklasse | 3D hoch | 3D quer | 3D Mittelklasse |
|---|---|---|---|---|---|---|
| Bilder/s (Ziel ≥ 55) | **57,8** | **58,2** | **55,8** | 53,5 | 53,8 | 54,0 |
| Bildzeit 95 % | 18,7 ms | 18,7 ms | 23,6 ms | 34,1 ms | 33,7 ms | 33,3 ms |
| Zeitanteil „verloren“ | 0 | 0 | 0 | 0 | 0 | 0 |
| Rand in der Bildmitte (Anteil Sonden) | 99,8 % | 100 % | 100 % | 100 % | 100 % | 100 % |
| längste Strecke ohne Rand in der Mitte | 0,6 s | 0 | 0 | 0 | 0 | 0 |
| Anteil Boden innen (Menge) | 0,8 % | 0,5 % | 1,3 % | 0,8 % | 0,8 % | 1,0 % |
| Tiefe in 2 min (Zehnerpotenzen) | 37,2 | 38,2 | 27,9 (60 s) | 25,2¹ | 25,2¹ | 22,3 (60 s) |
| Zoom nach 30 s: Gesamtbild / Tal / Rand | 9·10¹³ / 3·10¹⁷ / 1·10²¹ | 1·10¹⁴ / 3·10¹⁷ / 2·10²¹ | 2·10¹⁴ / 4·10¹⁷ / 1·10²¹ | 9·10¹⁴ / 2·10¹³ / 4·10¹⁷ | 9·10¹⁴ / 1·10¹⁴ / 3·10¹⁹ | 6·10¹⁴ / 2·10¹² / 4·10¹⁴ |
| Lücken (unbedeckt > 2 %) / harte Wechsel | 0,1 % / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Schärfe bis 10³⁰ (Ø Pufferpixel je Bildpixel)² | 0,73 | 0,72 | 0,73 | 0,60 | 0,62 | 0,61 |

¹ Der 3D-Flug endet bei 10²⁸ (nach 57–90 s), deshalb ist die Tiefe in 2 min dort kleiner.
² In Bewegung zeigt die App Vorschauen in geringerer Auflösung. Im Gesamtbild-Start bleibt das Bild voll scharf (0,93–0,96);
in den dichten Tälern liegt der Wert bei 0,57–0,68 (3D 0,44–0,51). Nie flackernd und nie mit Lücken: Lücken 0–0,2 % der
Bilder, 0 harte Wechsel.

**Jenseits von 10³⁰ (nur 2D):** 10³⁰ wird nach 48–63 s erreicht, danach rechnet der Prozessor. Der Flug läuft mit 60
Bildern/s weiter, nie verloren, Rand in der Mitte. Er wird aber langsamer: 9–12 Zehnerpotenzen pro Minute statt ~25–30,
weil die Tempo-Bremse auf 30 % steht. Das Bild ist dort weich (Ø 0,16–0,39 Pufferpixel je Bildpixel, etwa ¼–⅓
Auflösung), zeigt aber Spiralen und Filamente sauber (Bilder `2d_*_2min.jpg` bei 10³⁹–10⁴¹).

Gegenprobe: Eine tiefere Bremsgrenze (8 % statt 30 %) machte das Bild dort nicht schärfer (0,18), nur langsamer (2,8
Zehnerpotenzen/min). Die Prozessor-Rechnung schafft bei den nötigen Iterationszahlen keine schärfere Vorschau, deshalb
wurde die Änderung verworfen.

**Speicher:** Am Ende eines 30-s-2D-Flugs sind 7,7 MB Iterationspuffer belegt, Spitze 76 MB. Beim 3D-Flug sind es
123 MB (`test_memory3d`).

## Prüfung

- **Neu: `tests/test_fly2d.py`** (im sichtbaren Fenster wie die übrigen Flugtests, in `tests/run_all.sh`), alle Prüfungen grün:
  - Knopf-Lage hoch/quer, ≥ 48 px, frei vom Dock; im Flug, in 3D, bei Mandelbulb/Buddhabrot ausgeblendet.
  - 2D-Flug ohne 3D (`V3.on` false, keine Vorbereitung, nur `t3probe` übersetzt).
  - 20 s Flug: Zoom 2·10⁹, Rand in der Mitte 100 %, nie verloren.
  - Tippen = Pause (Zoom steht) und weiter.
  - Schieben im Flug: Kamera −165 px bei −165 px erwartet, der Flug läuft weiter.
  - Zwei Finger beenden den Flug.
  - Wechsel 2D→3D→2D im Flug: der Zoom steigt in beiden Modi weiter.
  - Taste V fliegt in 2D.
  - Orte-Flug im 2D-Modus: startet in 2D und landet **exakt** (cx, cy, zoom bitgleich).
  - `?fly2d=0`: kein Knopf, ✈ startet die 3D-Landschaft, 3D aus beendet den Flug.
  - 0 Fehler.
- **3D-Flugtests unverändert grün:** `test_v62` (Drehrate max. 9,5 °/s, Rand 100 %), `test_fly64` (15 fps, hoch/quer:
  nie verloren, Rand 100 %) und `test_3d`.
- **Angepasst:** `test_v63`, `test_gpu_guard`, `test_memory3d` und `test_shader_fail` riefen `startFly()` in 2D auf und
  meinten den 3D-Flug. Sie rufen ihn jetzt ausdrücklich auf (`{ d3: true }`); die geprüften Erwartungen sind unverändert.
  `test_shader_fail` prüft zusätzlich: Der 2D-Flug geht trotz defektem 3D.
- **Übrige Suite grün:** Unit-Tests, `node_core_test`, `test_release`, `test_truth` (GPU und CPU), `test_gestures`,
  `test_ui`, `test_features`, `test_blend`, `test_smooth`, `test_context_loss`, `test_fix_ref`, `test_bla_stall`,
  `test_deeplink`, `test_p3`, `test_shader_async` (ein Zeit-Ausreißer, danach zweimal grün) und `tools/check_release.py`.
- **`test_v64` (Bunte Menge, Innen-Proben) rot – bestehender Fehler, nicht durch diesen Auftrag:** Er schlägt auf dem
  Stand vor 6.6 genauso fehl. Er ist im `V654_BERICHT.md` (offener Punkt 2) bereits als eigener Auftrag geführt.
- Live-Check: https://drpeterkalmar.github.io/Fraktale/ meldet `APP_VERSION = '6.6.0'`. Der 2D-Flug läuft dort ohne
  Fehler (12 s: Zoom 2·10⁵, `tests/shots/flug2d/live_hoch.jpg`).

Bilder (selbst geprüft): `tests/shots/flug2d/`
- `knopf_{hoch,quer}.jpg` (Knopf-Lage)
- `leiste_{hoch,quer}.jpg` (Leiste im Flug)
- `2d_{hoch,quer}_<start>_{start,30s,2min}.jpg` (Serien)
- `flug2d.mp4`: 5 s, 1,6 MB, Seepferdchen-Tal 10⁶ → 10⁹, Aufnahme mit 25 Bildern/s. Nicht im Precache; `tests/` wird
  nicht veröffentlicht.

## Offen / Folgeideen

- **„Mitdrehen“ in 2D (Punkt 5, optional) – weggelassen.** Der 2D-Renderer kann nicht drehen. Dafür müssten die
  Pixel→Ebene-Abbildung im Anzeige-Shader, die Abdeckungs- und Vorausrechnung der Ebenen (achsparallele Rechtecke)
  und die 2D-Gesten mitdrehen. Das ist mehr als ein kleiner Schritt. Als Folgeidee: Kurs = Bildrichtung, Standard aus.
- **Prozessor-Tiefe weicher:** Jenseits von 10³⁰ zeigt der 2D-Flug etwa ⅓ Auflösung. Schärfer ginge nur mit weniger
  Iterationen in Bewegung oder einer GPU-Rechnung über 10³⁰ hinaus (Gleitkomma mit erweitertem Exponenten).
- Auf einem echten Mittelklasse-Handy nicht gemessen (wie bei 6.2–6.5 nur mit gedrosseltem M1).
- Mandelbulb und Buddhabrot: kein Flug (wie im Auftrag vorgesehen; dort ergab er sich nicht billig).
