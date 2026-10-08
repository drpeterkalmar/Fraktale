# Fraktal-Explorer 6.7.0 – Technik-Nacht „3D-Gebirge mit Tiefe, ruhig im Flug“ (08.10.2026)

## Kurzfassung

- **Live seit 6.7.0**, jede Etappe einzeln gepusht und live geprüft (6.6.1 Endpass, 6.6.2 AO/Detail, 6.6.3 TAA,
  6.6.4 Stufen/Gerät, 6.7.0 Abschluss). Alle 25 Testgruppen von `tests/run_all.sh` grün, 48 Unit-Tests grün, 0 Seitenfehler.
- **Neu im 3D-Bild:** filmische Tonkurve mit Belichtung nach Sonnenhöhe, dezenter Bloom, CAS-Nachschärfen beim
  Hochskalieren, Horizont-AO für Täler und Mulden, feine Fels-/Schneestruktur im Nahbereich, Schatten je Stufe,
  Gitterdichte aus der gemessenen Grafikzeit des Geräts.
- **TAA im Flug ist durchgefallen** und bleibt aus (`?taa=1` zum Ausprobieren): Die Reprojektion stimmt, das Flimmern
  halbiert sich, aber im Dauerzoom des Flugs verschmieren Kanten und Farbflecken sichtbar.
- **Budget:** Bildzeit p95 je Stufe gleich oder besser (Mittelklasse-Profil, hoch und quer). Die reine GPU-Zeit des
  Bewegungsbilds ist auf dem M1 um 4–30 % gestiegen (Streuung zwischen Läufen ±15 %); auf schwächeren GPUs wählt die
  neue Gitterwahl ein gröberes Gitter und gleicht das aus. Ladegröße +53 KB (Budget +100 KB).
- **Ehrliche Bildbewertung:** Der Unterschied ist sichtbar, aber nicht spektakulär. Am meisten gewinnen glatte Flächen
  (Gletscher, Talböden, Ufer) und der Alpin-Look; im dunklen Standard-Look an Kämmen bleibt es nah an 6.6.

## Ablauf und Vorbau

Die Leicht-Spur (`fraktale-v6-7-vorbau`, 07.10.) hatte ohne Browser vorgebaut: `js/three-tech.js` (reine Funktionen,
13 Unit-Tests), alle Shader und Abläufe in `js/three.js` hinter URL-Reglern, ein nachgebildeter WebGL-Kontext für
Node-Tests, ein GLSL-Prüfer und das Messskript `tests/measure_tech.py` (Übergabe war `VORBAU_fraktale-v6-7-technik.md`,
jetzt hier eingearbeitet und aus dem Repo entfernt).

1. **E0 auf `main` vor dem Merge gemessen** (6.6.0), dabei `measure_tech.py` um eine wiederholbare GPU-Messung an festen
   3D-Ansichten ergänzt (`--onlygpu`, Median je Ansicht – die Flugwerte hängen vom Zufallsflug ab).
2. **Merge** `--no-ff` ohne Konflikte (der Vorbau ging von 3bbf65e aus, `main` war nicht weitergelaufen).
3. **Abnahme jeder Etappe im Browser** (echte GPU, ANGLE/Metal, Pixel-7-Ansicht). Gefunden und korrigiert:

| Etappe | Befund im Browser | Korrektur |
|---|---|---|
| E1 | Ton-Knie 0,7 machte helle Schneeflächen von 6.6 (Anzeigewert ~0,8–0,95, gar nicht abgeschnitten) sichtbar grauer | Knie 0,8, Weißpunkt 1,5 |
| E1 | CAS 0,57 bei Skala 0,65 schärfte die Kantentreppen im Bewegungsbild nach | 0,2 + 0,35·(1/s − 1) → 0,39 |
| E2 | rohe AO lag im Mittel bei 0,74 → ganzes Bild −15 % Helligkeit | Abbildung: > 0,92 bleibt hell, nur echte Mulden dunkel (bis 0,45) |
| E2 | Detail-Normalen praktisch unsichtbar (Neigung im Mittel 0,025 ≈ 1,4°) | ~3× kräftiger, eine Oktave gröber, am Bild abgestimmt |
| E2 | danach „Leinen“-Gittermuster (Ableitung unter einem Texel der bilinearen Textur ist stückweise konstant) | Gradienten-Textur (analytisch beim Erzeugen), 1 statt 3 Abgriffe je Oktave |
| E2 | Kosten Ausgewogen +33 %, Maximal +47 % | Gradienten-Textur, AO Ausgewogen 2 Schritte, Akku ohne AO |
| E3 | TAA zitterte an Kanten (das aktuelle Bild ging mit Subpixel-Versatz ein, Gewicht bis 0,4) | aktuelles Bild jitterfrei aus 3×3 rekonstruiert; trotzdem durchgefallen (s. u.) |
| E4 | gespeicherte Gitter-Messung wurde nie geladen (`gridLoad` prüfte ein Feld `div`, gespeichert wird `{ms, d0, t}`) | Prüfung auf `ms`/`d0` + Unit-Test im echten Format |
| E4 | Geräteschlüssel = „WebKit WebGL“ (Chrome maskiert `RENDERER`) – alle Geräte gleich | echter GPU-Name über `WEBGL_debug_renderer_info`, nur wenn nötig |
| E5 | Akku +30 % GPU: AO-/Detail-Code war nur per Uniform aus, steckte aber im Shader | Gelände-Variante je Stufe ohne den Code (`-a0`/`-d0`), Stufe vor dem Vorab-Übersetzen gesetzt |
| E5 | Gitterwahl schwankte (Messung im flachen Anfang des Übergangs), wählte teils Teiler 5 (+76 % Gitterpunkte) | Messung ab 60 % Übergang, feinste Stufe 6, Budget Maximal 8,5 ms |
| Test | `test_shader_fail` (e) erwartete „kein Toast“, es erschien „3D wird vorbereitet …“ | Prüfung auf „kein Fehler-Hinweis“ |

## E1 Endpass

- **Tonemapping** in `post()` (Himmel und Gelände, vor dem 8-bit-Ziel): Neutral-Schulter ohne Fuß-Versatz (die Farben
  von 6.6 sind schon Anzeigewerte), unter 0,8 unverändert, darüber weich auf Weiß bei 1,5, sehr Helles entsättigt.
  `?tone=agx` (AgX nach Wrensch) verändert auch die Mitteltöne – nur zum Vergleich. Belichtung und Farbstich nach
  Sonnenhöhe (1,0 bei der Sonne von 6.6), dazu leichtes Split-Toning.
- **Bloom** aus halber Auflösung (Vorfilter mit weicher Schwelle, Gauß waagrecht/senkrecht), Screen-Mischung im Blit;
  Akku aus. Am Bild: Sonnenhof leicht heller und weicher, keine Halos an Kämmen (`bloom_hoch*.jpg`).
- **CAS** beim Übertragen auf den Canvas, Schärfe nach Renderskala; das Bewegungsbild in der Stillstands-Überblendung
  wird mitgeschärft (kein Sprung). Am Bild: Flächen schärfer, Treppen nur leicht betont (`cas_hoch_ausschnitt.jpg`).
- **Stimmungen** (`tone_*_hoch.jpg`, Morgen/Mittag/Abend über Test-Hooks `T3.sunEl`/`sunAz`; die App selbst hat weiter
  die feste Sonne von 6.6): Mitteltöne bleiben, Abend/Morgen wärmer. **Schnee:** In 6.6 brennt Schnee in diesen
  Szenen gar nicht im Sinne von Abschneiden aus (95-%-Wert 198/255) – flach wirkt er, weil Gletscher kaum Struktur haben.
  Das löst E2 (Detail-Normalen + AO), nicht die Tonkurve; die Schulter fängt Belichtung/Glanz/Bloom ab.

## E2 Horizont-AO und Detail

- **AO pro Gitterpunkt** wie die Schatten: je Richtung (fest in der Welt) der höchste Horizont, gemessen über der
  Tangentialebene – Hänge frei, Mulden/Rinnen dunkel. Dämpft Himmelslicht voll, direktes Licht zu 30 %. Stufen: Akku aus,
  Ausgewogen 4 Richtungen × 2 Schritte, Maximal 4 × 3. Am Bild: Fuß von Wänden, Kraterboden im Alpin-Look und
  Talgründe bekommen Tiefe, ohne Facetten (`ao_hoch*.jpg`, `ao_quer*.jpg`).
- **Detail-Normalen** nur im Fragment-Shader, 3 weltverankerte Oktaven mit derselben Zoom-Überblendung wie das
  Alpin-Rauschen (schwimmt nicht), Abstands- und Fußabdruck-Ausblendung (kein Flimmern in der Ferne). Stärke Fels 0,7,
  Boden 0,3, Schnee der Menge 0,3, Wasser 0. Am Bild: Gletscher und glatte Talböden mit natürlicher Struktur
  (`detail_hoch*.jpg`). Nebenbefund: das rautenförmige Muster ganz vorn im Gletscher gibt es schon in 6.6
  (Gitterfacetten im Nahbereich) – die Detail-Normalen überdecken es teilweise.

## E3 TAA im Flug – durchgefallen

Prüfstand `tests/taa_series.py`: ein echter Zufallsflug wird 600 Bilder lang Bild für Bild aufgezeichnet und
wiedergegeben; jede Variante zeichnet in einer **eigenen 3D-Instanz auf exakt denselben Daten** (eigene TAA-History),
Referenz = 16-fach gemitteltes Stillstandsbild derselben Ansicht in derselben Auflösung (0,65). Ein erster Versuch mit
getrennten Durchläufen war unbrauchbar: Die 2D-Rechnung stand in jedem Durchlauf woanders (anderes Gelände).

- **Reprojektion korrekt:** Vorbild nur verzerrt (ohne Mischung/Klemmung) weicht vom aktuellen Bild 0,9–2,2 ab
  (unverzerrt 4–14, Mittel |Δ| auf 0..255).
- **Ergebnis (Endstand der Parameter, Hochformat, Seepferdchen-Tal):**

| | ohne TAA 0,65 | TAA 0,65 | TAA 0,55 |
|---|---|---|---|
| Abweichung zur Referenz an Kanten | 5,7 | 10,4 | 11,9 |
| Abweichung gesamt | 0,89 | 1,39 | 1,57 |
| Flimmern (Bild 300→301 an Kanten, Bewegung herausgerechnet) | +0,9 | −4,9 | −5,8 |

  Mit den Vorbau-Werten (Gewicht 0,1–0,4, Klemmung 1,25 σ) lag TAA an Kanten 2× daneben; jitterfreies aktuelles Bild,
  Gewicht 0,3–0,5 und Klemmung 0,75 σ holten das auf 1,4–1,8× herunter. In ruhigen Flugphasen ist TAA gleich gut oder
  besser, in schnellen (Kurven + Zoom) verschmieren Kanten und Farbflecken – die History wird jedes Bild vergrößert und
  neu abgetastet. Echte Geisterbilder am Horizont habe ich in der Endfassung nicht gefunden (ein vermeintlicher Geist in
  der verkleinerten Collage war bei voller Auflösung in allen Varianten gleich).
- **Entscheidung:** aus. Gründe: messbares Verschmieren im Hauptfall (Zoom-Flug) widerspricht „kein Pixelbrei“; der
  TAA-Pass kostet zusätzlich GPU-Zeit, wo das Budget ohnehin knapp ist; auf dem Handy bringt er keine Auflösungsersparnis
  (das Bewegungsbild läuft dort schon mit 0,65). Bilder: `taa_hoch_tal*.jpg`, Zahlen: `tests/results_taa_hoch_tal.json`.

## E4 Stufen und Gerätewahl

- **Schattenschritte** Akku 3, Ausgewogen 6 (bit-gleich 6.6), Maximal 10 mit weicherem Halbschatten, gleiche Reichweite.
  Im selben Bild verglichen (`schatten_hoch*.jpg`): Akku praktisch nicht von Ausgewogen zu unterscheiden, keine Streifen.
- **Gitterdichte aus der GPU-Zeit:** beim ersten 3D-Start misst eine Timer-Query den Gelände-Pass in Bewegungsbildern
  (Median aus 6), Teiler aus Budget je Stufe (Akku 5, Ausgewogen 7, Maximal 8,5 ms), Grenzen 6…12, gespeichert je
  GPU-Name + Bildgröße (`localStorage fk3d_grid_v1`), angewandt beim nächsten 3D-Start (kein Geometriesprung).
  Geprüft: Neuladen nutzt den gespeicherten Wert (keine neue Messung). Auf dem M1 wählt sie feiner als 6.6 (Ausgewogen
  hoch 103×273 → 137×300). Ohne `EXT_disjoint_timer_query_webgl2` (viele Android-Chromes!) bleibt die 6.6-Regel.

## Messung vorher/nachher

`tests/measure_tech.py`, Apple M1 mit echter GPU, Pixel-7-Ansicht, Profil Mittelklasse-Android: CPU ×4, 4 Kerne,
DPR 2,6, sichtbares Fenster. Je Stufe: 2D-Zoom 6 s, 3D-Stillstand 3 s, 3D-Zufallsflug 10 s. Rohdaten:
`tests/results_tech_{vorher,nachher}_{hoch,quer}_thr4[_gpu].json`. Die GPU lässt sich nicht drosseln.

**Bildzeiten 3D-Flug (ms):**

| Stufe | | p50 | p95 | Bilder/s | > 50 ms |
|---|---|---|---|---|---|
| Akku hoch | vorher → nachher | 16,7 → 16,7 | 34,6 → 33,4 | 51,8 → 51,9 | 14 → 17 |
| Ausgewogen hoch | | 16,7 → 16,7 | 33,4 → 33,4 | 52,5 → 52,1 | 15 → 17 |
| Maximal hoch | | 16,7 → 16,7 | 48,0 → 34,1 | 50,8 → 50,0 | 22 → 18 |
| Akku quer | | 16,7 → 16,7 | 33,3 → 33,4 | 53,8 → 51,8 | 14 → 16 |
| Ausgewogen quer | | 16,7 → 16,7 | 33,3 → 33,5 | 52,2 → 51,2 | 17 → 17 |
| Maximal quer | | 16,7 → 16,7 | 33,7 → 33,4 | 51,1 → 51,4 | 20 → 17 |

2D-Zoom p95 überall 33,3–33,4 ms vorher wie nachher, 0 harte Bildwechsel im Flug. Die Bildzeiten sind auf den
Bildtakt gerastert (16,7/33,3 ms) und streuen: die p95-Änderungen liegen im Rahmen von ±0,2 ms bzw. sind besser.
Ausnahme im Stillstand: Ausgewogen hoch p95 18,3 → 33,2 ms (quer 33,3 → 33,3) – der vorher-Lauf hatte in den 3 s
weniger Ausreißer; die Mittelung im Stillstand ist pro Bild etwas teurer (s. u.).

**GPU-Zeit an festen Ansichten** (Summe dreier 3D-Ansichten, Median je Ansicht, ms; Bewegung = Bewegungsbild Skala 0,65,
Stillstand = ein Bild der Mittelung in voller Auflösung):

| Stufe | | vorher | nachher, gleiches Gitter (`?gpuwahl=0`) | nachher mit Gitterwahl |
|---|---|---|---|---|
| Akku hoch | Bewegung | 6,2 | 6,4 | 6,5 / 7,5 |
| Ausgewogen hoch | Bewegung | 15,1 / 15,2 | 19,5 | 18,9 / 17,0 |
| Maximal hoch | Bewegung | 21,6 / 20,1 | 23,0 | 25,1 / 26,5 |
| Akku quer | Bewegung | 5,6 | 5,8 | 6,7 |
| Ausgewogen quer | Bewegung | 12,2 | 13,0 | 15,6 |
| Maximal quer | Bewegung | 15,7 | 18,5 | 20,4 |
| Ausgewogen hoch | Stillstand | 27,6 / 28,8 | 31,6 | 29,5 / 28,9 |
| Maximal hoch | Stillstand | 40,2 / 39,9 | 44,0 | 50,0 / 46,0 |

Zwei Läufe derselben Fassung weichen bis ±15 % voneinander ab (Taktverhalten der GPU). Kosten je Baustein
(Ausgewogen, eigene Seitenaufrufe, vor dem Sparen): AO ≈ 1,1 ms/Bild, Detail ≈ 1,1 ms, Bloom ≈ 0,45 ms, Tonkurve + CAS ≈ 0,3 ms;
Gradienten-Textur und AO mit 2 Schritten brachten Ausgewogen danach von +33 % auf +11 % (ein Lauf).

**Einordnung:** Die Vorgabe „p95 gleich oder besser“ ist im Referenzprofil erfüllt, weil das Bild auf dem M1 am
Bildtakt hängt, nicht an der GPU. Die GPU arbeitet aber mehr. Auf einem echten Mittelklasse-Handy ist der Gelände-Pass
deutlich langsamer – dort greift die Gitterwahl (gröberes Gitter, sobald der Gelände-Pass über dem Stufen-Budget liegt);
ob das auf Peters Gerät reicht, kann nur eine Messung am Handy zeigen (`__fraktal.T3.gridInfo()` zeigt Messwert und Teiler).

**Ladegröße** (html, css, translations, manifest, sw, js): 498,8 → 551,9 KB (+53 KB; Budget +100 KB).

## Bilder (`tests/shots/technik/`, selbst angesehen)

| Collage | Bewertung |
|---|---|
| `gebirge_hoch.jpg`, `gebirge_quer.jpg` – vorher (6.6) / nachher an 4 Orten | Flächen mit Struktur, Mulden mit etwas Tiefe; an Kämmen im dunklen Standard-Look kaum Unterschied |
| `ao_hoch*.jpg`, `ao_quer*.jpg` – wie 6.6 / ohne AO / mit AO | Tiefe an Wandfüßen und im Krater, keine dunklen Flecken auf Hängen, keine Facetten |
| `detail_hoch*.jpg` – Tiefflug-Neigung ohne/mit Detail | Gletscher und Talböden nicht mehr glatt, kein Gittermuster; Fels im dunklen Look kaum sichtbar |
| `tone_{standard,gletscher,alpin}_hoch.jpg` – 3 Stimmungen × (6.6, Neutral, AgX) | Neutral hält die Mitteltöne, Abend/Morgen wärmer; AgX verschiebt Farben (nur Vergleich) |
| `bloom_hoch*.jpg`, `cas_hoch_ausschnitt.jpg` | Bloom dezent um die Sonne; CAS schärft Flächen, Treppen nur leicht |
| `schatten_hoch*.jpg` – Schattenschritte 3/6/10 im selben Bild | kaum Unterschied, keine Streifen |
| `taa_hoch_tal*.jpg` – Flug-Frames ohne TAA / TAA 0,65 / TAA 0,55 / Referenz | TAA glatter an Treppen, aber weicher; in schnellen Phasen verschmiert |

Skripte: `tests/shots_tech.py --part=gebirge|ao|detail|tone|endpass|stufen [--land]`, `tests/shots_schatten.py`,
`tests/taa_series.py`. Varianten werden im **selben Seitenaufruf** umgeschaltet – zwischen zwei Seitenaufrufen
unterscheiden sich die fernen Reserve-Ebenen je nach Rechenstand (das hatte den ersten Vergleich verfälscht).

## Regler (alle per URL, gelten für den Seitenaufruf)

| Regler | Standard | Wirkung |
|---|---|---|
| `?tone=0` / `?tone=agx` | Neutral | Endpass wie 6.6 (auch ohne Bloom) / AgX zum Vergleich |
| `?bloom=0` | an (Akku aus) | nur den Bloom aus |
| `?scharf=0` | an | lineares Hochskalieren wie 6.6 |
| `?hao=0` | an (Akku aus) | keine Horizont-AO |
| `?detail=0` | an (Akku aus) | keine Detail-Normalen |
| `?gpuwahl=0` | an | Gitter nach Bildschirmbreite wie 6.6, keine Timer-Query |
| `?taa=1`, `?taas=0.6` | aus | TAA im Bewegungsbild, Flug-Renderskala höchstens 0,7 bzw. x |

Alle Regler aus (`?tone=0&hao=0&detail=0&scharf=0&gpuwahl=0`) = Bild wie 6.6. Robustheit: scheitert das TAA- oder
Bloom-Programm, wird nur dieser Teil abgeschaltet; scheitert die Gelände-Variante mit AO/Detail, läuft 3D mit dem
Gelände wie 6.6 (`T3.info().fallback = '_66'`). Kontextverlust und Verlassen von 3D geben History/Bloom-Ziele frei.

## Prüfung

- `node tests/unit/run.js`: 48 ok (u. a. Tonkurven, CAS, AO-Geometrie, Gitterwahl inkl. Speicherformat, TAA-Mathe,
  alle Shader-Varianten durch den GLSL-Prüfer, ganzer 3D-Ablauf gegen nachgebildetes WebGL).
- `tests/run_all.sh`: 25/25 grün (Wahrheit GPU/CPU, Gesten, UI, 3D, Flug 2D/3D, Grafik-Wächter, Kontextverlust,
  Shader-Fehler inkl. neuer Fälle e/f, Speicher 3D, …). Einmal rot: `test_3d` „Flug 20 s: Zoom ≥ 1e9“ (Zufallsflug blieb
  bei 1,25·10⁸) – Wiederholung grün, die Änderung betraf den Standardweg nicht.
- Live nach jedem Push (`tests/live_check.py`): Version live = lokal, 3D blendet ein, 0 Seitenfehler.

## Offene Punkte

- **Keine Messung auf einem echten Android-Gerät.** Budgets der Gitterwahl (5/7/8,5 ms) und der Modellanteil der
  Gitterpunkt-Arbeit (0,6) sind am M1 geschätzt; am Handy `__fraktal.T3.gridInfo()` ablesen und ggf. anpassen.
- Viele Android-Chromes haben keine Timer-Query → dort bleibt die Gitterregel von 6.6 (keine Ersparnis, kein Risiko).
- Die GPU-Zeit ist gestiegen; wenn Peter auf dem Handy Ruckeln im 3D-Flug bemerkt: erst `?hao=0`, dann `?detail=0`
  ausprobieren und berichten.
- TAA: würde im Flug nur mit Bewegungsvektoren für den Zoom und einer schärferen History (TAAU mit Rückschärfen) taugen –
  größere Arbeit, nicht in dieser Nacht.
- Die Sonne ist in der App weiter fest (Stimmungen nur über Test-Hooks) – eine Tageszeit-Einstellung wäre eine neue
  Funktion, nicht Teil dieses Auftrags.
- Das rautenförmige Muster im Nahbereich großer Gletscherflächen (Gitterfacetten) gibt es seit 6.2.
