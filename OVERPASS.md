# Rohdaten von OpenStreetMap holen

Vier Dateien in `data/` kommen direkt aus OSM. Der Build liest sie, schreibt
sie nie zurück — wer Daten ändern will, ändert sie hier oder in `build-data.js`.

| Datei | Inhalt | gelesen von |
|---|---|---|
| `koeln-raw.json` | Rhein-Linie + Orte der Kernstadt | `build-data.js` |
| `koeln-ring25-pois.json` | Orte im 25-km-Ring um den Hbf | `build-data.js` |
| `koeln-stations.json` | die 245 Stationen | `build-data.js` |
| `koeln-boundaries-raw.json` | Verwaltungsgrenzen als Wege + Relationen | `build-boundaries.js` |

Daraus wird `data/koeln.json` (`node build-data.js`), daraus die fertige Seite
(`node build.js`). **Vor jedem Lauf prüfen, ob der Build die vorhandene Datei
byte-identisch reproduziert** — dreimal hat das in diesem Projekt einen
stillen Schaden verhindert.

Die Abfragen laufen auf <https://overpass-turbo.eu> (einfügen, *Run*, Export).
Ersetze überall `62578` durch die Relations-ID deiner Stadt.

---

## 1. Relations-ID der Stadt finden

```overpassql
[out:json][timeout:60];
rel["name"="Köln"]["boundary"="administrative"];
out ids tags;
```

Liefert für Köln `id 62578`, `admin_level 6`. Die Area-ID ist `3600062578`.

---

## 2. Verwaltungsgrenzen — als Wege, nicht als Flächen

```overpassql
[out:json][timeout:300];
(
 rel(62578);
 rel(area:3600062578)["boundary"="administrative"]["admin_level"~"^(9|10)$"];
);
out geom;
```

`admin_level` in Deutschland: 4 Bundesland · 5 Regierungsbezirk · 6 Kreis /
kreisfreie Stadt · 9 Stadtbezirk · 10 Stadtteil. In anderen Ländern liegen die
Ebenen anders — vorher mit `out ids tags;` prüfen, welche belegt sind.

**Das Entscheidende passiert beim Speichern.** In OSM ist die Grenze zwischen
zwei Stadtteilen **ein** Weg, den sich beide teilen; die Bezirksgrenzen
bestehen aus denselben Wegen. Wer daraus pro Fläche einen eigenen Ring
schreibt, legt jede Linie zwei- bis dreimal ab — und genau diese Kopien sind
in der alten Fassung auseinandergelaufen (bis 245 m Drift, Gabeln auf der
Karte, ein Punkt am Rudolfplatz fiel durch einen 0,2-m-Schlitz in gar keinen
Stadtteil).

Deshalb speichert `koeln-boundaries-raw.json` **jeden Weg genau einmal**, unter
seiner OSM-Way-ID, und die Relationen verweisen nur darauf:

```json
{
  "quelle": "OpenStreetMap / Overpass, rel(62578) + admin_level 9|10, out geom",
  "geholt": "2026-09-16",
  "arcs":      { "194136209": [[7.074567, 50.866258], [7.074289, 50.866721]] },
  "relations": [ { "id": 2613711, "name": "Altstadt-Nord", "level": 10,
                   "members": [ { "ref": 265079072, "role": "outer" } ] } ],
  "city":      { "id": 62578, "name": "Köln", "level": 6, "members": [] }
}
```

`build-boundaries.js` setzt daraus Ringe aus vorzeichenbehafteten Bogen-Indizes
zusammen (negativ = rückwärts, `~i = -i-1` wie in TopoJSON). Overpass liefert
die Mitglieder einer Relation unsortiert und in beliebiger Richtung — es wird
an den Endpunkten gesucht, nicht auf die Reihenfolge vertraut.

**Nicht ausdünnen.** Volle Auflösung, auf 6 Nachkommastellen gerundet (11 cm).
Die Bogenform spart mehr als jedes Vereinfachen und ist verlustfrei: 20 082
Punkte in 464 Bögen statt 47 068 Punkten in kopierten Ringen.

---

## 3. Trennende Wasserlinie (für die Rheinseiten-Frage)

```overpassql
[out:json][timeout:200];
area(3600062578)->.k;
way(area.k)["waterway"="river"]["name"="Rhein"];
out geom;
```

Ergibt für Köln einen durchgehenden Weg mit 162 Punkten. Liefert deine Stadt
mehrere Teilstücke, müssen die vorher aneinandergehängt werden.

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
Jet-Lag-Regel „gemessen wird ab dem Kartensymbol".

**Faustregel: POI-Daten müssen weiter reichen als das Spielgebiet.** Wer in
Worringen sitzt, hat womöglich ein Leverkusener Museum als nächstes. Dafür
gibt es `koeln-ring25-pois.json` — dieselben Abfragen, aber
`nwr(around:25000,50.9432,6.9583)` statt `area(…)`.

---

## 5. Mangal Döner (eigene Frage der Gruppe)

```overpassql
[out:json][timeout:300];
nwr(around:25000,50.9432,6.9583)["name"~"mangal",i];
out center tags;
```

Danach von Hand aussortieren: es zählt **jeder Laden, der „Mangal Döner"
heißt** (die Podolski-Kette und gleichnamige Läden), **nicht** Antep Mangal,
Elite Mangal, Mangal Lahmacun/Burger/Baklava und keine reine Firmenadresse
ohne `amenity`.

**Diese Liste steht als Konstante `MANGAL` in `build-data.js`, nicht in
`koeln-raw.json`.** Wer die Läden nur in `koeln.json` pflegt, verliert sie
beim nächsten `node build-data.js`. Stadtteil und Rheinseite rechnet der Build
selbst; Straßennamen zur Unterscheidung mehrerer Läden im selben Stadtteil
kamen aus einer zweiten Abfrage (`way[highway][name](around:40,…)`).

---

## 6. Stationen

`koeln-stations.json`, Felder `{k, n, x, y, u}` — `k` ist `kvb` oder `rail`.
**In OSM sind alle KVB-Linien einheitlich `route=tram`**; eine Trennung
Stadtbahn/Straßenbahn existiert dort nicht und lässt sich aus den Daten nicht
herstellen. Bus zählt nach den Gruppenregeln nicht.

---

## 7. Format von `koeln-raw.json`

```json
{
  "city": "Köln",
  "center": [6.9603, 50.9375],
  "rhein": [[6.97, 50.93]],
  "pois": [ { "c": "museum", "n": "Museum Ludwig", "x": 6.96, "y": 50.94 } ]
}
```

Kategorie-Kürzel (`c`): `museum`, `library`, `cinema`, `hospital`, `station`,
`park`, `zoo`, `aquarium`, `golf`, `consulate`, `theme_park`, `mangal`.

Ein früherer Schlüssel `admin` (ausgedünnte Grenzflächen) ist in Runde 22
entfallen — Grenzen kommen ausschließlich aus `koeln-boundaries-raw.json`.
**Nicht wiederbeleben.**

Die Datei liegt mit 4er-Einrückung und CRLF auf der Platte, damit Diffs lesbar
bleiben; `build-data.js` schreibt sie genauso zurück, kompakt wird erst beim
Einbetten in `index.html`.

---

## 8. Kuration nicht überspringen

OSM-Rohdaten enthalten regelmäßig:

- **Honorarkonsulate** — nach den Jet-Lag-Regeln ausdrücklich ausgeschlossen
- **Einzelgehege als eigene Zoos** („Terrarium", „Vogelvoliere" im Zoo)
- **Dependancen** desselben Konsulats als getrennte Einträge
- **Physio- und Reha-Zentren** als `amenity=hospital`
- **Kunstparks** als `tourism=theme_park`
- **Aquaristik-Läden** als `tourism=aquarium`

Ohne Bereinigung verzerren diese Einträge die Voronoi-Zellen und damit jede
Matching- und Tentacle-Frage. Die Regeln stehen in `build-data.js` als
`DROP_NAME`, `SUB_ZOO`, `NOT_ZOO`, `NOT_AQUARIUM` und `NOT_THEME`.

---

## 9. Wenn Overpass zickt

- **„Dispatcher Client::request read and idx::timeout" / „server is probably
  too busy"** ist der Normalfall bei großen Abfragen. Wiederholen hilft; sonst
  auf einen Spiegel ausweichen: `overpass.kumi.systems`,
  `overpass.private.coffee`, `overpass.osm.jp`.
- **`timeout` großzügig setzen** (300 s für die Grenzen), sonst bricht die
  Abfrage ab, bevor die Instanz überhaupt anfängt.
- Die Grenzdaten sind vom 16.09.2026. Ein neuer Lauf mit derselben Abfrage
  aktualisiert sie; die Bogenform muss dabei erhalten bleiben.

---

## 10. Linien, Flughäfen, Schnellfahrstrecken (Runde 25)

`data/koeln-transit.json` — gelesen von `build-data.js`. Geholt am 12.10.2026
im Browser (overpass-api.de war überlastet; geantwortet haben
`overpass.kumi.systems` und `maps.mail.ru/osm/tools/overpass`, Datenstand OSM
24.07.2026).

**Linien je Station:**

```overpassql
[out:json][timeout:300];
rel(50.80,6.75,51.10,7.20)["type"="route"]["route"~"^(train|light_rail|tram|subway)$"]->.r;
.r out body;
node(r.r)->.n; .n out skel qt;
way(r.r)["public_transport"="platform"]; out center qt;
way(r.r)["railway"="platform"]; out center qt;
```

Jeder Haltepunkt (Rolle `stop*`/`platform*`) einer Route mit `ref` wird der
nächsten Station **gleicher Art** zugeordnet (`tram` → `kvb`, `train` →
`rail`), wenn sie unter 200 m liegt. Nur KVB, S-Bahn, RE/RB — Fernverkehr
(ICE/IC/EC/FLX/NJ/ES) und die Rheinpark-Kleinbahn bleiben draußen.
`RE 1 (RRX)` wird zu `RE1`. Im Build teilen Stationen derselben Art unter
150 m Abstand ihre Linien (Messe/Deutz + Messe/Deutz tief; Bf Deutz/Messe +
Bahnhof Deutz/LANXESS arena). **Marktstraße hat keine Linie** (Endpunkt des
gebauten Abschnitts an der Bonner Straße, derzeit ohne Betrieb; Linie 5 ab
2029 geplant) — die App schließt sie mit der Linienfrage nie aus.

Aus derselben Abfrage kommen die **Linienverläufe** (`routes`): je Route die
Folge der zugeordneten Stationen, Gegenrichtung und Teilstrecken ohne neue
Kante weggelassen. Die App zeichnet sie schematisch Station zu Station
(Einstellungen → „Linien auf der Karte"). Zweiter Abruf am 12.10.2026 abends
direkt über overpass-api.de, Linienzuordnung identisch zum ersten.

Runde 26 an den Stationen: Rhein Energie Stadion auf den Halt der Linie 1 an
der Aachener Straße verlegt (50.93761, 6.87468), Köln/Bonn Flughafen ergänzt
(50.87892, 7.11928; S19, RE6, RB27). Damit wächst `play_box` nach Osten:
24,3 × 28,4 km = 691 km².

**Flughäfen und Schnellfahrstrecken:**

```overpassql
[out:json][timeout:300];
way(50.4,6.3,51.5,7.7)["railway"="rail"]["highspeed"="yes"];
out geom qt;
nwr(49.9,5.5,52.0,8.8)["aeroway"="aerodrome"]["iata"];
out center tags;
```

Flughäfen: nur solche mit Linienverkehr (CGN, DUS, DTM, NRN, MST, PAD, FRA,
HHN) — Militär-, Sport- und Regionalplätze ohne Linienflüge raus. Sie landen
als Orte-Kategorie `airport` in `koeln.json`.

Schnellfahrstrecken: `maxspeed` ≥ 200, je Strecke ein Gleis, auf
6.6–7.3 / 50.76–51.16 beschnitten, Douglas-Peucker 5 m. Im Raum Köln sind das
2600 Köln–Aachen (ab Müngersdorf), 2650 Köln–Duisburg (ab Stammheim) und 2690
Köln–Rhein/Main (ab Steinstraße).

### Runde 27 (13.10.2026): Stationsliste nach KVB-Plan

- **Namen nach dem KVB-Plan „Bahnen in Köln 2025/26"** (mit „Str.", „Bf",
  ohne „Köln-"-Präfix außer Köln Hbf/West/Süd, Köln/Bonn Flughafen) — die
  Namenslängen-Frage zählt genau diese Namen. Zuordnung alt → neu über einen
  normalisierten Schlüssel, Ausnahmen von Hand (Waldecker Straße → Buchforst
  Waldecker Str., Vischeringstraße → Holweide Vischeringstr., Gilgaustraße →
  Ensen Gilgaustr., Steinstraße (kvb) → Porz Steinstr., Godorf → Godorf Bf).
- **Umsteigepunkte zusammengelegt** (Plan zeigt je einen Halt): Weiden West,
  Chorweiler, Geldernstr./Parkgürtel, Bf Mülheim, Hansaring — Art `both`,
  Punkt in der Mitte; Messe/Deutz + Messe/Deutz (tief) → Messe/Deutz (rail).
  KVB „Bf Deutz/Messe" bleibt eigene Station.
- **Entfernt:** Marktstraße (ohne Betrieb), Longerich Friedhof (im Plan
  ausgegraut). **211 Stationen**, `play_box` 24,3 × 28,4 km = 690 km².
- **Lageprüfung** (OSM 12.10.2026): Abstand jeder Station zur Mitte ihrer
  Linien-Haltepunkte. 207 unter 25 m, alle unter 50 m außer Ehrenfeld (66 m —
  der Punkt ist der OSM-Bahnhofsknoten, die S-Bahn-Bahnsteige liegen östlich).
  Zülpicher Platz: 1 m von der Mitte der vier Haltepunkte (Linie 9 auf der
  Zülpicher Straße, 12/15 am Ring, bis 75 m auseinander).
