# Fraktale 7.1 – Bericht

Auftrag „Fraktale 7.1 – Neue Welten + Feinschliff“ (Peter, 09.10.2026: „nur zu!“) mit den Nachträgen vom 10. und 14.10.
Dieser Bericht wächst mit jeder Etappe; Einzelheiten zu jeder Version stehen im Changelog der README und in den Commits.

## Überblick der Releases

| Version | Inhalt |
|---|---|
| 7.1.0 | Look: Färbe-Stile für alle 2D-Welten – Seide (Stripe Average), Dreieck (TIA), Orbit-Fallen, Pickover-Stängel |
| 7.1.1 | Neue Welten: Lyapunov, Phoenix, Nova, Magnet I/II, Multibrot zⁿ, Burning-Ship-Familie, Newton mit Polynomwahl |
| 7.1.2 | Lichtbilder: Fraktal-Flammen, seltsame Attraktoren, Nebulabrot, Anti-Buddhabrot (GPU-Dichte-Renderer) |
| 7.1.3 | Weitere 3D-Fraktale: Quaternionen-Julia, Kaleidoskop-IFS, Apollonian |
| 7.1.4 | Julia-Lupe und Julia-Morph |
| 7.1.5 | Feinschliff: Sehenswürdigkeiten für alle Welten (84 Orte), Burning Ship/Tricorn ohne Staub-Sterne |
| 7.1.6 | Neue Standards nach Peter (Eis, Bunt, Grenznah 100 px, Farbtempo 20 s), Vollbild beim ersten Tipp, Zufalls-Startwelt, Neuladen = Neustart, sanfter Flugstart |
| **7.1.7** | **Ruhiger 3D-Flug** (dieser Abschnitt) |

Galerie-Bögen der Welten: `tests/shots/v71/blatt_*.jpg`.

## 7.1.7 – Ruhiger 3D-Flug

Peter, 10.10.: „Mandelbulb-Flug ist ziemlich ruckelnd.“ – 14.10.: „Flug ist noch zu unruhig … Anfangsgeschwindigkeit etwas
langsamer machen.“ Gilt für alle Ray-Welten (Mandelbulb, Mandelbox, Menger, Quaternionen-Julia, Kaleidoskop-IFS).

### Ursachen (gemessen, nicht vermutet)

1. **Takt:** Der alte Regler stellte die Auflösung fast jedes Bild um ×0,9/×1,04 nach (30–35 Wechsel/s, Skala pumpte
   0,28–0,70). Die Bilder sprangen zwischen 16 und 33 ms (p95 = 2 × Median) – das sieht man als Ruckeln.
2. **Kamera-Sägezahn:** Die Kollision schob die Kamera in festen 6-%-Sprüngen von der Oberfläche weg – drei Bilder vor,
   eines zurück. Kamera-Schritt je Bild ±40 % trotz gleichmäßigem Takt.
3. **Blick:** exponentielles Nachführen (k = 3/s) – jeder Zielwechsel der Sonde (alle 250 ms) war ein Sprung in der Drehrate,
   Drehraten bis 35°/s.
4. **Prozessor-Spitze:** Die Sonde schoss 25 Strahlen auf einmal (Mandelbox im Mittelklasse-Profil bis ~20 ms) – alle
   250 ms fiel ein Bild aus.
5. **Zeitstempel:** Die Kamera bewegte sich mit dem rohen rAF-Abstand; der zittert unter Last um ±8 ms, das Display zeigt
   aber im festen Takt → ungleich große Schritte je gezeigtem Bild.

### Lösung

- **Takt einrasten:** ein Bewegungsbild je N Bildschirmtakte (60/30/20 Bilder/s), nach der Zeit statt nach der Takt-Nummer
  (fällt ein Takt aus, kommt das nächste Bild sofort). Last aus GPU-Fences („zum eigenen Takt nicht fertig“) und
  ausgefallenen Bildern.
- **Qualitätsleiter mit Ruhe:** erst weiche Schatten aus, dann AO auf 1 Probe und 85 % Marsch-Schritte, zuletzt die Pixel;
  höchstens ein Wechsel je Sekunde; eine gescheiterte Probe geht zurück und wird 30 s gesperrt; von 30 zurück auf 60
  Bilder/s frühestens nach 30 s und nur, wenn die GPU fast immer schon nach einem Takt fertig war. Jede Welt merkt sich
  ihre Stufe für den nächsten Flug.
- **Timer-Queries geprüft und verworfen:** unter Metal/ANGLE maßen sie bei geteilter GPU die Wartezeit mit (≈ 30 ms auch
  bei kleinster Auflösung), und Safari auf dem iPhone kennt sie ohnehin nicht.
- **Zeitschritt in ganzen Bildschirmtakten** (`js/flight.js` taktDt, für alle Flüge inkl. 2D/Landschaft): absolutes Raster mit
  nachgeführter Phase (pro Schritt gerundet summierten sich Fehler; mit fester Phase flatterte die Rundung zwischen 0 und 2).
- **Bahn und Kamera getrennt:** die Bahn wird an einer Ideal-Stelle weitergerechnet; die Kamera folgt ihr über eine kritisch
  gedämpfte Feder (ω = 10/s, bei ausgefallenem Takt in zwei kleinen Schritten). Erst so verschwand der letzte Effekt: rechnete
  die Bahn von der nachlaufenden Kamera aus weiter, stieß jeder ausgefallene Takt eine kleine Schwingung an (+27 % Tempo).
- **Blick als Feder:** Drehrate ≤ 20°/s, Drehbeschleunigung ≤ 40°/s² – ein neues Ziel ändert die Beschleunigung, nie
  sprunghaft die Drehrate. Kollision schiebt genau um das Defizit; Sonde auf 5 Bilder verteilt.
- **Flug-Tempo 0,3** statt 0,5 (Anfahrt weiterhin 2 s); Einstellungs-Version 3: nur ein gespeichertes 0,5 wird einmal 0,3.
  Beim Test dieser Migration fiel ein Fehler auf, der behoben ist: die 7.1.6-Migration wäre mit der neuen Version erneut
  gelaufen und hätte Peters Palette/Saum ein zweites Mal überschrieben.

### Messung

`tests/measure_bulbfly.py`, Mittelklasse-Profil (Pixel 7, DPR 2,6, CPU ×4, 4 Kerne, echte GPU, sichtbares Fenster), Tempo 0,5,
20 s Autopilot je Welt, ausgewertet ab 2,5 s (nach der Anfahrt); in Klammern „ab 6 s“ = eingeschwungen (Takt-Stufe gefunden).
Alt = `?bulbpace=0` (Regler und Kamera bis 7.1.6), gleicher Lauf, gleicher Rechner. Ergebnisse:
`tests/results_bulbfly_a716_hoch.json` (alt), `tests/results_bulbfly_v717_hoch.json` (neu).

| Welt | Bilder/s | Bildzeit-σ ms (ab 6 s) | p95/Median | Bilder > 50 ms | Skala-Wechsel/s | Skala | Kamera-Zickzack (ab 6 s) | Blick max °/s | Blick-Ruck p99 | Pos.-Ruck p99 | Takt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Mandelbulb | 48,4 → 33,8 | 9,67 → 7,01 (0,68) | 2,93 → 1,04 | 14 → 0 | 34,51 → 0,06 | 0,28–0,7 → 0,59–0,7 | 0,492 → 0,102 (0,002) | 31,6 → 20,0 | 4,89 → 0,27 | 2,14 → 0,003 | 60/30 |
| Mandelbox | 48,0 → 32,3 | 10,8 → 5,91 (0,91) | 2,11 → 1,05 | 23 → 0 | 33,32 → 0,11 | 0,28–0,7 → 0,59–0,7 | 0,566 → 0,105 (0,066) | 22,7 → 14,0 | 3,24 → 0,37 | 2,103 → 0,004 | 60/30 |
| Menger | 59,5 → 45,8 | 2,27 → 7,74 (6,77) | 1,1 → 2,01 | 1 → 0 | 0,69 → 0,0 | 0,57–0,7 → 0,7–0,7 | 0,159 → 0,017 (0,018) | 25,2 → 10,7 | 1,15 → 0,26 | 0,986 → 0,002 | 60/30 |
| Quaternionen-Julia | 49,6 → 59,0 | 9,13 → 2,39 (1,3) | 2,04 → 1,09 | 15 → 1 | 30,69 → 0,23 | 0,28–0,7 → 0,44–0,7 | 0,538 → 0,108 (0,064) | 29,1 → 14,4 | 3,68 → 0,27 | 2,082 → 0,004 | 60 |
| Kaleidoskop-IFS | 53,0 → 60,0 | 5,8 → 0,68 (0,68) | 2,0 → 1,08 | 1 → 0 | 4,74 → 0,06 | 0,46–0,7 → 0,44–0,51 | 0,366 → 0,001 (0,001) | 13,6 → 20,0 | 1,64 → 0,31 | 0,307 → 0,003 | 60 |
| Mandelbulb (GPU ×4) | 32,4 → 29,7 | 15,56 → 2,6 (2,18) | 2,0 → 1,06 | 59 → 3 | 0,91 → 0,17 | 0,28–0,37 → 0,33–0,51 | 0,517 → 0,088 (0,086) | 35,3 → 19,4 | 6,15 → 0,36 | 1,996 → 0,005 | 30 |

Maße: *Bildzeit-σ/p95/> 50 ms* über die gezeigten Bewegungsbilder; *Kamera-Zickzack* = Streuung jedes Kamera-Schritts gegen das
Mittel seiner Nachbarn (fängt Ruckeln, nicht gewollte Tempoänderungen; der im Auftrag genannte Variationskoeffizient über
11 Bilder enthält auch weiches Beschleunigen und liegt bei 0,004–0,16, Autokorrelation der Abweichungen +0,5 = weiche
Tempoänderung, kein Zickzack); *Blick-Ruck* = Änderung der Drehrate je Takt (°/s); *Positions-Ruck* = 2. Differenz der
Geschwindigkeit je Flugzeit × Takt², relativ zum Zielabstand.

**Abnahme gegen die Kriterien:**

| Kriterium | Ergebnis |
|---|---|
| Bildzeit-σ ≤ 3 ms | eingeschwungen erfüllt (0,68–2,2 ms) außer Menger in diesem Lauf (wechselte während der Messung von 60 auf 30, s. u.); über die ganzen 17,5 s inkl. Einrasten nicht erfüllt (5,9–7,7 ms bei Welten, die von 60 auf 30 einrasten) |
| p95 ≤ 1,15 × Median | erfüllt bei festem Takt (1,04–1,09); Menger 2,0 wegen des Wechsels |
| 0 Bilder > 50 ms | erfüllt bis auf Q-Julia 1, schwache GPU 3 (vorher 1–59) |
| Skala-Wechsel ≤ 1/s | erfüllt (≤ 0,23/s, vorher bis 35/s) |
| Kamera-Schritt gleichmäßig (≤ 10 %) | Zickzack eingeschwungen 0,001–0,086 erfüllt; über das ganze Fenster 0,10–0,11 bei drei Welten (Einrasten fällt hinein) |
| Blick ≤ ~20°/s im Autopilot | erfüllt (≤ 20,0°/s, vorher bis 35°/s) |
| Ruck-Spitzen −80 % | Positions-Ruck −99 %; Blick-Ruck −77 % (Menger) bis −94 %; test_v717 B: Knicke im Kamera-Tempo p99 310 % → 0,8–3 % |
| Bildfolge 16 Frames „wirkt die Kamerafahrt ruhig?“ | `tests/shots/v717/fly_*_{neu,alt}.jpg` (`tests/series_v717.py`): neu gleichmäßig fortschreitend, ohne Hin- und Herspringen; die alte Folge wechselt Blick und Abstand von Bild zu Bild sprunghafter. Sichtprüfung durch mich, kein separates Vision-Modell |

**Ehrlich zu den Grenzen:**

- **Störlast auf dem Messrechner:** Während aller Messungen lief macOS-Fotoanalyse (`mediaanalysisd` 120–235 % CPU, teilt die
  GPU). Dieselbe Welt lief je nach Lauf mal mit 60, mal mit 30 Bildern/s (Menger und KIFS waren in anderen Läufen bei 60 mit
  σ 0,7 ms und Zickzack 0,001). Die Messung ist darum streuender als sonst; die Trendaussagen (Faktor 10–1000) sind stabil.
- **30 statt 60:** Auf dem Mittelklasse-Profil rasten Mandelbulb und Mandelbox meist auf gleichmäßige 30 Bilder/s ein. Das ist
  gewollt (gleichmäßig statt 60↔30), sieht aber weniger flüssig aus als echte 60. Die Zwischenbilder per Reprojektion kommen mit
  der nächsten Etappe („Im Flug immer scharf“), die ohnehin Vorausrendern und Reprojektion baut.
- **Erste Sekunden:** Ein Gerät, das 60 nicht schafft, braucht beim ersten Flug einer Welt 2–7 s, bis es eingerastet ist (danach
  merkt sich die Welt die Stufe).
- **Auflösung im Flug:** weiterhin 0,44–0,70 (Stufe „Mittel“) – genau das, was Peter als unscharf sieht; das ist der nächste
  Release.
- **120 Hz:** kein 120-Hz-Display am Messrechner. Takt-Raster und Einrastung rechnen mit der gemessenen Bildschirmperiode
  (8,33 ms wird erkannt), sind dort aber nicht gemessen.
- **Steckenbleiben im Tauchflug:** Der Tauchflug bleibt manchmal lange an derselben Stelle (Zoom stagniert, in der Mandelbox
  vorher wie nachher) – das löst das „Darüber-Hinweggleiten“ der Durchflug-Etappe.

### Tests

- `tests/test_v717.py` A–D: Flug-Tempo/Migration (6 Fälle), Ruhe der Kamerafahrt (Drehrate ≤ 20°/s, Blick-Ruck p99 < 1,5°/s,
  Knicke < 10 %, Skala ≤ 1/s), alter Regler läuft, Lenken im Flug – grün.
- Regression grün: test_v716 (A–G), test_v70, test_v71, test_rueck, test_fly2d, test_fs_fly, test_fly64, test_v62, test_smooth,
  test_3d, test_shader_fail, test_hud_fs, test_release, Unit-Tests (53), node_core_test.
- Angepasst: test_v716 G und test_rueck messen den Ruck jetzt je Flugzeit (`FLY.simT`) statt je rAF-Zeitstempel (die zittern unter
  Last ±8 ms, die Kamera nicht mehr – mit der alten Zeitbasis maß der Test das Zittern des Testrechners); test_rueck setzt das
  Tempo 0,5 ausdrücklich (Standard jetzt 0,3).
- Einmal beobachtet und nicht reproduzierbar: test_v70 „Rückflug bis ganz draußen“ blieb bei Zoom 219 stehen; eine
  Wiederholung des Tests und zwei nachgestellte Abläufe (mit und ohne Pause/Größenwechsel vor dem Rückflug) liefen sauber durch.
