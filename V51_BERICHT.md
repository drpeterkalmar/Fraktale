# Fraktal-Explorer 5.1.0 – Bericht „Nahtloser Bildaufbau"

Datum 02.10.2026. Auftrag (Peter, 01.10.): „Bilder sollen sich smoother aufbauen, weniger pixelig sein, und alte Renderings nahtlos in neue übergehen. Die immer wieder neu aufgebauten Szenen töten die Immersion." Dazu: vorausrechnen, und nur wenn nötig den Zoom etwas bremsen.

**Kurzfassung:** Das Bild lebt jetzt durchgehend. Beim Zoomen, Schieben, Doppeltipp und in der Tour gibt es keine harten Wechsel mehr (vorher 35 je Messlauf), der Anteil grober Frames fällt von 51–91 % auf 3–18 %, beim Schieben bleiben keine schwarzen Lücken mehr (vorher bis 85 % der Bildfläche zeitweise leer). Die Tour wird dafür 6 % länger (14,2 → 15,0 s). Die exakte Deep-Zoom-Rechnung ist unverändert (alle Wahrheitstests mit denselben Werten wie 5.0.1).

**Hinweis für Peter:** Die App ist eine PWA – einmal ganz schließen und neu öffnen (bzw. Seite neu laden), dann steht unter „Mehr" 5.1.0.

## 1. Befund in 5.0.1 (gemessen, nicht nur gelesen)

Die Code-Analyse von Hermes stimmte, die Messung zeigte aber zwei noch größere Ursachen:

1. **Zwei-Ebenen-Tausch** (`jobFinished`): Jede fertige Vorschau ersetzte während Bewegung hart das vorherige Bild – auch ein scharfes durch ein grobes. Messung: 11–20 harte Wechsel pro 6-s-Fahrt.
2. **Vorschauen kamen gar nicht an:** Veraltete Jobs wurden nach 400 ms verworfen; beim Schieben bei 10⁷ wurde dadurch fast nie eine Vorschau fertig, das alte Bild wanderte aus dem Schirm – **im Mittel 85 % der Fläche leer** (schwarz).
3. **Bildraten-Schätzung** nahm das Minimum der Frame-Zeiten; einzelne kurze Frames drückten sie auf ~8 ms, der Häppchen-Regler hielt jede normale 16,7-ms-Frame für Überlast und schrumpfte die Vorschau-Arbeit auf 1024 Pixel pro Frame – Vorschauen dauerten dann Sekunden (Zoom um 1000× auf einem Bild).
4. Vorschau bis 1/12 Auflösung, Farben bilinear gemischt → Blöcke bzw. Brei; Überhang 1,2.

## 2. Was gebaut wurde (und warum so)

**Schärfe-bewusster Ebenen-Stapel** (`js/app.js` „Ebenen-Stapel", `js/shaders.js` DISPLAY_FS): Jedes fertige Bild (Vorschau, Teilstreifen, Verfeinerung, exakt, vorausberechnet) bleibt als Ebene erhalten, bis zu 8 (Shader-Plätze). Sortierung pro Frame nach Schärfe *k* = Pufferpixel pro Bildschirmpixel nach Reprojektion (gekappt bei 1), +0,05 für das exakte Bild genau dieser Ansicht, winziger Aktualitätsbonus nur als Gleichstands-Entscheider. Der Display-Pass trägt von oben nach unten auf (Deckkraft = gefederte Abdeckung × Einblendung) und bricht ab, sobald das Pixel deckt – meist wird nur eine Ebene gelesen. Da die Verhältnisse der *k* zwischen Ebenen bei jeder Kamerabewegung gleich bleiben, ändert sich die Reihenfolge während Gesten praktisch nie → keine Sprünge. Eine gröbere neue Vorschau landet automatisch unter dem schärferen alten Bild und füllt nur Ränder/Lücken.
- *Aufräumen:* Ebenen, die in der 1,4-fach vergrößerten Ansicht nirgends beitragen, fallen weg; bei vollem Stapel die am wenigsten genutzte (Bildfläche ×10 gewichtet) – und zwar **weich ausgeblendet** (150 ms), nicht weggenommen. Die größte Ebene ist „Reserve" gegen schwarze Ränder und bleibt.
- *Speicher:* Iterationspuffer 4 B/Pixel; Pixel 7 (824×1678): Vollbild 5,5 MB. Pool-Grenze 40 MB am Handy (64 MB Desktop), gemessen typ. 14–27 MB belegt.

**Weiche Übergänge:** Einblenden zeitbasiert ab dem ersten gezeigten Frame (150 ms in Bewegung, 220 ms im Stillstand; ein ausgefallener Frame kann die Blende nicht verschlucken). Ränder gefedert (12 CSS-px; die Federbreite wächst stetig mit dem Abstand der Kante vom Bildrand – Kanten außerhalb des Bildes federn nicht, daher ist das ruhende Endbild pixelgleich zu 5.0.1). Die Stufen Vorschau → voll → exakt überlappen sich und wirken wie ein Scharfwerden.

**Weniger pixelig:** Vergrößerte Ebenen (k < 0,9) werden auf dem Iterationswert rekonstruiert: Innen/Außen getrennt, glatte Zonen Catmull-Rom 4×4 (auf das lokale Min/Max begrenzt, kein Überschwingen), Zonen mit großen Sprüngen weiter Farbmischung (Iterationswert dort zu interpolieren erzeugte Phantom-Farbbänder). Gröbste Vorschau 1/6 (GPU) bzw. 1/8 (CPU) statt 1/12; in Bewegung auch volle Auflösung, wenn die halbe < 15 ms braucht. Der Iterationspuffer bleibt exakt, geglättet wird nur im Display-Pass.

**Vorschau für die vorausgesagte Kamera, nur was fehlt:** Bekannte Pfade (Flug/Tour/Doppeltipp, Rad, Schwung) exakt, Finger-Gesten aus der Geschwindigkeit der letzten ~200 ms (80 %, begrenzt). Ein Kachelraster 8×16 über die vorausgesagte Ansicht zeigt, wo das Bild noch nicht scharf genug ist; gerechnet wird der dringendste zusammenhängende Bereich in der feinsten Auflösung, die in ~120 ms passt (gemessener Durchsatz). Beim Schwenk ist das ein Streifen am vorderen Rand in voller oder halber Auflösung statt des ganzen Bildes in 1/3. *Verworfen:* Gewinn-pro-Pixel als Kriterium (wählte immer grob), ein Rechteck um alle Lücken (bei L-förmigem Bedarf zu groß), Überhang 1,5 (A/B gemessen: kostet eine ganze Auflösungsstufe; mit Vorhersage reicht 1,2 in Bewegung). Bei bekanntem nahem Ziel (Doppeltipp, Tour-Ende) wird gleich das Zielbild gerechnet.

**Vorausrechnen im Leerlauf** (nach dem exakten Endbild, je ein Job, bei jeder Bewegung sofort abgebrochen, nie bei „Akku", nie im Hintergrund, höchstens jedes zweite Frame ein halbes Häppchen ≈ ≤ 50 % GPU, Summe ≤ 3 Vollbilder): Referenzorbit für 4× tieferen Zoom, Reserve 1/32 Zoom (1/16 der Pixel), Reserve 1/4 Zoom, Ring 1,6-fache Fläche in halber Auflösung, Bildmitte ×2 in voller Auflösung (nur wenn ein Vollbild < 1,5 s dauert). Vorausberechnete Ebenen liegen unter dem fertigen Bild und ändern es nicht.

**Tempo-Bremse („Schärfe-Front"):** nur für animierte Bewegungen. Gemessen wird die Schärfe in 100 ms (Vorhersage + vorhandene Ebenen); fällt das 10-%-Quantil unter 0,4, sinkt das Tempo weich bis 0,4×, sonst steigt es wieder (Totzone ±10 %, kein Pendeln). *Warum 0,4 statt der vorgeschlagenen 0,5:* Halb-Auflösungs-Vorschauen erreichen mit Vorhersage 0,43–0,5 – mit 0,5 bremste die Tour dauerhaft auf Minimum und dauerte 39 s statt 14 s, ohne schärfer zu werden. Pinch/Schieben unter dem Finger bleibt 1:1 (Hermes' Einschätzung geteilt; die Messung zeigt, dass der Pinch dank Vorhersage auch ungebremst zu 97 % scharf bleibt). Schalter „Mehr → Tempo an Rechenleistung anpassen" (Standard an), `?gov=0`.

**Robustere Bildraten-Schätzung:** 25-%-Quantil der letzten 90 Frame-Zeiten, eingerastet auf 120/90/60/30 Hz; zusätzlich zählt die Frame-Zeit ohne Rechenlast als Untergrenze (ein Browser, der aus anderen Gründen langsam zeichnet, lässt die Vorschau nicht mehr verhungern).

**A/B-Regler** (Werte 5.0.1 in Klammern): `?blend=0` (komplettes Verhalten 5.0.1), `?maxdiv=` (12), `?over=` (1.2), `?overmove=`, `?fadems=` (280/0), `?feather=` (0), `?recon=0` (Farbmischung), `?predict=0`, `?strips=0`, `?prefetch=0`, `?gov=0`, `?govk=`, `?govmin=`.

Buddhabrot und Mandelbulb sind unberührt.

## 3. Messungen

Methode `tests/measure_blend.py`: Messung hängt sich von außen an `R.present` (für 5.0.1 und 5.1 identisch); 24×48 Stichproben pro Frame: effektive Schärfe *k* (alpha-gewichtet), grob = *k* < 0,5, unbedeckt; |ΔRGB| auf einer per Mipmap verkleinerten Kopie (1/16), asynchron gelesen, zusätzlich bewegungskompensiert (vorheriges Bild auf die neue Kamera abgebildet); harte Wechsel = neue Ebene im ersten Frame schon voll deckend über einem Bild. Fahrten per Skript, für beide Versionen gleich: Pinch-Zoom 10³→10⁹ in 6 s, Schwenk 6 s bei 10⁷ (450 CSS-px/s mit Schlenker), ▶ Tour bis 10¹², 6 Doppeltipps im Abstand 0,7 s ab 10⁵; vor jeder Fahrt 2,5 s Betrachtungspause. Chromium mit echter GPU (Apple M1), Pixel-7-Ansicht. **Sichtbares Fenster** (headless liefert rAF nur mit ~15 fps, auch für eine leere Seite – Bewegungsmessungen wären dort verzerrt; die Regressionstests laufen trotzdem headless).

| Fahrt | Version | grobe Frames | grobe Fläche | leer | Ø Schärfe k | harte Wechsel | max. |ΔRGB| (bew.-komp.) | Dauer |
|---|---|---|---|---|---|---|---|---|
| Pinch 10³→10⁹ | 5.0.1 | 88,7 % | 88,7 % | 0 | 0,13 | 11 | 50,7 | – |
| | **5.1.0** | **2,7 %** | 1,9 % | 0 | **0,82** | **0** | 23,2 | – |
| Schwenk 10⁷ | 5.0.1 | 90,9 % | 85,0 % | **85 %** | 0,14 | 2 | 109,7 | – |
| | **5.1.0** | **17,7 %** | 5,3 % | **0** | **0,84** | **0** | 15,8 | – |
| Tour 1→10¹² | 5.0.1 | 77,4 % | 77,4 % | 0 | 0,22 | 2 | 85,5 | 14,2 s |
| | **5.1.0** | **2,8 %** | 2,8 % | 0 | **0,85** | **0** | 24,9 | 15,0 s |
| Doppeltipp ×6 | 5.0.1 | 50,6 % | 50,6 % | 0 | 0,52 | 20 | 17,1 | 4,9 s |
| | **5.1.0** | **5,7 %** | 1,2 % | 0 | **0,96** | **0** | 13,2 | 5,0 s |

**Mittelklasse-Profil** (CPU 4× gedrosselt, 4 Kerne; GPU bleibt M1 – eine 5–10× langsamere Handy-GPU lässt sich nicht emulieren): grobe Frames 5.0.1 → 5.1.0: Pinch 90 % → 6 %, Schwenk 89 % → 18 % (leer 83 % → 0), Tour 95 % → 2 % (14,1 → 14,9 s), Doppeltipp 52 % → 5 %; harte Wechsel 28 → 0.

**Tempo-Bremse an/aus** (5.1.0): Tour 14,2 s / 12,1 % grobe Frames (aus) → 15,0 s / 2,8 % (an); Doppeltipp-Serie 4,86 s / 8,6 % → 5,01 s / 5,7 %.

**|ΔRGB| bewegungskompensiert:** Die Spitzen sinken deutlich (Pinch 51 → 23, Schwenk 110 → 16, Tour 85 → 25). Der Median steigt dagegen (≈ 0,7 → 10): 5.0.1 zeigt in Bewegung ein eingefrorenes, unscharfes Bild (ändert sich kaum), 5.1 fügt laufend Details hinzu – die Metrik misst hier Schärferwerden, nicht Aufblitzen. Aussagekräftig sind daher Spitzen + harte Wechsel + Schärfe.

**Burst-Screenshots** (8 × 120 ms, `tests/shots/blend/sheet_*`), selbst gesichtet: 5.0.1 zerfällt beim Zoom 10⁵→10⁹ erst in Pixelblöcke, dann in einen orangen Farbbrei; beim Schwenk grobe Blöcke und schwarze Streifen. 5.1 bleibt in allen Bildern scharf und strukturiert, keine Kanten zwischen Ebenen sichtbar (Spaltenanalyse ohne Helligkeitseinbrüche).

**Bildrate/Leistung:** Display-Pass (GPU-Timer, M1) 1,4–1,6 ms in Ruhe und bei 3–6× vergrößerten Ebenen (5.0.1: 1,5–2,1 ms) – die Rekonstruktion kostet wegen des frühen Abbruchs nichts Messbares. Long Tasks > 50 ms: 0 (auch mit CPU-Drosselung 4×); JavaScript pro Frame Ø 0,19 ms, max. 4,2 ms (gedrosselt). Bildrate im sichtbaren Fenster wie 5.0.1 (≈ 60 fps).

## 4. Tests

`tests/run_all.sh` komplett grün, neu `tests/test_blend.py` (headless): 0 harte Wechsel bei Zoom/Schwenk/Herauszoomen/Doppeltipp/Flug, Schärfe fällt im Stillstand nie, Lücken < 1 % (Herauszoomen ×100 in 2 s: < 5 %, 5.0.1-Modus 87 %), exaktes Endbild deckend oben, Vorausrechnen aktiv, Speicher im Budget, Schwenk schärfer als `?blend=0`, Tempo-Bremse greift und `?gov=0` schaltet sie ab (Flug ≤ 2,5× so lang), 0 Fehler, keine Long Tasks. Wahrheitstests GPU und CPU: identisch zu 5.0.1 (z. B. 10⁷ 100 %, 10⁹ 99,5 %, 10¹⁴ 99,5 %, 10¹⁵ 99,75 %, 10⁴¹ CPU 99,75 %). Pixel-7-Emulation hoch/quer (`test_ui.py`): 0 Fehler, Touch-Ziele ≥ 48 px.

## 5. Grenzen / offen

- Nicht auf einem echten Android-Handy gemessen; die Regler (Durchsatz, Vsync, Bremse) stellen sich selbst ein, die Zahlen oben stammen von M1-GPU.
- Herauszoomen um mehr als ×32 in sehr kurzer Zeit kann am Rand kurz dunkel bleiben, bis die erste Vorschau da ist (5.0.1: großflächig schwarz).
- Beim Schwenk zählte die Messung einmal einen kurzen Schärfeabfall bei „stehender" Kamera (Kamera zwei Frames gleich während der Fahrt) – im echten Stillstand nie.
- Optional nicht gebaut: zeitliche Akkumulation/Sub-Pixel-Jitter im Stillstand (Supersampling); die Iterationspuffer und Wahrheitstests hätte es nicht berührt, aber es kostet im Stillstand dauerhaft GPU/Akku.
