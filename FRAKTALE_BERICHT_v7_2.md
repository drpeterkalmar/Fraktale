# Fraktale 7.3.0 + 7.3.1 – Exoten auf der Grafikkarte, Flug im tiefen Mandelbrot

Brief `fraktale-v7-2-exoten-df64` (Peter 20.10.2026). Live: **7.3.1** (https://drpeterkalmar.github.io/Fraktale/). Die Versionen
rückten nach dem Lavalampen-Job (7.2.0/7.2.1) nach: df64 = 7.3.0, Tiefzoom-Flug = 7.3.1.

## Kurz für Peter

- **Was du siehst (7.3.0):** Phoenix, Nova, Magnet I/II, Lyapunov und Multibrot (Exponent 4–8) rechnen über 2000× nicht mehr auf
  dem Prozessor, sondern auf der Grafikkarte – in „doppelter Genauigkeit“, die die Grafikkarte nachbildet. Das Bild ist dabei
  dasselbe wie vom Prozessor (geprüft), nur schneller. Das reicht am Handy bis etwa 10¹⁰, am großen Bildschirm bis ~2·10¹⁰;
  darüber rechnet wie bisher der Prozessor.
- **Ehrlich zum Flug:** Am Mac (M1) ist der Prozessor erstaunlich stark – die Grafikkarte ist dort „nur“ 2–14× schneller. Der Flug
  bleibt bei 60 Bildern/s, wird bei Magnet/Nova aber weiter oft gebremst (Lavalampe) bzw. ist teils grob. Bei Phoenix bei 57 000×
  (dein Screenshot) liegt es vor allem am Autopiloten, der dort keinen Rand findet und seitwärts sucht. Den echten Gewinn erwarte
  ich am rog (RTX 3070 Ti, ~8× die M1-Grafik) – das Mess-Skript liegt bereit.
- **Was du siehst (7.3.1):** „Ab ein paar Quintillionen pixelt der Flug“ – gemessen: Die Rechnung war es nicht. Der Flug ging
  manchmal **durch**: nach einem kurzen Ruckler beim Losfliegen raste der Zoom von 10¹⁸ bis 10²⁹⁰ (alles grob). Das ist behoben,
  ebenso ein Abbruch der Rechnung beim Herauszoomen. Grob bei 10¹⁸: vorher 32–46 %, jetzt 0–15 % der Bilder; bei 10²⁰ fast 0.
- **rog:** offline während des Jobs. Offen: `python3 tests/rog/measure_df64_rog.py` (FXC-Übersetzungszeit der neuen Shader –
  Pflicht vor „fertig“ –, Selbsttest, Wahrheit, Flug). Die FXC-Zeit am rog ist also **noch nicht gemessen**; die neuen Shader haben
  nur Schleifen mit Uniform-Grenzen (kein Entrollen) und werden erst übersetzt, wenn ein Exot über 2000× gebraucht wird.

## Etappe 1 – df64 für die Exoten (7.3.0)

**Technik.** `js/shaders.js` `exoticDF`: Zahl = Paar zweier f32 (hi + lo, ~48 bit). Bausteine nach Dekker/Knuth ohne FMA (twoSum,
Aufspalten 4097, twoProd), Addition/Multiplikation in der schnellen Form. Bahn, Pixelkoordinate (Mitte df64 + Pixel × Pixelgröße
df64) und Welt-Parameter in df64; Ableitungen (Distanz), Glättung (μ der Konvergenz, λ), Färbe-Stile in f32 aus den hi-Anteilen.
Nova als z + (c − R/3·(z − 1/z²)) (ohne |z|⁶-Überlauf), komplexe Division mit f32-Schätzung + df64-Rest. Lyapunov: λ als df64-Summe.
Unter 2000× bleiben alle Shader **bitgleich** (geprüft: 1392 Varianten Text-identisch).

**fast math – gemessen, nicht vermutet.** Erster Selbsttest am M1 (ANGLE/Metal): größter Fehler 2,6·10⁷ Einheiten 2⁻⁴⁸ = nur
f32-Genauigkeit. Bausteine einzeln auf der GPU: `dSplit(a)` lieferte (a, 0) – Metal ordnet `t·u − (t − a)` zu `t·(u − 1) + a` um,
der bekannte Trick „× Uniform 1,0“ (deck.gl) reicht dort nicht. Lösung: jedes Zwischenergebnis, dessen Rundung zählt, durch
`O(x) = uintBitsToFloat(floatBitsToUint(x) ^ u_z)` (u_z = 0): nicht umordenbar. Danach Selbsttest 2,58 · 2⁻⁴⁸. Der Selbsttest läuft
beim Start nach dem ersten Bild (nicht blockierend); fällt er durch, bleibt alles wie 7.2 (Prozessor).

**Wahrheitstest** `tests/test_v730.py` (480×360, je Exot 3 Randstellen, 500 Stichproben gegen CPU-f64):

| Exot | 10⁴ | 10⁶ | 10⁹ | 8·10¹⁰ (Grenze) |
|---|---|---|---|---|
| Phoenix Julia | 100 / 99,8 | 100 / 99,0 | 99,8 / 91,2 | 98,6 / 68,8 |
| Phoenix Mandel | 100 / 100 | 99,8 / 99,6 | 99,1 / 95,4 | 96,8 / 86,6 |
| Nova Mandel | 100 / 100 | 100 / 100 | 99,6 / 99,4 | 100 / 100 |
| Nova Julia | 100 / 100 | 100 / 99,8 | 100 / 99,4 | 99,2 / 95,2 |
| Magnet I | 99,4 / 93,0 | 95,4 / 72,4 | 98,5 / 30,8 | 100 / 14,6 |
| Magnet II | 100 / 97,8 | 100 / 94,6 | 97,8 / 41,2 | 99,6 / 69,8 |
| Lyapunov AB | 100 / 100 | 100 / 100 | 100 / 100 | 98,7 / 95,0 |
| Multibrot 5 | 100 / 98,0 | 100 / 88,0 | 99,0 / 72,0 | 96,9 / 43,0 |

(% gleich bei den „bestimmten“ Pixeln / roh, jeweils schlechteste der 3 Stellen.) „Bestimmt“ = der f64-Wert ändert sich nicht, wenn die
Bahn je Schritt auf 42 bit gerundet wird (3 Rundungsgitter). Warum diese Konditionierung: Am Phoenix-Rand bei 10⁹ stimmt selbst
f64 nur zu 97,7 % mit double-double überein; in den Zufallszonen von Magnet I liefern f64, df64 (GPU), df64 (bitgenau in JS
nachgerechnet), 45/40/30 bit lauter verschiedene Werte. Gate: ≥ 99 %, oder höchstens 1 Punkt unter einer vierten 42-bit-f64-Rechnung
(dort, wo auch die keine 99 % schafft). Die Brief-Vorgabe „≥ 99 % roh“ ist bei 10⁹ für keine endliche Genauigkeit erreichbar
(Magnet I roh 31 %, f64 selbst ist dort Zufall) – darum diese Lesart. **Farbe** GPU gegen Prozessor bei 10⁴–10⁹ ≤ 0,26/255 im
Mittel; an der Grenze in zwei Zufallszonen 14,5 bzw. 3,6/255 (nur gemessen). **Gleiches Aussehen wie f32** bei 0,5×: ≤ 0,3/255,
Ausnahme Magnet II 2,0/255 – dort ist f32 daneben, df64 = Prozessor (0,04/255).

**Grenze** je Formel gemessen: bis 10¹¹ (bei 360 px Höhe) gleich, ab 3·10¹¹ weichen Magnet II und Lyapunov ab → Regel „Pufferpixel
≥ 10⁻¹³ breit“ (`DF64_PX`): Handy 2400 px hoch ~1,2·10¹⁰, 1440p ~2·10¹⁰.

**Fund nebenbei: abgebrochene GPU-Befehlspuffer.** In ~1 von 4 Läufen waren bei 10⁹–10¹⁰ ganze Zeilenbänder 0. Ursache: Ein
df64-Häppchen nach der f32-Regel lief 100–300 ms auf der GPU, macOS brach solche Befehlspuffer ab (unter Windows droht nach 2 s
„Gerät weg“). df64-Häppchen sind jetzt nach Rechenaufwand begrenzt (Pixel × Iterationen, Ziel 1–3 Bildtakte) → 0 Fehler in 15 Läufen.
(Gleiches Muster gab es bei Mandelbrot-Bunt unter GPU-Last, s. „Suite“.)

**Tempo** (M1, Screenshot 480×360, GPU / Prozessor): Multibrot 5 bei 10⁹ 0,8 / 9,2 s; Magnet I 0,9 / 4,8 s; Nova 0,75 / 3,5 s; Lyapunov
0,43 / 1,9 s; Phoenix 0,56 / 0,98 s. Im Pixel-7-Profil (824×1678): Magnet I bei 3·10⁴ 316 ms je Vollbild (Burning Ship 19 ms) – df64
kostet ~20 f32-Operationen je Rechenschritt, Magnet mit Division am meisten. Kein Innen-Anteil an den Flugorten, die Zyklus-Erkennung
(Brent) hilft dort nicht (sie hilft bei großen Mengen-Flächen).

## Etappe 2 – Flug-Messung

`tests/measure_lava.py` (Pixel-7-Profil, sichtbares Fenster, 20 s ab 3·10⁴, Tempo 0,3; `results_lava_v730_*.json`):

| Lauf | df64, Lavalampe | Prozessor (`?df64=0`) | df64, `?lava=0` |
|---|---|---|---|
| Phoenix (2×) | grob 8 / 18 %, 60 B/s, Bremse 39 % | 12 / 9 % | 37 % |
| Nova (2×) | 50 / 0 %, Bremse 90 / 15 % | 52 / 65 % | 90 % (taucht bis 10⁹) |
| Magnet I (2×) | 57 / 44 %, Bremse 90 % | 44 / 66 % | 91 % (bis 10⁹) |
| Magnet II (2×) | 62 / 59 % | 64 / 65 % | 91 % |
| Burning Ship | 0 / 0 %, 59 / 56 B/s | – | – |
| Tour → 10⁸ Phoenix / Magnet II / Multibrot | 71 / 22 / 78 % | 76 / 73 / 76 % | – |

Bildrate wie Burning Ship (56–60 B/s), Gate „≤ 5 % grob“ **nicht erreicht**. Gründe (gemessen): Phoenix bei 3·10⁴ – der Autopilot ist
„verloren“ (findet keinen Rand, Zoomtempo 0,001/s, sucht seitwärts) und der Ebenen-Stapel (8) verdrängt die Teilstreifen; Magnet/Nova –
GPU-gebunden (Vorschau halbe Auflösung 110–200 ms, in Bewegung nur ein Häppchen je Bild), beim Herauszoomen über die Startansicht
hinaus fehlen Ebenen. Der Wächter bremst mit df64 in 15–90 % der Bilder (ohne ihn taucht der Flug bis 10⁹, zu 90 % grob). Etappe 3
(Stash) entfiel laut Nachtrag 21.10.

## Zusatz-Etappe – Flug ab Quintillionen (7.3.1)

Gemessen (`tests/measure_deep_fly.py`, Seepferdchental am Zoom-Wanderpunkt walk_1e41, Minibrot-Kern Periode 1941 aus 10²⁹):

- Rechenweg durchgehend gpu/perturb bis 10³⁰; Referenzorbit 3–15 ms je Neuberechnung, keine Wartezeit im Flug; BLA-Neubauten 0–5 je
  Flug; GPU-Vorschau halbe Auflösung 56 ms (10¹²) … 67–92 ms (10¹⁵–10²⁰) – kein Einbruch ab 10¹⁸; Iterationsgrenze 7200 → 20 000;
  CPU-Nachrechnung im Stillstand 10–41 % der Pixel (nur Stillstand, nicht im Flug). f32-Exponent bei 10²⁰ unkritisch.
- **Befund 1: Durchgehen.** 3 von 13 Flügen ab 10¹⁸/10¹⁹ rasten bis 10²⁹⁰. Aufzeichnung: in der Anfahrt sank das Zieltempo kurz
  (Schärfe-Einbruch), der Regler setzte die Beschleunigung = Sprung/Bildzeit = 8,9 (zulässig 0,5); nach der Anfahrt holte die Bremse
  (Ruck 0,05–0,14/s³) das nie ein, Zoomtempo bis 66 Zehnerpotenzen/s. Zweite, mildere Form: Beschleunigung aus dem schnellen
  Anfahrfenster (0,48) gegen die kleinere Grenze beim Bremsen → 1,3/s, 9 Zehnerpotenzen zu tief. Fix: Beschleunigung in der Anfahrt
  begrenzt; beschleunigt das Tempo vom Ziel weg, gilt sofort die Grenze der Phase (3D-Körper unverändert).
- **Befund 2: Herauszoomen grob.** Jede neue BLA-Tabelle brach den laufenden GPU-Job ab; Fix: Job behält seine Tabelle. Herauszoomen
  zusätzlich nach der Schärfe-Prognose.
- Ergebnis (20 s Zufallsflug, Anteil grober Bilder, alt = 7.2.1/7.3.0): 10¹² alt 0–5 % / neu 0–17 % (Mittel 5,8 %); **10¹⁸ alt 32–46 %
  / neu 0–15 %**; **10¹⁹ alt 27–53 % / neu 0–14 %**; 10²⁰ alt 0–48 % (Mittel 23 %) / neu 0–0,4 %; 0 harte Wechsel, nie mehr
  durchgegangen (0 von 24). Gate „1e18–1e20 nicht gröber als 1e12“: im Mittel erfüllt (≈ 6 % / ≈ 6 % / < 1 %), je Lauf streut es
  stark (Zufallsflug). Mandelbrot am Mac gemessen; Burning Ship/Tricorn/Celtic/Julia nicht eigens geflogen (gleicher Regler, gleicher
  BLA-Pfad). rog-Gegenmessung offen.

## Tests

- Neu: `tests/test_v730.py` A–E (0 Fehler), `tests/test_v731.py` A–B (A: alter Stand rot, Beschleunigung 7,6), `tests/unit/df64.test.js`.
- Angepasst: test_v71 G (Magnet 10⁴ jetzt df64, 10¹² Prozessor), test_v721 B (Prozessor-Welt mit `?df64=0`).
- Ganze Suite (`tests/run_all.sh`) auf 7.3.0-Stand: grün bis auf – jeweils am alten Stand (7.2.1, Port 8479) unter gleicher Last
  ebenfalls rot bzw. beim Wiederholen grün: test_gestures, test_blend, test_3d, test_rueck, test_fs_fly (Zeit-/Bildraten-Gates; parallel
  lief eine Hermes-Medien-Indexierung mit Ollama auf der GPU), test_features und test_v64 (beim Wiederholen grün), test_v63 (am alten
  Stand rot), test_gpu_guard, test_shader_async, test_shot (bekannt), test_v721 A/B/C (Stillstand 0,1 %, Pendel, Mandelbulb-Ruck streut
  ohne jede Änderung 3–31). Nach 7.3.1: test_truth (GPU), test_bla_stall, test_fix_ref, test_fly2d, test_v721 C/D, test_v731 grün.
- Handy-Profil (Pixel 7): test_v730 E fehlerfrei. Live geprüft: 7.3.0 Phoenix 57 400× gpu/df64, Selbsttest bestanden; 7.3.1 Mandelbrot
  10¹⁸ fertig, 0 Fehler.

## Offen

- **rog** (offline): `python3 -u tests/rog/measure_df64_rog.py` – Schritt 1 FXC-Zeit der df64-Shader (Pflicht), 2 Selbsttest/Wahrheit/
  Tempo, 3 Flug df64 gegen `?df64=0`. Server dieses Stands auf :8472, Task fk-gltest wie in `tests/rog/`.
- Flug der Exoten am Mac bleibt teils grob (s. Etappe 2); nächster Hebel wäre Perturbation auch für die Exoten (f32-Abweichungen um
  eine Referenzbahn wie beim Mandelbrot) statt df64 – ~20× weniger Rechenaufwand, eigenes Projekt.
