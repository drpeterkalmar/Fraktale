# Fraktale 7.4.0 – 7.4.2: Roll im Flug, Schweben am Rand, Start am Rand

Live: https://drpeterkalmar.github.io/Fraktale/ (7.4.2 geprüft) · **Am Handy die App einmal ganz schließen und neu öffnen** –
sonst zeigt sie bis zum Neustart die alte Version.

Peter, 26.10.2026:
- „Kannst du beim Fraktal-Autopiloten ganz langsame Rotationen (Roll) hinzufügen?“ → **7.4.0**
- „Fraktal-Autopilot: hover immer entlang der Mengengrenze.“ → **7.4.1**
- (Nachtrag) „Fraktal auch beim Start und Neuladen immer an der Mengengrenze starten.“ → **7.4.2**

## Kurz für Peter – was du am Handy ausprobieren kannst

1. **Roll (7.4.0):** Einen Flug starten (✈ oder einfach die App öffnen – der Zufallsflug startet von selbst). Das Bild dreht sich
   jetzt ganz langsam um seine Mitte, gut 1° pro Sekunde; etwa alle halbe bis ganze Minute wechselt die Drehrichtung über eine
   weiche Kurve. Anfahren und Anhalten gehen mit dem Flug, beim Anhalten läuft die Drehung in wenigen Sekunden sanft aus.
   Schieben/Zoomen mit den Fingern bleibt richtig herum. Der **Kompass-Knopf** in der Leiste unten (auch nach dem Flug, solange
   das Bild gedreht ist) und ⌂ drehen das Bild wieder gerade. In der 3D-Landschaft schaukelt das Bild sanft (höchstens ±12°),
   der Horizont kippt nie weg. Abschalten: Mehr → „Roll im Flug“; zum Vergleichen `?roll=0`, schneller `?roll=3` (°/s).
2. **Schweben am Rand (7.4.1):** Wenn der Flug in der Tiefe kurz schwebt und etwas herauszoomt (Lavalampe), gleitet das Bild
   jetzt am Rand der Menge entlang – vorher trieb es in eine beliebige Richtung, oft ins Schwarze oder ins Leere. Vergleich:
   `?randschweb=0`.
3. **Start am Rand (7.4.2):** Ein paarmal neu laden: Jeder Start beginnt mit einer Randstelle der Menge in der Bildmitte – nie
   mitten im Schwarzen, nie in einer leeren Fläche. Geteilte Links, Lesezeichen und „Wie zuletzt“ bleiben exakt.
   Vergleich: `?randstart=0`.

**Wichtig:** Dieser Auftrag lief in der „Leicht-Spur“ (parallel zu einem anderen Job, ohne Browser). Alles ist mit Node-Tests und
Simulationen des echten App-Codes geprüft, aber **nicht im Browser angesehen**. Die Browser-Tests sind geschrieben
(`tests/test_v740.py` A–H) und warten auf einen Lauf – siehe „Offen“.

## 7.4.0 Roll im Flug

**Bilddrehung der 2D-Ansicht (neu):** Die 2D-Ansicht konnte sich bisher nicht drehen. Jetzt hat sie einen Winkel (`VR.rot`,
`js/app.js`), und jede Stelle, die zwischen Bildschirm, Puffer und Welt umrechnet, kennt ihn:

| Stelle | Änderung |
|---|---|
| Rechen-Shader (f32, Perturbation, df64, Kachel-Screenshot) | Pixelversatz um die Puffermitte gedreht (`u_rcs`), jede Rechnung merkt ihren Winkel (`view.rot`) |
| CPU-Kacheln, exakte Nachrechnung, Screenshot-Kacheln | dieselbe Drehung im Worker (`tile-worker.js`, `rc/rs`) |
| Ebenen-Stapel (Anzeige) | Zielpixel → Texel mit Drehung (`layers.js` `rectXf`, `renderer.js` `xfFor`); Federung der Ränder verallgemeinert |
| Abdeckung, Planer, Aufräumen | schräge Ebenen genau geprüft (`inRect`), Teilstücke in gedrehten Bildachsen, Sichtbarkeit gedrehter Jobs |
| Sonde (Randsuche), 3D-Landschaft | lesen gedrehte Ebenen (`three.js` `u_lr`); 3D selbst rechnet ungedreht |
| Gesten, Pfeiltasten, Rechteck-Zoom, Lupe | `screenOffset` dreht → Finger bleiben richtig orientiert |
| Minikarte, Referenzpunkt-Suche, Link | gedrehtes Rechteck, Suchbereich, `r=` in Grad |
| ⛰ aus gedrehter Ansicht | Winkel wird zum Kurs (Draufsicht mit Kurs h = 2D-Drehung −h), Übergang ohne Sprung |

Ohne Drehung rechnet alles mit genau denselben Zahlen wie 7.3 (Test). Der Roll selbst (`flight.js` `rollStep`): Drehtempo über eine
kritisch gedämpfte Feder zu einem Ziel aus zwei langsamen Sinuswellen (83 s / 47 s, je Flug neu gewürfelt).

| Messung (Node, 10 min Flug, 60 Hz) | Wert |
|---|---|
| größtes Drehtempo | 1,50°/s (Einstellung 1,5°/s) |
| mittleres Drehtempo | 0,98°/s |
| größte Drehbeschleunigung im Flug | 0,38°/s² |
| größter Ruck | 0,28°/s³ |
| Richtungswechsel | 14 in 10 min (alle ~43 s) |
| Anfahrt | nach 1 s < 0,2°/s (mit der 2-s-S-Kurve des Flugs) |
| Ausrollen per Knopf | Bremsen ≤ 1,2°/s², steht nach ≤ 9 s (vorher, im Entwurf: Abriss in einem Bild) |
| 3D-Landschaft | Schaukeln höchstens ±12° |
| `?roll=0` / Einstellung aus | keine Drehung |
| Abbildung Zielpixel ↔ Texel mit Drehung | Abweichung < 10⁻⁶ Pixel (300 Zufallsfälle) |

Ein Prüf-Agent (nur Lesen) fand im Entwurf drei Fehler, alle behoben: Kompass-Knopf nach dem Flug unerreichbar (die Leiste war
außerhalb des Flugs verborgen), 3D-Standbild blieb nach dem Flug schräg stehen (Roll fehlte im Standbild-Schlüssel), Drehung
riss beim Anhalten ab.

## 7.4.1 Schweben immer am Rand

Vorher (7.2.1–7.4.0): Im Schweben/Herauszoomen/Warten trieb die Bildmitte mit 0,04 Bildhälften/s in eine vom Bild unabhängige,
langsam drehende Richtung. Jetzt (`flight.js` `edgeWalk`): bei jeder Sonde 48 Kandidaten auf zwei Kreisen um die Mitte, gewertet
nach dem Abstand zur Menge (Ziel 0,05 Bildhälften), Inneres und Wege durchs Innere stark negativ, Richtungsänderung quadratisch
negativ; der Kurs der Drift folgt gedämpft (≤ 0,5 rad/s). Abseits des Randes steuert er die nächste Randstelle im Sondenfenster
an (bis 2,5× schneller). Zoompunkt und Ziel wandern mit und rücken weich in die Mitte.

Messung ohne Browser: `tests/sim_schweben.js` – der echte 2D-Flug aus `flight.js` (flyUpdate, Lavalampe, Randsuche, Metriken)
mit einer Sonde, die der Prozessor rechnet (48×48, Distanzschätzung wie im Shader kodiert), Schärfe fest grob → die Lavalampe ist
fast nur im Bremsen/Schweben/Herauszoomen/Warten. 6 Orte × 120 s, gezählt je Sonde in diesen Phasen.
Korridor = 0 < Abstand ≤ 0,12 Bildhälften (3 × FLY_DE). Rohdaten `tests/results_schweben_{alt,neu}.json`.

| Ort | Mitte im Korridor | Zoompunkt im Korridor | Mitte innen | Mitte in leerer Fläche | Bild schwarz | Bild leer |
|---|---|---|---|---|---|---|
| Seepferdchental 10³ | 74 → **100 %** | 85 → 100 % | 0 → 0 % | 0 → 0 % | 0 → 0 % | 0 → 0 % |
| Seepferdchental 10⁵ | 86 → **100 %** | 81 → 100 % | 14 → 0 % | 0 → 0 % | 8 → 0,6 % | 0 → 0 % |
| Elefantental 10³ | 66 → **100 %** | 78 → 100 % | 17 → 0 % | 0 → 0 % | 5,8 → 4,4 % | 0 → 0 % |
| Spirale 10⁴ | 30 → **100 %** | 83 → 100 % | 0 → 0 % | 32 → 0 % | 0 → 0 % | 39 → 0,2 % |
| Kardioide 30× | 29 → **100 %** | 83 → 100 % | 71 → 0 % | 0 → 0 % | 71 → 17 % | 0 → 0 % |
| Antenne 10³ (großes Minibrot) | 52 → **81 %** | 85 → 81 % | 48 → 19 % | 0 → 0 % | 55 → 55 % | 0 → 0 % |
| **Mittel** | **56 → 97 %** | 83 → 97 % | 25 → 3 % | 5 → 0 % | 23 → 13 % | 6,5 → 0 % |

Mit anderen Zufallswerten (Startrichtung): Mitte im Korridor 73 → 97 % bzw. 65 → 93 %. Ziel ≥ 90 % erreicht. Schwächster Ort
ist die Antenne: dort läuft die Mitte am Rand eines großen Minibrots entlang, das beim Herauszoomen das halbe Bild füllt; einmal
(~15 s) gerät sie in einen Hals des Minibrots. Versucht und verworfen: eine Strafe für viel Inneres rund um einen Kandidaten
(`?randnin=`, Standard 0) – keine Verbesserung.

Die Drift hat dasselbe Tempo wie vorher; dass die Schärfe nicht schlechter wird, ist plausibel, aber **nicht gemessen** (braucht
Browser, `test_v740.py` G vergleicht den Anteil grober Bilder mit `?randschweb=0`).

## 7.4.2 Start und Neuladen am Rand

`zufall.js` `edgeCenter`: nach der Ortswahl (Startansicht, Tour-Ort, Kundschafter) rückt die Mitte auf die nächste Randstelle der
CPU-Sonde (Wechsel innen/außen zwischen zwei Nachbarzellen; Newton: zwischen Einzugsgebieten; ohne Wechsel: stärkster Sprung im
Iterationswert), nachgeschärft in einem 8× feineren Ausschnitt; kein Rand im Bild → Suche in 4×/16×/64× weiterer Ansicht, dann
zurück auf den gewählten Zoom. Hat eine Welt mit Menge dort mit den gewürfelten Parametern gar keine Menge, wird bis zu 2× neu
gewürfelt. Gilt für „Zufallsflug“ und „Zufallswelt still“; Links, Lesezeichen, „Wie zuletzt“ und Testautomation unverändert.

Messung ohne Browser: `tests/sim_randstart.js` – echter Zufallsstart aus `zufall.js` (rollPlan/applyPlan, Kundschafter, Tour-Orte)
mit den Welt-Daten aus `app.js`, je 2D-Welt 50 Starts mit festem Zufall, `?randstart=0` gegen neu. „Rand in der Mitte“ =
Ausschnitt ±0,04 Bildhälften um die Mitte enthält einen Rand. Rohdaten `tests/results_randstart.json`.

| Welt | Rand in der Mitte | Bild schwarz Ø | leere Ansicht | Würfeln Ø (ms) |
|---|---|---|---|---|
| Mandelbrot | 52 → **100 %** | 33 → 31 % | 0 → 0 % | 9 → 12 |
| Julia | 50 → **100 %** | 27 → 29 % | 0 → 0 % | 6 → 8 |
| Burning Ship | 50 → **100 %** | 33 → 36 % | 0 → 0 % | 8 → 10 |
| Tricorn | 42 → **100 %** | 31 → 32 % | 0 → 0 % | 6 → 8 |
| Multibrot z³ | 40 → **100 %** | 43 → 35 % | 0 → 0 % | 55 → 76 |
| Newton | 82 → **100 %** | 0,4 → 0,4 % | 0 → 0 % | 5 → 7 |
| Lyapunov | 48 → **100 %** | 22 → 37 % | 0 → 0 % | 19 → 24 |
| Phoenix | 22 → **100 %** | 17 → 23 % | 10 → 0 % | 4 → 7 |
| Nova | 42 → **96 %** | 8 → 17 % | 12 → 2 % | 13 → 31 |
| Magnet | 56 → **100 %** | 35 → 35 % | 0 → 0 % | 42 → 50 |

- Ziel 100 % in 9 von 10 Welten; Nova 96 % (2 von 50 Starts: auch nach zweimal Neu-Würfeln keine Menge im Bild – diese fängt in der
  App zusätzlich die Bildprüfung nach dem ersten Bild ab, die dann neu würfelt bzw. die Startansicht nimmt).
- Schwarzer Bildanteil: meist gleich; Lyapunov höher (die Mitte liegt jetzt an der Grenze zum chaotischen Bereich, der schwarz
  gezeichnet wird), Nova/Phoenix höher, weil leere Ansichten (ohne Menge) wegfallen.
- Startzeit: das Würfeln kostet 2–20 ms mehr Prozessorzeit (Nova durch Neu-Würfeln +18 ms); bis zum ersten Bild vergehen ohnehin
  1–4 s – merklich länger wird der Start nicht. Gemessen in der echten App (Zeit bis zur Bewegung): offen, `test_v740.py` H.

## Tests

- Neu (Node, laufen in `tests/unit/run.js`): `roll.test.js` (9 Fälle: Abbildung mit/ohne Drehung, Federung, Abdeckung, CPU-Kachel
  gedreht, Roll-Verlauf, An/Aus, 3D, Ausrollen), `schweben.test.js` (Kurzlauf der Schwebe-Simulation), `randstart.test.js`
  (Kurzlauf der Start-Simulation). Simulationen: `tests/sim_schweben.js`, `tests/sim_randstart.js`.
- Grün vor jedem Zusammenführen: alle Node-Tests (73), `node_core_test.js`, `tools/check_release.py`.
- Browser (geschrieben, **nicht gelaufen**): `tests/test_v740.py` A–H (Roll-Tempo/Sprünge/grobe Bilder gegen `?roll=0`, `?roll=0/3`,
  Link `r=`, Gesten in gedrehter Ansicht, Ausrichten, ⛰ aus gedrehter Ansicht, Schweben am Rand mit erzwungen grober Schärfe,
  20 Zufallsstarts). `test_fly2d.py` angepasst: im 2D-Flug zeigt die Leiste jetzt den Kompass-Knopf. In `tests/run_all.sh` eingetragen.
- Neues Werkzeug `tools/release_vnext.py`: vergibt beim Zusammenführen die nächste freie Version und ersetzt „Version VNEXT“ in
  der README (für parallele Queue-Jobs).

## Offen

1. **Browser-Lauf** `FK_HEADED=1 python3 tests/test_v740.py` und die bestehenden Flug-/Bildtests (`test_fly2d`, `test_v731`,
   `test_v721`, `test_shot`, `test_truth`, `test_3d`), sobald kein paralleler Job läuft – die Bildkette (Shader, Ebenen-Mischung,
   Sonde, Screenshot) ist neu und nur per Node/Shader-Prüfer getestet.
2. **Schärfe im Schweben** (`measure_lava.py` / `test_v731` B) mit und ohne `?randschweb=0` – erwartet gleich (gleiches Drifttempo).
3. Roll in den 3D-Körpern (Mandelbulb & Co.) nicht eingebaut – die haben schon ihr eigenes sanftes Schwanken/Rollen.
4. Antenne/Minibrot-Hälse beim Schweben (81 %), Nova-Starts ohne Menge (96 %).
