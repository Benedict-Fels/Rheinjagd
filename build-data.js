#!/usr/bin/env node
/**
 * Baut aus den rohen OSM-Daten die kuratierte Datendatei für die App.
 *
 * Kuration nach Jet-Lag-Regeln:
 *  - Honorarkonsulate ausschließen (Regel: "excluding honorary consulates")
 *  - Zoo: nur echte Zoos, keine Gehege/Terrarien innerhalb eines Zoos
 *  - Aquarium: in Köln Teil des Zoos -> eigene Kategorie leer
 *  - Krankenhaus: keine Physio-/Reha-Zentren
 *  - Golf: nur Anlagen im Stadtgebiet
 *  - Rheinseiten aus der Rhein-Mittellinie + Stadtgrenze konstruieren
 */
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/koeln-raw.json'), 'utf8'));

/* Optionale Erweiterung: POIs aus einem Ring um den Startpunkt (25 km).
   Nötig, damit "nächster Ort"-Fragen auch am Stadtrand stimmen — wer in
   Worringen sitzt, hat womöglich ein Leverkusener Museum als nächstes. */
const RING_FILE = path.join(__dirname, 'data/koeln-ring25-pois.json');
const ring = fs.existsSync(RING_FILE)
  ? JSON.parse(fs.readFileSync(RING_FILE, 'utf8'))
  : null;

/* Stationen + Spielgebietsgrenze (aus dem KVB-Netzplan abgeleitet). */
const STATION_FILE = path.join(__dirname, 'data/koeln-stations.json');
const stationData = fs.existsSync(STATION_FILE)
  ? JSON.parse(fs.readFileSync(STATION_FILE, 'utf8'))
  : null;

// ---------- POI-Kuration ----------
const DROP_NAME = [
  /honorar/i,                         // Honorarkonsulate (Jet-Lag-Regel)
  /abteilung für handel/i,            // Dependance desselben Konsulats
  /physiosport|performance athletic/i, // kein Krankenhaus
  /\bpraxis\b|physiotherapie|tagesklinik|dialyse/i,
];

/* Einträge, die innerhalb eines größeren POI liegen oder im Spielsinn kein
   eigenständiger Ort sind. Erkannt am Namen statt über eine Whitelist, damit
   die Regeln auch außerhalb Kölns greifen. */
const SUB_ZOO = /gehege|terrarium|insektarium|streichelzoo|aquarium\s*&|vogel|schutzstation|voliere/i;
// Bauernhöfe, Weiden und Wildgatter sind keine Zoos, die ein Mitspieler ansteuern würde
const NOT_ZOO = /wiese|ziegenhof|bauernhof|hirschpark|höhnerhoff|hühnerhof|weide|koppel/i;
// "Aquarium" im Ladennamen ist ein Zoofachgeschäft, kein Schauaquarium
const NOT_AQUARIUM = /&\s*co|shop|handel|zubehör|aquaristik/i;
// Erlebnisbauernhöfe und Naturparkzentren sind keine Freizeitparks
const NOT_THEME = /kunst|kultur|bauernhof|naturpark|mühle|wassererlebnis/i;

function curate(pois) {
  const out = [];
  for (const p of pois) {
    if (!p.n || DROP_NAME.some((re) => re.test(p.n))) continue;
    if (p.hon) continue;                                   // als Honorarkonsulat markiert
    if (p.c === 'zoo' && (SUB_ZOO.test(p.n) || NOT_ZOO.test(p.n))) continue;
    if (p.c === 'aquarium' && NOT_AQUARIUM.test(p.n)) continue;
    if (p.c === 'theme_park' && NOT_THEME.test(p.n)) continue;
    out.push({ c: p.c, n: p.n, x: p.x, y: p.y });
  }
  return out;
}

/** Doppelte Einträge zusammenführen (gleiche Kategorie, Name, ~50 m). */
function dedupe(pois) {
  const out = [];
  for (const p of pois) {
    const dup = out.find((q) =>
      q.c === p.c && q.n === p.n &&
      Math.abs(q.x - p.x) < 0.0008 && Math.abs(q.y - p.y) < 0.0005);
    if (!dup) out.push(p);
  }
  return out;
}

// ---------- Geometrie-Helfer ----------
function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return a / 2;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeom(pt, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    if (!pointInRing(pt, poly[0])) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) if (pointInRing(pt, poly[i])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

// ---------- Rheinseiten ----------
/**
 * Die Rhein-Mittellinie wird über die Stadtgrenze hinaus verlängert und
 * teilt die Stadtfläche damit in zwei Hälften. Für jede Stadtteil-Geometrie
 * entscheiden wir per Seitentest (Kreuzprodukt zum nächsten Liniensegment),
 * auf welcher Seite ihr Mittelpunkt liegt.
 */
function sideOfLine(pt, line) {
  // nächstes Segment finden
  let best = Infinity, bi = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-12;
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const d = (pt[0] - px) ** 2 + (pt[1] - py) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  const a = line[bi], b = line[bi + 1];
  const cross = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
  // Rhein fließt nach Norden -> cross > 0 = links der Fließrichtung = linksrheinisch
  return cross > 0 ? 'links' : 'rechts';
}

function centroid(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let bx = 0, by = 0, ba = 0;
  for (const poly of polys) {
    const r = poly[0];
    const a = Math.abs(ringArea(r));
    let cx = 0, cy = 0;
    for (const p of r) { cx += p[0]; cy += p[1]; }
    cx /= r.length; cy /= r.length;
    if (a > ba) { ba = a; bx = cx; by = cy; }
  }
  return [bx, by];
}

// ---------- Build ----------
/* Verwaltungsgrenzen kommen seit Runde 20 aus `data/koeln-boundaries-raw.json`
   (frischer Overpass-Export in voller Auflösung) und werden in Bogenform
   abgelegt: jede Grenzlinie steht genau einmal, beide Nachbarn verweisen
   darauf. `raw.admin` aus koeln-raw.json wird dafür **nicht mehr gelesen** —
   es ist die alte, pro Fläche kopierte und ausgedünnte Fassung, in der die
   Kopien bis zu 245 m auseinandergelaufen waren. */
const { build: buildBoundaries, expandRing } = require('./build-boundaries.js');
const B = buildBoundaries(path.join(__dirname, 'data/koeln-boundaries-raw.json'));
if (B.problems.length) {
  console.error('Grenzdaten fehlerhaft:', B.problems.join(' | '));
  process.exit(1);
}
/** Fläche als GeoJSON — nur hier im Build gebraucht (Rheinseite, POI-Stadtteil). */
const geomOf = (f) => ({ type: f.rings.length > 1 ? 'MultiPolygon' : 'Polygon',
  coordinates: f.rings.length > 1
    ? f.rings.map((r) => [expandRing(r, B.arcs)])
    : [expandRing(f.rings[0], B.arcs)] });

const city = { geometry: geomOf(B.city) };
const bezirke = B.d2.map((f) => ({ ...f, geometry: geomOf(f) }));
const stadtteile = B.d3.map((f) => ({ ...f, geometry: geomOf(f) }));

// Rheinseite pro Fläche bestimmen
for (const f of [...stadtteile, ...bezirke]) {
  f.side = sideOfLine(centroid(f.geometry), raw.rhein);
}

// Ring-Daten bevorzugen, sonst die Stadtdaten
/* Eigene Kategorie "mangal" (Runde 17, Wunsch von Bene): die Mangal-Döner-
   Läden als Matching-Frage. Sie stehen nicht in koeln-raw.json — Overpass ist
   aus der Bauumgebung nicht erreichbar, die Liste wurde deshalb einmalig über
   den Browser geholt und hier festgeschrieben.

   Abfrage (Overpass, 16.09.2026):
     [out:json];nwr["name"~"Mangal",i](50.60,6.40,51.30,7.45);out center tags;
   Gefiltert auf Namen, die neben "Mangal" auch "Döner", "LP10" oder
   "Podolski" enthalten (plus ein Laden, der nur "Mangal" heißt, aber Marke
   und Website der Kette trägt), und auf 25 km Luftlinie um den Hbf — POI-
   Daten müssen weiter reichen als das Spielgebiet. Bewusst NICHT dabei:
   gleichnamige, aber andere Läden (Antep Mangal, Elite Mangal, Mangal
   Lahmacun/Burger/Baklava an der Weidengasse) und die Firmenadresse am
   Anna-Schneider-Steig, die kein Laden ist.

   Namen: "Mangal Döner" + Straße, wo mehrere in denselben Stadtteil fallen,
   sonst Stadtteil bzw. Ort — 18-mal derselbe Eintragsname wäre in der
   Orte-Liste nicht bedienbar. Stadtteil und Rheinseite rechnet der Build
   unten wie bei jedem anderen POI. */
const MANGAL = [
  ['Mangal Döner Komödienstraße',     50.94161, 6.95597],
  ['Mangal Döner Weidengasse',        50.94845, 6.95420],
  ['Mangal Döner Heumarkt',           50.93560, 6.95998],
  ['Mangal Döner Hohenzollernring',   50.93868, 6.93982],
  ['Mangal Döner Zülpicher Platz',    50.93051, 6.93940],
  ['Mangal Döner Nippes',             50.96190, 6.95413],
  ['Mangal Döner Bonner Straße',      50.92071, 6.95989],
  ['Mangal Döner Ehrenfeldgürtel',    50.95045, 6.91673],
  ['Mangal Döner Kalker Hauptstraße', 50.93762, 7.00162],
  ['Mangal Döner Frankfurter Straße', 50.95865, 7.00938],
  ['Mangal Döner Schanzenstraße',     50.96503, 7.01668],
  ['Mangal Döner Ostheim',            50.92929, 7.04175],
  ['Mangal Döner Porz-Urbach',        50.88163, 7.08133],
  ['Mangal Döner Grengel',            50.87931, 7.12146],
  ['Mangal Döner Brühl',              50.82654, 6.90248],
  ['Mangal Döner Pulheim',            51.01836, 6.76191],
  ['Mangal Döner Bergheim',           50.95278, 6.64575],
  ['Mangal Döner Sankt Augustin',     50.77716, 7.18775],
];

const pois = dedupe(curate(ring ? ring.pois : raw.pois))
  .concat(MANGAL.map(([n, y, x]) => ({ c: 'mangal', n, x, y })));

// Rheinseite je POI; Stadtteil nur für POIs innerhalb Kölns
for (const p of pois) {
  const st = stadtteile.find((f) => pointInGeom([p.x, p.y], f.geometry));
  p.st = st ? st.name : null;
  p.side = sideOfLine([p.x, p.y], raw.rhein);
}

const counts = {};
pois.forEach((p) => (counts[p.c] = (counts[p.c] || 0) + 1));

// Stationen. Das Spielgebiet ist seit Runde 11 ein festes Rechteck
// (`play_box`), das aus der Bounding-Box der Stationen selbst berechnet wird
// — kein Polygon aus dem KVB-Netzplan und kein einstellbarer Radius-Kreis
// mehr (der ließ am Ost-/Westrand zu viel Fläche weg bzw. griff an anderen
// Rändern zu weit, weil die Stationen nicht kreisförmig um den Hbf liegen).
// Alle in `koeln-stations.json` verbliebenen Stationen liegen ohnehin im
// ehemaligen Netzumriss-Polygon; die 98 vorher außerhalb liegenden Stationen
// (Bonn, Leverkusen, Brühl etc.) wurden auf Benes Entscheidung bereits aus
// der Liste entfernt. `boundary` in koeln-stations.json wird hier bewusst
// nicht mehr gelesen.
let stations = [];
if (stationData) {
  stations = stationData.stations.map((s) => ({ k: s.k, n: s.n, x: s.x, y: s.y, u: s.u || 0 }));
}

/** Rechteckiges Spielgebiet: Bounding-Box der Stationen + Puffer (Bene:
    "vom südlichsten, westlichsten, nördlichsten und östlichsten Punkt etwa
    1,5 km mehr Abstand"). */
function stationBox(stations, bufferKm) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of stations) {
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
  }
  const midY = (minY + maxY) / 2;
  const dLat = bufferKm / 110.57;
  const dLon = bufferKm / (111.32 * Math.cos((midY * Math.PI) / 180));
  return { minX: minX - dLon, maxX: maxX + dLon, minY: minY - dLat, maxY: maxY + dLat };
}
const playBox = stations.length ? stationBox(stations, 1.5) : null;

const bundle = {
  city: 'Köln',
  center: raw.center,
  rhein: raw.rhein,
  city_boundary: city.geometry,
  stations,
  play_box: playBox,
  divisions: {
    /* `arcs` sind die 464 Grenzlinien, jede genau einmal. Eine Fläche ist eine
       Liste von Ringen, ein Ring eine Liste vorzeichenbehafteter Bogen-Indizes
       (negativ = rückwärts, ~i = -i-1 wie in TopoJSON). Die App rollt das beim
       Start einmal zu GeoJSON aus (`expandDivisions()` in app.js). */
    arcs: B.arcs,
    // Nutzer-Entscheidung: Rheinseite wird als "1st Division" geführt
    d1: { label: 'Rheinseite', kind: 'side' },
    d2: { label: 'Stadtbezirk', kind: 'poly', features: bezirke.map((f) => ({ name: f.name, side: f.side, rings: f.rings })) },
    d3: { label: 'Stadtteil', kind: 'poly', features: stadtteile.map((f) => ({ name: f.name, side: f.side, rings: f.rings })) },
  },
  pois,
};

/* Eingerückt und mit CRLF schreiben — genau so, wie die Datei auf der Platte
   liegt. Vorher schrieb der Build kompakt, die Datei war aber eingerückt: ein
   Lauf hätte 35.699 Zeilen zu einer einzigen gemacht und jeden Diff wertlos.
   In index.html landet sie ohnehin kompakt (build.js stringifyt neu). */
fs.writeFileSync(path.join(__dirname, 'data/koeln.json'),
  JSON.stringify(bundle, null, 4).replace(/\n/g, '\r\n'));

const sides = { links: 0, rechts: 0 };
stadtteile.forEach((f) => sides[f.side]++);
console.log('Stadtteile nach Rheinseite:', JSON.stringify(sides));
console.log('Bezirke:', bezirke.map((f) => f.name + '(' + f.side + ')').join(', '));
console.log('Grenzbögen:', B.arcs.length, '· Punkte:', B.arcs.reduce((s2, a) => s2 + a.length, 0));
console.log('POIs nach Kuration:', JSON.stringify(counts), '=', pois.length);
console.log('Stationen:', stations.length,
  JSON.stringify(stations.reduce((a,s)=>{a[s.k]=(a[s.k]||0)+1;return a;},{})));
console.log('Datei:', Math.round(fs.statSync(path.join(__dirname, 'data/koeln.json')).size / 1024) + ' KB');
if (playBox) {
  const w = (playBox.maxX - playBox.minX) * 111.32 * Math.cos(((playBox.minY + playBox.maxY) / 2 * Math.PI) / 180);
  const h = (playBox.maxY - playBox.minY) * 110.57;
  console.log('Spielgebiet (play_box):', w.toFixed(1) + ' x ' + h.toFixed(1) + ' km =', (w * h).toFixed(0) + ' km²');
}
