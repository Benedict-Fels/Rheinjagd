# Rheinjagd

Werkzeug für **Jet Lag: Hide and Seek** in Köln, als Web-App, die man auf dem
Handy installieren kann. Die Jäger kreisen damit das Versteck ein: Jede
beantwortete Frage schließt Stationen aus, die Karte zeigt, was noch möglich
ist. Der Verstecker sieht für jede Frage die wahre Antwort von seinem Versteck
aus.

## Was die App kann

- **Fragen:** Matching (Rheinseite, Stadtbezirk, Stadtteil, Linie,
  Namenslänge der Station, nächster Ort einer Kategorie), Measuring (Rhein,
  Bezirks-/Stadtteilgrenze, Schnellfahrstrecke, Orte), Radar
  (0,5–16 km), Thermometer (1 / 5 / 16 km), Tentakel (1,5 km).
- **Stationsmodell:** Verstecke sind die 211 Stationen (KVB-Stadtbahn,
  S-Bahn, Regionalbahn) mit einstellbarem Radius (Standard 500 m). Eine
  Station fällt ganz oder gar nicht; liegt eine Grenze näher als 10 m an ihr,
  bleibt sie stehen und wird als „knapp“ gemeldet.
- **Wirkung je Frage:** Anteil der Stationen, die im ungünstigsten Fall
  wegfallen (abschaltbar).
- **Endgame:** Nur noch eine Zone; Fragen beziehen sich auf die genaue
  Position und schneiden die Zone entlang ihrer wahren Grenze zu.
- **Karte:** Linien in KVB-Farben, Stations- und Versteckzonen, Grenzen,
  Orte; Stationen von Hand ausschließen, „unwahrscheinlich“ markieren,
  „trotzdem möglich lassen“.
- **Teilen:** Positions-Links zwischen den Gruppen, Live-Standort.
- **Offline:** Installierbar (PWA). Die App selbst und bereits angesehene
  Kartenkacheln liegen auf dem Handy.

## Projektaufbau

| Pfad | Inhalt |
|---|---|
| `src/head.html` | Titel, Leaflet-Einbindung, gesamtes CSS |
| `src/body.html` | Seitengerüst |
| `src/app.js` | die ganze App-Logik |
| `data/*.json` | Rohdaten aus OpenStreetMap + `koeln.json` (gebaut) |
| `build-data.js` | Rohdaten → `data/koeln.json` (Kuration, Linien, Spielgebiet) |
| `build-boundaries.js` | Verwaltungsgrenzen in Bogenform (von `build-data.js` benutzt) |
| `build.js` | `src/` + `koeln.json` → `index.html` |
| `index.html` | die fertige Seite (wird gebaut, nicht von Hand ändern) |
| `vendor/leaflet-1.9.4.js` | Kartenbibliothek Leaflet, unverändert |
| `sw.js` | Service Worker: Offline-Start, Cache für Bibliothek und Kacheln |
| `manifest.webmanifest`, `icon*` | Installation als App |
| `OVERPASS.md` | woher die Daten kommen und wie man sie neu holt |

## Bauen

Node.js genügt, es gibt keine Abhängigkeiten.

```sh
node build-data.js   # nur nötig, wenn sich etwas in data/ oder build-data.js ändert
node build.js        # baut index.html
```

`build-data.js` muss bei unveränderten Rohdaten `data/koeln.json`
byte-identisch reproduzieren — vor Änderungen am Build einmal prüfen.

## Hosting

Die Seite läuft auf GitHub Pages. Hochzuladen sind `index.html`, `sw.js`,
`manifest.webmanifest`, die Icons und der Ordner `vendor/`. Der Service Worker
wirkt nur über `https` (oder `localhost`); per `file://` geöffnet läuft die
App auch, nur ohne Offline-Funktion.

## Daten aktualisieren

Siehe `OVERPASS.md`: Abfragen für Grenzen, Rhein, Orte, Stationen, Linien,
Flughäfen und Schnellfahrstrecken, dazu die Kurationsregeln.

## Rechtliches

- Kartendaten und Kacheln © OpenStreetMap-Mitwirkende (ODbL). Die Kacheln von
  `tile.openstreetmap.org` dürfen nur beim normalen Ansehen geladen werden —
  kein Vorab- oder Massen-Download.
- Leaflet © Vladimir Agafonkin u. a., BSD-2-Clause.
