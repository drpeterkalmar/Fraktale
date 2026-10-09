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
