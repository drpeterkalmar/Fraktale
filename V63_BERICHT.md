# Fraktal-Explorer 6.3 – Bericht „3D-Start ohne Hänger“

Datum 05.10.2026. Auftrag: Peters Wunsch vom 04.10. (22:40): „Der Start vom 3D-Modus hängt Chrome am rog für
30 Sekunden auf – vielleicht geht das ressourcenschonender am Start?“ (rog = Windows 11, Chrome, RTX 3070 Ti → WebGL
läuft dort über ANGLE/Direct3D 11 mit dem FXC-Shader-Compiler). Vorgaben: Look nicht ändern, 2D nach 3D an/aus
pixelgleich, Wahrheitstests unverändert.

**Bitte am rog in Chrome testen: ⛰ antippen.** Erwartung: Der Tab friert nicht mehr ein. Der ⛰-Knopf bekommt einen
dezenten Ring („3D wird vorbereitet …“), das 2D-Bild bleibt verschiebbar und zoombar, danach richtet sich die
Landschaft auf. Wenn die Vorbereitung dort noch spürbar lange dauert, bitte die Messung unten laufen lassen.
(PWA: App einmal ganz schließen und neu öffnen bzw. Seite neu laden, unter „Mehr“ steht dann 6.3.0.)

## 1. Kurzfassung

- **Ursache (im Code bestätigt, am Mac nachgemessen):** Beim Antippen von ⛰ wurden alle sieben 3D-Programme übersetzt,
  darunter drei Gelände-Varianten (Standard/Weiß/Alpin), obwohl nur eine gebraucht wird. Das erste 3D-Bild fragte dann
  `LINK_STATUS` ab, und diese Abfrage **wartet**, bis der Treiber fertig ist. Bis dahin stand der ganze Tab. Der
  Gelände-Shader war zudem sehr groß: Jede der 6 Ebenen stand als eigene Kopie im Code, in `colorAt` sogar 6 × 6, und
  jede Aufrufstelle wurde komplett eingebettet. Genau solche entrollten Kopien braucht FXC unter Windows sekunden- bis
  minutenlang (bekanntes Shadertoy-Problem).
- **Jetzt wartet die App nie mehr auf den Treiber.** Der Übersetzungsstand wird einmal pro Bild abgefragt
  (`COMPLETION_STATUS_KHR`, blockiert nicht). Ohne diese Erweiterung wird in Häppchen über mehrere Bilder übersetzt.
  3D blendet erst ein, wenn alles fertig ist; bis dahin bleibt 2D bedienbar.
- **Nur die gebrauchte Gelände-Variante** wird übersetzt. Ein Look-Wechsel in 3D (z. B. Alpin) übersetzt im
  Hintergrund, der alte Look bleibt solange stehen.
- **Gelände-Shader kleiner, gleiches Bild, schneller:** Ebenen als echte Schleifen, Höhenabfragen gebündelt. Im
  Pixelvergleich gegen 6.2.0 auf identischen Daten (112 Fälle) weichen ≥ 99,995 % der Pixel höchstens 1/255 ab. Ein
  3D-Bild braucht auf dem M1 jetzt 15 % weniger Zeit (Standard), mit Alpin-Look 35 % weniger.
- **Messung (M1, Shader jeweils frisch übersetzt):** 6.2.0 friert beim Antippen **1,35 s** ein (Alpin 1,4 s), 6.3.0
  hat **0 Long Tasks**. Mit einem simulierten langsamen Treiber (jedes Programm 8 s bzw. 30 s Übersetzung, wie FXC am rog)
  stand 6.2.0 die ganzen 8 s still. 6.3.0 läuft dabei mit **60 fps** weiter, und 3D erscheint, sobald der Treiber fertig
  ist.

## 2. Umsetzung

### 2.1 Nie blockieren (`js/renderer.js`, `js/app.js`)
- `R.programReady(key, fs, vs)` startet die Übersetzung bei Bedarf und fragt danach nur noch
  `COMPLETION_STATUS_KHR` (wartet nie). Erst wenn diese Abfrage „fertig“ meldet, wird `LINK_STATUS` gelesen, und das
  kostet dann nichts mehr.
- Ohne `KHR_parallel_shader_compile` (manche Treiber): Vertex-Shader, Fragment-Shader und Link laufen je in einem
  eigenen Bild, höchstens ein Programm pro Bild. Kein einzelnes Bild trägt die ganze Übersetzung.
- `set3d(true)` schaltet nur ein, wenn `T3.ready(look)` (alle Programme des Looks übersetzt) und `T3.warm(look)`
  (angewärmt, siehe 2.4) erfüllt sind. Sonst merkt sich die App den Wunsch (`V3.prep`) und prüft ihn in jedem Bild
  erneut. Die Rechnung bleibt bis dahin 2D. ✈ während der Vorbereitung startet den Flug, sobald 3D bereit ist.
- Oberfläche: Der ⛰-Knopf zeigt einen sich drehenden Ring mit Füllstand, Titel und `aria-label` lauten „3D wird
  vorbereitet …“. Dauert die Vorbereitung länger als 0,4 s, erscheint dieselbe Meldung kurz als Toast. Nochmal tippen
  bricht ab (DE/EN, die übrigen Sprachen fallen auf EN zurück).

### 2.2 Nur übersetzen, was gebraucht wird (`js/three.js`)
- `needs(look)` = Höhen-Aufbau, Himmel, **eine** Gelände-Variante, Kopieren, Sonde, bei Weiß/Alpin dazu das Rauschen.
  Das sind 5–6 statt 7–8 Programme, und es wird nur eines der großen Gelände-Programme übersetzt statt drei.
- Look-Wechsel in 3D: `terrainProgram()` zeichnet mit der bisherigen Variante weiter (`T3.waiting`, die App zeichnet
  weiter), bis die neue übersetzt und angewärmt ist. Test: Wechsel auf Alpin bei 2,5 s simulierter Übersetzung. Erst
  bleibt der Standard-Look stehen, dann erscheint Alpin; längste Bildlücke 34 ms, keine Long Tasks.

### 2.3 Shader kleiner, Look gleich
- **Ebenen-Schleifen** `for (i < u_n3)` mit einem Uniform als Obergrenze; das verhindert, dass der Compiler entrollt
  (derselbe Kniff wie das `min(0, iFrame)` auf Shadertoy gegen lange Windows-Übersetzungen). GLSL ES 3.0 erlaubt bei
  Sampler-Arrays nur konstante Indizes, darum wird die Ebene per `switch` gewählt. Die Rechnung selbst steht jetzt einmal
  im Code statt sechsmal.
- `colorAt`: Die verschachtelte `below`-Kette (6 × 6) ist jetzt der Index der letzten deckenden Ebene.
- **Aufrufstellen gebündelt:** Der Vertex-Shader hatte 7 eingebettete Höhen-/Ufer-Abfragen plus 6 entrollte
  Schattenschritte (78 eingebettete Ebenen-Abfragen). Jetzt sind es 3 Schleifen mit je einer Aufrufstelle. Der
  Fragment-Shader hatte 3 Höhenabfragen und 6 Farbebenen, dazu eine Messhilfe, die `colorAt` zweimal zusätzlich
  einbettete. Jetzt sind es je eine Aufrufstelle; die Messhilfe zählt den See-Anteil mit.
- **Pixelvergleich** (`tests/compare_3d_shader.py`): In derselben Seite zeichnet eine zweite 3D-Instanz mit dem
  `three.js` von 6.2.0 auf exakt denselben Daten. Abgedeckt sind 4 Ansichten (Gesamtbild, Seepferdchen 300×,
  Randpunkt 10⁹, Julia), 6 Looks (Standard, ohne „Menge glatt“, Weiß, Dunkel, Alpin Wald/See), 45° und 60° Neigung,
  hoch und quer sowie der 8-Bit-Ersatzpfad. Ergebnis: **112/112 Fälle, ≥ 99,995 % der Pixel weichen höchstens 1/255
  ab**, einzelne Pixel bis 21–213 (Rundung an Kanten). Gegenprobe neu gegen neu: 100 % identisch. Auch mit
  hochskaliertem Bewegungsbild (65 %): ≥ 99,998 %.
- **Bildzeit** (gleiche Szene, Wanduhr, Minimum, M1, 65 % Auflösung, Mittel über die Ansichten):

| 3D-Bild | 6.2.0 | 6.3.0 |
|---|---|---|
| Standard | 3,37 ms | **2,86 ms** (−15 %) |
| ohne „Menge glatt“ | 3,27 ms | **2,80 ms** |
| Weiß (Gletscher) | 3,65 ms | **3,04 ms** |
| Alpin Wald / See | 5,77 / 5,68 ms | **3,72 / 3,66 ms** (−35 %) |

  Die Größe des vom Treiber übersetzten Codes (Metal) sinkt dabei kaum: 90,4k → 85,6k Zeichen, Alpin 104,9k → 100,0k.
  Metal bettet Funktionen nicht ein. Entscheidend ist die Einbettung bei FXC (Direct3D), und genau die messen die
  Windows-Läufe unten (`translatedChars` = HLSL-Länge, `compileMs` = FXC-Zeit je Programm).

### 2.4 Anwärmen und Übergabe an den Canvas (am Mac gefunden)
- Auch nach „fertig übersetzt“ stand das erste 3D-Bild am Mac noch ~190 ms (GPU-Prozess; der Haupt-Thread war frei).
  Ursache: Der Treiber baut beim ersten Zeichnen die Pipeline. Darum zeichnet die App vor dem Einblenden jedes Programm
  einmal unsichtbar in ein winziges Ziel mit denselben Formaten, **je Bild nur eines** (`T3.warm`; A/B: `?nowarm`).
  Der teuerste Fall war der kleine Kopier-Shader auf den Canvas, für den Metal eine eigene Variante neu übersetzt.
  Deshalb geht das fertige Bild jetzt per `blitFramebuffer` auf den Canvas (ganz ohne Shader); Überblendungen entstehen
  vorher in einem eigenen Ziel. Ergebnis gleich (siehe Pixelvergleich), Pause 190 → ~130 ms.
- **Rest (nur Mac, nur einmal):** Ist der Metal-Shadercache leer, also nach einem App-Update mit geänderten Shadern
  oder beim allerersten Start, bleibt eine einzelne Anzeige-Pause von 125–140 ms. Der Haupt-Thread ist dabei frei
  (0 Long Tasks). Mit gefülltem Cache (jeder weitere Start) gibt es keine Pause über 30 ms, 3D steht nach ~100 ms.
  Das Ziel „kein Bild > 100 ms“ ist am Mac damit nur fast erreicht; dieser Rest liegt im Metal-Treiber und lässt sich
  von der Seite aus nicht weiter aufteilen.

## 3. Messung

Skript `tests/measure_3d_start.py` (Mac und Windows): Es startet selbst einen Webserver und einen Browser mit frischem
Profil, tippt ⛰ an und hängt sich versionsunabhängig in WebGL ein (funktioniert auch mit 6.2.0). Gemessen werden:
Zeit bis zum ersten 3D-Bild, Bildlücken (`requestAnimationFrame`), Long Tasks, Bildrate während der Vorbereitung,
Wartezeit in Statusabfragen, je Programm Übersetzungszeit und übersetzte Codegröße. Jeder nach dem Antippen übersetzte
Shader wird per Nonce einmalig gemacht (sonst misst man ab dem 2. Lauf nur Caches); `--cache` schaltet das ab.
`--slow=MS` simuliert einen langsamen Treiber. Rohdaten: `tests/results_3dstart_*.json`.

Mac mini M1, Chrome for Testing (ANGLE/Metal), Desktop-Ansicht 1280×800, Seepferdchen-Tal 300×, je 2–3 Läufe:

| | 6.2.0 | **6.3.0** |
|---|---|---|
| Längster Haupt-Thread-Block (Long Task) | 1 348–1 368 ms | **keiner** |
| Längste Bildlücke | 1 349–1 353 ms | **126–140 ms** (siehe 2.4) |
| Warten in Shader-Statusabfragen | 1 344 ms | **0,1 ms** |
| Tippen → erstes 3D-Bild | 398–406 ms | 397–398 ms |
| Bildrate während der Vorbereitung | – (eingefroren) | **63 fps** |
| Alpin-Look: Block / Lücke | 1 424–1 440 ms / 1 406–1 423 ms | **keiner / 141 ms** |
| mit Shadercache (2. Start): Lücke, Tippen → 3D | 29–33 ms, 37–43 ms | 25–28 ms, 98–100 ms |
| **simuliert 8 s Übersetzung je Programm** | **7 990 ms eingefroren** | 0 Long Tasks, Lücke 141 ms, **60 fps**, 3D nach 8,4 s |
| **simuliert 30 s** | (nicht gemessen; wie bei 8 s eingefroren) | 0 Long Tasks, Lücke 125 ms, **60 fps**, 3D nach 30,4 s |

Mit Shadercache braucht 6.3.0 bis zum 3D-Bild ~60 ms länger als 6.2.0. Das sind die 6–8 Anwärm-Bilder (je ein
Programm pro Bild); dafür gibt es keinen Ruckler.

- **SwiftShader** (`--angle=swiftshader`, wie im Auftrag als „langsamer Treiber“ vorgeschlagen) taugt hier nicht als
  Ersatz: Ihm fehlt `KHR_parallel_shader_compile`, er übersetzt erst beim Zeichnen, und jede Abfrage wartet auf die
  2D-Rechnung, die dort auf der CPU läuft (2–3 s je Abfrage, unabhängig vom Shader). Einmal gemessen: 6.2.0 6,3 s Long
  Task. Wegen der Last auf dem 8-GB-Mac habe ich die Messung danach nicht weiter verwendet; stattdessen
  simuliert `--slow` den langsamen Treiber gezielt.

**Messung am rog (Windows, Chrome, Direct3D 11)** – im Projektordner (Python 3.12, `py -m pip install playwright`):

```
py tests\measure_3d_start.py --tag=rog_v630 --runs=3
py tests\measure_3d_start.py --tag=rog_v630_live --url=https://drpeterkalmar.github.io/Fraktale/
:: Vergleich 6.2.0:  git worktree add ..\Fraktale_v620 933214a
py tests\measure_3d_start.py --tag=rog_v620 --root=..\Fraktale_v620 --runs=2
```
Das Skript nimmt das installierte Chrome (Standard-Backend, also Direct3D 11) und schreibt
`tests\results_3dstart_rog_*.json` plus eine Textzeile je Lauf. Spannend dort: `compileMs` des Programms `gelaende_0`
(FXC-Zeit) und `translatedChars` (HLSL-Länge) 6.2.0 gegen 6.3.0 sowie `maxFrameGapMs`/`longTasks` (Ziel: < 100 ms, 0).

## 4. Tests
- `tests/run_all.sh` komplett grün: Node-Kern, Release/PWA/offline (Cache `fraktale-6.3.0`), Wahrheit GPU + CPU
  (okPct/maxDiff unverändert), Gesten, UI, Funktionen, Bildaufbau, 3D (inkl. **2D nach 3D an/aus pixelgleich:
  1,0000 wie zweimal 2D**), Glättung 6.1, 6.2. Beim Zufallsflug-Wischtest in `test_v62` gab es einmal einen
  Timing-Ausreißer (+0,20 statt > 0,25 rad); der Wiederholungslauf ergab +0,80 rad, PASS.
- Neu **`tests/test_v63.py`** (in `run_all`), langsamer Treiber simuliert (2,5 s je Programm):
  „3D wird vorbereitet …“ sichtbar; 2D lässt sich währenddessen verschieben; 3D erscheint von selbst nach 2,5 s;
  längste Bildlücke 28 ms, keine Long Tasks; nur Gelände-Variante 0 übersetzt; Look-Wechsel auf Alpin ohne Block (erst
  alter Look, dann Alpin); zweites Antippen bricht ab; ✈ während der Vorbereitung startet danach den Flug; ohne
  `KHR_parallel_shader_compile` erscheint 3D nach 0,5 s; 3D an/aus 5× zuverlässig; 0 Fehler.
- Neu `tests/compare_3d_shader.py` (Pixelvergleich + Bildzeit gegen 6.2.0), `tests/measure_3d_start.py` (Messung).

## 5. Grenzen / offen
- **Am rog nicht gemessen** (Auftrag: den rog nicht selbst ansteuern). Wie lange FXC für den neuen Gelände-Shader
  braucht, zeigt erst die Messung dort. Hängen kann der Tab nicht mehr, im schlimmsten Fall dauert nur die Vorbereitung
  (mit Ring am Knopf) länger. Sollte sie dort noch viele Sekunden dauern, wäre der nächste Schritt der gestaffelte Start
  (Auftrag Punkt 4: erst eine schlanke Variante, die volle im Hintergrund).
- Leerlauf-Vorübersetzen (Punkt 5) bewusst nicht wieder aufgenommen: Mit nicht blockierendem Abfragen wäre es zwar
  möglich, aber die 6.0-Messung (2D-Rechnung wartet in der Treiber-Warteschlange) gilt weiter, und der Start ist auch so
  nicht mehr blockierend.
- Mac: einmalige Anzeige-Pause von ~130 ms nach Updates (siehe 2.4).
