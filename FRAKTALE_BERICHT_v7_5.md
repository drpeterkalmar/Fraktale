# Fraktale 7.5.0 – Mutiger Flug: der Autopilot fliegt wieder hinein

Live: https://drpeterkalmar.github.io/Fraktale/ · **App einmal ganz schließen und neu öffnen** (bzw. Seite neu laden).

Peter, 29.10.2026: „Fraktalflug ist zu zaghaft im Heranzoomen.“ – „Das Standardtempo soll bleiben, es geht nur darum, dass er
überhaupt nicht hineinfliegen will.“

## Kurz für Peter

- **Was anders ist:** Der Autopilot blieb manchmal minutenlang an der Startstelle hängen, obwohl das Bild scharf war. Er hielt
  sich für „verloren“ und bremste auf fast null, oder er hatte sich nach einem kurzen Bremsen ein viel zu kleines Tempo gemerkt
  und kroch danach eine Minute lang. Das ist behoben. Das Grundtempo (0,3) ist unverändert, und die Lavalampe auch: Er bremst
  weiterhin, bevor es pixelig wird, schwebt, zoomt sanft heraus und taucht wieder ein.
- **Zahl:** Der Start, der vorher in jedem Lauf auf der Stelle stand (Tricorn, Seed 9), fliegt jetzt in 2 von 3 Läufen in die
  Tiefe (bis 10¹⁴ statt 10¹). Über alle 16 Teststarts: Läufe ohne 2 Zehnerpotenzen nach 60 s je Start 14 % → 12,5 %, grobe
  Bilder gleich (6,6 → 6,8 %).
- **Grenzen:** Zwei sehr teure Szenen (eine Julia-Menge direkt am „Einschnürpunkt“ −0,75 und ein Multibrot-Randort) kommen auf
  dem Mac weiterhin kaum hinein. Dort schafft die Grafik das Bild in Bewegung nur halb aufgelöst, und die Lavalampe bremst
  zu Recht.
- Vergleich am Handy: https://drpeterkalmar.github.io/Fraktale/?mutig=0 = Verhalten 7.4.3.

## Etappe 0 – Reproduziert und Ursache belegt (vor jeder Änderung)

Messplatz `tests/measure_v75.py`: echter Zufallsstart mit festem Zufall (`?seed=N`, Standard-Einstellungen, die gewürfelte
Flug-Geschwindigkeit 0,16–0,22 bleibt), Mac mini M1, Pixel-7-Profil, sichtbares Fenster, 120 s ab Flugbeginn. Je Bild (rAF):
log10 Zoom, Lavalampen-Phase, Zoomtempo und alle Faktoren seines Ziels (Reisetempo, „verloren“, Lenk-Drossel zf,
Schärfe-Prognose, Dauertempo rmax), GOV.lq, Rechenweg (`plan().kind`). Bremsursache je Bild = Phase außerhalb der Reise bzw. der
kleinste Faktor unter 0,7. Seeds vorher festgelegt: 8 GPU-Welten (7, 8, 9, 15, 19, 23, 35, 45), 4 Exoten (1, 2, 12, 13),
später 8 weitere GPU-Starts an Tour- und Kundschafter-Orten (46, 51, 53, 54, 56, 63, 65, 66). Vergleich 7.3.1 (Stand vor 7.4.0,
Worktree auf Port 8479).

### Die drei Hänger (Zeitreihen)

| Lauf | was passiert | Zahlen |
|---|---|---|
| 7.4.3, Seed 9 (Tricorn, Kundschafter 17×) | Start an einer Kante aus langsam entkommenden Punkten: Für die Distanzschätzung der Sonde ist die Menge überall > 1 Bildhälfte entfernt → „verloren“ (× 0,05) dauerhaft, Lenk-Drossel zf ≈ 0,07 (Zoompunkt weit vom Ziel), das Anflugziel springt alle 0,6 s auf die Gegenseite (±(0,43, −0,31)) → der Zoompunkt pendelt in der Mitte | Zoomtempo 0,0007 Zehnerpotenzen/s bei Schärfe 0,97 (scharf!); 120 s: 10^1,23 → 10^0,87; Ursache „verloren“ 53 %, Schweben 23 %, zf 10 %, Rückweg 10 %; **75 Phasenwechsel** (Kriech-Bremse alle ~4 s → Bremsen/Schweben) |
| 7.3.1, Seed 15 (Multibrot z³, Startansicht) | Schärfe-Zucken in den ersten 20 s → Bremsen → sofort wieder Reise, 6× hintereinander; jedes Mal Dauertempo × 0,7 | rmax 9 → **0,03** in 10 s, danach +6 %/s → 60 s bis zum Reisetempo; nach 60 s erst +1,3 Zehnerpotenzen; Ursache rmax 30 % |
| 7.4.3, Seed 19 (Julia c = −0,767 − 0,021i, 13×) | Schärfe genau an der Schwelle 0,5 (Vorschau halb aufgelöst) schon in der Anfahrt → Ziel 0 → Bremsen mit Tempo 0 → Dauertempo 0,03; dann Rückweg 13 s, Warten 20 s, Wiederanlauf | volles Bild 1,65 s bei 300 Iterationen (Julia daneben 80 ms) – Szene direkt am parabolischen Punkt −0,75, die Genauigkeitsprüfung schickt viele Pixel zur CPU |

### Vorher (7.3.1 / 7.4.3, je 1 Lauf, 8 GPU-Starts + 4 Exoten)

| Kennzahl | 7.3.1 | 7.4.3 |
|---|---|---|
| GPU: nach 60 s < 2 Zehnerpotenzen | 2 von 8 (Seed 15, 19) | 1 von 8 (Seed 9) |
| GPU: Tiefe nach 60 s, Median / größte Tiefe, Median | +10,1 / 10²¹ | +10,2 / 10²¹ |
| GPU: grob | 1,5 % | 8,1 % |
| GPU: Zeit Reise / Rückweg / Warten / Schweben / Bremsen | 89 / 5 / 2 / 2 / 2 % | 85 / 7 / 4 / 4 / 1 % |
| GPU: Bremsursache rmax / verloren / zf | 9 / 1 / 9 % | 4 / 7 / 3 % |
| Exoten: < 2 Zehnerpotenzen | 1 von 4 (Lyapunov) | 0 von 4 |

**Hat es mit 7.4.x angefangen? Nein.** 7.3.1 hängt genauso oft, nur an anderen Starts (Seed 15 statt 9). Welcher Start
hängt, streut je Lauf: Der Zufallsstart 7.4.2 rückt die Mitte an den Rand, dort ist die Randsuche öfter „verloren“, dafür
trifft das Dauertempo-Lernen andere Starts. Die meisten Starts (Mandelbrot, Burning Ship, Julia an der Startansicht) fliegen in
allen Ständen in 120 s bis 10²⁰–10²⁶. Die Hänger sind Einzelfälle, in denen der Flug dann aber gar nicht hineinkommt. Das
ist genau Peters Beobachtung.

## Etappe 1 – Fix (`js/flight.js` lavaStep / flyEdgeSteer, `?mutig=0` = 7.4.3)

Gilt für den Zufallsflug in 2D auf der schnellen GPU-Rechnung (Klassiker, f32/Perturbation bis 10³⁰):

1. **Dauertempo lernt nur aus echtem Tempo:** `rmax = 0,7 × Zoomtempo` nur, wenn beim Bremsen mindestens 30 % des Reisetempos
   anlagen. Ein Bremsen beim Anfahren oder Kriechen sagt nichts darüber, was die Grafik durchhält.
2. **Mut gegen die Lenk-Dämpfung:** Hält „verloren“ × zf das Zoomtempo bei scharfem Bild (Schärfe > 0,62) unter 30 %, wächst
   `L.mz` in 8 s auf 1. Die Dämpfung wird weich auf höchstens × 0,6 gelockert. Bei gutem Rand (Dämpfung > 0,6) baut sich der
   Mut wieder ab. Das seitliche Anfluggleiten bleibt.
3. **Anflugziel ohne Hin und Her:** Im Anflug wechselt das Ziel frühestens nach 3 s auf die Gegenseite des Zoompunkts.
4. **Kriech-Bremse** (`slowT`, „3 s unter 25 % → bremsen, schweben, zurück“) zählt nur, was Schärfe und Dauertempo erlauben,
   nicht die Lenk-Dämpfung beim Suchen des Randes.

Unverändert: Schärfe-Bremse (Tempo ∝ Schärfe-Prognose, Bremsen unter 0,5), Schweben, Rückweg, Warten, alle Schwellen, Ruck- und
Beschleunigungsgrenzen, Roll, Randläufer, `flySpeed` 0,3 und die Settings-Migration. Exoten (df64 ab 2000×), Newton (CPU ab 10⁵),
die Prozessor-Rechnung jenseits 10³⁰, die 3D-Körper und der Ziel-Flug fliegen wie 7.4.3.

**Gemessen und verworfen:**
- „Ohne Tempo nicht bremsen“ (Reise wartet an der Schwelle 0,5, statt zu schweben und herauszuzoomen): Seed 19 stand grob in
  der Reise (43 % grob), Seed 9 fiel auf 1,8 Zehnerpotenzen. Im Stand wird so eine Szene nicht scharf, erst der Rückweg über die
  schon scharfen Ebenen hilft.
- Schnelleres Nachwachsen des Dauertempos (+15 %/s bei sehr scharfem Bild): kein messbarer Gewinn, eher mehr Pumpen in
  schweren Szenen.
- Fix auch für Exoten: Phoenix 22/18 % statt 10/15 % grob, Newton 9/17 % statt 2/4 %. Die Exoten kamen vorher schon in jedem
  Lauf hinein. Darum bleibt es dort beim Verhalten von 7.4.3.

## Nachher – 16 GPU-Starts und 4 Exoten

Je Zelle: Tiefe nach 60 s (Zehnerpotenzen über dem Start) / größte Tiefe in 120 s / Anteil grober Bilder. **Fett** = Ziel
(≥ 2 nach 60 s) verfehlt. „alt“ = 7.4.3 bzw. `?mutig=0` (gleicher Code), „neu“ = Endstand 7.5.

| Seed | Welt, Start | 7.4.3 | `?mutig=0` (Lauf 1 / 2) | neu (Endstand) |
|---|---|---|---|---|
| 7 | Mandelbrot, Startansicht | +10,2 / 10²¹ / 0 % | +10,5 / 10²¹ / 0 % | +10,4 / 10²¹ / 0 % |
| 8 | Burning Ship, Startansicht | +6,4 / 10¹⁶ / 13 % | +9,7 / 10²⁰ / 0 % | +9,7 / 10²⁰ / 0 % |
| 9 | Tricorn, Kundschafter | **−0,1** / 10¹ / 3 % | **0,0** / 10¹ / 15 % | +3,1 / 10¹² / 12 % · +5,4 / 10¹⁴ / 4 % · **+1,0** / 10³ / 19 %¹ |
| 15 | Multibrot z³, Startansicht | +11,7 / 10²⁵ / 0 % | +11,2 / 10²⁴ / 0 % | +11,3 / 10²⁴ / 0 % |
| 19 | Julia (c am Punkt −0,75), Kundschafter | +2,2 / 10³ / 49 % | **−0,5** / 10¹ / 18 % | **−0,2** / 10¹ / 27 % |
| 23 | Julia, Startansicht | +8,9 / 10¹⁷ / 0 % | +8,5 / 10¹⁸ / 0 % | +9,8 / 10¹⁹ / 0 % |
| 35 | Mandelbrot, Startansicht | +11,9 / 10²⁴ / 0 % | +11,7 / 10²⁴ / 0 % | +11,6 / 10²⁴ / 0 % |
| 45 | Mandelbrot, Kundschafter | +11,8 / 10²⁶ / 0 % | +12,4 / 10²⁷ / 0 % | +11,7 / 10²⁶ / 0 % |
| 46 | Julia, Tour-Ort | – | +9,9 / 10²⁰ / 0 % | +10,0 / 10²¹ / 0 % |
| 51 | Burning Ship, Kundschafter | – | +11,4 / 10²⁴ / 0 % | +11,4 / 10²⁴ / 0 % |
| 53 | Julia, Tour-Ort | – | **+0,8** / 10³ / 3 % · +3,1 / 10³ / 13 % | +3,3 / 10⁴ / 38 % · +2,8 / 10³ / 5 % · +2,5 / 10³ / 13 % |
| 54 | Multibrot z³, Kundschafter | – | +2,9 / 10⁶ / 15 % · +3,7 / 10⁶ / 15 % · +2,1 · **+1,9**² | **+1,9** / 10⁴ / 32 % · **+1,9** / 10⁴ / 28 % · **+1,6** / 10⁴ / 35 % |
| 56 | Burning Ship, Tour-Ort | – | +5,8 / 10⁸ / 14 % · +6,5 / 10¹¹ / 4 % | +7,5 / 10¹⁸ / 0 % |
| 63 | Multibrot z³, Kundschafter | – | +3,2 / 10⁶ / 14 % · +3,7 / 10⁶ / 25 % | +3,7 / 10⁶ / 18 % |
| 65 | Burning Ship, Tour-Ort | – | +11,7 / 10²⁶ / 0 % | +11,7 / 10²⁶ / 0 % |
| 66 | Burning Ship, Tour-Ort | – | +11,7 / 10²⁴ / 0 % | +12,0 / 10²⁷ / 0 % |

¹ Lauf 2 und 3 mit Zwischenständen des Codes, die sich für Klassiker im Mut-/Lernteil nicht vom Endstand unterscheiden (nur
schnelleres rmax-Nachwachsen bzw. Exoten-Einschränkung). Lauf 3: Der Mut wirkt (Zoom 0,6 × Reisetempo), dann wird der Tricorn bei
10^2,4 tatsächlich grob (Schärfe bis 0,06), und die Schärfe-Bremse greift zu Recht. ² zusätzliche Kontrollläufe nur für Seed 54
(16 / 34 % grob).

| Kennzahl (GPU-Welten, alle Läufe, je Start gemittelt) | alt (7.4.3 + `?mutig=0`, 30 Läufe) | neu (20 Läufe) |
|---|---|---|
| Starts mit Hänger (mind. ein Lauf < 2 Zehnerpotenzen nach 60 s) | 4 (9, 19, 53, 54) | 2 (19, 54); mit den Zwischenständen ¹ 3 (Seed 9 in 1 von 3 Läufen) |
| Anteil Läufe < 2 nach 60 s, je Start gemittelt | 14,1 % | 12,5 % |
| grob, je Start gemittelt | 6,6 % | **6,8 %** (Ziel ≤ 6,6 + 2) |
| Zeit Reise / Rückweg / Warten / Schweben / Bremsen | 77 / 10 / 7 / 3 / 2 % | 79 / 10 / 8 / 2 / 2 % |
| Phasenwechsel je Minute (16 Starts, 1. Lauf) | 5,8 | 3,8 |
| kürzestes Rückweg-Pendel | 16,4 s | 15,3 s (Regel ≥ 8 s) |
| Bremsursache rmax (16 Starts, 1. Lauf) | 4 % | 1 % |

| Exoten (Phoenix, Magnet, Newton, Lyapunov; je 2 Läufe) | alt (7.4.3 + `?mutig=0`) | neu |
|---|---|---|
| < 2 Zehnerpotenzen nach 60 s | 0 von 8 | 0 von 8 |
| Tiefe nach 60 s, Median | +4,5 | +4,9 |
| grob | 14,7 % | 12,9 % |

**Ziel „alle GPU-Läufe ≥ 2 Zehnerpotenzen nach 60 s“: nicht ganz erreicht.**
- Seed 19 (Julia mit c direkt am parabolischen Punkt −0,75) hängt in beiden Ständen an der Rechenleistung: Das volle Bild kostet
  1,65 s. In Bewegung bleibt die Vorschau halb aufgelöst (Schärfe genau 0,50), auch im Schweben und Warten. Hineinfliegen hieße
  dort grob fliegen. 7.4.3 kam in einem von zwei Läufen knapp über die Marke (+2,2, aber 49 % grob).
- Seed 54 (Multibrot z³, Kundschafter bei 10²): Grenzszene. Alt 1,9–3,7 Zehnerpotenzen (4 Läufe), neu 1,6–1,95 (3 Läufe). Die
  geänderten Regeln greifen dort nicht („verloren“ 0, Mut 0). Der Unterschied liegt beim Dauertempo: Das alte Lernen aus Tempo ≈ 0
  ließ ihn dort sehr langsam weiterkriechen (rmax 0,03), das neue lässt ihn schneller ansetzen, er landet öfter in Rückweg und
  Warten. Bei 3 gegen 4 Läufen und dieser Streuung ist das nicht sicher, wird aber beobachtet.
- Am Handy (langsamere Grafik) sind Bremsungen häufiger. Dort sollte das Dauertempo-Lernen (Ursache 1) öfter zugeschlagen
  haben. Gemessen ist das nur am Mac.

## Tests

- **Neu `tests/test_v75.py`** (Mandelbrot-Startansicht, Tempo 0,3, Schärfe per `Object.defineProperty` erzwungen):
  A Bremsen beim Anfahren lässt das Dauertempo stehen (12–32 s: **6,0** Zehnerpotenzen; 7.4.3: **1,5**, rot),
  B „verloren“ × zf bei scharfem Bild (FLY.lost/zf festgehalten): **3,6** Zehnerpotenzen, 0 Phasenwechsel (7.4.3: **0,02**,
  12 Wechsel, rot), C `?mutig=0` wie 7.4.3 (0,02), D Schärfe-Bremse bleibt (grob ab 8 s → Bremsen, Schweben, Rückweg).
  Vorgänger 7.4.3 (Port 8479): A und B rot.
- Grün: `test_v743` (Sonde fertig, Rand in der Bildmitte 0,96), `test_v721` A–F (Lavalampe: Seepferdchen 0 % grob, Phoenix
  kürzestes Pendel 9,6 s, Mandelbulb, Tour), `test_v731` A + B, `test_v740` (Roll, Schweben am Rand, Randstart), `test_v720`
  (Zufallsstart), `test_rueck`, alle Node-Tests (73), `node_core_test`, `tools/check_release.py`.
- Geändert: `test_v731` B prüfte „nie durchgegangen“ als < 3 Zehnerpotenzen in 15 s. Das hielt nur, weil der Flug nach dem
  Bremsen kroch. Neu gilt: nicht schneller als das Reisetempo (0,3/s × 15 s). Das echte Durchgehen 7.3.0 lag bei bis zu 66
  Zehnerpotenzen/s.
- Rot wie auf 7.4.3 (dort gegengeprüft): `test_fly2d` „Stopp: Leiste weg, ✈-Knopf wieder da“ (seit 7.4.0 bleibt die Leiste mit dem
  Kompass-Knopf bei gedrehtem Bild stehen).
- Rohdaten: `tests/results_v75_{731,743,mutig0,mutig0B,mutig0C,neu,neuB,neuF,neuG,final}.json` (`_neu`/`_neuB`/`_neuF`: Zwischenstände,
  siehe ¹), Tabellen `python3 tests/measure_v75.py table=_731,_743,_mutig0,_final`.
