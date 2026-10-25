# Fraktale 7.2.0 + 7.2.1 – Zufallsflug beim Start und Lavalampen-Flug

Live: https://drpeterkalmar.github.io/Fraktale/ · **Am Handy die App einmal ganz schließen und neu öffnen** (bzw. Seite neu laden) – sie
zeigt sonst bis zum Neustart die alte Version.

## Kurz für Peter

**Was du beim Öffnen siehst (7.2.0):** Ein paar Zehntelsekunden dunkel, dann blendet eine zufällige Welt ein – in zufälligen Farben,
mit zufälligem Stil und Parametern, oft an einer zufälligen strukturreichen Stelle – und fliegt nach dem Einblenden in 4 s weich
los, ohne jede Bedienung auf dem Bild. Die 3D-Landschaft (Höhenrelief) wird nie gewählt, die 3D-Körper (Mandelbulb, Menger …)
schon. Zurück zur Bedienung: am Handy kurz tippen (3 s sichtbar, der erste Tipp schaltet wie bisher ins Vollbild), am Rechner
Taste H, Esc beendet das Start-Kino. Ganz am Anfang erscheint einmalig knapp 2 s dezent „Tippen für Menü“. Deine gespeicherten
Einstellungen bleiben unangetastet – die gewürfelten Werte gelten nur für diese Sitzung. Wer es anders mag: Mehr → **Start**:
*Zufallsflug* (neu) / *Zufall still* (wie bisher) / *Wie zuletzt*.

**Wie der Flug sich jetzt verhält (7.2.1, „Lavalampe“):** Kommt der Flug an eine Stelle, an der die Grafik nicht mehr mitkommt,
wird er nicht mehr pixelig: er bremst sanft, schwebt kurz, zoomt langsam ein Stück heraus (über die schon scharfen Bilder,
leicht seitlich treibend), und wenn die Tiefe scharf gerechnet ist, taucht er weich wieder hinein – gern an einer etwas anderen
Stelle. Kommt die Grafik schon beim Schweben nach, geht es ohne Rückweg weiter. Alle Wechsel laufen als weiche Kurven (mehrere
Sekunden), nie im Sekundentakt hin und her (frühestens alle 8 s ein neuer Rückweg). Bei den 3D-Körpern weicht er vor der
Genauigkeitsgrenze zurück (steigt von der Oberfläche auf) und taucht dann wieder ein. Auch Touren zu Orten werden lieber langsamer
als grob. Deine eigenen Tempo-Änderungen (Regler, Tasten, ⇄) wirken weiter sofort. Abschaltbar: Mehr → „Lavalampen-Flug“.

**Zum Vergleichen (A/B):**
- Ohne Lavalampe (Verhalten 7.2.0): https://drpeterkalmar.github.io/Fraktale/?lava=0
- Schnellerer Rückweg / mehr Seitendrift / trägere Kurven: `?lavarueck=0.5`, `?lavaseit=0.08`, `?lavatau=8`
- Start wie 7.1.6 (nur Welt würfeln, keine Farben/Parameter): `?zufall=0` · ohne Flug: `?start=still` · fester Zufall: `?seed=7`

## Messung Lavalampen-Flug (vorher 7.1.14 / nachher 7.2.1)

`tests/measure_lava.py`, Pixel-7-Profil (DPR 2,6), echte GPU (Mac mini M1, sichtbares Fenster), Tempo 0,3, je 60 s; Ruck =
3. Ableitung aus einem kubischen Ausgleich über ±0,12 s Flugzeit (robust gegen ausgefallene Bildtakte), ab 3 s (Anfahrt 7.1.6
in beiden gleich). „Grob“ = mehr als 10 % des Bildes unter 0,5 Pufferpixel je Bildpixel. Tour: nur die Fahrzeit.
Rohdaten: `tests/results_lava_v7114.json`, `tests/results_lava_v721.json`, Entwurf aus dem Stash: `tests/results_lava_stash.json`.

| Lauf | Rechenweg | grobe Bilder | ohne Bewegung | Zoom-Ruck p95 / max (Zehnerpot./s³) | Seiten-Ruck p95 / max (Bildhälften/s³) | harte Wechsel | Tiefe nach 60 s |
|---|---|---|---|---|---|---|---|
| Mandelbrot Seepferdchental 180× | GPU | 13,6 % → **0 %** | 0 → 0 | 0,023 / 9,3 → 0,12 / **0,37** | 0,33 / 0,75 → **0,22 / 0,41** | 0 → 0 | 10¹⁹ → 10¹⁶ |
| Burning Ship 60× | GPU | 0 → 0 | 0 → 0 | 0 / 0 → 0 / 0,003 | 0,19 / 0,40 → 0,19 / 0,49 | 0 → 0 | 10¹⁹ → 10¹⁹ |
| Phoenix 3·10⁴, Lauf 1 | CPU | 87 % → **11 %** | 0 → 0 | 0,09 / 0,58 → 0,05 / 0,14 | 1,7 / 8,6 → **0,14 / 0,88** | 0 → 0 | 10⁴·⁶ → 10³·¹ (pendelt) |
| Phoenix 3·10⁴, Lauf 2 | CPU | 94 % → **16 %** | 0 → 0 | 2,0 / 8,3 → **0,05 / 0,14** | 3,4 / 13 → **0,14 / 1,1** | 0 → 0 | 10⁸·² → 10²·⁸ (pendelt) |
| Mandelbulb | Körper | 0 → 0 | 0 → 0 | 31 / 1860 → **4,2 / 28** | 42 / 444 → **7,3 / 54** | 3 → 1 | 10⁴·⁹ → 10⁴·⁷ |
| Menger-Schwamm (Durchflug) | Körper | 0 → 0 | 0 → 0 | 0,15 / 58 → 0,10 / 59 | 0,15 / 8,6 → 0,15 / 8,3 | 2 → 1 | 10²·⁵ → 10²·⁴ |
| Tour „mb_deep“ (3·10⁹) | GPU | 41 % → **4 %** | 3,3 → 2,6 %¹ | 5,4 / 15 → **2,8 / 8,5** | 2,7 / 7,8 → **1,7 / 4,9** | 0 → 0 | beide am Ziel (15 s → 28 s) |

¹ die ersten 0,25 s jeder Tour (Startansicht, dann Abflug) – in beiden Ständen gleich.

- Ziele: grobe Bilder GPU-2D ≤ 2 % ✓ (0 %), Körperwelt ≤ 2 % ✓ (0 %), keine Stillstand-Bilder ✓, keine harten Richtungswechsel im
  2D-Flug ✓. Ruck: Spitzen überall deutlich kleiner (Seepferdchen 25×, Mandelbulb 65×, Phoenix 10–60×), p95 bei Körpern, Tour,
  Prozessor-Exoten deutlich kleiner. **Ausnahme:** Zoom-Ruck p95 im Seepferdchental 0,023 → 0,12 – 7.1.14 flog dort fast immer
  mit konstantem Tempo (und 14 % grob); die Lavalampe bremst ~4 % der Zeit, ruckbegrenzt (max 0,37 statt 9,3).
- Rein/Raus-Wechsel: Seepferdchen und Burning Ship brauchen keinen Rückweg (Bremsen genügt); Phoenix (Prozessor) 2–4 Wechsel je
  Minute, kürzestes volles Pendel 12,8–14,5 s; Mandelbulb weicht je ~15–20 s einmal zurück. Keine Pendelei unter 8 s.
- Zeit bis wieder scharf: Phoenix-Episoden im Mittel 0,3–1,1 s (vorher bis 39 s am Stück grob), Tour 0,5 s (vorher bis 6,3 s).
- Tiefe: Der GPU-Flug kommt etwas weniger tief (10¹⁶ statt 10¹⁹ in 60 s) – dafür ohne grobe Bilder. Auf der Prozessor-Rechnung
  (Phoenix ab 2000×) pendelt der Flug, statt in den Pixelbrei zu fliegen; echten Fortschritt dort bringt erst der folgende
  Auftrag „Exoten auf der GPU in df64“.
- **Stash „7.1.14-entwurf schaerfe-bremse+schweben“** gemessen (Seepferdchen, Phoenix 2×): Seepferdchen 1,6 % grob, aber Zoom-Ruck
  p95 2,4 / max 9,7; Phoenix: Kamera stand 90–94 % der Bilder und blieb trotzdem 59–95 % grob. Nicht übernommen; die Idee
  „seitlich treiben“ steckt geglättet im Lavalampen-Flug. Stash gelöscht.
- Gefunden und behoben (betrifft auch Touren ohne Lavalampe): Bei langsamer, gleichmäßiger Bewegung im Deep Zoom rechnete die
  Vorschau nur schmale Streifen (je ⅛ des Bildes), die der Ebenen-Stapel wieder verdrängte – das Bild blieb grob, selbst fast
  stehend. Jetzt wird in dem Fall die ganze Ansicht gerechnet (`?ganz=0` = alt).

## Zufallsstart – 30 Starts mit festem Zufall (`tests/test_v720.py`, `tests/results_v720_seeds.json`)

- 30 Starts, 0 Seitenfehler, nie 3D-Landschaft, nirgends Bedienung sichtbar, alle Welten mit Flug fliegen los (≤ 3,6 s nach dem Laden).
- 17 verschiedene Welten (Phoenix 4, Menger 4, Magnet 3, Mandelbox 3, Multibrot 2, Julia 2, Buddhabrot 2, je 1: Mandelbrot,
  Burning Ship, Tricorn, Newton, Lyapunov, Nova, Flamme, Mandelbulb, Kaleidoskop-IFS, Quaternionen-Julia).
- Orte: Tour-Ort 10, Startansicht 10, Kundschafter-Punkt am Rand 8, zufällige Blickrichtung (3D-Körper) 2. Sonde: 0 Rückfälle auf
  die Startansicht, 1× neu gewürfelt nach der Bildprüfung. 11 Paletten, Färbe-Stile, Bunt/Inseln/Ringe, Außen, Farbanimation
  (24× an, 6× aus) verteilt.
- 6 Bildschirmfotos (Pixel 7 hoch/quer, Desktop): `tests/shots/v720/` – mit Bildauswertung angesehen: nur das Fraktal, kein Overlay.

### Bewegung je Welt beim Zufallsflug

| Welten | Bewegung |
|---|---|
| Mandelbrot, Julia, Burning Ship (+ Varianten), Tricorn, Multibrot, Newton, Lyapunov, Phoenix, Nova, Magnet | 2D-Flug (Autopilot am Mengenrand, Lavalampe) |
| Mandelbulb, Mandelbox, Menger, Quaternionen-Julia, Kaleidoskop-IFS, Apollonian | eigener 3D-Flug (Durchflug oder Tauchen, gewürfelt; Lavalampe vor der Genauigkeitsgrenze) |
| Fraktal-Flamme | Flammen-Animation (das Bild bewegt sich selbst) |
| Buddhabrot, Attraktoren | stehen (jede Kamerabewegung würde ihr Bild neu sammeln), Farbanimation an |

## Tests

Neu: `tests/test_v720.py` A–G, `tests/test_v721.py` A–F, `tests/measure_lava.py`. Grün: unit, node_core, release, truth GPU/CPU,
gestures, ui, features, blend, 3d, smooth, v62, v64, v69, v70, context_loss, fix_ref, shader_fail, bla_stall, deeplink, p3, v7111,
v7113, v7114, hud_fs, fs_fly, fly2d, fly64, rueck, v716, v717, v718, v719, memory3d, v720, v721. Rot wie auf 7.1.14 (dort am
selben Tag gegengeprüft): test_v63 (Look-Wechsel der 3D-Landschaft), „Naht 3D“ in test_shot, test_gpu_guard, test_shader_async.
Geändert: test_v716 (Standard „Start“ jetzt Zufallsflug), test_fly2d (nach ⛰ aus im Flug zieht der 2D-Flug weich an).
