# Code-Gutachten Fraktal-Explorer 6.4.1 (Stand 2026-10-05)

Gutachter: Claude Fable 5.1 (max), Leicht-Spur: nur Lesen, Denken, kurze Node-Tests. Kein Browser, kein Server.
Grundlage: alle Module in `js/`, `index.html`, `sw.js`, `manifest.webmanifest`, `style.css`, `translations.js`,
alle Tests in `tests/`, Berichte `V5…V63_BERICHT.md`, README, Git-Historie (118 Commits).

Belege, die ich selbst ausgeführt habe (jeweils < 2 s CPU):
- `node --check` für alle JS-Dateien: fehlerfrei.
- `node tests/node_core_test.js --quick --only=seahorse_1e7`: ALL PASS (100 % innerhalb 1 Iteration).
- 20 Randfall-Prüfungen für `js/hp.js` (Roundtrip Dezimal/BigInt, Subnormale, negative Rundung, `mulNumber`): alle OK.
- Nachbau der Gestenlogik mit einem Fake-Element: Zwei-Finger-Tipp wird **nicht** erkannt, sobald der zweite Finger
  ein einziges `pointermove` an Ort und Stelle meldet (Befund P1-4).
- Übersetzungen: 9 Sprachen, 163 Schlüssel; `fr` und `pt` fehlt `help_tricorn` (Rückfall auf Englisch).

Nicht möglich in dieser Spur (offen, siehe Abschnitt 5): alle Browser-Tests, Messungen auf iPhone/Android.

---

## 1. Kurzurteil

1. Der Rechenkern (BigInt-Kamera, Referenzorbit, Perturbation, BLA, Fehlerschätzung) ist sauber, gut kommentiert und
   durch Wahrheitstests gegen Python-Decimal abgesichert. Das ist der wertvollste Teil und er ist gesund.
2. Die Orchestrierung in `js/app.js` (2162 Zeilen, ein einziger Scope mit neun globalen Zustandsobjekten) ist das
   größte Wartbarkeitsrisiko: Referenz, Ebenen, Nachrechnung, Flug, 3D und Vorausrechnen greifen über Modulvariablen
   ineinander, und 29 URL-Schalter halten alte Verhaltensversionen am Leben.
3. Das größte Risiko für Nutzer: **Robustheit bei Störungen.** Ein WebGL-Kontextverlust (auf dem Handy beim
   App-Wechsel üblich) lässt 3D dauerhaft kaputt, ein Shader-Fehler auf einem fremden Treiber friert die App bei jedem
   Start ein, und eine neu eintreffende Referenz während der exakten Nachrechnung führt in eine Endlosschleife.
4. Vier Befunde sind echte Fehler (P1), darunter der unzuverlässige Zwei-Finger-Tipp, den der E2E-Test nicht sieht.
5. Tests: viele, gründlich, aber fast alle brauchen einen Browser; keine Unit-Tests für die reinen Module, kein
   CI-Gate vor dem Deploy, jeder Push auf `main` geht sofort live.

Befunde: **4 × P1, 9 × P2, 14 × P3.**

---

## 2. Befunde P1 (drohender oder bestehender Fehler)

### P1-1 Endlosschleife der exakten Nachrechnung bei Referenzwechsel

- **Stelle:** `js/app.js:394-413` (Antwort des Orbit-Workers), `js/app.js:860-863` (`onFixPixels`, `missingRef`),
  `js/tile-worker.js:54`, `js/app.js:502` (Auslöser).
- **Beleg (Code-Pfad):** Trifft eine neue Referenz ein, bricht der Handler laufende GPU-Jobs ab (Zeile 407-408),
  **nicht aber die laufende Nachrechnung `RC.fix`**, und schickt allen CPU-Workern die neue Referenz (Zeile 411).
  Die Worker antworten auf die noch offenen Nachrechen-Pakete mit `missingRef` (alte `refId`). `onFixPixels` schickt
  daraufhin wieder die aktuelle Referenz plus **dasselbe Paket mit der alten `refId`** (Zeile 863) – Worker antwortet
  erneut `missingRef` – und so weiter, bis die Kamera sich bewegt. Symptom: HUD-Spinner steht ewig bei 50 %, CPU
  beschäftigt, kein exaktes Bild, kein Vorausrechnen (weil `schedule` bei offenem `RC.fix` sofort zurückkehrt,
  Zeile 992-995).
  Auslöser ist realistisch: Zeile 502 fordert in Bewegung eine neue Referenz an, wenn der Referenzpunkt mehr als
  16 Bildradien entfernt liegt; der Referenzkern (Nukleus) darf bis zu 64 Radien entfernt liegen
  (`js/fractal-core.js:596`), während die strenge Prüfung in Zeile 482 nur den Abstand zur **angefragten Ansicht**
  (≤ 3 Radien) und den Zoom (≤ 8×) prüft. Also: finales Bild + Nachrechnung starten mit der alten Referenz, die neue
  kommt mittendrin an.
- **Umbau:** Im `ref`-Handler: `if (RC.fix && RC.fix.fr.mode === 'perturb' && RC.fix.fr.refId !== m.id) cancelFix()`
  und das Frontbild wie in Zeile 832 auf Stufe 2 setzen (wird neu gerechnet). Zusätzlich in `onFixPixels` bei
  `missingRef` prüfen, ob `REF.cur.id` noch zur Nachrechnung passt, sonst abbrechen (Schutz gegen künftige Pfade).
- **Aufwand:** S. **Risiko:** gering (nur Abbruch + Neustart eines Pfads, der heute hängt).
- **Test:** Test-Hook `__fraktal.testNewRef()` (erzwingt eine Referenzanfrage mit neuer Signatur für die aktuelle
  Ansicht); E2E: tiefe Ansicht, warten bis `status().fixing`, Hook rufen, erwarten `status().done` ≤ 15 s.

### P1-2 Shader-Fehler zur Laufzeit werden nicht abgefangen – App friert bei jedem Start ein

- **Stelle:** `js/renderer.js:20-29` und `:80-98` (werfen `Error`), `:270-271` (`drawCompute` übersetzt synchron),
  `:627-630` (`selfTest` prüft nur 3 von >40 Varianten), `js/three.js:746-758` (`terrainProgram`),
  `js/app.js:1902-1952` (`frame` ohne try/catch, `requestAnimationFrame` wird vor der Arbeit neu gesetzt).
- **Beleg:** Alle Rechen-Varianten (Formel 1–4 × direkt/Perturbation × Fehlerschätzung × Distanz × Bunt) und die sechs
  Gelände-Varianten werden erst bei Gebrauch übersetzt. Schlägt eine fehl (fremder Treiber, z. B. die `IN`-Variante
  mit `struct`/`inout` auf einem älteren Mali/Adreno, oder ein Link-Fehler bei 16 Samplern), fliegt die Ausnahme aus
  `schedule()`/`present()` **in jedem Frame** – das Bild friert ein, die Konsole läuft voll, keine Meldung. Weil
  `setCol: 'bunt'`, `alpine`, `deOn` in `localStorage` landen (`js/app.js:67-72`), passiert das **bei jedem Start**,
  bis der Nutzer den Speicher löscht.
- **Umbau:** (1) `program()` wirft weiter, aber `R.programReady`/`drawCompute`/`terrainProgram` fangen den Fehler,
  merken `R.broken[key] = true` und melden ihn einmal. (2) Rückfallregeln ohne neues Verhalten: Variante mit `inn`
  defekt → Bunt für diese Sitzung aus + Toast; Perturbations-Shader defekt → `gpuPerturbOK = false` (CPU-Pfad, gibt
  es schon); Gelände-Shader defekt → `set3d(false)` + Toast. (3) `frame()` bekommt ein try/catch um `schedule`
  und `present`, das den Fehler einmal protokolliert und die Schleife am Leben lässt, statt 60×/s zu werfen.
- **Aufwand:** S–M. **Risiko:** gering; Fehlerfall wird nur abgefedert, Normalfall unverändert.
- **Test:** E2E nach dem Muster von `tests/test_v63.py` (dort wird schon ein langsamer Treiber simuliert):
  `gl.compileShader` per Monkeypatch für eine Variante scheitern lassen → App läuft weiter, Toast, 0 unbehandelte
  Fehler, Bild wird fertig.

### P1-3 WebGL-Kontextverlust: Wiederherstellung unvollständig, 3D danach dauerhaft kaputt

- **Stelle:** `js/renderer.js:110-122` (`initGL` setzt `programs`, `pending`, `vao`, `refTex`, `pool` zurück, aber
  **nicht** `_dummy` (`:496`), `_dummyD` (`:489`), `scatterProg/VAO/VBO` (`:368`), `histTex` (`:518`));
  `js/three.js` hat **gar keinen** Reset: `fbo`, `grid` (`:587`), `fboS`, `acc` (`:851`), `noiseTex` (`:907`),
  `warmT`, `warmDone` (`:775`), `probeBuf` (`:1074`), `lastTerr` (`:744`); `js/app.js:1954` (`R.onRestored`) setzt
  `RC`/`REF` zurück, lässt aber `V3.on`, `V3.accKey` und `T3` unberührt.
- **Beleg:** Nach `webglcontextrestored` liefert `target()` (`js/three.js:852-857`) das alte `fbo`-Objekt zurück,
  weil die Größe passt – ein Objekt des verlorenen Kontexts. `bindFramebuffer` scheitert, Himmel und Gelände landen
  ohne Tiefenpuffer auf dem Canvas, `T.present` liest eine tote Textur → schwarz/Müll, in jedem Frame GL-Fehler.
  3D aus/an hilft nicht (`freeStill` räumt nur `fboS`/`acc`). In 2D: `scatter` schreibt still nichts mehr (die
  Nachrechnung „gelingt“, das Bild bleibt f32), Buddhabrot zeigt nichts. Kontextverlust ist auf Android/iOS normal
  (App-Wechsel, Speicherdruck – und P2-3 macht ihn wahrscheinlicher).
- **Umbau:** `T3.reset()` (alle GL-Handles auf `null`, `warmDone = {}`, `lastTerr = null`, `T.variant` leer),
  aufgerufen aus `R.onRestored`; `initGL` nullt die vier Renderer-Handles; `R.onRestored` setzt `V3.accKey = null`,
  `V3.accPending = false` und löst bei `V3.on` einen Neuaufbau aus (`invalidate()` reicht, wenn `T3` sauber ist).
- **Aufwand:** S–M. **Risiko:** gering (nur Wiederherstellungspfad).
- **Test:** E2E mit `WEBGL_lose_context` (`loseContext()`/`restoreContext()`, headless Chrome kann das): in 2D und in
  3D nach Verlust + Wiederherstellung: `status().done` wieder `true`, 3D-Bild nicht schwarz (Pixelprüfung), 0 Fehler.

### P1-4 Zwei-Finger-Tipp (÷3) ist auf echter Hardware unzuverlässig

- **Stelle:** `js/gestures.js:67` (`moved` wird für **jeden** Zeiger vom Ablagepunkt des **ersten** Fingers
  gemessen), `:92` (Bedingung `moved < 18`), Testlücke `tests/test_gestures.py:74` (Zwei-Finger-Tipp ohne
  `touchMove`).
- **Beleg (reproduziert in Node mit Fake-Element):** Finger 1 bei x=100, Finger 2 bei x=200. Meldet Finger 2 ein
  einziges `pointermove` an seiner eigenen Position (0 px Bewegung), wird `moved = 100` → statt `onTwoFingerTap`
  feuert nur `onEnd`. Ohne dieses `pointermove` klappt die Geste. Echte Touchscreens liefern beim Auflegen des
  zweiten Fingers praktisch immer ein `pointermove` (Subpixel-Zittern) – die Geste wirkt „mal ja, mal nein“.
  Der E2E-Test sendet nur `touchStart`/`touchEnd` und sieht den Fehler nicht.
- **Umbau:** Ablagepunkt pro Zeiger in `pts` speichern (`x0, y0`) und `moved = max(moved, hypot(p.x - p.x0,
  p.y - p.y0))` rechnen. Doppeltipp und Langdruck (ein Finger) bleiben unverändert.
- **Aufwand:** S. **Risiko:** gering.
- **Test:** Unit-Test ohne Browser (Fake-Element, zwei Szenarien, siehe Anhang A); E2E-Ergänzung: `touchMove` des
  zweiten Fingers an Ort vor `touchEnd`.

---

## 3. Befunde P2 (Wartbarkeit, Robustheit, Performance)

### P2-1 Update-Race des Service Workers: alte Seite läuft nach dem Update mit gemischten Versionen oder ohne CPU-Worker

- **Stelle:** `sw.js:40` (`skipWaiting`), `:43-44` (alte Caches löschen + `clients.claim`), `js/app.js:512-522`
  (CPU-Worker werden erst bei Bedarf erzeugt: `:628`, `:840`, `:1815`), kein `Worker.onerror`.
- **Beleg:** Beim Start registriert die (alte) Seite `sw.js`; eine neue Version installiert sich sofort, übernimmt die
  Seite und löscht `fraktale-<alt>`. Erzeugt die alte Seite danach ihre Worker (`js/tile-worker.js?v=alt`), kommen
  sie aus dem Netz als **neue** Version (Protokoll-Drift) oder gar nicht (offline) – und weil es keinen
  `onerror`-Handler gibt, bleiben `RC.fix`/`RC.job` offen, `schedule` wartet ewig (Zeile 992-995), der Spinner
  dreht. Der README-Hinweis „App einmal ganz schließen“ beschreibt genau das Symptom.
- **Umbau:** (1) CPU-Pool beim Start anlegen (`cpuPool()` in `init()`; Worker kosten im Leerlauf nichts) – damit
  sind alle Skripte der Sitzung geladen, bevor ein Update greifen kann. (2) `w.onerror` → Job/Fix abbrechen, Toast.
  (3) `skipWaiting` entfernen (Update beim nächsten Start, wie die README es ohnehin verlangt) **oder** bei
  `controllerchange` einmalig neu laden, sobald die App still steht. Variante 1 ist die kleinere Änderung.
- **Aufwand:** S. **Risiko:** gering.
- **Test:** `tests/test_release.py` erweitern: nach dem Laden `buddhaInfo().busy.length === nCpu` (Pool steht);
  Update-Übergang: zweite `sw.js` mit anderer VERSION ausliefern, alte Seite offline weiter auf Zoom > 10³⁰
  (CPU-Pfad) → `done`.

### P2-2 BLA-Neuaufbau bleibt nach einer verworfenen Vorausrechen-Referenz hängen – kein finales Bild zwischen 6× und 8×

- **Stelle:** `js/orbit-worker.js:10, 32, 50` (nur die **letzte** Referenz wird behalten; fremde `bla`-Anfragen
  werden **still** ignoriert), `js/app.js:400-402` (Vorausrechen-Referenz wird bei Bewegung verworfen),
  `:496-500` (`REF.blaPending` wird nur durch eine `bla`-Antwort zurückgesetzt; bei `blaCmax > 8·need` wartet
  `ensureRef` und liefert `false`).
- **Beleg:** Im Leerlauf fordert das Vorausrechnen eine Referenz für 4× tieferen Zoom an; bewegt sich der Nutzer
  vorher, verwirft die App sie – der Worker merkt sich aber genau diese als `last`. Die nächste `bla`-Anfrage für die
  aktuelle Referenz wird ignoriert, `blaPending` bleibt `true`. Zoomt der Nutzer dann 6–8× über die Referenz hinaus
  (noch streng nutzbar, aber `blaCmax` ist „zu großzügig“), kehrt `ensureRef` mit `false` zurück und **kein finales
  Bild wird gerechnet**, bis > 8× eine neue Referenz erzwingt. Sichtbar als dauerhaft weiche Vorschau.
- **Umbau:** Worker antwortet auf eine nicht passende `bla`-Anfrage mit `{type:'bla', refId, ignored:true}`; App
  setzt `REF.blaPending = false` auch bei jeder eintreffenden/verworfenen `ref`-Antwort. Alternativ: Worker hält
  die letzten zwei Referenzen.
- **Aufwand:** S. **Risiko:** gering.
- **Test:** Unit-Test des Worker-Protokolls mit Fake-`self` (Folge: `ref` A, `ref` B, `bla` für A → Antwort kommt).

### P2-3 GPU-Speicher ist nach oben nicht begrenzt – in 3D auf Handys bis 250 MB, bei „Maximal“ auf dpr-3-Geräten > 400 MB

- **Stelle:** `js/renderer.js:153-166` (`acquire` verwirft nur **freie** Puffer über dem Budget), `js/app.js:587`
  (Budget 40/64 MB), `:617` (3D rechnet quadratisch `max(w,h)²` in voller Auflösung), `:580` (`MAXL = NL = 8`;
  der Kommentar sagt „(6)“), `:785` (bis 7 + ausblendende Ebenen), `js/three.js:22` (3D nutzt höchstens `N3 = 6`).
- **Beleg (Rechnung):** Pixel 7, „Ausgewogen“ (dpr 2): 824×1830 → 3D-Puffer 1830² × 5 B = **16,7 MB je Ebene**
  (2D: 7,5 MB); 8 Ebenen + Job + Vorausrechnung + Nachrechen-Kopie + Höhentexturen (RGBA16F, halbe Auflösung,
  Mipmaps ≈ 9 MB je Ebene) → 150–250 MB. iPhone 15 Pro bei „Maximal“ (dpr 3): 2556² × 5 B = **33 MB je Ebene**,
  mit Höhentexturen > 400 MB → Kontextverlust ist wahrscheinlich (und P1-3 macht ihn endgültig). Zwei der acht
  Ebenen nutzt 3D nie (`layers3d` schneidet bei 6 ab) – reine Verschwendung.
- **Umbau (ohne sichtbares Verhalten zu ändern):** (1) In 3D `MAXL` auf `T3.N3` (6) begrenzen. (2) Kantenlänge des
  quadratischen 3D-Rechenpuffers deckeln (z. B. ≤ 1600 px, darüber mit `div` gerechnet – die Anzeige ist ohnehin auf
  `T.scale` 0,65 am Handy). (3) Belegte Bytes mitzählen; über dem Budget kein Vorausrechnen starten und beim
  Aufräumen die am wenigsten genutzte Ebene zuerst freigeben.
- **Aufwand:** M. **Risiko:** mittel – weniger Ebenen können am Horizont Lücken zeigen; mit den vorhandenen Metriken
  (`frameStats`, `layerInfo`, `test_3d`, `test_blend`) messbar.
- **Test:** E2E: nach 30 s Zufallsflug `layerInfo().pool.usedMB` ≤ Budget + 1 Vollbild; `test_blend`/`test_3d`
  unverändert grün.

### P2-4 Jeder Push geht ungeprüft live; der Pages-Artefakt enthält 83 MB Test-Screenshots

- **Stelle:** `.github/workflows/static.yml:49-52` (`path: '.'`), keine Test-Stufe; CLAUDE-Regel „immer pushen“.
- **Beleg:** Die Pipeline baut nicht und testet nicht. Ein kaputter Commit (z. B. ein vergessenes `?v=` – vgl. die
  4.8.0-Lehre im README) ist sofort bei allen Nutzern. Hochgeladen werden alle getrackten Dateien: 214 Screenshots
  (83 MB), Berichte, Testskripte; die README verweist auf vier Bilder unter `tests/shots/`.
- **Umbau:** (1) Job `check` vor `deploy`: `node --check js/*.js`, `node tests/node_core_test.js --quick`
  (Python 3 ist auf `ubuntu-latest` da), statischer Teil von `test_release.py` als `tools/check_release.py`
  (Versionsgleichheit, Precache-Liste ⊇ alle `<script src>`/CSS/Manifest/Icons). (2) Artefakt nur aus
  Laufzeitdateien (`index.html`, `js/`, `assets/`, `style.css`, `translations.js`, `sw.js`, Manifest, `docs/img/`);
  die vier README-Bilder nach `docs/img/`.
- **Aufwand:** S–M. **Risiko:** keins für Nutzer; die lokale Testpflicht bleibt.
- **Test:** Workflow-Lauf; absichtlich falsche Version in `sw.js` muss den Deploy stoppen.

### P2-5 `js/app.js` ist zu groß und trägt zu viele Verantwortungen

- **Stelle:** `js/app.js` (2162 Zeilen): Zustand/Settings 31–72, Kamera 101–121, Animationen 123–263, Gesten
  265–325, Referenzverwaltung 391–507, CPU-Pool 509–554, Jobs/Ebenen 556–815, Nachrechnung 817–889, Scheduler
  891–1170, Tempo-Bremse 1172–1191, Legacy 1193–1243, 3D-Zustand 1314–1497, Flug 1499–1807, Buddhabrot 1808–1829,
  URL 1846–1893, Hauptschleife 1895–1952, API 2019–2159. Größte Funktionen: `schedule` (979–1075, ~100 Zeilen,
  sechs Verzweigungsebenen), `flyEdgeSteer` (1685–1782), `planPreview` (1086–1170), `pruneLayers` (768–815).
- **Beleg:** Neun modulweite Zustandsobjekte (`S, RC, REF, V3, FLY, GOV, PF, CV, stats`) werden aus allen Bereichen
  beschrieben; z. B. hängt der Flug an `RC.dtEMA`, `GOV.g`, `V3.probe`, `T3.lastCam`. Die drei Fehler P1-1, P2-1,
  P2-2 sind genau solche Kopplungen zwischen Bereichen, die niemand mehr überblickt.
- **Umbau:** Schnitt in IIFE-Module nach dem Muster von `three.js` (`create(ctx)` mit explizitem Kontext):
  `js/url-state.js`, `js/cpu-pool.js` (Pool + Nachrechnung), `js/refs.js` (Referenz/BLA), `js/layers.js`
  (Ebenen, Abdeckung, Aufräumen), `js/flight.js` (Flug + Sonde), zuletzt `js/scheduler.js`. Keine Umbenennung,
  keine Logikänderung; `sw.js`-Precache, `index.html` und `test_release.py` je Schritt nachziehen.
- **Aufwand:** L (mechanisch, aber viele Schritte). **Risiko:** mittel; abgesichert durch Pixelgleichheit
  (`readFront` an drei Ansichten vor/nach jedem Schritt) und die bestehende E2E-Suite.

### P2-6 29 URL-Schalter und Legacy-Pfade verdoppeln den Zustandsraum und blähen die Shader auf

- **Stelle:** `js/app.js:569-579, 1193-1243` (`?blend=0`: Scheduler und Bildaufbau 5.0.1), `js/shaders.js:688-700,
  817-823` (`u_legacy`), `js/three.js:324, 351-353, 400-407, 413` (`u_smooth == 0`: Verhalten 6.0), Flug 6.1
  (`?flyedge=0`), 6.4.0 (`?flyhold=0`), dazu `recon, predict, strips, prefetch, over, overmove, maxdiv, fadems,
  feather, gov, govk, govmin, de, dew, flycap`.
- **Beleg:** Die Vergleichsmessungen sind in den Berichten dokumentiert; die alten Pfade werden nur noch von fünf
  Tests als A/B-Referenz angefasst (`test_blend`: `blend=0`, `gov=0`; `test_smooth`: `aa=0`; `test_v62`/`measure_fly`:
  `flyedge=0`; `test_fly64`: `flyhold=0`). Kombinationen sind ungetestet. Der Gelände-Shader trägt beide
  Ufer-/Wasser-Varianten – nach der 6.3-Lehre (Übersetzungszeit unter Direct3D) ist jede tote Verzweigung teuer.
- **Umbau:** Behalten: Test-/Diagnoseschalter (`nosw, noanim, renderer, s3d, fpscap, prof, inflight, nobla,
  nowarm`). Entfernen samt Code: `blend`, `recon`, `predict`, `strips`, `prefetch`, `over*`, `maxdiv`, `fadems`,
  `feather`, `aa=0`/`de=0`/`dew`, `flyedge`, `flyhold`, `flycap`, `gov*`; die betroffenen Tests verlieren nur ihren
  A/B-Teil (Pixelgleichheit gegen eine abgelegte Referenz statt gegen 5.0.1).
- **Aufwand:** M. **Risiko:** mittel (Testanpassung); Produktverhalten unverändert, da nur die Standardpfade bleiben.

### P2-7 2D-Shader-Varianten werden noch blockierend übersetzt

- **Stelle:** `js/renderer.js:270-271` (`drawCompute` → `program()` synchron), `:255` (nur die Bunt-Variante nutzt
  `programReady`), `:627-630` (`selfTest` übersetzt beim Start drei Programme synchron).
- **Beleg:** Erster Wechsel auf Burning Ship/Tricorn/z³/Julia, erste finale Stufe (Variante mit Fehlerschätzung),
  Umschalten von „Menge glatt“ – jede dieser Übersetzungen steht im Frame. 6.3 hat für 3D 1,35 s (M1) bzw. Sekunden
  (Windows/D3D) gemessen; die 2D-Varianten mit BLA sind kleiner, aber dieselbe Mechanik.
- **Umbau:** Alle Rechen-Varianten über `R.programReady` anfordern (Job ruht, Vorschau bleibt stehen – genau wie heute
  bei Bunt); nach der ersten Vorschau die `err`/`de`-Variante der aktuellen Formel vorwärmen.
- **Aufwand:** S. **Risiko:** gering. **Test:** Long-Task-Messung bei Formelwechsel nach dem Muster von
  `tests/measure_3d_start.py` mit simuliertem langsamem Treiber.

### P2-8 CPU-Jobs lassen sich in den Workern nicht abbrechen

- **Stelle:** `js/app.js:591-600` (`cancelJob` leert nur die Main-Thread-Warteschlange), `:546` (zwei Kacheln je Worker
  in Arbeit), `js/tile-worker.js:23-46` (keine Abbruchprüfung).
- **Beleg:** Bei Zoom > 10³⁰ oder Rechenweg „CPU“ rechnen bis zu 14 Kacheln à 64² Pixel × 30 000 Iterationen zu
  Ende, nachdem der Nutzer weitergezoomt hat – Akku und Verzögerung des nächsten Jobs.
- **Umbau:** In Bewegung nur eine Kachel je Worker in Arbeit; Kachelgröße an `maxIter` koppeln
  (Budget Pixel × Iterationen); optional Abbruch-Prüfung zwischen Kachelzeilen über eine `cancel`-Nachricht ist nicht
  möglich (Worker verarbeitet Nachrichten erst nach der Kachel) – daher kleinere Einheiten.
- **Aufwand:** S. **Risiko:** gering (Durchsatz im Stillstand unverändert, messbar mit `bench_compare.py`).

### P2-9 Testlücken an kritischen Stellen; alles hängt am Browser

- **Stelle:** `tests/run_all.sh` (13 Läufe, 12 davon Playwright), kein `tests/unit/`.
- **Beleg:** Keine Unit-Tests für `hp.js`, `gestures.js` (P1-4 wäre in 20 Zeilen Node aufgefallen), die generische
  Perturbation für Formel 2/3/4 (`perturbPixel`, nur E2E), das Worker-Protokoll (P2-2); kein Test für Kontextverlust
  (P1-3) und Update-Übergang (P2-1); `test_gestures.py` prüft den Zwei-Finger-Tipp ohne `touchMove`.
- **Umbau:** `tests/unit/*.js` mit purem Node (keine Abhängigkeiten): hp-Roundtrips (Anhang A), Gesten-Automat,
  Formel-Parität Perturbation vs. direkt bei Zoom 10³ (billig), Orbit-Worker-Protokoll mit Fake-`self`;
  `node tests/unit/run.js` in `run_all.sh` und ins CI (P2-4).
- **Aufwand:** M. **Risiko:** keins.

---

## 4. Befunde P3 (Kosmetik, kleine Robustheit)

- **P3-1 Toter Zustand:** `tour` (`js/app.js:127, 328, 338, 340` – gesetzt, nie gelesen), `RC.timeToFull`,
  `RC.lastKeyFull` (`:583`), `RC.list` (`:1297, :1447` – nur zugewiesen), `V3.settleT` (`:1320`), `FLY.steerBase`,
  `FLY.t0` (`:1322`), `stats.lastRef` (`:413`). Aufwand S.
- **P3-2 Veraltete Kommentare:** `js/app.js:580` „Ebenen im Display-Pass (6)“ – `NL` ist 8 seit 5.1;
  `:585` „4 B/Pixel“ – seit 6.1 sind es 5 B. Aufwand S.
- **P3-3 GLSL `palette()` dreifach** (`js/shaders.js:538, 851, 913`); Bulb und Buddhabrot könnten `PAL_GLSL` nutzen
  (sie brauchen dann die `u_formula`/`u_maxIter`-Uniforms – oder `palette()` wird in einen eigenen Block gezogen).
  Aufwand S.
- **P3-4 Übersetzung:** `fr` und `pt` fehlt `help_tricorn` (Rückfall Englisch). Aufwand S.
- **P3-5 Deeplink-Robustheit:** `js/app.js:1873` begrenzt `it` nur nach unten (`changeIter` deckelt bei 500 000,
  `:363`); ein Link mit `it=99999999` erzeugt GPU-Häppchen von Minuten → Windows-Watchdog (2 s) → Kontextverlust.
  `HP.fromString('1,5')` (Komma) liefert still `0` → Ansicht springt zum Ursprung. Oben deckeln, Komma als Punkt
  lesen. Aufwand S.
- **P3-6 Unbegrenzt wachsende Zeiten:** `S.time`, `S.cycle` (`js/app.js:1909-1910`) wachsen linear; `u_cycle` wird
  im Shader als f32 mit `fract()` benutzt – nach ~1 Tag Dauerbetrieb (≈ 13 000) liegt die Auflösung bei 10⁻³ →
  Farbbänder. Modulo einer Periode (z. B. 1024) ändert nichts am Bild. Aufwand S.
- **P3-7 Vollbild-Knopf auf iPhone** (`js/ui.js:459-463`): `requestFullscreen` gibt es dort nicht, der Knopf tut
  stumm nichts → bei `!document.fullscreenEnabled` ausblenden. Aufwand S.
- **P3-8 Orte-Vorschaubild in 3D** (`js/ui.js:416`): `presentNow()` zeichnet das 2D-Bild über die 3D-Szene;
  `captureBlob` (`js/app.js:1990`) macht es richtig → `A.snapshot()` verwenden. Aufwand S.
- **P3-9 Orbit-Worker-Fehler ohne Rückhaltung** (`js/app.js:396`): nach `error` wird dieselbe Anfrage im nächsten
  Frame erneut gesendet (Konsole läuft voll, Worker rechnet dauernd). Kurze Sperre je Signatur. Aufwand S.
- **P3-10 `R.info()` alle 200 ms** (`js/ui.js:66`, `js/renderer.js:620-624`): `getExtension` bei offenem
  „Mehr“-Tab in jeder HUD-Aktualisierung → einmal cachen. Aufwand S.
- **P3-11 Repo-Hygiene:** 214 Screenshots (83 MB) getrackt, `.git` 313 MB durch mehrfach überschriebene PNGs;
  Messblätter gehören nicht ins Repo (oder Git LFS); README-Bilder nach `docs/img/`. Aufwand S–M.
- **P3-12 Version an 20 Stellen** (`index.html` 16×, Manifest 3×, `sw.js`, `js/app.js`): `tools/bump_version.py`
  plus statischer Check (P2-4). Aufwand S.
- **P3-13 Display-Shader belegt alle 16 Fragment-Sampler** (`js/shaders.js:536, 630-631`: `NL = 8` × 2) – exakt das
  WebGL2-Minimum (Safari meldet 16), null Reserve. Mit `NL = 6` (3D nutzt ohnehin 6, 2D zeigt selten mehr als 5)
  sinkt auch der Speicher (P2-3). Aufwand S, aber Verhaltensänderung → eigener Schritt mit Messung.
- **P3-14 Farbanimation zeichnet im Leerlauf dauerhaft mit voller Bildrate** (`js/app.js:1294-1298`, Standard
  an): Akku. Option: 30 Bilder/s für die Animation oder Pause nach Minuten ohne Eingabe. Das ist eine bewusste
  Produktentscheidung, kein Fehler – nur als Hinweis.

---

## 5. Offen (braucht Browser oder Gerät)

- E2E-Suite (`tests/run_all.sh`) nicht gelaufen (Spur ohne Browser). Letzte eingecheckte Wahrheitstests sind vom
  05.10. (6.4.0) und grün.
- iPhone: `KHR_parallel_shader_compile` fehlt in Safari → die Häppchen-Übersetzung aus 6.3 blockiert dort pro
  Schritt (Vertex, Fragment, Link) so lange, wie Metal braucht; messen (`measure_3d_start.py`-Muster).
- iPhone/Android: Speicherverbrauch in 3D bei „Ausgewogen“ und „Maximal“ (P2-3) und Kontextverlust (P1-3) auf einem
  echten Gerät nachstellen (App-Wechsel, mehrere Tabs).
- Zwei-Finger-Tipp (P1-4) auf echter Hardware vor/nach der Korrektur zählen (10 Versuche).

---

## 6. Umbauplan (kleine, einzeln testbare Schritte)

Reihenfolge: erst das Sicherheitsnetz, dann die Fehler, dann Robustheit, dann Aufräumen, zuletzt der Schnitt von
`app.js`. Jeder Schritt ist ein eigener Commit mit grünem Test.

**Phase 0 – Sicherheitsnetz (P2-9, P2-4 statisch)**
1. `tests/unit/hp.test.js`, `gestures.test.js`, `core-formulas.test.js`, `orbit-worker.test.js`; `tests/unit/run.js`
   (purer Node). Test: `node tests/unit/run.js` grün; `run_all.sh` ruft ihn als ersten Lauf.
2. `tests/test_snapshot.py`: `readFront` an drei Ansichten (2D direkt, 2D Perturbation 10⁹, 3D-Argumente `args3d`)
   als Referenz ablegen; Vergleich bitgleich. Dient allen folgenden Schritten als Regressionsgitter.
3. `tools/check_release.py` (statischer Teil von `test_release.py`, zusätzlich Precache ⊇ alle Skripte/Styles/Icons
   aus `index.html`); `check`-Job im Workflow vor `deploy`.

**Phase 1 – Fehler (P1)**
4. P1-4 Gesten: Ablagepunkt je Zeiger. Test: Unit-Test (zwei Szenarien) + `test_gestures.py` mit `touchMove`.
5. P1-1 Nachrechnung bei Referenzwechsel abbrechen. Test: Hook `testNewRef()` + E2E `done` ≤ 15 s.
6. P1-3 Kontextverlust: `T3.reset()`, `initGL`-Handles, `onRestored`. Test: `test_context_loss.py` (2D + 3D).
7. P1-2 Shader-Fehler abfangen + Rückfall. Test: E2E mit scheiterndem `compileShader` für eine Variante.

**Phase 2 – Robustheit (P2)**
8. P2-1 Pool beim Start, `Worker.onerror`, `skipWaiting` raus. Test: `test_release.py` erweitert.
9. P2-2 Worker-Protokoll (`ignored`-Antwort, `blaPending` zurücksetzen). Test: Unit-Test Protokoll + E2E Zoom
   1× → 7× über die Referenz: finales Bild kommt.
10. P2-7 `programReady` für alle Rechen-Varianten. Test: Long-Task-Messung Formelwechsel.
11. P2-8 Eine Kachel je Worker in Bewegung, Kachelbudget nach `maxIter`. Test: `bench_compare.py` Stillstand
    unverändert.
12. P2-3 Speicher: `MAXL` in 3D = 6, Kantenlänge des 3D-Rechenpuffers deckeln, belegte Bytes mitzählen.
    Test: `layerInfo().pool.usedMB` nach Flug; `test_3d`, `test_blend` grün; Snapshot-Test 2D bitgleich.

**Phase 3 – Aufräumen (P2-6, P3)**
13. P3-1/P3-2 toter Zustand und Kommentare; P3-5 Deeplink-Deckel; P3-6 Zeit-Modulo; P3-7/P3-8/P3-9/P3-10.
    Test: Unit + Snapshot bitgleich.
14. P2-6 Legacy-Pfade und alte A/B-Schalter entfernen (App, Display-Shader, Gelände-Shader), Tests anpassen.
    Test: ganze Suite grün, Snapshot bitgleich, `compare_3d_shader.py` ≥ 99,99 % ≤ 1/255.
15. P3-3 `palette()` zusammenlegen; P3-4 Übersetzung. Test: Snapshot (Bulb/Buddha per Screenshot-Hash).

**Phase 4 – Schnitt von `app.js` (P2-5), modulweise, je ein Commit**
16. `js/url-state.js` (stateURL/readURL/syncURL, `setColParam`). 17. `js/cpu-pool.js` (Pool, Feed, Nachrechnung).
18. `js/refs.js` (Referenz, BLA, `refUsable`, `ensureRef`). 19. `js/layers.js` (Ebenen, `coverage`, `orderLayers`,
    `pruneLayers`). 20. `js/flight.js` (Flug, Sonde, Lenkung). 21. `js/scheduler.js` (`schedule`, `planPreview`,
    Vorausrechnen, Tempo-Bremse). Jeder Schritt: `sw.js` + `index.html` + `test_release` nachziehen, Suite grün,
    Snapshot bitgleich.

**Phase 5 – Deploy/Repo (P2-4 Rest, P3-11, P3-12)**
22. Artefakt nur aus Laufzeitdateien, README-Bilder nach `docs/img/`, `tools/bump_version.py`. Test: Workflow-Lauf,
    Live-Seite zeigt die Version.

---

## Anhang A – Belege (ausgeführt am 2026-10-05, Node 24)

Gesten-Nachbau (Auszug):
```
Zwei-Finger-Tipp ohne pointermove von Finger 2        -> twoFingerTap
Zwei-Finger-Tipp, Finger 2 sendet 1 pointermove an Ort -> end
```

hp.js-Randfälle: `fromString/toString` (6 Werte), `fromNumber/toNumber` (0.1, −0.5, 1e−300, 5e−324, 123456.789,
−1e200), `roundShift(−3n, 1) = −1n`, `roundShift(3n, 1) = 2n`, `mulNumber` (positiv/negativ), `toString(−1e−7, 3)
= "0.000"`, `digitsForZoom(1e9) = 14`, `fromString("abc") = 0n`, `fromString("1,5") = 0n` – alle wie erwartet.

Node-Mathetest: `{"view":"seahorse_1e7","maxIter":2450,"method":"center","bla":{"okPct":100,"maxd":0.026},
"noBla":{"okPct":100}} OK · ALL PASS`.
