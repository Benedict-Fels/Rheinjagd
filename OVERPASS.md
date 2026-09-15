# Rohdaten von OpenStreetMap holen

Die Abfragen laufen auf <https://overpass-turbo.eu> (dort einfügen, *Run*,
dann *Export → GeoJSON* bzw. das JSON aus der Konsole).

Ersetze überall `3600062578` durch `3600000000 + <Relations-ID deiner Stadt>`.

---

## 1. Relations-ID der Stadt finden

```overpassql
[out:json][timeout:60];
rel["name"="Köln"]["boundary"="administrative"];
out ids tags;
```

Liefert für Köln `id 62578`, `admin_level 6`. Die Area-ID ist dann
`3600062578`.

---

## 2. Verwaltungsgrenzen

```overpassql
[out:json][timeout:300];
(
 rel(62578);
 rel(area:3600062578)["boundary"="administrative"]["admin_level"~"^(9|10)$"];
);
out geom;
```

`admin_level` in Deutschland:

| Level | Ebene |
|---|---|
| 4 | Bundesland |
| 5 | Regierungsbezirk |
| 6 | Kreis / kreisfreie Stadt |
| 9 | Stadtbezirk |
| 10 | Stadtteil |

In anderen Ländern liegen die Ebenen anders — vorher mit einer
`out ids tags;`-Abfrage prüfen, welche Levels überhaupt belegt sind.

---

## 3. Trennende Wasserlinie (für die Rheinseiten-Frage)

```overpassql
[out:json][timeout:200];
area(3600062578)->.k;
way(area.k)["waterway"="river"]["name"="Rhein"];
out geom;
```

Ergibt für Köln einen durchgehenden Weg mit 162 Punkten. Liefert deine Stadt
mehrere Teilstücke, müssen die vor der Verwendung aneinandergehängt werden.

---

## 4. Orte

In zwei Abfragen aufteilen — Overpass drosselt sonst (HTTP 429).

```overpassql
[out:json][timeout:300];
area(3600062578)->.k;
(
 nwr(area.k)["tourism"="museum"];
 nwr(area.k)["amenity"="library"];
 nwr(area.k)["amenity"="cinema"];
 nwr(area.k)["amenity"="hospital"];
);
out center tags;
```

```overpassql
[out:json][timeout:300];
area(3600062578)->.k;
(
 nwr(area.k)["tourism"="zoo"];
 nwr(area.k)["tourism"="aquarium"];
 nwr(area.k)["tourism"="theme_park"];
 nwr(area.k)["leisure"="golf_course"];
 nwr(area.k)["office"="diplomatic"];
 nwr(area.k)["leisure"="park"]["name"];
 nwr(area.k)["railway"="station"];
 nwr(area.k)["railway"="halt"];
);
out center tags;
```

`out center` liefert bei Flächen den Mittelpunkt — das entspricht der
Jet-Lag-Regel „gemessen wird ab dem Kartensymbol“.

---

## 5. Format der Datendatei

`build-data.js` erwartet `data/<stadt>-raw.json` in dieser Form:

```json
{
  "city": "Köln",
  "center": [6.9603, 50.9375],
  "admin": [
    { "type": "Feature",
      "properties": { "name": "Ehrenfeld", "level": 9, "id": 123 },
      "geometry": { "type": "Polygon", "coordinates": [[[lon, lat], ...]] } }
  ],
  "rhein": [[lon, lat], ...],
  "pois": [ { "c": "museum", "n": "Museum Ludwig", "x": 6.96, "y": 50.94 } ]
}
```

Kategorie-Kürzel (`c`): `museum`, `library`, `cinema`, `hospital`, `station`,
`park`, `zoo`, `aquarium`, `golf`, `consulate`.

---

## Kuration nicht überspringen

OSM-Rohdaten enthalten regelmäßig:

- **Honorarkonsulate** — nach den Jet-Lag-Regeln ausdrücklich ausgeschlossen
- **Einzelgehege als eigene Zoos** („Terrarium“, „Wildgehege“ innerhalb des Zoos)
- **Dependancen** desselben Konsulats als getrennte Einträge
- **Physio- und Reha-Zentren** als `amenity=hospital`
- **Kunstparks** als `tourism=theme_park`

Ohne Bereinigung verzerren diese Einträge die Voronoi-Zellen und damit jede
Matching- und Tentacle-Frage. Die Regeln stehen in `build-data.js` unter
`DROP_NAME` und `ZOO_KEEP`.
