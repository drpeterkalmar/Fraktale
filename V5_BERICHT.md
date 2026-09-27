# Fraktal-Explorer v5.0.0 – Bericht (Android-first Deep Zoom + neue UI)

Branch `v5-android`, Datum 27.09.2026. Kurzfassung: Rendering komplett neu (GPU-Perturbation + BLA, exakte CPU-Nachrechnung, Reprojektion), UI komplett neu (HUD, Dock, Bottom-Sheet, Gesten), PWA/offline. Alle Pflicht-Tests grün.

## 1. Was geändert wurde

**Rendering**
- *Vorher (v4.8):* GPU-df64 bis Zoom 10⁵, darüber CPU-Worker mit 128-px-Kacheln; Referenzorbit mit decimal.js **auf dem Main-Thread** (Blockaden bis 236 ms), Kachel-Aufbau sichtbar.
- *Jetzt:* Referenzorbit per **BigInt-Festkomma im Worker** (`js/orbit-worker.js`, `js/fractal-core.js`), Referenzwahl Bildmitte → **Minibrot-Kern** (Kugel-Periode + Newton, Orbit wird periodisch gewickelt) → Gitter-Probe. Julia nutzt zusätzlich den kritischen Orbit als Rebase-Ziel.
- **GPU-Perturbation** (WebGL2, f32-Deltas, Orbit als RG32F-Textur, eigener Orbit-Index pro Pixel, Zhuoran-Rebase, BLA mit aufsteigender Stufensuche + Backoff) für Mandelbrot, Julia, z³, Tricorn, Burning Ship bis 10³⁰; darüber derselbe Algorithmus in f64 auf der CPU bis 10²⁹⁰.
- **Wichtiger Befund:** f32-Deltas allein sind in dichten/„langsamen" Randzonen (Seepferdchental, fast-parabolisch) **nicht** exakt genug – 83–93 % statt ≥ 99 % (per bitgenauer f32-Emulation in Node bewiesen, kein GPU-Bug). Lösung: Der finale GPU-Pass führt pro Pixel die Ableitung mit und schätzt den Rundungsfehler (RMS, Faktor 4) → vorhergesagter Iterationsfehler. Pixel mit Δμ > 1 werden markiert, per Bit-Pack-Pass asynchron gelesen und vom CPU-Pool in **f64 exakt nachgerechnet** (typ. 1–25 % der Pixel), Übernahme per Crossfade. Trefferquote des Fehlermodells in der Emulation: 100 % (kein falscher Pixel unerkannt).
- Iterationspuffer (R32UI) + separater Farb-Pass: **Reprojektion** des letzten Bildes bei Gesten, Vorschau (1/2…1/12 Auflösung, Vsync-geregelt) → Verfeinerung → Crossfade. Kein Kachel-Aufbau, nach Fertigstellung pixelgleich (Test).
- Rechenhäppchen Fence-getaktet (kein gl.finish, kein Watchdog-Risiko): bei Gesten Frame-Zeit-Regler (≤ 1,3 × Vsync), im Stillstand 2 Häppchen in der Warteschlange (doppelter Durchsatz).
- Direkt (f32) bis Zoom 1000, danach Perturbation – gleiche Glättungsformel, Übergang geprüft (Zoom 999/1001: je 100 %).

**UI (Android-first):** HUD-Pille (Tiefe als 1,23 × 10⁹), Dock in der Daumenzone, Bottom-Sheet (Querformat: Seitenpanel), Glas-Design, alle Touch-Ziele ≥ 48 px (gemessen), `100dvh`, Safe-Areas, `touch-action: none` auf dem Bild (kein Browser-Doppeltipp-Zoom), keine History-Einträge (Back-Geste frei). Gesten: Pan mit Trägheit, Pinch um den Fingermittelpunkt, Doppeltipp ×3, Zwei-Finger-Tipp ÷3, Langdruck → Julia, Tippen → Oberfläche aus/an. Welten als Karten mit Vorschaubild, Julia-c-Pad (live), 10 Paletten als echte Verlaufs-Swatches + Custom (6 Farbwähler, gespeichert), Farbdichte, Farbanimation, 3D-Relief, Orte-Karten + eigene Orte + **Auto-Zoom-Tour**, Teilen (Web Share/Download, Deeplink), Vollbild, Installieren.

**PWA:** `manifest.webmanifest`, `sw.js` (Cache `fraktale-5.0.0`, alle URLs `?v=5.0.0`, HTML network-first mit `no-cache`), Worker-URLs automatisch aus `APP_VERSION`. Keine externen Abhängigkeiten mehr (decimal.js/Google Fonts entfernt).

**Aufgeräumt:** `*_recovered.js`, `alpha_diff.patch`, v4-`fraktal.js/fractal-worker.js/shaders.js`, alte `test_*.py`, `shots_*/`. Neue Tests unter `tests/`, Werkzeuge unter `tools/`.

## 2. Messwerte vorher/nachher

Methode: `tests/bench_compare.py` – derselbe Headless-Chromium mit echter GPU (ANGLE/Metal, Apple M1), Pixel-7-Viewport (412×915, DPR 2,625; v5 mit DPR-Cap 2 → 824×1678). v4 = Stand `main` (auf :8473 serviert), Zeit bis letzte Kachel; v5 = Zeit bis **exaktes** Endbild (inkl. CPU-Korrektur). `hardwareConcurrency` auf 4 gesetzt (handyähnlich; mit 8 Kernen siehe `tests/results_bench.json`).

| Ansicht | v4.8 fertig | v5 erstes Bild | v5 GPU-Vollbild | v5 exakt fertig | Long Tasks v4 → v5 |
|---|---|---|---|---|---|
| Seepferdchen 10⁷ | 4,79 s | 0,09 s | 0,64 s | **1,46 s** | 63 ms → 0 |
| Seepferdchen 10⁹ | 3,02 s | 0,08 s | 0,49 s | **1,28 s** | 106 ms → 0 |
| Seepferdchen 10¹⁴ | 17,74 s | 0,10 s | 0,98 s | **4,65 s** | 236 ms → 0 |
| Peters Spirale 1,7·10⁷ | 0,68 s | 0,04 s | 0,27 s | **0,60 s** | 0 → 0 |

GPU-Budget pro Frame (Timer-Query, M1): Display-Pass 1,5 ms; Vorschau 124×252 bei 10⁹: ~15 ms (wird in Häppchen verteilt). Hinweis: rAF-FPS sind headless unbrauchbar – selbst eine leere `gl.clear`-Seite erreicht dort nur 16–19 fps; aussagekräftig sind GPU-Zeiten und Long Tasks.

## 3. Testergebnisse

Alle über `tests/run_all.sh` (lokal :8472), 0 Page-/Console-Fehler in allen Läufen.

**Korrektheit** (`tests/test_truth.py`, 400 Stichproben/View, Wahrheit = Python-Decimal-Direktiteration `tests/truth.py`; Kriterium |Δμ| ≤ 1 bei ≥ 99 %; „kond." = ohne Pixel, deren Wahrheit sich schon bei 10⁻⁶ Pixel Verschiebung ändert):

| View | GPU strikt | GPU kond. | CPU f64 strikt |
|---|---|---|---|
| Seepferdchen 10⁷ | 100 % | 100 % | 100 % |
| Randpunkt 10⁹ | 99,5 % | 100 % | 99,5 % |
| Peters Spirale 1,7·10⁷ | 100 % | 100 % | 100 % |
| Seepferdchen 10¹⁴ | 99,5 % | 100 % | 99,5 % |
| Randpunkt 10¹⁵ | 99,75 % | 100 % | 99,75 % |
| Julia 10¹⁰ | 99,75 % | 100 % | 99,75 % |
| Tricorn 10⁶ / Burning Ship 10⁶ / z³ 10⁵ | 99,5 / 100 / 100 % | 100 % | gleich |
| Übergang Zoom 999 (direkt) / 1001 (Perturbation) | 100 / 100 % | 100 % | 100 % |
| Randpunkt 10⁴¹ (nur CPU) | – | – | 99,75 % (kond. 100 %) |
| *Extrem-Views* 10²⁹, z³ 10⁶/10⁷/10⁸ | 96,5–98,75 % | **100 %** | **identisch** |

Extrem-Views = Zoom-Walk direkt auf den Mengenrand (8–15 % schlecht konditionierte Pixel); dort erreicht auch die exakte f64-Rechnung strikt nur denselben Wert – Eigenschaft der Ansicht, nicht des Renderers. SwiftShader (striktes IEEE-f32) bestätigt: 99,33 / 100 / 100 / 100 %. Node-Kerntest (`tests/node_core_test.js`) grün.

**Weitere Tests:** `test_gestures.py` (Pinch ×4.0, Doppeltipp ×3.0, Zwei-Finger ÷3, 0 Long Tasks, Bild nach Fertig 3 s lang pixelgleich), `test_ui.py` (alle Tabs/Modi, Touch-Ziele ≥ 48 px, DE/EN), `test_features.py` (Deeplink, Tour endet exakt bei 10⁹, eigene Orte, PNG-Export, keine History-Einträge), `test_release.py` (Versionen konsistent, 37 Precache-Dateien, Offline-Neustart rendert). Screenshots: `tests/shots/` (Hoch- und Querformat).

## 4. Offene Punkte / Grenzen

- **Nicht auf echtem Android getestet** (nur Emulation + M1-GPU + SwiftShader). Mittelklasse-GPUs sind ~5–10× langsamer als M1: Vorschau sofort, exaktes Bild bei 10⁹ geschätzt einige Sekunden, bei 10¹⁴ ~15–30 s (die CPU-Korrektur dominiert). Frame-Zeit-Regler und Vsync-Schätzung sind headless nicht verifizierbar.
- Beim Start wird nur geprüft, ob die Shader kompilieren – kein numerischer GPU-Selbsttest gegen die CPU (Treiberfehler auf exotischen GPUs fielen nur über Rechenweg „CPU" auf).
- GPU-Grenze 10³⁰ (f32-Exponent); darüber übernimmt die CPU (langsamer). floatexp/skalierte Deltas auf der GPU nicht umgesetzt.
- Kein Inneres-Früherkennen (Periodizitätscheck) – bewusst, weil es in parabolischen Zonen fliehende Pixel falsch als „innen" markieren kann; kostet bei Ansichten mit viel Innerem Zeit.
- BLA nur für holomorphe Formeln (Mandelbrot/Julia/z³); Tricorn/Burning Ship perturbieren ohne Sprünge.
- Neue UI-Texte nur DE/EN; die übrigen 7 Sprachen behalten ihre Hilfetexte, neue Beschriftungen fallen auf Englisch zurück.
- Die tiefen Sehenswürdigkeiten 10⁹/10²⁹ sind sehr dicht (Rauschen); ggf. schönere Koordinaten auswählen.

## 5. Bitte am Android-Handy prüfen

1. **Cache leeren:** alte App/Seite schließen; falls v4 als Verknüpfung installiert war: entfernen. Chrome → Einstellungen → Website-Einstellungen → drpeterkalmar.github.io → Daten löschen (oder einmal „Neu laden" lang drücken). Unter „Mehr" muss **5.0.0** stehen – sonst ist es noch der alte Cache.
2. Oben rechts im HUD antippen: „Modus" soll **GPU Perturbation +BLA** zeigen (ab Zoom 1000), FPS während Gesten.
3. Pinch/Pan in 10⁷…10⁹ (Orte → „Seepferdchen-Tiefe", „Peters Spirale"): bleibt es flüssig? Wie lange bis der Fortschrittsbalken unter der HUD-Pille verschwindet?
4. **▶ Tour** bei „Filigran 10¹⁵" und „Tiefsee 10²⁹"; „Jenseits der GPU 10⁴¹" (CPU, dauert länger).
5. Doppeltipp, Zwei-Finger-Tipp, Langdruck (→ Julia), einmal Tippen (Oberfläche weg).
6. „Mehr → Exakte Nachrechnung" aus/an: Unterschied in Tempo (aus = schneller, minimal verrauscht).
7. „App installieren" (Mehr) bzw. Chrome-Menü → „Zum Startbildschirm", danach Flugmodus: startet offline?
8. Falls etwas ruckelt: Auflösung „Akku" testen und mir HUD-Werte (Renderzeit, FPS) + GPU-Name (Mehr → Rechenweg-Zeile) schicken.
