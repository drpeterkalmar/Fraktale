# 🌀 Fraktal-Explorer 6 – Deep Zoom fürs Handy, auch als 3D-Landschaft

**Live:** https://drpeterkalmar.github.io/Fraktale/ · installierbar als App (PWA), funktioniert offline.

Ein Mandelbrot- und Fraktal-Explorer, der auch auf einem Mittelklasse-Android-Handy flüssig bis in Tiefen von 10³⁰ (GPU) und 10²⁹⁰ (CPU) zoomt – ohne Kachel-Aufbau, ohne Flackern, mit mathematisch geprüften Bildern. Seit 6.1 sieht die Menge aus wie in den bekannten vorgerenderten Zoom-Videos: geschlossen, ruhig, mit glattem Rand. Seit 6.2 kann sie jede Farbe haben – in 3D wird Weiß zum Gletscher, der Alpin-Look macht daraus ein Alpenpanorama mit Wald oder See im Tal – und der Flug gleitet ruhig am Mengenrand in die Tiefe.

![6.2 Alpin-Look: oben Standard, Mitte Wald, unten See (Zoom 1, 300×, 10⁶)](tests/shots/setcol/vergleich_alpin_quer.jpg)

![6.0 (links) und 6.1 (rechts): Seepferdchen-Tal, 300×](tests/shots/smooth/sheets/vergleich_hoch_seepferd_300_2d.jpg)

![Vorschau](tests/shots/portrait_08_deep1e15_relief_gold.png)

## 🖐 Gesten (Kurzanleitung)

| Geste | Wirkung |
|---|---|
| Ein Finger ziehen | verschieben – mit Schwung (Trägheit) |
| Zwei Finger spreizen/zusammenziehen | zoomen; der Punkt unter den Fingern bleibt stehen |
| Doppeltipp | hineinzoomen ×3 an dieser Stelle |
| Zwei-Finger-Tipp | herauszoomen ÷3 |
| Lange drücken (Mandelbrot) | Julia-Menge genau für diesen Punkt öffnen |
| Einmal tippen | Bedienelemente aus-/einblenden (Vollbild-Genuss); schließt offene Menüs |
| Unten: **Welten · Farben · Orte · Teilen · Mehr** | Bottom-Sheet mit allen Einstellungen (Griff ziehen: groß/zu) |

## 🏔 3D & Flug

![3D-Landschaft im Flug](tests/shots/3d/quer_flug_4.jpg)

Oben rechts **⛰ (3D-Landschaft)** antippen: die aktuelle Ansicht richtet sich als Gebirge auf – der Rand der Menge bildet die Kämme, die Menge selbst ist ein See, Farben = aktuelle Palette, Sonne mit weichen Schatten, Dunst zum Horizont. Die exakte Deep-Zoom-Rechnung bleibt dieselbe wie in 2D (die Landschaft liest nur das fertige Bild).

| Geste in 3D | Wirkung |
|---|---|
| Ein Finger ziehen | über die Landschaft schieben |
| Zwei Finger spreizen/zusammen | hinein-/herauszoomen |
| Zwei Finger drehen | Landschaft drehen |
| Zwei Finger gemeinsam hoch/runter | neigen (0–60°) |
| Doppeltipp / Zwei-Finger-Tipp | Zoom ×3 / ÷3 |
| Leiste unten: **✈ Flug**, ⛰ Höhe, 🧭 Ausrichten | Flug starten/stoppen, Bergehöhe, zurück auf Norden + Standardneigung |

**✈ Flug:** Die Kamera gleitet über die Landschaft und taucht dabei endlos in die Tiefe (Zoom + Vorwärtsflug); die Berge wirken in jeder Tiefe gleich hoch. Der **Zufallsflug** (✈ in der Leiste) gleitet seit 6.2 ruhig am Mengenrand entlang (Filamente, Spiralen, Minibrot-Ränder) – der Zoompunkt sitzt auf dem Rand, der Kurs dreht gedämpft (höchstens 17 °/s) mit leichter Schräglage; das Innere und leere Ebenen meidet er, aus einer leeren Fläche gleitet er erst zum nächsten Rand. **✈ Flug** an einem gespeicherten Ort (Orte-Tab) startet im Gesamtbild und landet exakt dort. **Tippen = Pause**, **nach links/rechts wischen = lenken**, ⏩-Regler = Tempo. Vergleich mit dem Flug bis 6.1: `?flyedge=0`, Drehrate: `?flyturn=` (rad/s). Bei Mandelbulb (schon 3D) und Buddhabrot gibt es keinen 3D-Schalter.
Desktop: rechte Maustaste ziehen = drehen/neigen, Shift+Pfeile = drehen/neigen, `D` = 3D an/aus, `V` = Flug.

**Desktop:** Mausrad = Zoom um den Mauszeiger, Ziehen = verschieben, Shift+Ziehen = Rechteck-Zoom.
Tasten: `M J B T 3 N` Modi · `P` Palette · `R` Reset · `S` Bild · `F` Vollbild · `I` Oberfläche · `H` Hilfe · `L` Sprache · `+/−` Iterationen · Pfeile verschieben · `Bild↑/↓` Zoom · `Z` Rechteck-Zoom.

Das HUD oben zeigt Modus und Tiefe (z. B. `1,23 × 10⁹`). Antippen öffnet Details: Koordinaten, Iterationen (−/+/Auto), Rechenweg, Renderzeit, FPS, Version. Antippen der Zoomzahl wechselt zwischen 10er-Potenz und Wörtern („1,23 Milliarden").

## ✨ Funktionen

- **8 Welten:** Mandelbrot, Julia (mit c-Pad: Punkt ziehen, Julia-Menge folgt live; Feinsteller ±0.1…10⁻⁴), Burning Ship, Tricorn, Mandelbrot z³, Newton, Mandelbulb 3D, Buddhabrot.
- **Farben:** 11 Paletten als echte Farbverlaufs-Vorschau + eigene Palette mit 6 Farbwählern (wird gespeichert), **Farbe der Menge** (Schwarz, Weiß, dunkelste/hellste Palettenfarbe, eigene; 2D + 3D, im Link `sc=`), **Alpin-Look (3D)** mit Tal Wald/See/Wiese (Link `al=`), Farbdichte, Farbanimation (an/aus, Tempo), 3D-Relief, weiche Übergänge/Bänder, Funkeln im Inneren (nur bei dunkler Menge).
- **Orte:** eigene Orte merken (in jeder Welt, mit Mini-Bild), **▶ Tour** = automatischer Zoom-Flug vom Gesamtbild zum Ziel. Fest eingebaute Sehenswürdigkeiten gibt es seit 5.0.1 nicht mehr – sie lagen alle auf Mandelbrot-Koordinaten und passten in den anderen Welten nicht.
- **Teilen:** Bild (Web Share API bzw. Download, mit Beschriftung) oder Link zur exakten Stelle (Deeplink `#m=…&x=…&y=…&z=…`).
- **Mehr:** Iterationen (Auto oder manuell), Auflösung (Akku / Ausgewogen / Maximal), Rechenweg (Auto / GPU / CPU), exakte Nachrechnung, **Menge glatt (wie Video)**, **Glatte Kanten (wie Video)**, Tempo an Rechenleistung anpassen, Übersichtskarte, Rechteck-Zoom, Sprache (DE, EN + 7 weitere für die Hilfetexte), Vollbild, Reset, Hilfe, App installieren.

## 🧠 Wie es funktioniert (Architektur v5)

- **Hochpräzise Kamera** (`js/hp.js`): Bildmitte als BigInt-Festkommazahl (1088 Bit) statt decimal.js – keine externe Bibliothek mehr, offline-fähig.
- **Referenzorbit im Worker** (`js/orbit-worker.js`, `js/fractal-core.js`): BigInt-Iteration mit zoomabhängiger Präzision. Referenzwahl: Bildmitte, sonst **Minibrot-Kern** (Kugel-Periodenerkennung + Newton), sonst Gitter-Probe (längster Orbit). Für Julia zusätzlich der kritische Orbit (Rebase-Ziel). Nie auf dem Main-Thread.
- **GPU-Perturbation** (`js/shaders.js`): Delta-Iteration im Fragment-Shader (WebGL2, f32), Orbit als Float-Textur, pro Pixel eigener Orbit-Index, Zhuoran-Rebase, **BLA** (bilineare Approximation) zum Überspringen von Iterationen. Direkte f32-Iteration bis Zoom 1000 – gleiche Glättungsformel, daher nahtloser Übergang.
- **Exaktheit trotz f32:** Der finale Pass führt pro Pixel die Ableitung mit und schätzt den Rundungsfehler (vorhergesagter Iterationsfehler). Unsichere Pixel (typ. 1–25 %) rechnet der CPU-Worker-Pool in f64 exakt nach; die Korrektur wird per Crossfade übernommen. Danach ändert sich das Bild nicht mehr.
- **Iterationspuffer + Display-Pass** (`js/renderer.js`): Gerechnet wird in einen Iterationspuffer (R32UI); eingefärbt wird separat. Dadurch: Palette/Farbanimation/Relief ohne Neuberechnung, und bei Gesten wird das letzte Bild **reprojiziert** (60 fps), während im Hintergrund eine niedrig aufgelöste Vorschau nachläuft. Im Stillstand: Verfeinerung bis volle Auflösung, Tausch per Crossfade. Rechenarbeit in Fence-getakteten Häppchen – kein GPU-Stau, keine Main-Thread-Blockade.
- **Nahtloser Bildaufbau (5.1)**: Jedes fertige Bild bleibt als **Ebene** erhalten (bis 8). Der Display-Pass trägt sie nach Schärfe sortiert auf (Pufferpixel pro Bildschirmpixel nach Reprojektion): eine gröbere neue Vorschau füllt nur Lücken und überdeckt nie ein schärferes altes Bild; neue Ebenen blenden zeitbasiert ein (150 ms in Bewegung, 220 ms im Stillstand), Ränder sind gefedert, vergrößerte Vorschauen werden auf dem Iterationswert interpoliert (Catmull-Rom) statt auf Farben. In Bewegung wird für die **vorausgesagte** Kamera gerechnet, und nur der Teil, der noch nicht scharf genug ist (beim Schwenk ein Streifen am vorderen Rand in hoher Auflösung). Im Leerlauf wird **vorausgerechnet** (tieferer Referenzorbit, weite Reserve-Ebenen, Ring, Mitte ×2). Animierte Bewegungen (Tour, Doppeltipp, Rad, Schwung) bremsen weich, bevor das Bild grob würde; Finger-Gesten bleiben 1:1. A/B-Regler: `?blend=0` (Verhalten 5.0.1), `?maxdiv=`, `?over=`, `?fadems=`, `?feather=`, `?recon=0`, `?predict=0`, `?prefetch=0`, `?strips=0`, `?gov=0`. Details: `V51_BERICHT.md`.
- **Glatt wie Video (6.1)**: Neben jedem Iterationspuffer liegt ein zweiter 8-bit-Kanal mit der **Distanzschätzung** (Abstand zur Menge in Pixeln, aus der Ableitung dz/dc, die GPU-Perturbation inkl. Rebase/BLA und CPU-f64 mitführen). Der Display-Pass färbt Punkte, die näher als ~1 Pixel an der Menge liegen, in der Mengenfarbe – mit weichem Saum (0,25–1,25 px), bilinear pro Bildschirmpixel interpoliert. Die Menge wird so eine ruhige Fläche mit kantengeglätteter Kontur, bei jeder Iterationszahl; der Iterationspuffer selbst bleibt bitgenau (Wahrheitstests unverändert). In 3D trägt die Höhentextur den Mengen-Anteil inkl. Saum (B-Kanal) – Farbe und Wasser pro Pixel statt pro Texel/Gitterpunkt, Felsfarbe nach weich interpolierten Normalen statt Dreiecks-Facetten; im Stillstand wird das 3D-Bild in voller Auflösung mit Subpixel-Versatz 8× gemittelt (Akku: 4×), danach ruht die GPU. A/B-Regler: `?aa=0` (Verhalten 6.0.0), `?aa=N` (Zahl der gemittelten 3D-Bilder), `?de=0` (nur Distanzschätzung aus), `?dew=W` (Saumbreite in Pixeln, 2D). Details: `V61_BERICHT.md`.
- **3D-Landschaft (6.0)** (`js/three.js`): liest nur die fertigen Iterationspuffer-Ebenen. Pro Ebene eine Höhentextur (halbe Auflösung, RGBA16F, Mipmaps), Gitter im Bildraum mit Vertex-Texture-Fetch, Höhe = log₂(1+μ) histogramm-entzerrt (Quantile aus einer kleinen Sonde), Menge = See, weiche Schatten pro Gitterpunkt, Licht/Farbe pro Pixel, Dunst + Himmel, Fels auf Steilflächen. In 3D rechnet die App quadratisch (Drehen) und zusätzlich ferne Detailstufen für den Horizont; die Sonde steuert auch den Zufallsflug.
- **Farbe der Menge + Alpin-Look (6.2)**: Mengenfarbe als Uniform im Display-Pass und im Gelände-Shader (Schwarz = bisheriger Wert, bitgleich); helle Menge: dunkler Saum außen an der Kontur, kein Funkeln, in 3D matte Schnee-/Gletscherfläche. Alpin: Färbung nach relativer Höhe (Tal/Alm/Fels/Schnee, Neigung aus der Normalen), Talsee als abgeschnittener Talboden, Texturen aus einer kachelbaren GPU-Rauschtextur in welt-verankerten Oktaven (Versatz exakt aus der BigInt-Kamera, schwimmt beim Zoomen nicht). Der Gelände-Shader existiert in drei Varianten (Standard/Schnee/Alpin), damit der Standard so schnell bleibt wie 6.1. Details: `V62_BERICHT.md`.
- **Flug am Mengenrand (6.2)**: Die 3D-Sonde liefert neben der Höhe die Distanz zur Menge (8 Bit im selben Auslesewert, im Flug alle 150 ms, Positionen auf die aktuelle Kamera umgerechnet). Der Zoompunkt wird auf Stellen ≤ 0,04 Bildhälften am Rand gelegt, mit jeder Sonde nachgeführt und nur mit Hysterese neu gewählt; der Kurs folgt ihm kritisch gedämpft. Im 3D-Modus begrenzt der Rechen-Regler sein Budget auf einen Bildtakt (vorher bis 8 → Flug ruckelte; `?flycap=0` = alt).
- **CPU-Pfad** (`js/tile-worker.js`): gleicher Algorithmus in f64 für Zoom > 10³⁰, Newton-Tiefzoom, als Fallback (Rechenweg „CPU") und für die exakte Nachrechnung. Worker-Zahl = Kerne − 1.
- **PWA** (`manifest.webmanifest`, `sw.js`): versionierter Cache (`fraktale-<Version>`), jede Datei mit `?v=<Version>`, HTML network-first. Worker-URLs hängen automatisch an `APP_VERSION`.

## ✅ Prüfung (Zahlen sind der Beweis)

Unabhängige Wahrheit: direkte Iteration in Python-`Decimal` (`tests/truth.py`) an 400 Stichprobenpixeln je Ansicht, Kriterium |Δμ| ≤ 1 Iteration bei ≥ 99 %.

| Ansicht | GPU (Metal) | CPU f64 |
|---|---|---|
| Seepferdchen 10⁷ | 100 % | 100 % |
| Randpunkt 10⁹ | 99,5 % | 99,5 % |
| Peters Spirale 1,7·10⁷ | 100 % | 100 % |
| Seepferdchen 10¹⁴ | 99,5 % | 99,5 % |
| Randpunkt 10¹⁵ | 99,75 % | 99,75 % |
| Julia 10¹⁰, Tricorn 10⁶, Burning Ship 10⁶, z³ 10⁵ | 99,5–100 % | – |
| Übergang direkt↔Perturbation (Zoom 999/1001) | 100 % / 100 % | 100 % |
| Randpunkt 10⁴¹ (nur CPU) | – | 99,75 % |

Details, Methode und Grenzfälle: `V5_BERICHT.md`. Tests laufen lokal mit `python3 -m http.server 8472` und `python3 tests/<test>.py`.

## 🛠️ Start ohne Internet

Ordner herunterladen, `start_fractal.bat` (Windows) doppelklicken oder `python3 -m http.server 8000` und http://localhost:8000 öffnen. Kein Build-Schritt nötig.

## 📜 Änderungen

**Version 6.2.0** – Farbe der Menge (Weiß/Alpin) + sanfter Flug zum Mengenrand
- Neu: **Farbe der Menge** (Farben-Tab): Schwarz (wie bisher), Weiß, dunkelste/hellste Farbe der Palette, eigene Farbe per Farbwähler – in 2D und 3D, gespeichert, im Teilen-Link (`sc=`), bei Orten mitgespeichert. Helle Menge: Kontur mit weichem dunklem Außensaum (bleibt klar), Funkeln aus; 3D: matte Schnee-/Gletscherfläche mit bläulichen Schatten statt See.
- Neu: **Alpin-Look (3D)** mit Tal **Wald / See / Wiese**: Höhenzonen statt Palette (Tal → Almen → Fels → Schnee, die Menge ist Gletscher), klarer Himmel, bläulicher Dunst; Talsee mit Spiegelung und weichem Ufer; welt-verankerte Texturen (schwimmen beim Zoomen nicht). Neue Palette „Alpin“ für 2D.
- Verbessert: **Zufallsflug lenkt sanft und bleibt am Mengenrand** (Zoompunkt auf dem Rand per Distanzschätzung, Hysterese, gedämpfter Kurs, Schräglage). Gemessen (3 Flüge × 30 s, hoch): Drehrate Ø 28,5 → 4,5 °/s, Spitze 52 → 17 °/s, Richtungswechsel 44,7 → 4,6 pro Minute, Rand in der Bildmitte 71 → 100 % der Zeit (6.1 schwebte ab Zoom 1 bis zu 26 s über leerer Ebene), leerer Boden 30 → 5 %.
- Verbessert: **Flug ruckelt weniger** – der Rechen-Regler blähte in 3D sein Budget auf bis zu 8 Bildtakte auf; jetzt höchstens einer: Flug 33,8 → 50,4 fps (M1, sichtbares Fenster), Mittelklasse-Profil 35,5 → 51,6 fps; Gesten unverändert 60 fps.
- Kosten 3D-Bild (M1, 65 %): Standard wie 6.1 (3,3–4,1 ms), Weiß +4–10 %, Alpin +60–70 % (5,5–6,9 ms). Wahrheitstests, nahtloser Bildaufbau (harte Wechsel 0) und alle 6.1-Glättungswerte unverändert.
- Neu für A/B: `?flyedge=0` (Flug wie 6.1.0), `?flyturn=R`, `?flycap=N|0`.
- Hinweis PWA: App einmal ganz schließen und neu öffnen, dann steht unter „Mehr" 6.2.0. Details und alle Zahlen: `V62_BERICHT.md`.

**Version 6.1.0** – Menge und Ufer glatt wie in YouTube-Zoomvideos
- Neu: **Menge glatt (wie Video)** (Mehr, Standard an): Distanzschätzung als zweiter Kanal; Punkte näher als ~1 Pixel an der Menge bekommen die Mengenfarbe → die Menge ist eine geschlossene schwarze Fläche mit glattem Rand statt eines „Pixelhaufens“, unabhängig von der Iterationszahl. Gemessen (Pixel-7-Ansicht, Ausschnitt 512², gegen eine 16× überabgetastete f64-Referenz): Seepferdchen 300× bei 3000 Iterationen Farbsprünge benachbarter Pixel 16,7 % → 1,3 %, mittlere Abweichung 17,4 → 0,8; Randpunkt 10⁹ 33,3 % → 3,7 %, 32,7 → 1,6; Flimmern beim Subpixel-Schwenk 20,9 → 4,1. Dunkle Fläche wie in der Referenz (30,4 % zu 29,9 %), also nicht aufgebläht.
- Neu: **Glatte Kanten (wie Video)** (Mehr, Standard an): 3D-Bild im Stillstand in voller Auflösung, 8 Bilder mit Subpixel-Versatz gemittelt (Akku: 4), danach ruht die GPU; Übergang aus der Bewegung weich überblendet.
- Verbessert (3D): Ufer und Minibrot-Plateaus rund und kantengeglättet (Mengen-Anteil pro Pixel aus der Distanzschätzung statt hartem Wechsel pro Texel, Wasser pro Pixel statt pro Gitterpunkt), keine Facetten-Klötze mehr an Steilwänden (weich interpolierte Normalen), kein Wasser an senkrechten Wänden. See bleibt glatt und spiegelnd. Abweichung von einer 48×-Referenz derselben Szene (doppelte Auflösung): Bewegungsbild mit 65 % Auflösung, wie es 6.0 auch im Stillstand zeigte, gegen das gemittelte 6.1-Stillbild: Seepferdchen 1,51 → 0,63, Randpunkt 10⁹ 2,55 → 0,94; Flimmern bei kleiner Drehung (6.0 → 6.1) 7,2 → 3,1 bzw. 13,4 → 5,8.
- Kosten: Vorschau-Rechnung in Bewegung im Deep Zoom +12–20 % GPU-Zeit pro Pixel (direkte Rechnung bis Zoom 10³: +7–40 %, absolut wenig; die Vorschau-Regelung hält die Bildrate), fertiges Bild unverändert, Display-Pass +10–15 % (~0,1 ms); 3D-Bild in Bewegung +4 %; Speicher +25 % je Iterationspuffer (5 statt 4 Byte pro Pixel), 3D-Höhentexturen doppelt so groß.
- Unverändert: Iterationspuffer bitgenau, Wahrheitstests GPU + CPU mit identischen Werten, nahtloser Bildaufbau (harte Wechsel 0). Iterationszahl bleibt bei autoIter – mit Distanzschätzung ist die dunkle Fläche bei 300 und 30 000 Iterationen gleich (34,30 % / 53,2 % / 23,07 % in drei Ansichten), mehr Iterationen bringen dem Rand nichts mehr.
- Neu für A/B: `?aa=0` = Verhalten 6.0.0, `?aa=N`, `?de=0`, `?dew=W`. Kleinigkeit: Hauptkardioide/Periode-2-Kreis werden in der direkten Rechnung ohne Iteration als innen erkannt (Gesamtbild schneller).
- Hinweis PWA: App einmal ganz schließen und neu öffnen, dann steht unter „Mehr" 6.1.0. Details und alle Zahlen: `V61_BERICHT.md`.

**Version 6.0.0** – 3D-Landschaft + Flug
- Neu: **🏔 3D-Landschaft** (Schalter oben rechts, alle Welten außer Mandelbulb/Buddhabrot): Höhe aus der geglätteten Iterationszahl mit Histogramm-Entzerrung (Relief auch in dichten Tiefen), Menge = See, Rand = Kämme; Neigen, Drehen, Höhenregler; Sonne mit weichen Schatten, Dunst, Himmel; weicher Übergang 2D ↔ 3D (bei Neigung 0 identisch zum 2D-Bild).
- Neu: **✈ Flug** – Zufallsflug entlang interessanter Randbereiche oder Flug zu einem gespeicherten Ort (exakte Ankunft); Tippen = Pause, Wischen = lenken, Tempo-Regler; die Tempo-Bremse aus 5.1 gilt auch hier.
- Technik: Gitter im Bildraum mit Vertex-Texture-Fetch (WebGL2) über Mipmap-Höhentexturen pro Bild-Ebene, ferne Detailstufen für den Horizont, Renderauflösung passt sich der Bildrate an. 2D-Pfad unverändert (Display-Shader bytegleich, 2D-Bild nach 3D an/aus pixelgleich, Wahrheitstests unverändert). Details: `V6_BERICHT.md`.
- Verbessert (2D): dritte, winzige Reserve-Ebene (1/256 Zoom) – schnelles Herauszoomen bis ×256 ohne schwarze Ränder (Test ×100 in 2 s: 0 % Lücken, 5.0.1: ~90 %).
- Hinweis PWA: App einmal ganz schließen und neu öffnen, dann steht unter „Mehr" 6.0.0.

**Version 5.1.0** – nahtloser Bildaufbau
- Neu: Bilder bauen sich weich auf und gehen nahtlos ineinander über – kein Rückfall auf ein gröberes Bild, kein Aufblitzen, keine harten Wechsel mehr (5.0.1 tauschte während Bewegung hart und ersetzte das scharfe alte Bild durch jede grobe Vorschau).
- Neu: Ebenen-Stapel mit schärfe-bewusstem Compositing, gefederten Rändern, zeitbasiertem Einblenden auch in Bewegung; Vorschau-Rekonstruktion auf dem Iterationswert (weniger pixelig); gröbste Vorschau 1/6 statt 1/12.
- Neu: Vorschau für die vorausgesagte Kamera; beim Schwenk wird nur der neue Rand gerechnet (dafür in höherer Auflösung); bekanntes Ziel (Doppeltipp, Tour-Ende, auslaufender Schwung) wird direkt gerechnet.
- Neu: Vorausrechnen im Leerlauf (tieferer Referenzorbit, Reserve-Ebenen gegen schwarze Ränder beim Herauszoomen, Ring für Schwenks, Bildmitte ×2) – niedrigste Priorität, nicht bei „Akku", nicht im Hintergrund.
- Neu: „Tempo an Rechenleistung anpassen" (Mehr, Standard an): Tour/Doppeltipp/Rad/Schwung werden kurz langsamer, wenn das Bild sonst grob würde; Finger-Gesten bleiben 1:1.
- Fix: Bildraten-Schätzung (einzelne kurze Frames drückten sie auf ~8 ms, die Vorschau-Arbeit schrumpfte dann auf 1024 Pixel pro Frame).
- Gemessen (M1, Pixel-7-Ansicht, 5.0.1 → 5.1.0, Anteil Frames mit grobem Bild): Pinch 10³→10⁹ 89 % → 3 %, Schwenk 91 % → 18 % (Lücken 85 % → 0 %), Tour bis 10¹² 77 % → 3 % (Dauer 14,2 → 15,0 s), Doppeltipp-Serie 51 % → 6 %; harte Wechsel 35 → 0. Exaktheit (Wahrheitstests) unverändert.
- Hinweis PWA: App einmal ganz schließen und neu öffnen, dann steht unter „Mehr" 5.1.0.

**Version 5.0.1**
- Entfernt: fest eingebaute Sehenswürdigkeiten (12 Orte + Vorschaubilder). Sie lagen alle auf Mandelbrot-Koordinaten und zeigten in Julia, Burning Ship, Tricorn, z³ usw. etwas Beliebiges. Der Orte-Tab enthält jetzt nur mehr eigene Orte – die funktionieren in jeder Welt (inkl. Julia-Parameter, auch bei ▶ Tour).

**Version 5.0.0** (Android-first-Neubau)
- Neu: GPU-Perturbation mit BLA statt CPU-Kacheln ab 10⁵ – Deep Zoom bis 10³⁰ auf der GPU, CPU-f64 bis 10²⁹⁰.
- Neu: exakte Nachrechnung unsicherer Pixel (f32-Fehlerschätzung + CPU-f64); geprüft gegen Decimal-Wahrheit.
- Neu: Referenzorbit per BigInt im Worker (vorher decimal.js auf dem Main-Thread: bis 236 ms Blockaden), Referenzwahl über Minibrot-Kerne.
- Neu: Reprojektion alter Bilder während Gesten, Vorschau→Verfeinerung mit Crossfade, kein Kachel-Aufbau, kein Flackern.
- Neu: Oberfläche komplett neu: HUD-Pille, Dock in der Daumenzone, Bottom-Sheet (Querformat: Seitenpanel), Glas-Design, Touch-Ziele ≥ 48 px, `dvh` + Safe-Areas, `touch-action` gegen Browser-Doppeltipp-Zoom.
- Neu: Gesten mit Trägheit, Doppeltipp, Zwei-Finger-Tipp, Langdruck → Julia.
- Neu: Orte als Karten mit Vorschaubildern, eigene Orte, Auto-Zoom-Tour, Teilen (Web Share), Deeplinks, Vollbild, PWA/offline.
- Neu: 4 zusätzliche Paletten, Farbdichte, Relief, Farbanimation abschaltbar (spart Akku: ohne Animation zeichnet die App im Stillstand nichts neu).
- Fix: Buddhabrot war fast schwarz (z₀ = 0 wurde von jedem Orbit gezählt und dominierte die Normierung).
- Messwerte (M1, Pixel-7-Viewport, 4 Kerne, Zeit bis exaktes Endbild): 10⁷ 4,8 → 1,5 s · 10⁹ 3,0 → 1,3 s · 10¹⁴ 17,7 → 4,6 s; erstes Bild nach < 0,1 s; Main-Thread-Long-Tasks: bis 236 ms → 0.

**Bewusst ersetzt/entfernt (v5):**
- *Formel-Leiste unten* → die Formeln stehen auf den Welten-Karten; im Julia-Modus zeigt ein Chip über dem Dock das aktuelle c (Tipp öffnet c-Pad und Feinsteller). Grund: Platz in der Daumenzone.
- *Ziffern-Stepper für Julia-c* → Feinsteller mit wählbarer Schrittweite (0.1 … 10⁻⁴) plus c-Pad; gleiche Funktion, größere Touch-Ziele.
- *Pfeiltasten ↑/↓ = Iterationen* → Pfeiltasten verschieben jetzt (wie die Hilfe schon immer behauptete); Iterationen per `+/−`.
- *Info-Panel links oben, Palettenliste rechts oben, Bookmark-Leiste unten* → HUD-Pille + Bottom-Sheet (alles weiter vorhanden).
- *Übersichtskarte* ist am Handy standardmäßig aus (Platz), ab 900 px Breite an; Schalter unter „Mehr".
- *Google-Fonts und decimal.js vom CDN* → Systemschrift und eigene BigInt-Arithmetik (offline, keine Drittanbieter-Anfragen).
- *„Shift+Klick = Julia" (stand im alten README, war nicht umgesetzt)* → Langdruck (Maus: gedrückt halten).
- Aufgeräumt: `*_recovered.js`, `alpha_diff.patch`, alte `test_*.py` und `shots_*/` (v4-spezifisch); neue Tests in `tests/`.

**Version 4.8.0**
- Neu: **Custom-Palette** (7. Eintrag im Palette-Picker) mit 6 Color-Pickern — live-Vorschau beim Ziehen, automatisches Speichern (localStorage), bleibt über Reloads erhalten. Wirkt überall: GPU-Shader, CPU-Worker, Minimap, Buddhabrot.
- Klarstellung: CPU-Modus übernimmt bereits ab **100.000×** (`ZOOM_THRESHOLD = 1e5`) — Kommentar im Code auf den tatsächlichen Stand korrigiert (war ein df64-Überbleibsel von ~1e11).
- Hotfix (993b1f6): `saveCustomPalette`/`loadCustomPalette` waren im ersten 4.8.0-Push undefiniert → `init()`-Crash (Panel hing beim Fallback-Tag). Lehre: `node --check` findet fehlende Funktionsdefinitionen nicht — E2E vor „live"-Ausruf. Statischer No-JS-Fallback-Tag auf 4.8.0 aktualisiert.

**Version 4.7.4**
- Default-Iterationen 500 → 300: flüssigeres Standard-View, Details bei Bedarf manuell per +/− erhöhen.
- Adaptiver Iterations-Floor startet jetzt BEI 300 (statt Basis 1000 + 1000 drauf): exakt 300 bis Zoom ~280, danach wächst er quadratisch mit log₁₀(zoom) weiter. Gilt einheitlich an allen drei Stellen (CPU-Render, Referenz-Orbit, GPU-Render); manuelle Werte bleiben unangetastet.
- Cache: `fraktal.js?v=1.16` (Safari-Cache-Lehre — Query bumpen, wenn sich fraktal.js ändert).

**Version 4.7.3**
- Kosmetik: Panel-Modusanzeige „GPU f64" heißt jetzt nur mehr „GPU" (das f64-Detail gehört in Changelogs, nicht ins HUD).

**Version 4.7.2**
- Fix: Panel-Versions-Tag wurde bei jedem UI-Update von `updateUI()` mit hardcodierter '4.5' überschrieben (Überbleibsel vom v4.5-Hotfix) — `index.html`-Bumps waren dadurch unsichtbar. Jetzt: `APP_VERSION` in `fraktal.js` als Single Source of Truth, Panel liest nur mehr die. Release-Checkliste erweitert.

**Version 4.7.1**
- Fix: GPU-Zoom ruckelte/pixelt seit v4.7 — der v4.6-Beschleunigungs-Lerp sprang 19 % pro Frame auch bei kleinsten Gesten (Spielfluss!). Jetzt Bremsprofil: kleine Gesten gleiten exakt wie originally, große Deep-Zoom-Sprünge beschleunigen den Renderstart trotzdem 4-18×.
- Klarstellung: shaders.js (GPU) war und ist unverändert — das Ruckeln kam vom Kamera-Lerp, nicht von der GPU-Mathe.

**Version 4.7**
- Neu: CPU-Renderer nutzt bis Zoom 1 Billionen direkte f64-Berechnung (wie Mandelbrot z³/Newton — Peters Vorschlag!) und erst darunter Perturbation. Bis 1e12 exakt & artefaktfrei.
- Fix: Formel-Leiste auf dem iPhone war im Weg (CSS-Kaskaden-Bug: Mobile-Regel stand vor der Basis-Regel und verlor).
- Fix: Worker-Cache-Busting — Safari hatte alte Worker-Versionen wochenlang gecacht (deshalb zeigte Peters iPhone noch v4.5 mit alten Artefakten).
- Fix: Iterations-Buttons (+/−) reagieren im CPU-Modus wieder — vor dem Fix hat der adaptive Iterations-Floor jeden manuellen Wert sofort zurückgesetzt und kein Re-Render wurde getriggert. Manuelle Werte bleiben jetzt stabil, Bookmark-Klick kehrt zur adaptiven Iterationswahl zurück.
- Fix: CPU-Modus war bei Deep-Zooms zu weich/verwaschen — die Perturbations-Mathe wertete Flucht/Rebase am falschen Orbit-Index aus (globaler Iterationszähler statt Orbit-Position pro Pixel). Jetzt: Fluchttest am vollen z, Zhuoran-Rebasing mit Orbit-Neustart. Beweis: Pixel-Test gegen direkte f64-Wahrheit (max. Abweichung 0,56 Iterationen).
- Speed: Rendern startet deutlich früher nach dem Zoomen — zweistufige Annäherung (Zeitkappung: jede Geste schafft den Renderstart in ~1 s, kleine Zuschritte gleiten weich weiter).
- Speed: Render-Startschwelle früher (Rest-Bewegung < 2 % statt < 0,5 %).

**Version 4.5**
- Fix: CPU-Modus zeigt jetzt KEINE Farbartefakte mehr beim Zoomen und Scrollen (Kacheln werden korrekt ins sichtbare Bild gemalt, alte Render-Reste werden vor jedem Durchgang geräumt).
- Fix: Flächige Orange/Weiße Bilder beim Verschieben im Deep-Zoom behoben (weicher Bildpuffer bleibt beim Verschieben liegen, GPU-Precision-Müll blitzt nicht mehr durch).
- Neu: Zhuoran-Rebasing in der Perturbations-Mathe — beseitigt Präzisions-Knicke bei sehr tiefen Zooms und macht kurze Referenz-Orbits harmlos.
- Neu: Laufzeit-Iterationen passen sich jetzt schon im GPU-Bereich der Zoom-Tiefe an (keine „flachen" Regionen mehr bei mittleren Zoomstufen).
- Fix: Farbsprünge zwischen rendern Kacheln (Farbzyklus wird pro Rendervorgang eingefroren).
- Fix: Sanfte Farbverläufe in allen Fraktal-Modi (kein Banding mehr in Burning Ship / Tricorn / z³).

**Version 4.4**
- Fix: CPU-Rendering-Verschiebung (kein verschobenes Bild mehr beim Zoomen).
- Fix: Präzisionsprobleme bei sehr tiefem Zoom.
- Fix: Interaktion friert beim Rendern nicht mehr ein.

---
*Entwickelt mit ❤️ für kleine und große Entdecker.*
