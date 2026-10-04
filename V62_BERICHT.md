# Fraktal-Explorer 6.2.0 – Bericht „Farbe der Menge (Weiß/Alpin) + sanfter Flug zum Mengenrand“

Datum 04.10.2026. Auftrag: Peters Wünsche vom 03.10. – „der Menge auch andere Farben geben können, z. B. Weiß für den
alpinen Look in 3D“, „Tal als Wald oder See“ und „der automatische Flug soll weniger hart lenken und automatisch den
Grenzbereich der Menge anfliegen“. Deep-Zoom-Rechnung exakt (Wahrheitstests unverändert), 5.1-Bildaufbau, 6.0-3D und
6.1-Glättung nicht schlechter.

**Hinweis für Peter:** Die App ist eine PWA – einmal ganz schließen und neu öffnen (bzw. Seite neu laden), dann steht
unter „Mehr“ 6.2.0. Neu im Tab **Farben** ganz oben unter den Paletten: **Farbe der Menge** (Schwarz · Weiß · Dunkel ·
Hell · Eigene) und der Schalter **Alpin-Look (3D)** mit der Tal-Wahl **Wald · See · Wiese**. Der Flug (✈ in der
3D-Leiste) lenkt jetzt von selbst ruhig am Mengenrand entlang. Vergleich mit dem alten Flug: Adresse mit `?flyedge=0`.

![Alpin-Look quer: oben Standard (wie 6.1), Mitte Alpin mit Wald, unten Alpin mit See – Zoom 1, 300×, 10⁶](tests/shots/setcol/vergleich_alpin_quer.jpg)

## 1. Kurzfassung

- **Flug:** Der Kurs dreht im Mittel mit **4,5 statt 28,5 °/s**, Spitzen **17 statt 52 °/s**, die Drehrichtung wechselt
  **4,6- statt 44,7-mal pro Minute**, der Ruck (Änderung der Drehrate) sinkt auf ein Fünfzigstel. Der Mengenrand liegt in
  **100 %** der Flugzeit in der Bildmitte (6.1: 71 % – ab Zoom 1 schwebte der alte Flug 26 s über einer leeren Ebene).
  Technik: Der Zoompunkt sitzt auf dem Mengenrand (Distanzschätzung aus 6.1) und gleitet weich mit, der Kurs folgt ihm
  als gedämpftes System; leichte Schräglage in Kurven.
- **Flug ruckelt weniger:** Nebenbei gefunden und behoben – im 3D-Modus blähte der Rechen-Regler aus 5.1 sein
  Zeitbudget auf bis zu 8 Bildtakte auf. Flug im sichtbaren Fenster **33,8 → 50,4 fps** (95-%-Wert der Bildzeit 118 →
  33 ms), Mittelklasse-Profil **35,5 → 51,6 fps**. Gesten bleiben bei 60 fps.
- **Farbe der Menge:** Schwarz (wie bisher, bitgleich), Weiß, dunkelste/hellste Farbe der Palette, eigene Farbe
  (Farbwähler). Gilt in 2D und 3D, wird gespeichert und geteilt (Link `sc=`). Bei heller Menge bekommt die Kontur außen
  einen weichen dunklen Saum (bleibt klar erkennbar), das Funkeln geht bei hellen Farben aus.
- **3D Weiß = Gletscher:** matte Schneefläche, bläuliche Schatten, sanfter Glanz, keine Wellen, leichte Schneestruktur.
- **Alpin-Look:** Färbung nach relativer Höhe statt Palette – Tal (Wald, See oder Wiese) → Almen → Fels an steilen Hängen
  → Schnee auf flachen Höhen, die Menge ist Gletscher; klarer blauer Himmel, bläulicher Dunst. Funktioniert bei jedem
  Zoom (Höhenzonen relativ zum Bild, Texturen welt-verankert, schwimmen beim Zoomen nicht).
- Kosten: Standard-Look so schnell wie 6.1, Weiß +4–10 %, Alpin +60–70 % GPU-Zeit pro 3D-Bild (M1: 5,5–6,9 ms statt
  3,3–4,1 ms; Gesten und Flug trotzdem 60 bzw. ~51 fps).

## 2. Flug: sanfter und am Mengenrand

### 2.1 Ist-Stand (gemessen, nicht nur gelesen)
`flyUpdate` drehte den Kurs mit bis zu 0,9 rad/s (52 °/s) auf ein Ziel, das `flySteer` alle 300 ms neu aus 13 Kandidaten
bis ±150° wählte – ohne Hysterese. Messung bestätigt: In 2 von 3 Flügen lag die Drehrate fast dauernd an der Grenze
(Ø 37–42 °/s), 56–72 Richtungswechsel pro Minute. Zusätzlich gefunden: die Sonde, aus der gelenkt wird, war beim
Auswerten bis zu ~450 ms alt (asynchrones Auslesen + 300-ms-Takt) – bei 0,5 Zehnerpotenzen/s ist der Zoom inzwischen um
×1,5 gewachsen, alle Positionen darin also um 50 % falsch. Das erklärt einen Teil des Hin-und-Her.

### 2.2 Umsetzung (`js/app.js`, Abschnitt Flug; Sonde in `js/three.js`)
- **Sonde mit Distanz:** Die 48×48-Sonde liefert zusätzlich die Distanz zur Menge (aus dem DE-Kanal der schärfsten Ebene,
  umgerechnet in Bildhälften) in den unteren 8 Bit desselben Auslesewerts – kein zusätzliches Auslesen. Im Flug alle
  150 ms, Positionen werden zwischen Sonden- und aktueller Kamera umgerechnet (`probeMap`).
- **Zoompunkt am Rand:** Gezoomt wird um einen Punkt A vor dem Fokus. Bleibt A stehen, fliegt die Kamera exakt auf diesen
  Weltpunkt zu – darum ist A das eigentliche Ziel. A wird auf Stellen mit Distanz ≤ 0,04 Bildhälften gelegt (direkt am
  Rand, wie bei den YouTube-Zoomvideos): ein Punkt dicht an der Menge bleibt über viele Zehnerpotenzen randnah. Wertung
  zusätzlich: viel Menge in der Umgebung (Minibrot-Inneres, große schwarze Flächen) negativ, Detail und Randdichte
  positiv, leere Ebene (Distanz > 0,25) zunehmend negativ.
- **Nachführen statt springen:** Bei jeder Sonde wird das Ziel im Umkreis 0,2 um A nachgeführt (der Rand „wandert“ beim
  Tauchen); ein weiter entferntes Ziel nur mit **Hysterese** (≥ 25 % besser und das alte ≥ 1,5 s gehalten).
  Kandidaten nur im Vorwärtsbereich ±90°, 0,25–0,7 Bildhälften voraus.
- **Gedämpfter Kurs:** A gleitet mit begrenzter Geschwindigkeit und weich wechselnder Richtung zum Ziel; der Kurs folgt
  der Richtung von A kritisch gedämpft (Drehrate ≤ 0,3 rad/s = 17 °/s, Drehbeschleunigung ≤ 0,5 rad/s²), dazu leichte
  Schräglage (max. ~6°), die nach dem Flug weich ausklingt.
- **Start in leerer Fläche:** Liegt voraus nichts Gutes, wird die beste Stelle im ganzen Sondenfenster angeflogen (kaum
  tiefer, seitlich hingleiten, langsamer je näher); ist im Fenster gar kein Rand, zeigt die höchste Iterationszahl die
  Richtung zur Menge. Test ab Zoom 6 weit draußen (0,55 + 0,75i): Rand nach ~2 s erreicht, dann Tauchen am Rand.
- **Wischen lenkt** weiterhin (Zoompunkt und Ziel drehen sich um den Fokus, der Kurs folgt gedämpft; 3 s lang bleibt die
  Automatik in ±35° um die neue Richtung). **Tippen pausiert**, **Ortsflug** unverändert exakt (test_3d).
- A/B: `?flyedge=0` = Wertung und Lenkung 6.1.0, `?flyturn=R` = maximale Drehrate in rad/s.

### 2.3 Messung (`tests/measure_fly.py`)
Pixel 7, headless mit echter GPU (Apple M1, ANGLE/Metal) und echtem Tempo (0,5 Zehnerpotenzen/s), je 30 s ab
Gesamtbild (Zoom 1), Seepferdchen-Tal 300×, Randpunkt 10⁶. Drehrate aus dem Kurs pro Bild, Richtungswechsel = Vorzeichen-
wechsel der Drehrate (gezählt ab 2 °/s), Ruck = |Änderung der Drehrate|/s. Rand: pro Sonde 9×9 Punkte im mittleren
Bilddrittel auf den Boden projiziert – „Rand im Bild“, wenn einer davon eine Distanz < 0,3 Bildhälften hat; innen/leer
(Distanz > 1) als Anteil des sichtbaren Bodens. Rohdaten `tests/results_fly_*.json`.

| Hochformat (Mittel aus 3 Flügen) | 6.1.0 | 6.1-Lenkung mit neuem Regler¹ | **6.2.0** |
|---|---|---|---|
| Drehrate Ø / 95 % / Spitze (°/s) | 28,5 / 51,6 / 51,6 | 26,8 / 51,6 / 51,6 | **4,5 / 14,6 / 17,2** |
| Richtungswechsel pro Minute | 44,7 | 38,5 | **4,6** |
| Ruck Ø / max (°/s²) | 174 / 4 567 | 95 / 6 342 | **3,2 / 66** |
| Rand in der Bildmitte (Anteil Sonden) | 71 % | 70 % | **100 %** |
| längste Strecke ohne Rand | 26,2 s (ab Zoom 1) | 27,2 s | **0 s** |
| Boden innen / leer | 2,0 % / 30,2 % | 1,4 % / 36,1 % | 1,7 % / 5,4 % |
| erreichte Tiefe in 30 s (Zehnerpotenzen) | 11,3–12,3 | 9,6–14,7 | 12,1–15,1 |

| Querformat (Mittel aus 3 Flügen) | 6.1.0 | **6.2.0** |
|---|---|---|
| Drehrate Ø / Spitze (°/s) | 27,8 / 51,6 | **5,1 / 17,2** |
| Richtungswechsel pro Minute | 40,4 | **8,0** |
| Ruck max (°/s²) | 6 238 | **101** |
| Rand in der Bildmitte | 94 % | **100 %** |
| Boden leer | 24,9 % | 7,6 % |

¹ Gleiche Bildrate wie 6.2 (fairer Vergleich für Ruck/Richtungswechsel): 6.1-Lenkung (`?flyedge=0`) mit dem korrigierten
Regler aus 2.4. Harte Ebenenwechsel in allen Flügen 0.

Flug-Serienbilder (6 × 250 ms in der Flugmitte): `tests/shots/fly/serie_v610.jpg` / `serie_v620.jpg` (hoch),
`serie_v610_quer.jpg` / `serie_v620_quer.jpg`. Selbst gesichtet: 6.1 zeigt ab Zoom 1 sechs Bilder lang nur eine leere
blaue Ebene; 6.2 gleitet in allen drei Flügen über Gebirge am Mengenrand, im Seepferdchen-Tal spiralförmig in die Tiefe,
im Querformat sichtbar an Filamenten entlang. Die Bilder wirken ruhig, die Blickrichtung ändert sich langsam.

### 2.4 Bildrate im Flug – Fund am Rechen-Regler
Der Häppchen-Regler aus 5.1 bemisst sein Zeitbudget nach der Dauer von Frames ohne Rechenarbeit („Leerlauf“). In 3D sind
diese nie leer (das 3D-Bild selbst, noch eingereihte GPU-Arbeit) – das Budget wuchs bis auf 8 Bildtakte, der Flug
rechnete pro Frame bis zu 2 Mio. Pixel und ruckelte (headless sogar nur ~15 Bilder/s). In 3D gilt jetzt höchstens ein
Bildtakt (`pumpCtl`, A/B `?flycap=N`, `?flycap=0` = alt). Gemessen im sichtbaren Fenster (`tests/fps_v62.py`, M1,
Pixel-7-Ansicht; die Maschine war nebenbei durch andere Dienste ausgelastet, alle Werte in derselben Sitzung):

| | 6.1.0 | 6.2.0 | 6.1.0 Mittelklasse² | 6.2.0 Mittelklasse² |
|---|---|---|---|---|
| 2D-Zoomfahrt 10³ → 10⁷ | 60 fps | 59,8 fps | 60 fps | 60 fps |
| 3D drehen + neigen (Seepferdchen) | 60 fps | 60 fps (Alpin 60) | 60 fps | 60 fps (Alpin 60) |
| Flug 8 s | 33,8 fps, 95 % ≤ 118 ms | **50,4 fps, 95 % ≤ 33 ms** (Alpin 52,0) | 35,5 fps | **51,6 fps** (Alpin 51,2) |

² CPU 4× gedrosselt, 4 Kerne (die GPU lässt sich nicht drosseln). Das Ziel „Flug ≥ 60 fps“ ist damit nicht ganz
erreicht: Der Flug rechnet in jedem Frame neue Bilder (Zoom läuft dauernd), ~15 Frames in 8 s sind länger als 50 ms
(Referenzorbit-Wechsel, CPU-Nachrechnung). Gegenüber 6.1 ist es aber deutlich besser und das Bild bleibt scharf
(Serienbilder). Headless bestätigt: 1 500–1 800 statt ~450 Bilder in 30 s Flug, Tiefe in 30 s eher größer.

## 3. Farbe der Menge

### 3.1 Bedienung und Speichern
Farben-Tab, Abschnitt **Farbe der Menge**: fünf Knöpfe mit Farbpunkt (zeigt die echte Farbe, bei Dunkel/Hell die der
aktiven Palette), bei „Eigene“ erscheint ein Farbwähler. Gespeichert mit den übrigen Einstellungen; im Link
`sc=w|d|l|<hex>` (fehlt = Schwarz), Alpin-Look `al=f|l|m`. Ein geteilter Link beschreibt das Bild vollständig (ohne `sc`
= Schwarz). Orte speichern Farbe der Menge und Alpin-Look mit – wie die Palette, die beim Antippen eines Ortes ebenfalls
nicht umgestellt wird (bisheriges Verhalten bleibt gleich).
- **Dunkel/Hell** = dunkelste bzw. hellste Farbe der Palette über den ganzen Farbzyklus (ändert sich nicht mit der
  Farbanimation). **Eigene**: so umgerechnet, dass nach Sättigung und Gamma des Bildes ungefähr die gewählte Farbe
  erscheint (Test: gewählt 217/178/106, im Bild 217/178/106).

### 3.2 2D
`voidColor()` im Display-Pass nimmt die Mengenfarbe; der Saum aus 6.1 blendet in sie (er mischt ohnehin zur Mengenfarbe).
Schwarz ist exakt der bisherige Wert – das 2D-Bild ist mit Schwarz bitgleich zu 6.1 (alle 6.1-Kennzahlen in
`test_smooth` unverändert). **Funkeln:** blendet zwischen Helligkeit 0,15 und 0,45 aus (Weiß + Funkeln wirkte schmutzig,
auf dunklen Farben bleibt es). **Kontrast:** Bei heller Menge (Helligkeit > 0,35) bekommt die Außenseite der Kontur
einen weichen dunklen Saum (1,25–4 Pixel, bis −50 %) – die Kontur bleibt auch bei Paletten mit hellen Randfarben klar.
Sichtung: `tests/shots/setcol/blatt_set_2d_hoch.jpg` / `_quer.jpg` – Weiß, Hell und Eigene zeigen eine scharf
umrissene, geschlossene Menge; die Spiralen sind gut lesbar.

### 3.3 3D
Dunkle Farben tönen den See, helle (Weiß) machen ihn zur **Schnee-/Gletscherfläche**: matt, Schatten bläulich
(Himmelslicht), sanfter Glanz statt Himmelsspiegelung, keine Wellen, leichte Schneestruktur. Die Fläche bleibt auf
Seehöhe (Hochplateau war in 6.0 verworfen); auf großen fernen Flächen wird die Lichtnormale beruhigt (sonst sah man
Gitterfacetten). Weil der 6.1-Saum dichte Filamentzonen mengenfarben macht, liegen dort jetzt Schneefelder auf den
Kämmen – das wirkt wie verschneite Grate. Sichtung: `tests/shots/setcol/blatt_set_3d_*.jpg`.

## 4. Alpin-Look (Peters Idee: Tal als Wald oder See)

- **Höhenzonen** nach relativer Höhe (dieselbe entzerrte Höhe, die die Landschaft formt – darum bei jedem Zoom
  gleich verteilt): unter ~0,17 Tal, bis ~0,46 Almwiese, darüber Fels/Geröll, ab ~0,64 Schnee nur auf flachen Lagen;
  Fels auch an steilen Hängen (Neigung aus der Normalen); Übergänge mit Rauschen verwischt, keine harten Linien.
- **Tal Wald** (Standard): dunkle Baumkronen mit Lichtpunkten aus feinem Rauschen, Helligkeit der Kronen moduliert das
  Licht; zur Baumgrenze hin aufgelockert. Echte Baum-Instanzen bewusst weggelassen: Das Gelände ist ein Bildraum-Gitter
  ohne feste Weltposition, Instanzen müssten pro Bild neu verteilt werden und kosteten auf dem Handy am meisten – die
  Textur wirkt ab der üblichen Flughöhe bereits wie Wald.
- **Tal See:** Talboden unter dem Wasserspiegel (relative Höhe 0,1) wird im Gitter flach abgeschnitten (nicht in der
  Menge selbst), Uferlinie pro Pixel aus der unbeschnittenen Höhe (weich). Wasser mit Himmelsspiegelung, Sonnenglanz und
  sanften Wellen, die in der Ferne ausblenden (sonst Moiré). Der Wasserspiegel hängt an der zeitlich geglätteten
  Höhen-Entzerrung (2,5/s) – kein Flackern beim Zoomen/Fliegen. Spiegelung der Berge selbst gibt es nicht (das
  vorhandene Wasser spiegelt nur den Himmel).
- **Tal Wiese:** hellere Almwiese bis ins Tal.
- **Himmel klar** (Blau), **Dunst bläulich**; 2D nutzt die neue Palette „Alpin“ (Grün/Grau/Blau) mit weißer Menge.
  Der Schalter setzt Weiß + Palette „Alpin“ als Voreinstellung; Farbe der Menge bleibt danach frei wählbar.
- **Welt-verankertes Rauschen:** Texturen in lokalen Bildkoordinaten würden beim Zoomen schwimmen. Darum 4 Oktaven mit
  Wellenlängen als Zweierpotenzen der Welt; der Versatz jeder Oktave wird exakt aus der BigInt-Kamera berechnet
  (Fokus / Wellenlänge mod 256 – in f32 im Deep Zoom unmöglich), beim Tieferzoomen gleiten die Oktaven weiter (Gewichte
  sin², Summe konstant). Das Rauschen selbst steckt in einer einmal auf der GPU erzeugten, kachelbaren 512²-Textur mit
  Mipmaps (1 Zugriff pro Oktave, ferne Bereiche automatisch geglättet).
- Vision-Check (selbst gesichtet, `tests/shots/setcol/vergleich_alpin_hoch.jpg` / `_quer.jpg`, Einzelbilder
  `tests/shots/setcol/<hoch|quer>/alpin_*.jpg`): **Ja, es wirkt wie ein Alpenpanorama** – Zoom 1: Gletscher-Kessel
  (Hauptkardioide) mit verschneitem Grat, ringsum Wald bzw. ein großer See; 300×: verschneite Felskämme über grünen
  Almen; 10⁶ quer mit See: Almen, Felsflanken, Gletscherkämme, Bergsee mit sanftem Ufer – das stimmigste Bild. Schwächen:
  im Hochformat bei 300× dominiert der Schnee (dichte Zone), der Fels ist dort nur schmal; der Wald wirkt aus großer
  Höhe als dunkler Teppich.

## 5. Kosten (GPU-Zeit 3D-Bild, Bewegung, 65 % Auflösung wie Handy)
Wanduhr zwischen zwei Synchronisationspunkten über 20 Bilder, 8× im Wechsel, Minimum (`tests/bench_v62.py`, Rohdaten
`tests/results_bench_v62_v610.json` / `_v620.json`):

| Ansicht | 6.1.0 | 6.2 Standard | 6.2 Weiß | 6.2 Alpin Wald / See |
|---|---|---|---|---|
| Gesamtbild | 3,25 ms | 3,27 ms | 3,39 ms | 5,51 / 5,51 ms |
| Seepferdchen 300× | 3,88 ms | 3,77 ms | 4,18 ms | 6,40 / 6,27 ms |
| Randpunkt 10⁶ | 3,92 ms | 4,09 ms | 4,50 ms | 6,85 / 6,67 ms |

Wichtig dabei: Der Gelände-Shader gibt es jetzt in **drei Varianten** (Standard / + Schnee / + Alpin). Mit allem Code in
einem Shader war auch der Standard-Look 40 % langsamer als 6.1 (4,6 statt 3,3 ms), obwohl die neuen Zweige gar nicht
liefen – der Compiler plant Register für den schlimmsten Fall. Alpin bleibt teurer (die Zonenfärbung selbst); auf einem
Mittelklasse-Handy senkt die vorhandene 3D-Regelung dann die Bewegungsauflösung, bis die Bildrate hält. Speicher:
+1,4 MB Rauschtextur (nur bei Weiß/Alpin), Sonde unverändert.

## 6. Tests
`tests/run_all.sh` komplett grün: Node-Kern, Release/PWA/offline (Cache `fraktale-6.2.0`), Wahrheit GPU + CPU
(unverändert), Gesten, UI (Touch-Ziele ≥ 48 px hoch und quer), Funktionen, Bildaufbau (harte Wechsel 0), 3D (inkl.
Ortsflug exakt, Tippen pausiert), Glättung 6.1 (alle Werte wie 6.1), plus neu **`tests/test_v62.py`**:
- Farbe der Menge per Knopf: Schwarz-Pixel wie 6.1 (0/0/6), Weiß 2D hell, gespeichert, nach Neuladen noch da, Link `sc=w`,
  eigener Farbton per Link (`sc=d9b26a` → im Bild 217/178/106); 3D Gletscher hell (18/31/58 → 158/168/189)
- Alpin per Link (`al=l`), GPU-Zeit 3D-Bild < 16 ms; 8-bit-Ersatzpfad (iPhone ohne Float-Renderziel) quer mit Alpin und
  `?flyedge=0`-Flug ohne Fehler
- Zufallsflug 30 s ab Seepferdchen-Tal: 0 Fehler, 0 harte Wechsel, Spitze 16,3 °/s (< 25), 6 Richtungswechsel/min (< 15),
  Rand in der Bildmitte 100 % (≥ 90 %), innen 3 % (< 15 %); Wischen nach rechts dreht den Kurs (+1,1 rad)

Mess- und Bildskripte: `tests/measure_fly.py`, `tests/fps_v62.py`, `tests/bench_v62.py`, `tests/shots_setcol.py`.

## 7. Grenzen / offen
- Nicht auf einem echten Android-Handy/iPhone gemessen (Pixel-7-Emulation, iPhone-Pfad ohne Float-Renderziel emuliert).
- Flug ≥ 60 fps nicht ganz erreicht (≈ 51 fps auf M1, vorher 34); weitere Glättung hieße die Rechen-Orchestrierung
  im Flug umbauen (z. B. Referenzorbit-Wechsel und CPU-Nachrechnung im Flug seltener) – eigener Auftrag.
- Alpin-Look nur in 3D mit Höhenzonen; in 2D gibt es dafür die Palette „Alpin“ mit weißer Menge.
- Burning Ship/Tricorn: Der Flug nutzt dort die genäherte Distanz aus 6.1 – funktioniert, ist aber keine strenge
  Schätzung; ohne Distanzkanal („Menge glatt“ aus, `?de=0`) fällt der Flug auf die 6.1-Wertung mit sanfter Lenkung zurück.
- Ein Ort speichert Mengenfarbe/Alpin mit, stellt sie beim Antippen aber (wie die Palette) nicht um. Falls Peter das
  möchte: eine Zeile in `goTo` (dann am besten Palette mit).
