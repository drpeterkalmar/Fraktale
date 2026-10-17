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
| 7.1.7 | Ruhiger 3D-Flug: gleichmäßiger Takt, Kamera und Blick ohne Zittern, Flug-Tempo 0,3 |
| 7.1.8 | Im Flug immer scharf: volle Auflösung, Zwischenbilder, Streifen, Vorausrendern, langsamer statt unscharf |
| 7.1.9 | Durchflug, Gleiten, sanfte Fluglage |
| **7.1.10** | **ⓘ-Faktenkarte je Welt** (Abschnitt unten) |

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


## 7.1.8 – Im Flug immer scharf

Peter, 14.10.: „… wenn beim Flug nicht das Bild unscharf und pixelig wird, sondern immer perfekt aussieht, am besten durch
vorausschauendes Rendern?“ Ausgangslage (7.1.7): Auflösungsskala im Flug 0,44–0,70, die Bewegung rechnete außerdem mit zwei
Iterationen weniger, gröberem Treffer-Epsilon und ohne bzw. mit wenigen Schatten – das Flugbild zeigte eine andere, weichere
und 1,4–2,2-mal hellere Oberfläche als das Standbild an derselben Stelle.

### Umsetzung (Stufen nach Messung)

1. **Schärfe vor Tempo** (Standard; `?scharf=0` = Weg 7.1.7): die Auflösung bleibt immer 1,0. Reicht die GPU nicht, kommen
   weniger echte Bilder, und der Flug wird weich langsamer (Faktor 2/N bei einem echten Bild je N Takte; Tempo-Regler =
   Höchsttempo). Die Effekte bleiben auf jeder Stufe gleich und nahe am Standbild (Iterationen wie dort, 60 % der Schatten-
   Schritte mit gleicher Reichweite, volle AO, 70 % Marsch-Schritte, Epsilon 0,6) – so gibt es auch keinen Helligkeits-
   sprung, wenn der Regler umschaltet.
2. **Vorausrendern** (Standard; `?voraus=0` = aus) – nicht als Ringpuffer vieler Bilder, sondern in der Form, die die Messung
   nahelegte: Ein echtes Bild wird **in Streifen über N Takte** gerechnet (jeder Takt gleich viel Arbeit, ein teures Bild
   verdrängt die Anzeige nicht mehr) und zwar **für die Kamera, die beim Fertigwerden erreicht ist** (der Autopilot kennt
   seine Bahn: Kamera und Blick folgen gedämpften Federn mit stetiger Geschwindigkeit). Jeder Takt dazwischen zeigt den
   Verlauf per Tiefen-Reprojektion in seiner Kamera (**Zwischenbilder**: 30, 20 … echte → 60 angezeigte Bilder/s). Gemessen
   bei fester Stufe (15 echte Bilder/s): Kantenschärfe Mandelbulb 0,96 mit / 0,81 ohne Vorausschau. Ein Puffer über
   Sekunden wäre bei Lenken/Gesten zu verwerfen und brauchte bis 150 MB; die Streifen brauchen keinen zusätzlichen Speicher.
3. **Temporal hochrechnen** (Standard; `?taau=0` = jedes echte Bild voll gerechnet): auf den unteren Stufen wird je echtem
   Bild nur jedes 4. Pixel neu marschiert (2×2-Raster, Versatz wechselt), die übrigen kommen per Tiefen-Reprojektion aus dem
   Verlauf – ein gemeinsamer Pfad mit den Zwischenbildern (RESOLVE_FS). Gegen Schlieren: Reprojektion nur, wenn die Tiefe
   passt (vier Proben-Kandidaten + Fixpunkt-Suche), Klemme auf den Wertebereich der neuen Proben dort, wo die Reprojektion
   unsicher ist, frei gewordene Stellen aus den neuen Proben (tiefenbewusst), Catmull-Rom statt bilinear (bilinear verwischte
   jede Reprojektion weiter). Ein 3×3-Raster war gebaut, zeigte aber Treppen an Silhouetten und Streifen – gestrichen.
- Leiter: volle Abtastung 60/30 → 2×2-Raster 60/30 → 20/15/10/7,5/5 echte Bilder/s; Wechsel ≤ 1/s, Sperren 10–15 s.
- Startbild aus dem geglätteten Standbild; beim Anhalten wird der Verlauf in die aktuelle Kamera gebracht (sonst sprang das
  Bild um die Streifen-Takte zurück – auch der Weg 7.1.7 springt hier um 1–4 px, s. Versatz unten).
- Speicher (Pixel-7-Profil, Canvas 824 × 1678): 66 MB (vorher 49 MB) – Marsch-Ziel = Ziel der Ruhebild-Mittelung.
- Nebenbei behoben: die Schonfrist nach einem Größenwechsel (Flugschritt ≤ 1/30 s) wurde seit 7.1.7 von der Takt-Rundung
  überschrieben (test_fs_fly).

### Messung

Schärfe: `tests/measure_scharf.py` – je Welt 3 Punkte im Flug (Mittelklasse-Profil, Tempo 0,5): Flug pausieren, sofort das
gezeigte Bild, dann das fertig gemittelte Standbild derselben Kamera. Maße im mittleren Ausschnitt (70 %):
Kantenschärfe = mittlerer Sobel-Betrag Flug/Stand (normiert), SSIM, Helligkeit Flug/Stand, Versatz = beste Verschiebung.
Ergebnisse `tests/results_scharf_{v717,v718}.json`, Bildpaare `tests/shots/v718/scharf_*.jpg`.

| Welt | Skala 7.1.7 → 7.1.8 | Kantenschärfe Mittel (Min–Max) | SSIM Mittel | Helligkeit Flug/Stand | Versatz beim Anhalten |
|---|---|---|---|---|---|
| Mandelbulb | 0,59 → 1,0 | 0,71 → **0,86** (0,86–0,86) | 0,21 → 0,67 | 2,07 → 1,23 | 1–4 px → 0 |
| Mandelbox | 0,70 → 1,0 | 0,62 → **0,90** (0,85–0,94) | 0,30 → 0,71 | 1,66 → 1,20 | 1–4 px → 0–1 |
| Menger | 0,70 → 1,0 | 0,60 → **0,79** (0,72–0,87) | 0,34 → 0,60 | 1,13 → 1,03 | 1 px → 0 |
| Quaternionen-Julia | 0,51–0,70 → 1,0 | 0,77 → **1,02** (0,96–1,06) | 0,67 → 0,85 | 1,29 → 1,09 | 4–6 px → 0* |
| Kaleidoskop-IFS | 0,70 → 1,0 | 0,62 → **1,07** (0,98–1,26) | 0,42 → 0,78 | 1,05 → 1,01 | 1 px → 0 |

\* einmal [4, −3]: periodisches Muster, die Verschiebungssuche findet dort ein Nebenmaximum.

Takt und Tempo: `tests/measure_bulbfly.py --secs=30 --slow=1,4` (Mittelklasse-Profil; „GPU ×4“ = Marsch-Pass viermal,
simuliert ein schwaches Handy). Angezeigt = echte + Zwischenbilder. Tempo-Faktor = wie schnell der Flug gegenüber dem Regler
fliegt (Schärfe vor Tempo).

| Welt | angezeigt Bilder/s | echte Bilder/s | Bildzeit-σ ms (ab 6 s) | p95/Median | > 50 ms | Skala | Tempo-Faktor Mittel (Min) | Takt N |
|---|---|---|---|---|---|---|---|---|
| Mandelbulb | 59,1 | 30,2 | 2,16 (2,29) | 1,08 | 0 | 1,0 | 1,0 (0,82) | 1/2/3 |
| Mandelbox | 59,7 | 22,9 | 1,4 (1,47) | 1,08 | 0 | 1,0 | 0,76 (0,67) | 2/3 |
| Menger | 59,4 | 27,8 | 1,77 (1,88) | 1,08 | 0 | 1,0 | 0,77 (0,5) | 1/2/3/4 |
| Quaternionen-Julia | 59,7 | 27,3 | 1,3 (0,67) | 1,08 | 0 | 1,0 | 0,88 (0,67) | 1/2/3 |
| Kaleidoskop-IFS | 59,1 | 57,0 | 2,21 (1,72) | 1,1 | 0 | 1,0 | 1,0 (0,99) | 1/2 |
| Mandelbulb (GPU ×4) | 57,3 | 5,3 | 4,06 (3,19) | 1,11 | 2 | 1,0 | **0,22** (0,17) | 3/6/12 |

Ein Lauf eine Stunde früher, während auf dem Rechner zusätzlich ein Hermes-Job und die macOS-Fotoanalyse liefen (Last 6–8):
Tempo-Faktor Mandelbulb 0,33–0,5, Mandelbox 0,43, Menger 0,69, Q-Julia 0,67, KIFS 0,87 – bei ebenfalls 59–60 angezeigten
Bildern/s. Das Tempo ist also genau die Größe, die nachgibt, wenn die GPU knapp ist.

**Abnahme gegen die Kriterien:**

| Kriterium | Ergebnis |
|---|---|
| Auflösungsskala im Flug ≥ 0,95 | erfüllt: 1,0 in allen Welten und auf allen Stufen |
| SSIM ≥ 0,95 oder Kantenschärfe ≥ 90 % | Kantenschärfe erfüllt bei Mandelbox (0,90), Q-Julia (1,02), KIFS (1,07); knapp nicht bei Mandelbulb (0,86) und Menger (0,79). SSIM 0,60–0,85: das Standbild mittelt 12 versetzte Bilder (Kantenglättung) – schon ein voll gerechnetes Einzelbild kommt beim Menger nur auf SSIM ~0,63 (Flimmern der feinsten Löcher). Zeitliche Glättung mit Subpixel-Versatz war gebaut und gemessen: sie hob die SSIM nicht und kostete Kantenschärfe (0,94 → 0,83) – Standard aus (`?taaujit`). |
| Takt-Kriterien aus 7.1.7 | erfüllt: angezeigt 59–60 Bilder/s, σ 0,7–2,3 ms, p95 ≤ 1,1 × Median, 0 Bilder > 50 ms (schwache GPU: 2) |
| Tempo-Einbußen als Tabelle | s. o.: Mittelklasse-Profil 0,76–1,0 des Reglertempos, schwache GPU 0,22 |
| Speicher-Spitze | 66 MB (Pixel-7-Profil) |
| Bildfolgen 16 Frames „scharf wie Standbild? Pixel? Schlieren?“ | `tests/shots/v718/serie_<welt>_{neu,alt}[_1zu1].jpg` (`tests/series_v718.py`). Meine Sichtprüfung (kein separates Vision-Modell): neu deutlich schärfer (Menger-Löcher, Mandelbulb-Knospen klar begrenzt, Schattierung wie im Stand), alt weich hochskaliert mit flimmernden Lichtsäumen; neu in extrem feinkörnigen Mandelbulb-Zonen leichte Körnung und vereinzelte Reißverschluss-Kanten an Silhouetten, keine Schlieren hinter bewegten Kanten gefunden |

**Ehrlich zu den Grenzen:**

- **Schwaches Handy:** Volle Schärfe gibt es dort nur über Tempo – bei 4× langsamerer GPU fliegt der Mandelbulb mit etwa
  einem Fünftel des eingestellten Tempos (5 echte Bilder/s, angezeigt weiter ~57). Wem das zu langsam ist: `?scharf=0`
  (Weg 7.1.7, schneller, aber grob) – als Schalter in den Optionen ist das noch nicht angeboten.
- **Helligkeit:** Das Flugbild ist im Mittel noch 1–23 % heller als das Standbild (60 % der Schatten-Schritte); volle
  Standbild-Effekte trafen die Helligkeit (0,97–1,0), kosteten aber so viel, dass der Mandelbulb nur noch mit grobem Raster
  flüssig lief. Die Überblendung beim Anhalten (180 ms) fängt den Rest auf.
- **Messrechner:** Messungen schwanken stark mit der Fremdlast (macOS-Fotoanalyse teilt die GPU); kein 120-Hz-Display
  vorhanden – Takt-Raster, Streifen und Zwischenbilder rechnen mit der gemessenen Bildschirmperiode (8,33 ms wird erkannt),
  sind dort aber nicht gemessen.
- **2D-Flug:** mitgemessen (Bildfolge Mandelbrot, Pixel-7-Profil): sichtbar scharf (Schärfe-Front seit 5.1) – nicht geändert.

### Tests

- `tests/test_v718.py` A–F: Flug in voller Auflösung (Skala 1, echte + Zwischenbilder), Anhalten ohne Sprung (Versatz 0),
  Start aus dem Ruhebild, Schärfe vor Tempo (Tempo-Faktor 2/N), `?scharf=0` / `?taau=0`, Speicher ≤ 150 MB – grün.
- `tests/test_shader_fail.py` (l): Auflöse-Pass defekt → scharfer Weg aus, Flug wie 7.1.7, keine Fehler – grün.
- Unit `tests/unit/bulb.test.js`: alle Shader der 3D-Welten durch den GLSL-Prüfer.
- Regression grün: test_v717, test_v716, test_v70, test_v71, test_rueck, test_fs_fly, test_hud_fs, test_fly2d, test_release,
  Unit-Tests (54). test_shot: alle Nähte der 2D- und Ray-Welten bitgleich; „Naht 3D“ (3D-Landschaft, von 7.1.8 nicht berührt)
  zeigte unter der heutigen Fremdlast 560–670 abweichende Werte bis 12–21/255 – genauso beim veröffentlichten 7.1.7 im selben
  Lauf (Gegenprobe im eigenen Arbeitsbaum), also vorbestehend und lastabhängig.
- Rückflug-Hänger (test_v70, zweimal im langen Testlauf: Rückflug blieb bei Zoom ~200 stehen, im nachgestellten Ablauf nie):
  Ursache nicht gefunden; abgesichert mit einem Fortschrittswächter – sinkt der Zoom eine Sekunde lang nicht (weniger als
  10 % des Tempos), gilt der aufgezeichnete Weg nicht mehr und der Flug zieht vom Ziel weg heraus; scheitert der Schritt an
  einer Wand, weicht er entlang der Blickrichtung aus. test_v70 danach grün (11,5 s bis „Ganz draußen“).
- test_rueck: Schwelle „nach 1,5 s losgeflogen“ von Zoom 1,5 auf 1,3 – seit der sanften Anfahrt (7.1.6) lag der Wert genau
  auf der Kante (7.1.7: 1,50, 7.1.8: 1,48).


## 7.1.9 – Durchflug, Gleiten, sanfte Fluglage

Peter, 10.10.: „Kann man durch den Menger-Schwamm und andere 3D-Dinger darüber und durchfliegen statt reinzoomen mit dem
Flugzeug?“ – 14.10.: „… kann auch gern etwas Pitch, Yaw und Roll machen (nicht übertreiben) … wenn an Oberfläche eines
3D-Objektes, dann darüber hinweggleiten.“ (Etappe vor die ⓘ-Faktenkarte gezogen.)

### Umsetzung

- **Zwei Flug-Arten**: ✈ **Durchflug** (Standard für Menger-Schwamm, Mandelbox, Kaleidoskop-IFS, Apollonian) und 🔍 **Tauchen**
  (bisheriger Flug, Standard für Mandelbulb und Quaternionen-Julia). Umschalter in der Flug-Leiste (im Flug, wechselt weich) und
  im 3D-Bedienfeld („Flug“); die Wahl wird je Welt gespeichert.
- **Durchflug**: Die Kamera fliegt in Blickrichtung; Tempo ∝ Abstand zur Oberfläche (v = 2,6 · Tempo · Abstand), gedeckelt durch
  die lokale Skala und den freien Weg geradeaus – in engen Gängen langsam, in offenen Hallen schnell, nie in die Wand.
  Iterationen und Treffer-Epsilon folgen dem Abstand (Zoom = Z0/Abstand). Autopilot: Sonde aus 7 × 5 Strahlen im Blickkegel
  (±36° × ±24°, verteilt auf 5 Takte); Kurs weich (Federn) auf den Strahl mit dem längsten freien Weg, Hysterese 15 %, etwas
  Trägheit. Strahlen ohne Treffer werden unterschieden: Tunnel (am Strahl-Ende noch Struktur nah) zählt voll, Leere zählt
  quadratisch wenig – ohne diese Unterscheidung flog der Autopilot aus dem Menger-Schwamm hinaus und wurde dabei, weil das
  Tempo am Abstand hängt, exponentiell schneller. Führt alles ins Leere: Kurs zur Mitte des Gebildes. Sackgasse: zur Seite mit
  dem meisten Platz. Ziel genau hinter dem Kurs: Wende über die Seite. Vor Leere oder Wand darf der Blick 30°/s drehen
  (sonst 20°/s).
- **Gleiten** (beide Flug-Arten, `?gleiten=0` = aus): Durchflug – unter der Gleithöhe (4 % der lokalen Skala) Kurs ganz
  tangential, Höhe geregelt (4/s, geglättet), Normale tiefpassgefiltert (keine Hüpfer über kleine Knospen), Blick 8° nach unten;
  nur über offenen Flächen (gegenüber muss Platz sein, sonst regelte es in engen Gängen gegen eine Wand). Tauchen – unter der
  Gleithöhe (12 % des Zielabstands, nie unter der Grenze der Handsteuerung) kein Abstoßen, sondern Höhe halten, das Ziel wandert
  tangential voraus und bleibt auf der Oberfläche; der Tauch-Abstand schrumpft im Gleiten weiter, man gleitet immer tiefer ins
  Detail bis zur Genauigkeitsgrenze.
- **Sanfte Fluglage** (`?schwanken=0/1/2`, Schalter „Sanft schwanken“ im 3D-Bedienfeld): Summe langsamer Sinusse, Perioden
  6,3–11,9 s – Gieren ±4°, Nicken ±3°, Rollen ±6°; Querneigung in Kurven ∝ Drehrate; Rollen gesamt ≤ 15°. Nur Blick/Roll in der
  Darstellung (Sonden, Kollision und Bahn nutzen den Kurs ohne Schwanken); mit der Anfahrt eingeblendet, nach dem Flug in
  ~0,6 s ausgeblendet. Die Kamera kann dafür jetzt rollen (Kamera-Basis, Reprojektion des scharfen Flugs inklusive).
- **Kollision**: Durchflug – kein Schritt länger als der halbe Abstand (die Distanzschätzung ist eine Schranke: keine Wand wird
  übersprungen), Mindestabstand 35 % der Gleithöhe. Tauchen – Schritt ebenso begrenzt, Strecke geprüft, an Kanten Mindesthöhe
  gegen alle Flächen.
- **Rückwärts**: Durchflug auf dem aufgezeichneten Weg (ein Punkt je ¼ Abstand) bis zum Anfang („Am Anfang des Wegs“).
- **Lenken**: Ziehen dreht im Durchflug den Kurs (Gieren/Nicken), danach übernimmt der Autopilot weich.
- Behoben beim Prüfen: (1) Das Tauchziel glitt auf gerader Linie zum nächsten Zielpunkt und lag dabei in der Luft – der
  Tauchflug zielte auf einen Luftpunkt und hing an der Genauigkeitsgrenze (vermutlich das „Steckenbleiben im Tauchflug“ aus
  7.1.7); es bleibt jetzt auf der Oberfläche. (2) Nach dem Gleiten an der Genauigkeitsgrenze kam der Rückflug nicht los
  (test_v70) – Schritte weg von der Oberfläche sind dort jetzt erlaubt.

### Messung

Dauerflug je Welt 3 min (`tests/measure_durchflug.py`, Pixel-7-Profil, Tempo 0,5, Prüfwerte im Flug per `?flugstat`):
Durchdringung = die Strecke von Takt zu Takt schneidet die Oberfläche; Steckenbleiben = Durchflug 2 s am Stück unter 15 % des
Solltempos, Tauchen 2 s kaum Bewegung; Gleithöhe = Abstand/Gleithöhe je Gleitphase ohne erste und letzte halbe Sekunde.
Ergebnis `tests/results_durchflug_v719.json`.

| Welt | Flug-Art | Durchdringungen | NaN | Steckenbleiben (längstes) | Gleitphasen / Zeit im Gleiten | Gleithöhe Median (p10–p90) | max. Zoom | angezeigt Bilder/s / > 50 ms |
|---|---|---|---|---|---|---|---|---|
| Mandelbulb | Tauchen | 0 | 0 | 0 (0 s) | 1 / 177,1 s | 0,95 (0,95–0,95) | 83515 | 59,9 / 0 |
| Mandelbox | Durchflug | 0 | 0 | 0 (0 s) | 6 / 151,3 s | 1,01 (0,91–1,08) | 1026 | 59,8 / 1 |
| Menger | Durchflug | 0 | 0 | 0 (0,9 s) | 4 / 143,3 s | 1,01 (0,98–1,18) | 8251 | 59,5 / 3 |
| Quaternionen-Julia | Tauchen | 0 | 0 | 0 (0 s) | 1 / 169,5 s | 1,01 (1,0–1,02) | 12103 | 60,0 / 0 |
| Kaleidoskop-IFS | Durchflug | 0 | 0 | 0 (1,28 s) | 1 / 101,3 s | 1,01 (0,89–1,1) | 9719 | 59,6 / 0 |
| Apollonian | Durchflug | 0 | 0 | 0 (0 s) | 0 / 0 s | – (–––) | 2 | 59,8 / 0 |

Pumpen-Kriterium (±30 %): Streuung p10–p90 um den eigenen Median – erfüllt in allen Welten. Der Mandelbulb gleitet nach
~10 s fast durchgehend an der Genauigkeitsgrenze (Gleithöhe dort = Grenze der Handsteuerung, daher Median 0,95 und keine
Streuung); Apollonian fliegt durch die Hallen des Kugelschaums ohne Gleitphase.

Takt mit den Standard-Flugarten (`tests/measure_bulbfly.py --secs=20`, Mittelklasse-Profil; `results_bulbfly_v719_hoch.json`):

| Welt (Standard-Flugart) | angezeigt Bilder/s | echte Bilder/s | Bildzeit-σ ms | p95/Median | > 50 ms | Tempo-Faktor Mittel | Blick max °/s |
|---|---|---|---|---|---|---|---|
| Mandelbulb | 59,7 | 11,6 | 1,53 | 1,08 | 0 | 0,44 | 20,0 |
| Mandelbox | 59,1 | 30,4 | 2,16 | 1,07 | 0 | 0,95 | 20,0 |
| Menger | 60,0 | 35,2 | 0,71 | 1,08 | 0 | 1,0 | 19,9 |
| Quaternionen-Julia | 59,7 | 24,1 | 1,38 | 1,08 | 0 | 0,79 | 20,0 |
| Kaleidoskop-IFS | 60,0 | 55,6 | 0,63 | 1,07 | 0 | 1,0 | 20,0 |
| Apollonian | 59,2 | 31,2 | 2,03 | 1,08 | 0 | 1,0 | 20,0 |

Bildfolgen (`tests/series_v719.py`, 16 Bilder im Abstand von 0,5 s ab 6 s nach dem Start): `tests/shots/v719/flug_<welt>.jpg`.
Meine Sichtprüfung (kein separates Vision-Modell): Menger – nähert sich dem Würfel, zieht im Tiefflug über die Deckfläche und
taucht dann durch ein Loch in die Gänge (erkennbar DURCH); Mandelbox – fliegt an Kanten und durch Hohlräume der Box; KIFS –
Flug an einer Felswand entlang (über Strukturen); Apollonian – durch die Hallen des Kugelschaums; Mandelbulb – taucht bis
Zoom ~7·10⁴ und gleitet dann sichtbar an einer gefiederten Kante entlang; Q-Julia – taucht in ihre gestreiften Tiefen.
Schwanken: Horizont neigt sich langsam um einige Grad, in Kurven deutlicher – sichtbar, ruhig.

**Ehrlich zu den Grenzen:**

- Die Mandelbox wird von außen meist überflogen bzw. an ihren Kanten entlang beflogen; ins Innere findet der Autopilot selten
  (die Box ist außen weitgehend geschlossen). Der Menger-Schwamm gelingt am besten.
- Drehrate des Blicks: 20°/s wie in 7.1.7, im Durchflug vor Leere oder Wand bis 30°/s (sonst kroch er beim Wenden).
- Der Tauchflug des Mandelbulb kostet nah an der Oberfläche viel GPU: Tempo-Faktor im Mittel 0,44 im Mittelklasse-Profil.
- Vorausrendern (7.1.8) nutzt im Durchflug noch keine Vorausschau der Bahn (nur im Tauchen); Streifen und Zwischenbilder gelten.

### Tests

- `tests/test_v719.py` A–F: Standard-Flugart je Welt, Umschalter im Flug, Wahl gespeichert; Durchflug Menger ohne Durchdringung,
  Rollen ≤ 15°, Gieren-Schwanken ≤ 4°; `?schwanken=0/2`; Rückwärts bis zum Anfang; Lenken; `?gleiten=0`; Fluglage nach dem Flug.
- Angepasst: test_v71 (Apollonian: Tauchen – Zoom steigt; Durchflug – Weg in Abständen zur Oberfläche).
- Regression grün: test_v70, test_v71, test_v716, test_v717, test_v718, test_shader_fail, test_rueck, test_fs_fly, test_shot,
  test_hud_fs, Unit-Tests.


## 7.1.10 – ⓘ-Faktenkarte je Welt

Peter, 10.10.: „… im Eck jedes Welt-Buttons ein kleines Informationszeichen, welches beim Draufttippen genaue Fakten zu dieser
Welt erzählt.“

- Jede der 19 Welten-Kacheln im Welt-Wähler hat oben rechts ein ⓘ – ein eigener Knopf neben der Kachel (nicht in ihr), so wählt
  der Tipp die Welt nicht. Tippfläche 48 px (Auftrag ≥ 32 px; die Touch-Regel der App, `test_ui`, verlangt 48), sichtbar ein
  22-px-Punkt. Das ✓ der gewählten Welt (Deko-Stil) ist dafür nach links gewandert.
- Karte im Glas-Look: Formel bzw. Regel, „Entdeckt“, 2–4 Zahlen/Eigenschaften, „Im Bild“ mit Verweis auf die Tour-Orte (und bei
  den 3D-Welten der Flug-Art), „Wusstest du?“, Quellen. Schließen per ✕, Tipp daneben, Esc. Deutsch und Englisch (andere Sprachen:
  Englisch), hoch und quer vollständig sichtbar.
- **Nur belegte Fakten**: Quellen je Karte in `js/weltfakten.js` (kommentiert) und sichtbar am Kartenende – Wikipedia-Artikel
  der jeweiligen Fraktale sowie Originalarbeiten (Douady & Hubbard 1982, Shishikura 1998, Michelitsch & Rössler 1992, Crowe et al.
  1989, Hubbard & Schleicher 2014, Cayley 1879, Markus & Hess 1989, Ushiki 1988, Peitgen & Richter 1986, Draves & Reckase 2003,
  Pickover 1994, Norton 1982, Hart/Sandin/Kauffman 1989, Knighty 2010). Bewusst weggelassen, weil nicht sicher belegt: Herkunft der
  Burning-Ship-Untervarianten (Celtic, Büffel …), Urheber des Svensson-Attraktors, Namensherkunft „Phoenix“. Eigenes der App ist
  markiert („Variante der App“): gebrochene Multibrot-Exponenten und Morph, Burning-Ship-Untervarianten, Phoenix-Mandelbrot-Form,
  Nova-Formen, KIFS-Parameter, der 3D-Kugelschaum „Apollonian“.
- Länge: 45–88 Wörter je Karte (Ziel ≤ ~90).
- Sichtprüfung der Bildschirmfotos (`tests/shots/v7110/waehler_{hoch,quer}.png`, `karte_{mandelbrot,menger}_{hoch,quer}.png`,
  durch mich): ⓘ klein und eindeutig in der Ecke, stört die Kachel nicht; Karten gut lesbar, gegliedert, nicht überladen.
- Tests: Unit `tests/unit/weltfakten.test.js`; `tests/test_v7110.py` A–D; test_ui (Touch-Ziele) grün.

## Stand des Gesamtauftrags 7.1

Alle Etappen und Nachträge sind umgesetzt und live: Färbe-Stile (7.1.0), neue 2D-Welten (7.1.1), Lichtbilder (7.1.2), weitere
3D-Fraktale (7.1.3), Julia-Lupe/-Morph (7.1.4), Feinschliff und Sehenswürdigkeiten (7.1.5), neue Standards (7.1.6), ruhiger
3D-Flug (7.1.7), im Flug immer scharf (7.1.8), Durchflug/Gleiten/Fluglage (7.1.9), ⓘ-Faktenkarte (7.1.10). Offene Grenzen stehen
in den Abschnitten „Ehrlich zu den Grenzen“ (vor allem: Tempo-Einbußen auf schwachen Geräten, Mandelbox wird selten von innen
durchflogen, kein 120-Hz-Messgerät, Messungen unter Fremdlast streuen).
