# Fraktal-Explorer 6.0.0 – Bericht „3D-Landschaft + Flug"

Datum 02.10.2026. Zwei Etappen in einem Auftrag: **5.1.0 nahtloser Bildaufbau** (eigener Bericht `V51_BERICHT.md`, live seit heute) und darauf aufbauend **6.0.0 3D-Landschaft + Flyover**.

**Hinweis für Peter:** Die App ist eine PWA – einmal ganz schließen und neu öffnen (bzw. Seite neu laden), dann steht unter „Mehr" 6.0.0. Der 3D-Schalter ist das ⛰-Symbol oben rechts.

## 0. Nahtloser Bildaufbau (5.1.0) – Kurzfassung

Jedes fertige Bild bleibt als Ebene erhalten; der Display-Pass trägt die Ebenen nach Schärfe sortiert auf (eine gröbere Vorschau überdeckt nie ein schärferes Bild), neue Ebenen blenden weich ein, Ränder sind gefedert, Vorschauen werden auf dem Iterationswert rekonstruiert. In Bewegung wird für die vorausgesagte Kamera nur gerechnet, was fehlt; im Leerlauf wird vorausgerechnet; animierte Bewegungen bremsen weich, bevor das Bild grob würde. Gemessen (M1, Pixel-7-Ansicht, 5.0.1 → 5.1.0): grobe Frames Pinch 89 → 3 %, Schwenk 91 → 18 % (leere Fläche 85 → 0 %), Tour 77 → 3 % (14,2 → 15,0 s), Doppeltipp 51 → 6 %; harte Wechsel 35 → 0; Wahrheitstests unverändert. Alles Weitere: `V51_BERICHT.md`.

Nachtrag 2D in 6.0: dritte Reserve-Ebene (1/256 Zoom, 1/64 der Pixel) – der Extremtest „×100 Herauszoomen in 2 s“ streute vorher headless zwischen 1 und 15 % kurz leerer Fläche, jetzt 0 % (5.0.1-Modus ~90 %).

## 1. Was die 3D-Landschaft ist

Schalter ⛰ (oben rechts): Die aktuelle Ansicht richtet sich in 0,7 s als Gebirge auf. Der Rand der Menge (höchste Iterationszahl) bildet Kämme, die Menge selbst ist ein See, weit draußen liegt flaches Land; Farben = aktuelle Palette (gleicher GLSL-Code wie 2D), Sonne von links oben mit weichen Schatten, Himmelslicht, Dunst zum Horizont, Himmel mit Sonnenhof, der See spiegelt den Himmel. Steile Flanken bekommen eine Felsfarbe statt einer senkrecht gestreckten Bodentextur.

Gesten: ein Finger schiebt über den Boden, zwei Finger spreizen = Zoom, drehen = Drehung, gemeinsam hoch/runter = Neigung (0–60°), Doppeltipp ×3. Leiste über dem Dock: ✈ Flug, ⛰ Höhe (bzw. ⏩ Tempo im Flug), 🧭 Ausrichten. Desktop: rechte Maustaste = drehen/neigen, Shift+Pfeile, `D`, `V`. DE/EN vollständig, übrige Sprachen fallen auf EN zurück. Mandelbulb (schon 3D) und Buddhabrot: Schalter ausgeblendet.

**Exaktheit:** Die Landschaft liest nur die fertigen Iterationspuffer. Die Kamera der Rechnung ist dieselbe wie in 2D (Bodenpunkt in der Bildmitte), die Rechnung inkl. CPU-f64-Nachrechnung ist unverändert; nur die Rechenansicht ist in 3D quadratisch (damit beim Drehen nichts fehlt), und es kommen ferne Detailstufen dazu.

## 2. Technik und Entscheidungen

- **Gitter im Bildraum („projected grid") mit Vertex-Texture-Fetch** statt Höhenfeld-Raymarching: jede Gitterecke ist ein Kamerastrahl, der den Boden trifft und um die Höhe angehoben wird. Gleichmäßige Dichte auf dem Schirm, der Horizont kostet nichts extra, Rasterisierung ist auf Mittelklasse-GPUs viel billiger als 60–120 Raymarch-Schritte pro Pixel. Das Gitter reicht bis weit unter den Bildrand (hohe Berge vorn heben die unterste Reihe an).
- **Höhentexturen mit Mipmaps** (pro Ebene halbe Auflösung, RG16F: log₂(1+μ) relativ zu einer Basis, Innen-Anteil; 8-bit-Ersatz ohne Float-Renderziel): Geometrie und Licht lesen sie passend zur Bildschirmgröße → keine Treppen, kein Flimmern. Speicher: +1/3 der Ebene, nur in 3D, beim Verlassen freigegeben.
- **Höhe:** Histogramm-Entzerrung (9 Quantile aus einer 48×48-Sonde um den Fokus, weich nachgeführt) – lineare Normierung ergab in dichten Tiefen einen flachen „Teppich", weil fast alles nahe am Rand liegt. Geometrie = 55 % Großform (Mindest-Glättung 4 % der Bildhöhe) + 45 % Feinstruktur; der große See wird aus einer groben Ufer-Maske abgesenkt (sanfte Hänge statt Wände), kleine Mengen-Inseln (Minibrots) bleiben als Plateaus stehen. *Verworfen:* rohe Höhe (Nadelwald), Hochplateau-See (verdeckte alles dahinter), steile Uferkante.
- **Licht:** weiche Schatten pro Gitterpunkt (6 Schritte durchs grob werdende Höhenfeld – pro Pixel war es 15× teurer), Normale pro Pixel aus der Höhentextur, Felsfarbe nach der Neigung des tatsächlich gezeichneten Dreiecks.
- **Horizont:** fern liegen die weiten Reserve-Ebenen aus 5.1 (1/4 und 1/32 Zoom); in 3D wird der Ring größer gerechnet (der Boden vor der Kamera liegt bis ~1,7 Bildhälften hinter dem Fokus), und während Bewegung ist jede dritte Vorschau eine ferne Detailstufe. Dunst blendet alles jenseits der Daten aus.
- **Übergang 2D ↔ 3D:** Bei Neigung 0 und Höhe 0 ist die Abbildung exakt affin (Boden senkrecht zur Blickachse) – das 3D-Bild entspricht dann dem 2D-Bild; Neigung/Höhe/Licht wachsen in 0,7 s, die ersten 25 % werden mit dem 2D-Bild überblendet.
- **Leistung:** 3D wird in eine eigene Zielfläche gerendert (Handy 65 %, Desktop 100 % der Canvas-Auflösung) und hochskaliert; die Auflösung regelt sich nach der Bildrate (bis 45 %). Die großen 3D-Shader werden beim Antippen des 3D-Knopfs vorab übersetzt (KHR_parallel_shader_compile, ~100 ms Vorsprung bis zum Loslassen); der erste 3D-Frame kann einmalig bis ~85 ms dauern (fällt in den Übergang). Automatisches Vorübersetzen im Leerlauf wurde verworfen: danach benötigte 2D-Shader und Rechnungen warteten in der Treiber-Warteschlange (im Test: 99-ms-Ruckler, beim Schieben kurz 38 % leere Fläche). Neigen/Drehen/Höhe sind Darstellung, keine Kamerabewegung (lösen keine Neuberechnung aus).

## 3. Flug (✈)

Zoom + Vorwärtsflug: gezoomt wird um einen Punkt knapp vor dem Fokus in Flugrichtung → die Kamera gleitet vorwärts und taucht tiefer; da die Landschaft in lokalen Einheiten (halbe Bildhöhe) gebaut ist, wirken Berge in jeder Tiefe gleich hoch. Die Tempo-Bremse aus 5.1 gilt auch hier.
- **Zufallsflug:** alle 300 ms werden 13 Kurse bis ±150° bewertet (entlang des Strahls 0,3–1,3 Bildhälften: Randnähe + Detail positiv, leere Ebene negativ, Inneres stark negativ); ist voraus alles flach, gleitet die Kamera seitlich zum nächsten Rand statt tiefer zu tauchen. Erste Version wählte nur ±60° um den Startkurs und tauchte in eine leere Ebene – behoben, Serienbilder über 16 s / 7 Zehnerpotenzen bleiben im Gebirge.
- **Flug zu einem Ort** (✈ an der Orte-Karte): Start im Gesamtbild wie ▶ Tour, gerade auf den Ort zu, Ankunft exakt (Test: Koordinate und Zoom auf 10⁻⁶ genau), Referenzorbit gleich fürs Ziel.
- Tippen = Pause, nach links/rechts wischen = lenken (klingt in 2,5 s ab), zwei Finger = Flug beenden, Tempo-Regler 0,1–1,5 Zehnerpotenzen/s (Standard 0,5).

## 4. Messungen

Chromium mit echter GPU (Apple M1), Pixel-7-Ansicht 412×915 (Canvas 824×1678); Mittelklasse-Profil = 4 Kerne + CPU 4× gedrosselt (die GPU lässt sich nicht drosseln).

| | M1 | Mittelklasse-Profil |
|---|---|---|
| GPU-Zeit 3D-Bild (Timer-Query, Minimum) | 2,8 ms (45 %) · 3,7 ms (65 %) · 5,9 ms (100 %) | GPU = M1 |
| Bildrate Gesten in 3D (sichtbares Fenster) | 56 fps | 52 fps |
| Bildrate Flug 8 s bis 1,5·10¹³ | 49 fps | 47 fps |
| Long Tasks > 50 ms im Flug | 0 | 0 (ein 50-ms-Task bei Referenzorbit-Übernahme, unverändert seit 5.0) |
| JavaScript pro Frame | Ø 0,3 ms, max. 6 ms | |
| Zufallsflug 20 s (headless, Tempo 0,8) | bis 5·10¹⁰–4·10¹¹, 0 harte Wechsel, 0 Lücken | |

Einschätzung Mittelklasse-Android: deren GPUs sind etwa 6–10× langsamer als M1 → 3D-Bild 17–37 ms bei 45–65 % Auflösung; die Regelung senkt die Auflösung, bis die Bildrate hält. **Auf einem echten Gerät nicht gemessen** – 30 fps sind plausibel, aber nicht bewiesen.

## 5. Tests

`tests/run_all.sh` komplett grün, neu `tests/test_3d.py`: alle 8 Welten 3D an/aus ohne Fehler (6/7 ohne Schalter), 2D-Bild nach 3D an/aus **pixelgleich** (100 % identische Pixel, wie zweimal 2D), Touch-Gesten in 3D (Drehen −1,571 rad bei 90°-Fingerdrehung, Neigen +0,31 rad, Spreizen ×2,0, Schieben, Doppeltipp ×3,0), 3D-Leiste ≥ 48 px, GPU-Zeit < 16 ms, Zufallsflug 20 s bis ≥ 10⁹ ohne Fehler und ohne harte Wechsel, Tippen pausiert, Ortsflug endet exakt. Der 2D-Display-Shader ist bytegleich zu 5.1.0, die Wahrheitstests (GPU + CPU) haben dieselben Werte wie 5.0.1.

**Screenshots** (`tests/shots/3d/`, `tests/shots3d.py`): Seepferdchen-Tal (300×), Spirale 1,7·10⁷, Randpunkt 10⁹, Julia, je 30° und 55°, hoch und quer, plus Flug-Serie 6 × 250 ms. Selbst gesichtet: Es wirkt wie eine Landschaft – Gebirgskämme am Rand, Täler, Seen, Dünenflachland weit draußen, ferne Gipfel im Dunst; keine Treppen, die Gitterauflösung ist dank Mipmaps nicht zu sehen; der Horizont läuft weich in Dunst aus. Schwächen: an sehr steilen Flanken bleibt die Felsfläche schlicht; bei Julia (Zoom 1,6) ist weit draußen eine fast leere Hochebene zu sehen.

## 6. Grenzen / offen

- Nicht auf echtem Android/iPhone gemessen (Emulation + M1). iPhone Safari: WebGL2 + EXT_color_buffer_float vorhanden; ohne Float-Renderziel greift ein 8-bit-Ersatz (leichte Höhenstufen möglich).
- Im 3D-Modus kostet jedes neue Bild zusätzlich eine Höhentextur (+1/3 Speicher der Ebene); Pool-Budget wie 5.1.
- Der Fokus (Bodenpunkt in der Bildmitte) ist der Bezugspunkt für Zoom und Rechnung; Zoomen um den Finger-Mittelpunkt gibt es in 3D bewusst nicht (der Punkt unter den Fingern ist in Perspektive mehrdeutig).
- Freier Flug durch 3D-Fraktale (Mandelbox/Mandelbulb) ist wie vereinbart nicht Teil dieses Auftrags.
