# 🌀 Fraktal Explorer 🚀 

Willkommen in der unendlichen Welt der Mathematik! Mit diesem Tool kannst du das berühmte **Mandelbrot-Männchen** erforschen und so weit hineinzoomen, wie du willst – es tauchen immer wieder neue, wunderschöne Muster auf!

![Vorschau](https://raw.githubusercontent.com/drpeterkalmar/Fraktale/main/preview.png) *(Hinweis: Mache einen Screenshot im Tool mit 'S' und lade ihn hier hoch!)*

## ✨ Was ist das hier eigentlich?

Ein Fraktal ist ein mathematisches Wunderwerk. Stell dir ein Bild vor, in das du immer weiter hineinzoomen kannst, und es tauchen immer wieder neue Muster auf, die dem Ganzen ähneln. Es ist wie eine Reise in ein unendliches Universum!

### Die Zauberformel: z = z² + c

Keine Angst vor Mathe! Die Formel funktioniert wie ein Spiel:

1. Du nimmst eine Zahl.
2. Du nimmst sie mit sich selbst mal.
3. Du zählst eine feste Zahl dazu.
4. Das Ergebnis nimmst du als neue Zahl und fängst von vorne an!

- **Gefangen (Schwarz):** Die Zahl bleibt klein und "kreist" immer weiter herum.
- **Flucht (Bunt):** Die Zahl wird riesig und schießt wie eine Rakete ins Unendliche ab! Die Farben zeigen uns, wie schnell sie "geflüchtet" ist.

## 🎮 Steuerung – So wirst du zum Forscher

- **Scrollen:** Rein- und Rauszoomen (unendlich tief!).
- **Klicken & Ziehen:** Bewege dich durch die Fraktal-Welt.
- **Doppelklick:** Zentrieren und schneller hineinzoomen.
- **Taste `S`:** Mache ein cooles Foto von deiner Entdeckung.
- **Taste `P`:** Wechsle die Farben (Paletten).
- **Taste `M` / `J`:** Wechsle den Modus (Mandelbrot, Julia-Menge oder **Burning Ship**).
- **Taste `Z` / Lupe:** Aktiviere den Zoom-Modus, um ein Rechteck zu ziehen.
- **Shift + Ziehen:** Ziehe einen Rahmen auf, um genau diesen Bereich zu vergrößern.
- **Shift + Klick:** Erschaffe eine Julia-Welt genau an dieser Stelle.

## 🌌 Andere Welten entdecken
- **Burning Ship:** Sieht aus wie ein brennendes Schiff am Horizont. Wir nehmen die normale Formel, aber machen alles "positiv" (Absolutwert) vor dem Rechnen.
- **Buddhabrot:** Ein Fraktal, das wie ein meditierender Buddha aussieht. Es zeigt die Wege, die Punkte nehmen, wenn sie ins Unendliche abhauen.
- **Mandelbulb:** Die 3D-Version des Mandelbrot-Männchens – wie alienartige Kathedralen!
- **Newton-Fraktale:** Entstehen durch das Suchen von Nullstellen in Gleichungen. Jeder Startwert landet bei einer anderen "Antwort" und bekommt eine eigene Farbe.

## 🛠️ Installation & Start

Du brauchst nichts zu installieren!

1. Lade dir diesen Ordner herunter.
2. Doppelklicke auf `start_fractal.bat`.
3. Dein Browser öffnet sich und die Reise beginnt!

## 📜 Änderungen

**Version 4.6**
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
