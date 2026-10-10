# Fraktale 6.9.0 – Außen: Palette, Grenznah, Schwarz (+ langsamere Farbanimation)

Wunsch Peter (10.10.2026): „mehr Optionen für Farbe der Menge. Option Unendlichkeit schwarz (=invertieren) oder nur grenznahe
Farben. OPTIONAL langsamere Farbenspiele.“

## Umsetzung
- **Wahl „Außen“** (Farben-Tab, direkt unter „Farbe der Menge“): Palette (Standard, bitgleich zu 6.8.1) · Grenznah · Schwarz.
- **Grenznah (2D):** Display-Pass `js/shaders.js`, Faktor `g_outK` je Bildpunkt auf die Außenfarbe (auch auf das Relief-Glanzlicht):
  `exp2(−2·d / W)` mit d = bilinear interpolierte Distanzschätzung in Zielpixeln (`o_de`, 6.1) und W = Saumbreite in Zielpixeln
  (CSS-Pixel × Gerätepixel; im Screenshot × Bildgröße/Bildschirm). Die 8-bit-Distanz reicht bis ~245 Pufferpixel; zwischen
  120 und 240 Pufferpixeln blendet der Rest unmerklich aus (kein Ring). Die Distanzschätzung wird bei Grenznah auch gerechnet,
  wenn „Menge glatt“ aus ist (`deActive` = mitrechnen, `deMaskOn` = Mengen-Saum).
- **Schwarz:** `g_outK = 0`. Schwarze bzw. fast schwarze Menge (Helligkeit < 0,06) → automatisch Bunt + Hinweis, zurück auf
  Palette/Grenznah stellt die alte Mengenfarbe her; schwarze Menge bei „Außen Schwarz“ wählen → Außen zurück auf Palette.
  **Entscheidung dritter Bunt-Modus:** nicht nötig – im Bildvergleich (Blätter unten) wirken Inseln (Kuppel-Licht je Knospe)
  und Ringe (Verlauf zum Kern) auf Schwarz plastisch, die Menge ist nicht flach.
- **3D:** erster Versuch nach relativer Geländehöhe („Täler dunkel, Grate farbig“) verworfen – im Gesamtbild liegt die weite
  Ebene nach der Histogramm-Entzerrung oben (Messhilfe `u_dbg = 6`: relative Höhe ≈ 0,85), sie blieb bunt. Jetzt trägt die
  Höhentextur im bisher ungenutzten A-Kanal den Randabstand (log2 Pufferpixel, 2×2 gemittelt, mit Mipmaps); das Gelände
  dunkelt nach derselben Formel wie 2D ab → Grate und Ufer leuchten, Ebenen und Täler dunkel. Schwarz = dunkles Gestein,
  Seen (Menge) in den Bunt-Farben. Alpin-Look: ohne Wirkung (Hinweis).
- **Newton, Mandelbulb, Buddhabrot:** Wahl gesperrt mit Hinweis (keine Menge/Distanz im Sinne von 2D).
- **Farbanimation:** Regler 0..1 → Tempo 0,002·400^x Runden/s (0,002–0,8), Standard 0,15 unverändert; Anzeige „1 Runde in 6,7 s“
  bis „1 Runde in 8,3 min“.
- Link: `ou=e<Saum px>` / `ou=k`, fehlt = Palette (alte Links unverändert); localStorage `outMode`, `edgeW`; Orte speichern `out`.
  Texte DE/EN/HU/ES/FR/PT/ZH/JA/KO.

## Prüfung
- Blätter (Palette · Grenznah · Schwarz+Inseln · Schwarz+Ringe × Gesamtbild, Randpunkt 10⁶, Deep Zoom 10¹² über die CPU,
  Julia c = −1 + 0,1i): `tests/shots/v69/blatt_2d_hoch.jpg`, `blatt_2d_quer.jpg`; 3D: `blatt_3d_hoch_pal-edge-black_inseln.jpg`,
  Saumbreiten 4/16/60 px: `blatt_3d_hoch_edge-edge_4-edge_60.jpg` (Skript `tests/shots_v69.py`). Selbst angesehen: Grenznah
  ergibt leuchtende Filamente auf Schwarz ohne Kanten; im Deep Zoom, wo fast alles randnah ist, bleibt das Bild bunt und nur
  die ruhigen Flächen dunkeln ab. Schwarz an einer Stelle ohne sichtbare Menge (Deep Zoom 10¹²) ist folgerichtig ganz schwarz.
- Screenshot-Kacheln (`tests/test_shot.py`, neu 3 Fälle): Grenznah Mandelbrot 3·10⁹ (GPU), 10³⁴ (CPU), Julia – je 0
  abweichende Werte gegen das Bild aus einem Stück.
- `tests/test_v69.py`: Links, Automatik Bunt, Grenznah mit/ohne „Menge glatt“ (Ecke weit draußen 0,0 gegen 96,8 bei Palette,
  Saum 80 px heller als 4 px), Sperre Newton/Mandelbulb, Tempo-Grenzen und Speichern.
- Kosten (M1, Pixel-7-Ansicht, Anzeige-Pass GPU-Zeit, Median aus 5): Palette 2,85–3,02 ms, Grenznah 2,83–3,04 ms, Schwarz
  (= Bunt) 2,86–4,16 ms. 2D-Flug Mittelklasse-Profil (CPU ×4, sichtbares Fenster, 30 s ab Seepferdchen-Tal): hoch
  54,8 / 53,4 / 54,4, quer 54,4 / 56,0 / 54,7 Bilder/s (Palette/Grenznah/Schwarz) – im Rauschen.
- Bestehende Tests grün: unit, node_core, test_ui, test_features, test_deeplink, test_v62, test_v63, test_v64, test_3d,
  test_smooth, test_blend, test_shader_fail, test_p3, test_shot.

## Grenzen
- Saumbreite höchstens 80 px: die Distanz liegt als 8 bit bis ~245 Pufferpixel vor.
- 3D-Grenznah nutzt den Randabstand der Höhentextur (halbe Auflösung, gemittelt) – etwas weicher als in 2D.
