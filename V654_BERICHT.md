# Bericht 6.5.2 – 6.5.4: Grafik-Wächter und Umbau nach dem Gutachten vom 05.10.2026

Auftrag: `docs/audit/2026-10-05-max-gutachten.md` (nur P1 + P2, Phasen 0–5) plus Hermes-Nachtrag „Grafikkarte weg →
weiße Fläche“. Gearbeitet am Mac mini (M1, Chrome headless über ANGLE/Metal; Flugtests im sichtbaren Fenster).
Ergebnis: drei Releases, alle live und geprüft.

| Version | Inhalt | Live geprüft |
|---|---|---|
| **6.5.2** | Etappe 0: Grafik-Wächter, vollständige Wiederherstellung nach Kontextverlust (= Gutachten P1-3) | ja (Version, Bild in 1,5 s, 0 Fehler) |
| **6.5.3** | Phase 0 (Sicherheitsnetz) + Phase 1 (P1-Fehler) + Phase 2.1–2.5 (P2) | ja |
| **6.5.4** | Phase 2.6 (alte A/B-Pfade), Phase 3 (Aufräumen), Phase 4 (Schnitt von app.js), Phase 5 (Deploy/Repo) | ja (Mehr-Tab „6.5.4“, mit/ohne `?deko=0`, 3D, 0 Fehler) |

Die Version heißt nicht 6.4.2 (wie im ursprünglichen Brief), sondern folgt laut Hermes-Vorab auf den live stehenden
Stand. Schritt −1 entfiel: `rog-v65` = `main` = 6.5.1, `DEKO_BERICHT.md` war vollständig.
38 Commits, davon 29 als „umbau(<nr>)“, je Schritt einer.

---

## Etappe 0 (6.5.2): nie mehr eine leere oder weiße Fläche

**Gemacht**
- `webglcontextlost` → nach 1,5 s Glas-Meldung „Grafik wird neu verbunden …“; kommt `restored`, verschwindet sie und
  das Bild ist sofort zurück. Nach 6 s ohne Wiederherstellung: „Die Grafikkarte hat die Verbindung verloren.“ +
  **Neu laden** (Ansicht vorher in den Link: Ort, Zoom, Welt) + „Hilft das nicht: Browser ganz schließen und neu öffnen“.
- **Start-Wächter:** ohne erstes Bild nach 12 s (Handy 20 s, nur sichtbare Zeit) dieselbe Art Meldung mit **Neu laden**
  und **Einfache Grafik** (CPU-Rechenweg + Auflösung „Akku“ + kein GPU-Selbsttest, nur für die Sitzung, nichts wird
  gespeichert). Kommt das Bild doch, verschwindet die Meldung. Test-Hook `?test_nofirstframe=1`.
- **Weiß vermeiden:** `<html style="background:#05060f">`, Canvas-Hintergrund = App-Hintergrund, solange eine Meldung
  steht, ist der Canvas ausgeblendet. Headless ließ sich kein weißer Canvas erzeugen (verlorener Canvas zeigt dort
  den Body-Hintergrund) – das Weiß bei Peter kam vermutlich vom abgestürzten GPU-Prozess selbst; jetzt liegt in jedem
  Zustand nur noch der dunkle Hintergrund.
- **Fatal-Fall** (kein WebGL 2 bzw. Anzeige-Shader scheitert hart): Text um Ursache und Abhilfe ergänzt („Chrome sperrt
  WebGL nach wiederholten Grafik-Abstürzen: Browser ganz neu starten; chrome://gpu zeigt den Status“), 9 Sprachen.
- **3D/Flug/Buddhabrot nach Kontextverlust** (= Gutachten P1-3, darum schon hier): `T3.reset()` (alle GL-Handles,
  Anwärm-Zustand, Gelände-Variante), Renderer-Handles (`_dummy*`, `scatter*`, `histTex`), **Erweiterungen im neuen
  Kontext neu aktivieren** (ohne `EXT_color_buffer_float` war die 3D-Landschaft nach der Wiederherstellung flach – im
  Gutachten nicht erwähnt, beim Testen gefunden), Höhentexturen/Mittelung/Buddhabrot zurücksetzen.

**Tests:** `tests/test_gpu_guard.py` (a: Verlust + Wiederherstellung nach 1 s; b: ohne Wiederherstellung, Knopf lädt
neu, Ort/Zoom/Welt erhalten, hoch und quer; c: Start-Wächter + Einfache Grafik; d: 3D; e: Verlust mitten im Flug, Flug
läuft weiter), `tests/test_context_loss.py` (2D Seepferdchen 1e9 nach Wiederherstellung **bitgleich**, 3D wieder mit
Höhen (Helligkeit 47,2 → 44,9), Buddhabrot sofort). Screenshots `tests/shots/gpu_guard_*.png` per Bild geprüft.

**Messzeiten Shader am Mac (für Hermes’ Vergleich mit rog):** 3D-Start `measure_3d_start.py` (6.5.2, Metal, frische
Shader): Tippen → 3D 656 ms, längster Block 145 ms, 0 Long Tasks; Übersetzen+Linken je Programm: Höhe 249 ms,
Himmel 140 ms, Gelände 332 ms, Blit 249 ms, Sonde 249 ms (`tests/results_3dstart_v652_metal.json`). 2D-Programme
(synchron `program()`, frischer Quelltext): Anzeige 24 ms, Rechen-Varianten 5–8 ms – ANGLE/Metal baut die eigentliche
Pipeline erst beim ersten Zeichnen. Ob am rog die App selbst (langer Compile → Watchdog) oder die parallelen
Test-Browser den GPU-Prozess abstürzen ließen, ist am Mac nicht zu klären (offen für Hermes’ Messung).

---

## Phase 0 – Sicherheitsnetz

| Schritt | Gemacht | Ergebnis |
|---|---|---|
| 0.1 | `tests/unit/run.js` + `hp`, `gestures`, `core-formulas`, `orbit-worker` (purer Node, < 1 s) | grün; bekannte Fehler P1-4/P2-2 zuerst als „erwartet rot“ markiert, mit 1.1/2.2 grün |
| 0.2 | `tests/test_snapshot.py`: Gesamtbild, Seepferdchen 1e9 (GPU), dasselbe auf der CPU, 3D | bitgleich (SHA-256 der Rohbytes), 6.5.1 und 6.5.2 gegengeprüft identisch |
| 0.2b | Snapshot deckt auch den Display-Shader ab (2D-Canvas der exakten Ebene) | nötig für 2.6 |
| 0.3 / 0.3b | `tools/check_release.py` (Versionen, Precache ⊇ alles Geladene inkl. Worker in allen Modulen, `--root=_site`); Workflow-Job `check` vor `deploy` | Actions grün; absichtlich falsche Version/fehlende Datei → FAIL |

Abweichungen: Die Snapshots liegen als Hash + Stichprobe vor (Rohdaten wären je ~15 MB JSON). Der Formel-Test
vergleicht nur gut konditionierte Pixel (direkt bei c±10⁻¹³ stabil) – an chaotischen Randpixeln springt schon die
direkte f64-Rechnung (Burning Ship: 30 von 200 Pixeln); dort ist |Δμ| ≤ 10⁻¹⁰. Der 3D-Snapshot zeichnet nur den
bitgleichen Rechenpuffer mit fester Höhen-Normierung (das normale 3D-Bild schwankt zwischen zwei Läufen desselben
Stands um bis zu 73/255 je Block, weil Ebenenstapel und Höhen-Normierung zeitabhängig wachsen).

## Phase 1 – Fehler (P1)

| Schritt | Vorher (belegt) | Nachher |
|---|---|---|
| 1.1 Zwei-Finger-Tipp | mit 1 px Zittern des zweiten Fingers: Faktor 1,0 (Tipp verloren) | Faktor 0,333 (÷3), Unit + E2E |
| 1.2 Nachrechnung bei Referenzwechsel | 2/2 Läufe nach 20 s nicht fertig (Spinner) | fertig nach 3,5 s; zusätzlich gefunden: der vorhandene Rückweg „Referenz gewechselt → neu rechnen“ setzte nur `stage = 2`, `schedule` startete danach wieder die Nachrechnung → jetzt als Vorschau markiert (`recompute`) |
| 1.3 Kontextverlust | schon mit 6.5.2 erledigt (siehe Etappe 0) | — |
| 1.4 Shader-Fehler | 6.5.1 mit kaputter Bunt-Variante: kein Hinweis, Bild nie fertig | `R.broken` + markierte Ausnahme, Rückfall nur für die Sitzung (Bunt aus / CPU-Perturbation / CPU-Rechenweg / 3D aus) mit Meldung (9 Sprachen), `frame()` überlebt Fehler; 4 Fälle in `test_shader_fail.py`, 0 pageerror |

## Phase 2 – Robustheit (P2)

| Schritt | Ergebnis |
|---|---|
| 2.1 Service Worker | Worker beim Start (7 bereit), `onerror` → Abbruch + Meldung, kein `skipWaiting`. Test mit echter neuer SW-Datei: Update wartet, alter Cache bleibt, offline 1e31 in 3,4 s fertig. 6.5.1: Update übernahm sofort und löschte den alten Cache unter der laufenden Seite (die Worker entstanden dort aber schon mit dem ersten Bild – das Risiko war kleiner als im Gutachten) |
| 2.2 BLA-Stau | vorher 2/2 Läufe 30 s ohne finales Bild (`blaPending` hängt); nachher fertig in 1,7 s. Der Worker antwortet `ignored`, die App behält dann die vorhandene Tabelle (nur `blaPending` zurücksetzen hätte den Stau nicht gelöst – `ensureRef` hätte weiter auf eine schnellere Tabelle gewartet) |
| 2.3 2D-Shader nicht blockierend | simulierter langsamer Treiber (2 s): vorher 2 Long Tasks à 2064/2027 ms beim Formelwechsel, nachher keine; größte Bildlücke 148 ms bei 133 ms Leerlauf-Lücke (headless-Bildtakt). Finale Variante wird nach der Vorschau vorgewärmt |
| 2.4 CPU-Kacheln | Arbeit je Kachel ≤ 3·10⁷ (T²·maxIter, ≥ 16 px): Bilder bitgleich, Stillstand direkt nacheinander 3,56→3,60 s / 11,43→11,53 s / 2,56→2,78 s (≤ +9 %, Rechner hatte Last 7–9), Umschalt-Latenz Median 800→596 ms. **Ausgelassen:** „in Bewegung nur 1 Kachel je Worker“ – gemessen schlechter (erste Kachel der neuen Ansicht Median 635 statt 225 ms, Ausreißer bis 2,5 s) |
| 2.5 Speicher 3D | 30-s-Flug Pixel 7: 155 → 123 MB belegt (Spitze 174 → 123), höchstens 6 statt 8 Ebenen, Puffer 1920² statt 2014² (Kante 1600 + Überhang), kein Vorausrechnen über dem Budget; `test_fly64` mit 1600 grün (Rand 1,0), 2048 nicht nötig. 2D bitgleich, 3D-Snapshot neu (einzige Pixel-Ausnahme). **Ziel ≤ 64 MB nicht erreicht:** 6 Ebenen in voller Auflösung mit Überhang sind allein ~110 MB; weniger geht nur mit sichtbar gröberem 3D – Entscheidung bei Peter |
| 2.6 a–d | `?blend=0` (5.0.1), `?aa=0/N`, `?de=0`, `?dew` (6.0-Schattierung im Gelände-Shader), `?flyedge=0`, `?flyhold=0`, `?flycap`, und `recon, predict, strips, prefetch, over, overmove, maxdiv, fadems, feather, gov, govk, govmin, inflight` entfernt. Snapshot inkl. Display-Shader bitgleich, `compare_3d_shader.py` 96 Fälle 100 % identisch. Tests auf feste Referenzwerte umgestellt (5.0.1-Modus: Schwenk-Schärfe 0,001, Herauszoom-Lücken 0,913; ohne Tempo-Bremse Flug 5,53 s). Bleiben: `deko`, `renderer`, `noanim`, `nobla`, `nowarm`, `s3d`, `fpscap`, `prof`, `flyturn`, `nopreview`, `test_nofirstframe`, `nosw` |

## Phase 3 – Aufräumen

- 3.1 toter Zustand (`tour`, `RC.timeToFull/lastKeyFull/list`, `V3.settleT`, `FLY.steerBase/t0/scoreT`, `stats.lastRef`), Kommentare (8 Ebenen, 5 B/Pixel).
- 3.2 Links: `it` ≤ 500 000, Dezimalkomma (`x=-0,7453`) – vorher still Sprung zum Ursprung.
- 3.3 Zähler: **`S.cycle %= 1000` statt 1024** – die Paletten haben Frequenzen 0,4/0,5/0,7, der 3D-Himmel nutzt sie ohne `fract`; mit 1024 wäre er bei jedem Umlauf (≈ 1,9 h bei Tempo 0,15) gesprungen, mit 1000 ist alles exakt periodisch. `S.time %= 86400`: Funkeln/Wasser laufen über `sin(0,5·t)` usw. und sind mit keiner Periode exakt periodisch → einmal pro 24 h Laufzeit ein kleiner Phasensprung (vorher drohten nach Tagen Ruckler durch f32).
- 3.4 `help_tricorn` fr/pt; Orbit-Worker-Fehler sperren die Anfrage 5 s; `R.info()` gecacht; Vollbild-Knöpfe ohne Vollbild-Schnittstelle ausgeblendet; Orte-Vorschau in 3D = 3D-Bild (6.5.3: 2D-Bild, im Test belegt).

## Phase 4 – Schnitt von `js/app.js`

`app.js` 2225 → 1216 Zeilen; neu `url-state.js` (64), `cpu-pool.js` (142), `refs.js` (140), `layers.js` (146),
`flight.js` (309), `scheduler.js` (395). Muster `self.FK<Name>.create(ctx)`: Namen aus app.js werden nach dem Anlegen
aller Module per `link()` gebunden, veränderliche App-Variablen (`cssW`, `flight`, `inertia`, `camDirty` …) liest das
Modul über `ctx.<name>` (Getter/Setter). Funktionsrümpfe sonst wörtlich übernommen (Werkzeug mit Klammer-/String-/
Regex-Lexer). Zwei Stellen laufen schon beim Anlegen und lesen darum direkt aus `ctx` (Orbit-Worker-URL, `?flyturn`).
Je Modul: `node --check`, Release-Check, Snapshot bitgleich, `test_blend`, `test_3d`, `test_features` + gezielte Tests.

## Phase 5 – Deploy/Repo

- 5.1 Artefakt nur aus Laufzeitdateien (4,4 MB statt des ganzen Repos mit 217 MB Screenshots), vor dem Upload mit
  `check_release.py --root=_site` geprüft; README-Bilder nach `docs/img/` (Originale bleiben unter `tests/shots/` –
  Git LFS entscheidet Peter). Live: `tests/run_all.sh` und Berichte liefern 404, die App läuft.
- 5.2 `tools/bump_version.py X.Y.Z` (28 Stellen, danach Release-Check).

## Testumgebung (neu/geändert)

- `tools/serve.py` ersetzt `python3 -m http.server 8472`: dessen Warteschlange (5 Verbindungen) lief bei 12 Skripten
  gelegentlich über → ein Skript kam nicht an („App kam nicht hoch“, `ERR_SOCKET_NOT_CONNECTED`). Das war auch die
  Ursache seltener Snapshot-Ausreißer. `e2e_lib` meldet jetzt, warum die App nicht hochkam, und lädt einmal neu.
- Flugtests (`test_3d`, `test_v62`, `test_fly64`, `test_memory3d`) laufen in `run_all.sh` im sichtbaren Fenster:
  headless drosselt macOS den Bildtakt auf ~8 Bilder/s (auch 6.5.1 fiel dort durch).
- `compare_3d_shader.py` verglich nach einem Look-Wechsel zwei verschiedene Gelände-Varianten (Anwärmen) – behoben.
- `test_ui` misst nach Ende der Einblend-Animationen (vorher 47 statt 48 px bei `scale(.98)`).
- Wahrheitstests (`test_truth` GPU + CPU) nach jeder Suite: `okPct`/`maxDiff` identisch zu den eingecheckten Werten.

## Ganze Suite (letzter Lauf, Endstand vor der Versionsnummer)

24 Läufe, 22 grün. Rot:
1. **`test_blend` „Schwenk schärfer als 5.0.1-Modus“** – die Messgröße ist stark lastabhängig (gleicher Code:
   0,004 … 0,68; Schwelle 0,051). Bei normaler Last grün; Hintergrundlast des Mac (VPN, iCloud) bis 9.
2. **`test_v64` Bunt-Proben (bestehender Fehler, nicht durch diesen Auftrag):** In einer bestimmten Testfolge
   rechnet die GPU Innenpunkte (Kardioide, Periode-2/3-Knospe, Minibrot) als Außenpunkte (μ ≈ 416–437), sogar
   einmal sichtbar orange in der schwarzen Kardioide. Belege: tritt identisch mit dem unveränderten **6.5.1** auf
   (heute früh noch grün), mit `?nobla` nie, frisch geladen nie, auch mit erzwungen frisch übersetzten Shadern
   (kein Shader-Cache-Problem). Schon die Vorschau-Stufe ist betroffen. **Hypothese:** Mit „Bunt“ laufen Innenpunkte
   über `maxIter` hinaus (Orbit um bis zu 16 384 verlängert), die BLA-Tabelle ist nur bis `maxIter` gebaut – je
   nachdem, welche Tabelle gerade gebunden ist, springt die GPU über ungültige Einträge. Empfehlung: eigener kurzer
   Auftrag (Reproduktion: `python3 tests/test_v64.py`, mehrfach; Gegenprobe `?nobla`).

## Offen (braucht Gerät oder Entscheidung)

- iPhone/Android: Zwei-Finger-Tipp 10 Versuche vorher/nachher; Speicher 3D am Gerät; Kontextverlust per App-Wechsel.
- rog17: Shader-Compile/Link-Zeiten mit normalem Chrome (`tests/measure_3d_start.py`) – Hermes misst.
- P2-3: Ziel 64 MB nur mit gröberem 3D erreichbar (siehe 2.5).
- `test_v64`-Befund (oben) als eigener Auftrag.
- Git LFS für `tests/shots/` (217 MB).
