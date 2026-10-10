# Fraktal-Explorer 6.8.0 – Rückwärts fliegen + Vollbild nur mit Bild

Auftrag `fraktale-v6-8` (Wunsch von Peter, 09.10.2026: „Rückwärts fliegen bitte.“ und „Das HUD im Vollbildmodus komplett
ausblenden.“). Stand 10.10.2026, live unter https://drpeterkalmar.github.io/Fraktale/ (Version 6.8.0 geprüft).
Zwischenstände: 6.7.1 (Rückwärtsflug), 6.7.2 (HUD), beide live geprüft.

## Kurz für Peter

- **Rückwärts:** Der Tempo-Regler in der Flug-Leiste geht jetzt von ganz links (rückwärts ⏪) über die Mitte (Schweben ⏸,
  rastet ein) nach rechts (vorwärts ⏩). Daneben **⇄**: ein Tipp, und der Flug kehrt weich um (0,6 s, kein Ruck).
- Rückwärts nimmt der Flug **denselben Weg wie hinein** – in 2D zoomt das Bild auf der Strecke des Hinflugs heraus, in 3D
  fliegt die Kamera rückwärts über die Landschaft und schaut dabei nach vorn (wie ein rückwärts abgespieltes Video).
  **↶ Umdrehen** (nur 3D) dreht den Blick um 180°, dann sieht man, wohin es geht.
- In der Übersicht (Zoom 1) hält der Flug weich an: „Ganz draußen“. ⇄ fliegt wieder hinein.
- Tastatur im Flug: `R` = Richtung wechseln, `↑/↓` = Tempo, `U` = Umdrehen. Außerhalb des Flugs bleibt `R` = Zurücksetzen.
- **Vollbild:** Im Vollbild ist jetzt wirklich nur das Bild zu sehen. Kurz tippen (oder Maus bewegen) zeigt die Bedienung
  für 3 s, dann verschwindet sie wieder. Zoomen, Schieben und Lenken holen sie nicht zurück, ein Flug läuft weiter.
- **iPhone:** Dort gibt es kein Vollbild für Webseiten. Der Knopf oben rechts heißt dort **Kino-Modus** und macht dasselbe
  (Bedienung weg, nur Bild) – auch in der installierten App. Raus: kurz tippen, Knopf antippen.
- Abschaltbar: Mehr → „HUD im Vollbild ausblenden“. Ohne Rückwärts wie bis 6.7: Link mit `?rueck=0`.
- Bilder: `tests/shots/v68/` (Collagen `collage_vollbild_hoch.jpg`, `collage_vollbild_quer.jpg`, Leiste `leiste_3d_flug.jpg`).

## Umsetzung

### Rückwärtsflug (`js/flight.js`)

- **Tempo mit Vorzeichen:** `S.flySpeed` −1,5 … +1,5 Zehnerpotenzen/s (gespeichert wie bisher). `FLY.sp` ist das
  tatsächliche Tempo: Es folgt dem Regler mit τ = 0,18 s; ⇄ (`reverseFly`) fährt es in 0,6 s auf einer S-Kurve (smoothstep)
  über 0 auf den Gegenwert. Damit ändern sich Zoom- und Seitentempo stetig. Regler/Pfeiltasten gehen über `setFlySpeed`
  (Einrasten bei |v| < 0,08). Steht der Regler beim Start auf 0 oder rückwärts in der Übersicht, startet der Flug vorwärts.
- **Schweben ohne Ruck:** Bis 6.7 glitt die 2D-Bildmitte unabhängig vom Tempo zum Zoompunkt, und der 3D-Kurs drehte weiter.
  Beides läuft jetzt mit dem Tempo bis 0,1 gegen 0 (0,1 war bis 6.7 der kleinste Reglerwert – im alten Bereich unverändert).
  Sonst hätte das Seitentempo beim Richtungswechsel einen Sprung gehabt.
- **Kursverlauf:** Im Vorwärtsflug (Zufallsflug) wird je 1/100 Zehnerpotenz die Bildmitte (BigInt) und der Kurs gemerkt
  (`FLY.trail`). Einträge oberhalb des aktuellen Zooms fallen beim Vorwärtsflug weg (nach einem Rückflug geht es anders
  weiter). Startet ein Flug genau dort, wo der letzte endete, gilt der Verlauf weiter.
- **Rückflug-Schritt `revStep`** (rein rechnerisch wie `flyStep`, also auch für die Vorhersage des Planers):
  - Zoom nimmt ab; in den letzten 0,6 Zehnerpotenzen vor Zoom 1 ist das Tempo ∝ √Abstand (konstante Verzögerung), Ende exakt
    bei Zoom 1 → „Ganz draußen“ (Hinweis einmal, der Flug bleibt an).
  - Mit Verlauf: Die Kamera folgt der Bewegung des Verlaufs (Vorsteuerung, auf 2 Bildhälften/s gedeckelt – ein Sprung im
    Verlauf, z. B. nach Schieben im Hinflug, wird zu weichem Gleiten), die Abweichung klingt mit τ = 0,3 s ab. In 3D folgt der
    Kurs ebenso. Gleiche Mitte und gleicher Kurs bei gleichem Zoom = dieselben Bilder wie im Hinflug.
  - Ohne Verlauf (tief gestartet, im Rückflug geschoben oder gelenkt): 2D zentriert heraus, 3D Zoom um den Zoompunkt vor dem
    Fokus heraus (die Kamera gleitet rückwärts, der Kurs folgt dem Zoompunkt, Wischen lenkt); in den letzten 1,5
    Zehnerpotenzen gleitet die Mitte zur Startübersicht.
  - Ziel-Flug (Orte): Die Lage ist dort eine Funktion des Zooms – rückwärts dieselbe Funktion, zurück bis zum Start-Zoom.
- **Zielwahl:** Rückwärts sucht der Flug keinen Rand – er nimmt den bekannten Weg; beim Herauszoomen bleibt der Rand ohnehin im
  Bild. Beim Wechsel zurück nach vorn beginnt die Randsuche frisch (Ziel neu, „verloren“ zurückgesetzt, 2D-Zoompunkt Mitte).
- **Umdrehen** (`turnFly`, nur 3D): Blick-Versatz `V3.turnA` 0 → π in 0,8 s (app.js `update3d`, `view3d`); Kurs und Flugweg
  bleiben. Beim Flugende wird der Versatz in den Kurs übernommen – die Ansicht schaut weiter dorthin, wohin sie schaute.
- **Gesten** wie 6.6: Tippen = Pause, ein Finger schiebt (2D) bzw. lenkt (3D), zwei Finger beenden den Flug.

### Planer in Gegenrichtung (`js/scheduler.js`)

Rückwärts kommt neues Bild am Rand (2D) bzw. hinter der Kamera (3D: der untere Bildrand liegt bis ~1,7 Bildhälften hinter dem
Fokus, die normale Vorschau deckt nur ±1,2) herein, die Mitte ist aus den tieferen Ebenen schon scharf. Darum ist im Rückflug
jede zweite Vorschau (3D: die nicht-fernen) eine Ebene für die Kamera, die als Nächstes kommt: 2D Zoom ÷ 1,6 um die Mitte,
3D Zoom ÷ 1,3 eine Bildhälfte hinter dem Fokus (die CPU-Kacheln laufen von der Mitte aus – das Gelände hinter der Kamera
zuerst), in Vorschau-Auflösung. Diese Ebenen werden nicht wie andere veraltete Jobs verworfen, solange sie weiter sind als die
Ansicht (`job.rev`). Die Vorschau selbst wird ohnehin für die vorausgesagte Kamera gerechnet (`predictCam` → `revStep`).

**Erst-Fassung verworfen:** Eine sehr grobe Übersichtsebene (Zoom ÷ 2,5) bei jeder zweiten Vorschau machte das Bild nicht
besser (Schärfe 0,83 → 0,80, 3D unten 1,02 → 0,76 im Zufallsflug), weil die Ebenen des Hinflugs den Anfang des Rückflugs schon
decken. Jetzt wird die Zusatz-Ebene nur gerechnet, wenn die Zielkamera sonst Lücken oder ein grobes Viertel hätte
(`coverage(…).unc > 1 %` oder 25-%-Quantil der Schärfe < 0,6/Teiler). A/B: `?revpf=0`.

### HUD im Vollbild / Kino-Modus (`js/ui.js`, `style.css`, `js/app.js`)

- `body.hudless`: alle Kinder von `body` außer Canvas, Überblendungs-Canvas und Grafik-Fehlermeldung bekommen Deckkraft 0 und
  `pointer-events: none` (0,3 s). Das erfasst automatisch auch künftige Elemente. `body.hud-peek` zeigt sie wieder.
- Aktiv bei echtem Vollbild (`fullscreenchange`) mit Einstellung `S.hudFs` (Standard an) oder im Kino-Modus.
- **Tipp:** `gestures.js` meldet einen Tipp erst nach dem Doppeltipp-Fenster (kein Wischen, < 10 px, < 280 ms). app.js fragt
  zuerst `API.tapHook`: ausgeblendet → nur zeigen (der Flug wird nicht pausiert). Bei sichtbarem HUD verhält sich der Tipp wie
  bisher (im Flug Pause, sonst blendet er die Bedienung gleich wieder aus).
- **Maus:** `pointermove` ohne gedrückte Taste (> 4 px) zeigt; Ziehen mit der Maus ist eine Geste und zeigt nicht. Solange
  ein Menü offen ist oder sich die Maus über der Bedienung bewegt, bleibt sie sichtbar. Eine ruhende Maus zählt nur 3 s, sonst
  hielte die Maus nach dem Klick auf den Vollbild-Knopf alles fest – das fand der Test.
- Beim ersten Eintritt je Sitzung bleibt die Bedienung 2,2 s mit dem Hinweis „Kurz tippen zeigt die Bedienung“ stehen.
- **Kino-Modus:** ohne Vollbild-Schnittstelle (`document.fullscreenEnabled`/`requestFullscreen` fehlen: iPhone, auch als
  installierte App) sind `#btn-fullscreen` und der Kachel-Knopf unter „Mehr“ der Kino-Modus (bis 6.7 dort ausgeblendet, P3-7).
  `Esc`/`F` verlassen Vollbild bzw. Kino-Modus.

### Oberfläche und Texte

- Flug-Leiste: Regler −1,5 … +1,5 mit Markierung bei 0, Symbol ⏪/⏸/⏩, ⇄ (`#btn-rev`) im Flug, ↶ (`#btn-turn`) im 3D-Flug.
  Im 3D-Flug sind es jetzt fünf Elemente – dort zeigt Stopp nur das Symbol (Querformat: Leiste etwas breiter), damit alles
  ≥ 48 px bleibt (geprüft: hoch 412 px und quer, Ausrichten nicht mehr abgeschnitten).
- Neue Texte in allen 9 Sprachen (Richtung wechseln, Umdrehen, Ganz draußen, Kino-Modus, Einstellung, Hinweis, Hilfe-Zeile);
  Desktop-Tastenhilfe (de/en) um die Flug-Tasten ergänzt.

## Messung

`tests/measure_rueck.py`, Apple M1, Chromium mit echter GPU (Metal), headless, Profil Mittelklasse wie 6.7: Pixel 7, DPR 2,6,
CPU 4× gedrosselt, 4 Kerne. Je Lauf 12 s vorwärts, dann ⇄ (1 s übersprungen) und 12 s rückwärts, Tempo 0,5.
Rohdaten: `tests/results_rueck_v680_*.json`.

**Bildrate vorwärts → rückwärts** (Bilder/s, in Klammern Bildzeit 95 %):

| | 2D hoch | 2D quer | 3D hoch | 3D quer |
|---|---|---|---|---|
| Zufallsflug (Seepferdchen-Tal 300×) | 52,9 (33,3) → **56,3** (18,1) | 53,8 (33,3) → **56,1** (18,6) | 50,4 (49,7) → **50,4** (49,9) | 49,6 (48,2) → **49,9** (34,4) |
| fester Weg (Ziel-Flug zum Tal 10¹²) | 56,0 → **57,4** | 55,8 → **57,9** | 54,5 → **55,0** | 54,8 → **56,6** |

Der Rückflug ist nie langsamer als der Vorwärtsflug (Herauszoomen braucht weniger Iterationen).

**Nutzen der Rückflug-Ebenen** (fester Weg, damit beide Läufe dieselben Bilder sehen; mit → ohne `?revpf=0`):

| | hoch | quer |
|---|---|---|
| 2D-Rückflug: Ø Schärfe (Pufferpixel je Bildpixel) | **0,97** / 0,87 | **0,99** / 0,90 |
| 3D: Gelände hinter der Kamera (unterer Bildrand), Ø Schärfe | **1,61** / 0,69 | **1,28** / 1,26 |
| 3D: Lücken am unteren Bildrand | 0 / 0 | **0** / 0,9 % |
| 3D: Strecke in 12 s (Zoom) | 3·10⁶ → **150** / 3,5·10⁶ → 3100 | 5,4·10⁶ → **8** / 3,8·10⁶ → 88 |
| Bilder/s rückwärts | 57,4 / 59,1 (2D), 55,0 / 58,1 (3D) | 57,9 / 59,2 (2D), 56,6 / 59,0 (3D) |

Mit den Ebenen ist das Bild im Rückflug schärfer, und der 3D-Rückflug kommt weiter, weil die Tempo-Bremse seltener greift.
Er kostet 1–3 Bilder/s gegenüber „ganz ohne“, bleibt aber über dem Vorwärtsflug. Im Zufallsflug (`test_rueck`, Pixel 7 ohne
Drosselung) ebenso: unterer Bildrand 0 % Lücken, Schärfe 1,34 gegen 0,5 % und 1,04 ohne.

## Prüfung

- **Neu `tests/test_rueck.py`** (in `tests/run_all.sh`), alle 27 Prüfungen grün (`tests/results_rueck_v680.json`):
  - Regler −1,5 … 1,5, 0,03 rastet auf 0 (⏸), −0,8 ⏪, 0,6 ⏩; Taste R kehrt um, ↓ senkt das Tempo.
  - 2D: 12 s vorwärts (Zoom ~5·10⁵), dann ⇄: Zoom fällt **monoton** (0 Anstiege in ~750 Bildern), hält bei **Zoom 1,000000**,
    „Ganz draußen“, Flug bleibt an, **keine NaN**.
  - **Richtungswechsel ohne Ruck** (Kamera-Delta je Bild): größte Änderung des Zoomschritts 0,0008 log₁₀/Bild (ein harter
    Wechsel wären 0,0167), des Seitenschritts 0,0007 Bildhälften/Bild.
  - **Gleicher Weg:** Bildmitte im Rückflug bei gleichem Zoom im Median 0,0004, 95 % 0,0014 Bildhälften neben dem Hinflug.
  - Bildrate rückwärts 60 ≥ vorwärts 60; Rückflug-Ebenen gerechnet.
  - Ziel-Flug: rückwärts exakt zurück zum Start (Zoom 1, Mitte −0,5/0), danach vorwärts **exakt** gelandet (cx, cy, Zoom).
  - 3D: Zoom fällt monoton (z. B. 1,5·10⁸ → 2800 in 12 s), **Bodenabstand** rückwärts min. 0,93 Bildhälften = vorwärts (Minimum 0,2;
    Augenhöhe minus höchstes Gelände im Umkreis 0,25 um den Fußpunkt, aus der Sonde), Kurs folgt dem Hinflug (Median 0,0002
    rad), Gelände hinter der Kamera ohne Lücken, Bildrate rückwärts ≥ vorwärts; Umdrehen +180°, danach zeigt die Ansicht weiter
    dorthin.
  - `?rueck=0`: kein ⇄, Regler ab 0,1, Taste R kehrt nicht um. 0 Fehler.
- **Neu `tests/test_hud_fs.py`** (in `tests/run_all.sh`), alle 28 Prüfungen grün (`tests/results_hud_v680.json`):
  - Pixel 7 hoch und quer: im Vollbild alle 16 Bedienelemente mit wirksamer Deckkraft 0 (Produkt über die Vorfahren) und
    nicht klickbar (an jeder Knopfstelle liegt das Bild obenauf).
  - Wischen und Zwei-Finger-Zoom holen das HUD nicht zurück; kurzer Tipp zeigt es (Deckkraft 1), der laufende Flug läuft
    weiter und ist nicht pausiert; nach ≈ 3 s wieder aus; ein Tipp bei sichtbarem HUD pausiert wie bisher; F verlässt das Vollbild.
  - Einstellung aus: Vollbild mit Bedienung; Einstellung wird gespeichert.
  - Desktop: Mausbewegung zeigt, Ziehen nicht.
  - **iPhone 13 per WebKit** (Vollbild-Schnittstelle entfernt wie im iPhone-Safari): Knopf „Kino-Modus“, alles ausgeblendet
    ohne echtes Vollbild, Tipp zeigt, Knopf verlässt den Kino-Modus. 0 Fehler.
- **Sichtprüfung** der Aufnahmen (selbst angesehen): `vollbild_{hoch,quer}_ohne_hud.jpg` und `kino_iphone_ohne_hud.jpg`
  zeigen nur das Fraktal, keinerlei Bedienelement; die „mit HUD“-Bilder zeigen Pille, Knöpfe, Flug-Leiste und Dock vollständig.
  Dabei gefunden und behoben: Im 3D-Flug war der Ausrichten-Knopf rechts abgeschnitten (Leiste zu voll).
- **Angepasst:** `test_p3` erwartete ohne Vollbild-Schnittstelle ausgeblendete Knöpfe; jetzt Kino-Modus (Auftrag).
- **Übrige Suite grün** (headless, Metal): Unit-Tests, `node_core_test`, `test_release`, `tools/check_release.py`, `test_truth`
  (GPU und CPU), `test_gestures`, `test_ui`, `test_features`, `test_blend`, `test_3d`, `test_smooth`, `test_v62`, `test_v63`,
  `test_v64`, `test_fly64`, `test_fly2d`, `test_gpu_guard`, `test_context_loss`, `test_fix_ref`, `test_shader_fail`,
  `test_bla_stall`, `test_deeplink`, `test_p3`, `test_shader_async`, `test_memory3d`.
- Test-Browser starten jetzt immer stumm (`--mute-audio` in `tests/e2e_lib.py` und `tests/measure_3d_start.py`).

## Offen / Grenzen

- Bodenabstand: Die Kamera fliegt (wie seit 6.0) in fester Höhe in lokalen Einheiten über einem auf h3d·1,1 begrenzten
  Gelände – rückwärts ändert daran nichts; gemessen bleibt er konstant 0,93 Bildhälften. Eine echte Geländefolge gibt es nicht.
- Der Rückflug folgt dem Hinweg nur innerhalb eines Flugs (bzw. wenn der neue Flug genau dort startet, wo der alte endete).
  Nach Schieben/Lenken im Rückflug geht es zentriert hinaus.
- Fullscreen in iOS-Safari selbst und auf einem echten Mittelklasse-Handy nicht gemessen (WebKit-Emulation bzw. gedrosselter M1).
- Toasts liegen im Flug wie bisher über der Flug-Leiste (z. B. „Ganz draußen“ für 2,6 s).


---

# 6.8.1 – Flug im Vollbild + Screenshot in beliebig hoher Auflösung

Auftrag `fraktale-v6-8b` (Wunsch von Peter, 09.10.2026). Stand 10.10.2026, live unter https://drpeterkalmar.github.io/Fraktale/
(Version 6.8.1). Zwischenstände E1 (Flug im Vollbild), E2 (Screenshot), E3 (Messung) – je gepusht und live geprüft.

## Kurz für Peter

- **Flug im Vollbild:** Vollbild an und aus, die wegfallende Adressleiste, Drehen hoch/quer und der Kino-Modus am iPhone
  unterbrechen einen laufenden Flug nicht mehr – er fliegt mit Kurs und Tempo weiter, ohne Ruck.
- **Ohne Bedienung steuern:** Leertaste = Flug an/aus, `R` = Richtung, `↑/↓` = Tempo. Am Handy bei ausgeblendeter
  Bedienung: **Doppeltipp = Flug an/aus**, ein einfacher Tipp holt wie bisher die Bedienung.
- **Screenshot groß:** Mehr → „Screenshot-Auflösung“: Bildschirm, 2×, 4×, 8K oder eigene Größe (bis 1 Gigapixel). Darunter
  steht, wie groß, wie lange, wie viele MB. Teilen → Bild: kurze Rückfrage mit dieser Schätzung, dann „Rendere Kachel 12/64 …“
  mit Abbrechen. Das Bild wird in Stücken gerechnet und zusammengesetzt – ohne sichtbare Nähte. Die Beschriftung unten links
  lässt sich abschalten.
- Grenzen: Buddhabrot nur in Bildschirmgröße; große 3D-Bilder sind scharf im Licht, aber nicht detailreicher im Gelände.
- Bilder: `tests/shots/v681/` (Ausschnitte Mitte, Kachelkante, Beschriftung für 1×/4×/8K/16k je Modus).

## Flug im Vollbild (E1)

**Befund:** Ein Größenwechsel stoppte den Flug nicht (Flugzustand, Sonde und Ebenen überleben `resize()`: `invalidate()`
markiert nur neu, die Ebenen liegen in Welt-Koordinaten und tragen weiter, Puffer der neuen Größe kommen mit den nächsten
Vorschauen). Gestört haben zwei Dinge: Beim Umschalten lässt der Browser Bilder aus (macOS-Vollbild, Drehen: 80–100 ms) – der
zeitbasierte Flug machte dann einen Sprung; und die Tempo-Bremse sah nach dem Wechsel kurz unscharfe Ränder und bremste.

**Umsetzung (`js/app.js`, `js/scheduler.js`, `js/ui.js`):**
- `RC.resizeT` = Zeit der letzten Größenänderung; gesetzt in `resize()` und schon vorher bei Vollbild-Knopf/`F`, Kino-Modus,
  `fullscreenchange`, `orientationchange`, `screen.orientation` (die Aussetzer kommen vor dem `resize`-Ereignis).
- 0,6 s danach ist ein Flugschritt höchstens 1/30 s lang (lieber einen Augenblick langsamer als ein Kamerasprung); 1,5 s hält
  die Tempo-Bremse ihren Wert (die neuen Ränder sind bis dahin gerechnet).
- Leertaste = Flug an/aus (ein fokussierter Knopf, z. B. Vollbild, wird dabei nicht ausgelöst); Doppeltipp bei ausgeblendetem
  HUD = Flug an/aus (`API.dblTapHook`), sonst wie bisher hineinzoomen.

**Prüfung `tests/test_fs_fly.py`** (Pixel 7, sichtbares Fenster, `results_fs_fly_v681.json`): je 2D und 3D Flug starten →
Vollbild an + Adressleiste weg → 4 s → quer → 3 s → hoch → 3 s → Vollbild aus (F, HUD ist aus) → 2,5 s.
- Flug durchgehend an, nie pausiert (2D 876, 3D 854 Bilder); 6 Größenänderungen, in den 0,6 s danach **kein Bild mit Sprung**
  (Zoomschritt ≤ Tempo/30 s in 154 bzw. 151 Bildern); Tempo-Bremse hält 1,5 s ihren Wert.
- Bildrate ohne → mit Vollbild: 2D 55,1 → 55,1, 3D 53,5 → 52,3 Bilder/s; Zoomtempo 0,45 → 0,50 bzw. 0,47 → 0,45 log₁₀/s.
- Im Vollbild ohne HUD: Leertaste aus/an, R kehrt um (und wieder zurück), ↑ Tempo +0,1, Tasten holen das HUD nicht; Doppeltipp
  aus/an, HUD bleibt aus; einfacher Tipp zeigt das HUD, der Flug läuft weiter.
- iPhone 13 (WebKit, ohne Vollbild-Schnittstelle): 2D-Flug durch Kino-Modus an, Drehen, Kino-Modus aus – 631 Bilder, keins
  angehalten, größter Zoomschritt 0,024 (längste Bildzeit 49 ms).
- Hinweis: `test_hud_fs` fällt headless (≈ 10 Bilder/s, Tipp-Zeiten unzuverlässig) auch mit 6.8.0 durch – im sichtbaren
  Fenster grün; `run_all.sh` startet ihn jetzt so.

## Screenshot in hoher Auflösung (E2)

**Option** (Mehr, gespeichert): *Bildschirm* (volle Geräteauflösung – auch bei Auflösung „Akku“), *2×*, *4×*, *8K*
(7680 × 4320), *Eigene* (Breite × Höhe, Seitenverhältnis wie Bildschirm oder frei, Vorgabe 3840 × 2160, je Seite ≤ 65535,
≤ 1 Gigapixel); „Beschriftung im Screenshot“ (Standard an, Schrift = Bildhöhe/70). Andere Seitenverhältnisse als der
Bildschirm: in 2D passt das ganze Bildschirmbild hinein (am Rand kommt mehr dazu), in 3D bleibt der senkrechte Blickwinkel.

**Kachel-Rendern (`js/capture.js`):**
- Kacheln ≤ min(MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE, MAX_VIEWPORT_DIMS, Handy 1024 / sonst 2048) samt Rand, Streifenhöhe
  so, dass ein RGBA-Streifen ≤ 24 MB (Handy) bzw. 64 MB bleibt. Reihenfolge Streifen für Streifen.
- **2D:** je Kachel ein Rechenpuffer (GPU oder CPU-Worker – derselbe Rechenweg wie das Ruhebild bei dieser Pixelgröße, d. h.
  ab Bildschirm-Zoom-Äquivalent 1000 Perturbation; gleiche Iterationen, Distanzschätzung, exakte f64-Nachrechnung unsicherer
  Pixel) mit 4 px Rand, dann der Anzeige-Pass 1:1 in ein RGBA-Ziel. **Bitgleich zum Bild aus einem Stück**, weil jede Kachel
  mit derselben Ansichtsmitte rechnet und ihre Lage als ganz-/halbzahligen Pixelversatz `u_pxoff` bekommt (in f32 exakt – die
  Pixelkoordinate p ist dieselbe Zahl wie im ganzen Bild), die BLA-Entscheidung fürs ganze Bild fällt (bei Bedarf wird die
  Tabelle für den größeren Umkreis neu gebaut, `requestBLA`), CPU-Kacheln und Nachrechnung mit den Koordinaten des ganzen Bilds
  laufen und Vignette/Funkeln über `u_vp` die Lage im ganzen Bild kennen.
- **3D:** dieselbe Kamera für das ganze Bild (Seitenverhältnis des Bilds), je Kachel nur die Projektion verschoben/gestreckt
  (`u_vt`: Gelände-Vertex-Shader, Himmelsstrahl, Vignette); Gitter und Detailstufen wie auf dem Bildschirm, 8 versetzte Bilder
  gemittelt wie im Stillstand (ein Bild je App-Takt), Bloom mit Verkleinerung 2 × Maßstab (gleicher Radius relativ zum Bild),
  Rand ≥ Bloom-Radius. Dafür ist das Zeichnen von Himmel + Gelände aus `T.render` in `drawScene` herausgelöst (gleicher Code
  für Bildschirm und Kacheln). Vor dem Start rechnet der Planer das Bildschirmbild fertig (die Kacheln lesen seine Ebenen).
- **Mandelbulb:** Anzeige-Shader mit `u_vp`, bitgleich. **Buddhabrot:** nur Bildschirm (Bild aus Zufallsproben über die Zeit;
  4× bräuchte 16× so viele – Minuten bis Stunden), die anderen Stufen sind dort ausgegraut mit Hinweis.
- **Ausgabe:** bis 100 MP (Handy 16,7 MP – iOS-Canvas-Grenze) Streifen per `putImageData` in ein OffscreenCanvas, dann
  `convertToBlob`; darüber **streamend** (`js/png-worker.js`): Paeth-Filter je Zeile, `CompressionStream('deflate')`, jedes
  komprimierte Stück sofort ein IDAT-Block, höchstens zwei Streifen unterwegs – das Bild liegt nie ganz im Speicher.
- **Ablauf:** Ansicht steht (Planer pausiert, laufender Flug angehalten und danach fortgesetzt, Gesten/Tasten gesperrt außer
  Esc), Rechnen in Häppchen im App-Takt (`step()` aus `frame()`), Fortschritt „Rendere Kachel i/n“ mit Restzeit und Abbrechen.
  Schätzung vor dem Start aus der Rechenzeit des Bildschirmbilds bzw. 3D-Kosten je Mittelungsbild, Kodierzeit, Dateigröße aus
  Bits je Pixel; nach jedem echten Screenshot ≥ 4 MP lernt sie nach (Faktor 0,25–4, localStorage). GPU-Kontextverlust (`R.onLost`)
  bricht sauber ab („Grafik verloren – Screenshot abgebrochen“), danach geht es wieder. Ist nach langem Rechnen die Nutzer-Geste
  verfallen, fragt die Leiste mit „Teilen / Speichern“ (Teilen und Herunterladen brauchen eine Geste).

## Prüfung und Messung (E2/E3)

**Kachelnähte** (`tests/test_shot.py`, 640 × 360 in einem Stück gegen Kacheln zu 128 px bzw. 3D 160 px, gleiche
Animationszeit; 3D aus demselben eingefrorenen Zustand):

| Fall | Kacheln | Rechenweg | abweichende Werte | größte Abweichung |
|---|---|---|---|---|
| Mandelbrot tief (GPU-Perturbation) | 15 | gpu/perturb | 0 von 691200 | 0 |
| Mandelbrot 10³⁴ (CPU-Perturbation) | 8 | cpu/perturb | 0 von 172800 | 0 |
| Julia (GPU direkt) | 15 | gpu/direct | 0 von 691200 | 0 |
| Newton | 15 | gpu/direct | 0 von 691200 | 0 |
| Mandelbulb | 15 | –/– | 0 von 691200 | 0 |
| 3D | 12 | –/– | 263 von 691200 | 3 |

3D: die wenigen Abweichungen (Rundung bei Rasterung und Bloom je Kachel) liegen verstreut, an den Kachelkanten im Mittel
0,0013 gegen 0,0006 Stufen sonst – keine Naht. (Zwei getrennte 3D-Aufnahmen hintereinander unterscheiden sich stärker, weil
Höhen-Normierung, Himmel und Vorausrechnung zwischen ihnen weiterlaufen – darum der Vergleich aus demselben Zustand.)

**Bedienung** (Pixel 7): Menü zeigt je Stufe Größe/MP/Dauer/Dateigröße; Eigene 3000 × 2000 frei + Beschriftung aus bleibt nach
Neuladen; „wie Bildschirm“ koppelt die Höhe; Ablauf 2× mit laufendem Flug: Rückfrage mit Schätzung, „Rendere Kachel 2/15 …“,
Ansicht steht, Datei `Fraktal_mandelbrot_1.4e3_2164x4404_….png`, Flug danach wieder unterwegs; Abbrechen; Kontextverlust
während 4× → Abbruch „lost“, danach wieder ein Screenshot; Buddhabrot nur „Bildschirm“. iPhone 13 (WebKit): Canvas-Weg (2×)
und streamender Weg (8K) liefern gültige PNGs der richtigen Größe.

**Größen** (`test_shot.py --matrix`, Desktop 1280 × 720, Apple M1, Chromium headless mit Metal, Beschriftung an;
Speicher = Summe RSS aller Browser-Prozesse; Naht = mittlerer Farbsprung über die Kachelkante / zwischen Nachbarspalten):

| Modus | Stufe | Größe | Kacheln | Ausgabe | Zeit | Schätzung | Datei | Speicher | Naht |
|---|---|---|---|---|---|---|---|---|---|
| Mandelbrot 3·10⁹ | 1x | 1280 × 720 | 1 (1280×720) | Canvas | 0,8 s | 1 s | 1,4 MB | 436 MB | – |
| Mandelbrot 3·10⁹ | 4x | 5120 × 2880 | 6 (2040×2040) | Canvas | 13,8 s | 13 s | 19,4 MB | 1014 MB | 3,81 / 4,85 |
| Mandelbrot 3·10⁹ | 8k | 7680 × 4320 | 12 (2040×2040) | Canvas | 22,8 s | 25 s | 41,0 MB | 1481 MB | 3,85 / 3,56 |
| Mandelbrot 3·10⁹ | 16k | 16384 × 9216 | 81 (2040×1024) | PNG-Worker | 81,5 s | 124 s | 117,3 MB | 1580 MB | 5,57 / 5,57 |
| Julia | 1x | 1280 × 720 | 1 (1280×720) | Canvas | 0,7 s | 1 s | 0,9 MB | 447 MB | – |
| Julia | 4x | 5120 × 2880 | 6 (2040×2040) | Canvas | 6,8 s | 10 s | 10,0 MB | 970 MB | 4,54 / 4,70 |
| Julia | 8k | 7680 × 4320 | 12 (2040×2040) | Canvas | 10,8 s | 11 s | 20,1 MB | 1393 MB | 2,43 / 2,79 |
| Julia | 16k | 16384 × 9216 | 81 (2040×1024) | PNG-Worker | 27,5 s | 77 s | 52,4 MB | 1305 MB | 1,49 / 1,37 |
| 3D-Landschaft | 1x | 1280 × 720 | 1 (1280×720) | Canvas | 1,5 s | 1 s | 1,4 MB | 475 MB | – |
| 3D-Landschaft | 4x | 5120 × 2880 | 6 (1920×1920) | Canvas | 11,0 s | 29 s | 17,0 MB | 861 MB | 1,99 / 1,96 |
| 3D-Landschaft | 8k | 7680 × 4320 | 15 (1848×1848) | Canvas | 18,4 s | 50 s | 34,2 MB | 1328 MB | 1,25 / 1,22 |
| 3D-Landschaft | 16k | 16384 × 9216 | 110 (1612×1014) | PNG-Worker | 67,5 s | 184 s | 83,2 MB | 1178 MB | 0,53 / 0,61 |

- Headless läuft der App-Takt mit ≈ 10 Bildern/s, 3D braucht je Kachel 10 Takte – im sichtbaren Fenster: 3D 8K 5,4 s statt 18 s,
  2D 8K 15,7 s, 2D 16k 65 s. **Die App bleibt dabei flüssig:** 2D 8K 48,9 Bilder/s (95 % ≤ 33 ms, längster Takt 200 ms beim
  Kodieren), 2D 16k 48,7 Bilder/s (längster 56 ms), 3D 8K 50,7 Bilder/s (längster 83 ms).
- Speicher bleibt auch bei 151 MP unter ~1,5 GB (streamend), Canvas-Weg 8K ~1,3–1,6 GB.
- Ausschnitte selbst angesehen (`tests/shots/v681/*_kante.jpg` an der detailreichsten Stelle der Kachelkante, `*_mitte.jpg`,
  `*_beschriftung.jpg`): keine Kante, keine Versätze; die Beschriftung läuft ungebrochen über eine Kachelgrenze. 2D in 16k
  gestochen scharf bis in feinste Filamente; 3D in 8K/16k weich im Gelände (siehe Grenzen).

**Übrige Suite** (headless, Metal) nach dem Umbau von Shadern und 3D-Renderer grün: Unit-Tests (48), `node_core_test`,
`test_release`, `tools/check_release.py`, `test_truth` (GPU), `test_features`, `test_3d` (sichtbar), `test_context_loss`,
`test_shader_fail`, `test_gestures`, `test_ui`, `test_fs_fly`, `test_shot`. Abschlusslauf mit 6.8.1: Unit, `node_core_test`,
`test_release`, `check_release`, `test_gestures`, `test_ui`, `test_hud_fs` (sichtbar), `test_fs_fly` (sichtbar), `test_shot`,
`test_p3`, `test_deeplink`, `test_blend`, `test_fly2d` (sichtbar) grün. `test_rueck` fällt headless durch (2D-Flug kommt in 12 s
nur bis Zoom ~60, die Tempo-Bremse steht auf 0,3, weil der unsichtbare Browser heute nur ~12 Bilder/s liefert) – **mit 6.8.0
genauso** (Gegenprobe auf einer Arbeitskopie von 783443d: Zoom 62); im sichtbaren Fenster mit 6.8.1 grün. `run_all.sh` startet
ihn jetzt sichtbar.

## Offen / Grenzen

- **3D-Gelände in sehr großen Bildern:** Die Höhen kommen aus den für den Bildschirm gerechneten Ebenen (bis 1600 px Kante). Licht,
  Kanten und Himmel sind in voller Auflösung scharf, das Gelände wird ab ~4× aber nicht detailreicher, sondern weicher. Für echte
  Detailgewinne müssten für den Screenshot eigene, feinere Ebenen gerechnet werden – Kandidat für Job 7.0 (Mandelbulb übernimmt
  die Technik, `T3.capBegin/capFrame/capFinish`, `R.presentBulb(…, target, vp)`).
- Buddhabrot nur Bildschirmauflösung (siehe oben).
- Schätzung: vor dem ersten Screenshot eines Geräts grob (gemessen Faktor 0,4–1,1 in 2D, 3D bis 2,7× zu vorsichtig), danach
  gelernt.
- Auf echten Handys nicht gemessen (Pixel-7-Emulation auf dem M1, WebKit-Emulation fürs iPhone); dort gelten 1024er-Kacheln und
  ab 16,7 MP der streamende Weg.
- Kodieren im Canvas-Weg: `convertToBlob` blockiert in WebKit kurz (bis ~0,5 s am Ende).
