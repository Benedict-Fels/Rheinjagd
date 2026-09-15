/* ============================================================
   Rheinjagd — Seeker-Werkzeug für Jet Lag: Hide and Seek
   ============================================================ */
'use strict';

const MILE_KM = 1.609344;
/** Fläche einer Rasterzelle in km² — hängt vom gewählten Radius ab. */
function cellArea() { return (S.grid ? S.grid.cellKm : 0.15) ** 2; }

/* ---------- Kategorien ---------- */
const CATS = {
  museum:     { label: 'Museum',        plural: 'Museen' },
  library:    { label: 'Bibliothek',    plural: 'Bibliotheken' },
  cinema:     { label: 'Kino',          plural: 'Kinos' },
  hospital:   { label: 'Krankenhaus',   plural: 'Krankenhäuser' },
  station:    { label: 'Bahnhof',       plural: 'Bahnhöfe' },
  park:       { label: 'Park',          plural: 'Parks' },
  zoo:        { label: 'Zoo',           plural: 'Zoos' },
  aquarium:   { label: 'Aquarium',      plural: 'Aquarien' },
  theme_park: { label: 'Freizeitpark',  plural: 'Freizeitparks' },
  golf:       { label: 'Golfplatz',     plural: 'Golfplätze' },
  consulate:  { label: 'Konsulat',      plural: 'Konsulate' },
};

/** Reihenfolge in den Fragenlisten — häufige und nützliche zuerst. */
const CAT_ORDER = ['station', 'park', 'museum', 'cinema', 'library', 'hospital',
                   'zoo', 'aquarium', 'theme_park', 'golf', 'consulate'];

const RADAR_MI = [0.25, 0.5, 1, 3, 5, 10];
const THERMO_MI = [0.5, 3, 10];

/* Spielgebiet: Kreis um den Startpunkt. Köln Hbf ist der Standard. */
const HOME_DEFAULT = { name: 'Köln Hauptbahnhof', x: 6.95907, y: 50.94278 };
const RADIUS_DEFAULT_KM = 10;
const RADIUS_MIN_KM = 3;
const RADIUS_MAX_KM = 30;

/* Versteckzone: Der Hider muss sich innerhalb dieses Abstands zu einer
   zugelassenen Station aufhalten (Jet-Lag-Standard: 500 m). */
const HIDE_RADIUS_M_DEFAULT = 500;
/* Welche Stationsarten gelten? Eure Absprache: S-Bahn, U-Bahn/Stadtbahn und
   Regionalbahnhöfe — kein Bus. In OpenStreetMap sind alle KVB-Linien
   einheitlich als Tram erfasst, eine Trennung Stadtbahn/Straßenbahn gibt es
   dort nicht — deshalb zwei Arten statt drei. */
const STATION_KINDS = {
  rail: { label: 'Bahnhof / S-Bahn', hint: 'Regional- und S-Bahn-Halte' },
  kvb:  { label: 'KVB-Stadtbahn',    hint: 'U-Bahn und oberirdische Stadtbahn' },
};

/* ---------- Zustand ---------- */
const S = {
  data: null, grid: null, fields: null, pois: null,
  live: null, history: [], stamp: 0,
  seeker: null,          // [lon, lat]
  picking: null,         // laufende Punktauswahl
  map: null, layers: {},
  disabled: {},          // cat -> Set(index) abgeschalteter POIs
  thermoFrom: null,
  home: { ...HOME_DEFAULT },   // Mittelpunkt des Spielgebiets
  radiusKm: RADIUS_DEFAULT_KM, // Radius des Spielgebiets
  hideRadiusM: HIDE_RADIUS_M_DEFAULT,   // Versteckradius um Stationen
  hideKinds: { rail: true, kvb: true },
  hideZoneOn: true,            // Versteckzone aktiv?
  useArea: true,               // Spielgebiet aus dem KVB-Plan statt Radius-Kreis
  showStations: false,         // Stationspunkte auf der Karte
  fineEdgesOn: true,           // Feine Kanten an Versteckzone/Fragen statt grobem Raster
  fineEdge: null, fineEdgeStamp: -1, // Cache für buildFineEdges()
  expanded: {},                  // Titel aufgeklappter Gruppen (Fragen- und Orte-Tab) —
                                  // Standard ist zugeklappt, hier stehen nur Ausnahmen
  customPois: [],                // benutzerdefinierte Orte: {id,c,n,x,y}
  showPois: false,               // eigene + eingebaute Orte als Punkte auf der Karte
  poiPicking: null,              // laufende Punktauswahl für den POI-Editor
};

/* ============================================================
   Geometrie (identisch zur getesteten Engine)
   ============================================================ */
const R_EARTH = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;
// Exakter km-pro-Breitengrad-Wert (aus demselben R_EARTH wie distKm/Haversine
// oben) — nur für die Fein-Kanten-Verfeinerung unten, wo es auf wenige Meter
// ankommt. Der Rest der Datei nutzt an einigen Stellen 110.57 als
// Näherungskonstante fürs Raster selbst (Zellgröße etc.); das bewusst nicht
// anfassen, um die bestehende Rasterausrichtung nicht zu verschieben — hier
// geht es nur um die *Abweichung einer exakten Prüfung vom Raster*, und die
// muss mit derselben Erdradius-Basis wie distKm rechnen, sonst hat die
// „exakte" Kante selbst wieder einen systematischen Fehler (~13 m bei einem
// 2,4-km-Radar-Kreis, gemessen mit 110.57 statt hier).
const KM_PER_DEG_LAT = (R_EARTH * Math.PI) / 180;

function distKm(ax, ay, bx, by) {
  const dLat = toRad(by - ay), dLon = toRad(bx - ax);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(ay)) * Math.cos(toRad(by)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeom(x, y, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    if (!pointInRing(x, y, poly[0])) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) if (pointInRing(x, y, poly[i])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

function bboxOf(g) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const p of poly[0]) {
    if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0];
    if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1];
  }
  return [a, b, c, d];
}

function sideOfLine(x, y, line) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-12;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const dd = (x - px) ** 2 + (y - py) ** 2;
    if (dd < best) { best = dd; bi = i; }
  }
  const a = line[bi], b = line[bi + 1];
  return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 1 : 2;
}

function distToLineKm(x, y, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-12;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = distKm(x, y, a[0] + t * dx, a[1] + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/* ---------- Raster ----------
   Das Spielgebiet ist ein Kreis um S.home mit S.radiusKm. Zellen darin sind
   möglich (`inCity` = Spielgebiet). Für jede Zelle merken wir zusätzlich, ob
   sie im Kölner Stadtgebiet liegt (`inKoeln`) — nur dort sind Stadtteil- und
   Bezirksangaben belegt.
   Bei großem Radius wird die Zelle vergrößert, damit die Zellenzahl und
   damit die Rechenzeit ungefähr gleich bleibt. */
function cellSizeFor(radiusKm) {
  if (radiusKm <= 12) return 0.15;
  if (radiusKm <= 20) return 0.22;
  return 0.3;
}

function buildGrid(data) {
  const home = S.home, radius = S.radiusKm;
  const cell = cellSizeFor(radius);
  const dLat = cell / 110.57;
  const dLon = cell / (Math.cos(toRad(home.y)) * 111.32);

  /* Spielgebiet: entweder das Polygon aus dem KVB-Netzplan oder — wenn der
     Nutzer auf Radius umgestellt hat — ein Kreis um den Startpunkt. */
  const poly = S.useArea && data.play_area ? data.play_area.ring : null;

  /* Rand-Polster fürs Raster: mindestens eine Zelle, aber auch mindestens der
     Versteckzonen-Radius (+10% Toleranz). Ohne das schneidet die Raster-
     Bounding-Box selbst den 500-m-Kreis um randnahe Stationen ab, bevor
     überhaupt das Polygon zum Zug kommt — einige der 20 Eckstationen (z. B.
     Köln-Worringen, Chorweiler, Zündorf) liegen nur wenige Meter innerhalb
     der Polygonkante. */
  const edgePadKm = S.hideZoneOn ? (S.hideRadiusM / 1000) * 1.1 : 0;
  const edgePadLat = Math.max(dLat, edgePadKm / 110.57);
  const edgePadLon = Math.max(dLon, edgePadKm / (Math.cos(toRad(home.y)) * 111.32));

  let minX, maxX, minY, maxY;
  if (poly) {
    minX = Math.min(...poly.map((p) => p[0])); maxX = Math.max(...poly.map((p) => p[0]));
    minY = Math.min(...poly.map((p) => p[1])); maxY = Math.max(...poly.map((p) => p[1]));
    minX -= edgePadLon; maxX += edgePadLon; minY -= edgePadLat; maxY += edgePadLat;
  } else {
    const padLat = Math.max((radius / 110.57) * 1.02, radius / 110.57 + edgePadLat);
    const padLon = Math.max((radius / (Math.cos(toRad(home.y)) * 111.32)) * 1.02,
                             radius / (Math.cos(toRad(home.y)) * 111.32) + edgePadLon);
    minX = home.x - padLon; maxX = home.x + padLon;
    minY = home.y - padLat; maxY = home.y + padLat;
  }

  const cols = Math.ceil((maxX - minX) / dLon);
  const rows = Math.ceil((maxY - minY) / dLat);
  const n = cols * rows;

  const g = {
    cols, rows, minX, minY, dLon, dLat, cellKm: cell,
    xs: new Float64Array(n), ys: new Float64Array(n),
    inCity: new Uint8Array(n),    // im Spielgebiet
    inKoeln: new Uint8Array(n),   // zusätzlich im Kölner Stadtgebiet
    side: new Uint8Array(n),
    d2: new Int16Array(n).fill(-1), d3: new Int16Array(n).fill(-1),
    count: 0, koelnCount: 0,
  };

  const cityBox = bboxOf(data.city_boundary);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const x = minX + (c + 0.5) * dLon;
    const y = minY + (r + 0.5) * dLat;
    g.xs[i] = x; g.ys[i] = y;
    if (poly ? !pointInRing(x, y, poly) : distKm(x, y, home.x, home.y) > radius) continue;
    g.inCity[i] = 1; g.count++;
    if (x >= cityBox[0] && x <= cityBox[2] && y >= cityBox[1] && y <= cityBox[3] &&
        pointInGeom(x, y, data.city_boundary)) { g.inKoeln[i] = 1; g.koelnCount++; }
  }

  for (let i = 0; i < n; i++) if (g.inCity[i]) g.side[i] = sideOfLine(g.xs[i], g.ys[i], data.rhein);

  applyHideZone(g, data);

  for (const key of ['d2', 'd3']) {
    const feats = data.divisions[key].features;
    const boxes = feats.map((f) => bboxOf(f.geometry));
    for (let i = 0; i < n; i++) {
      if (!g.inKoeln[i]) continue;
      const x = g.xs[i], y = g.ys[i];
      for (let k = 0; k < feats.length; k++) {
        const b = boxes[k];
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (pointInGeom(x, y, feats[k].geometry)) { g[key][i] = k; break; }
      }
    }
  }
  return g;
}

/** Stationen, die als Versteckpunkt gelten (nach eingestellten Arten). */
function hideStations() {
  const list = S.data.stations || [];
  return list.filter((s) => S.hideKinds[s.k]);
}

/** Numerischer Schlüssel für die Raumindex-Zelle (schneller als String-Keys
    bei den vielen Lookups der Feinraster-Verfeinerung unten). */
function hzKey(cx, cy) { return cx * 100003 + cy; }

/** Nächste Entfernung (km) zu einer zugelassenen Station, über den Raumindex.
    Für die grobe Zuordnung (einmal pro Rasterzelle) — exakte Haversine-Distanz. */
function nearestStationDistKm(x, y, hz) {
  const cx = Math.floor(x / hz.CS), cy = Math.floor(y / hz.CS);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = hz.cells.get(hzKey(cx + dx, cy + dy));
    if (!a) continue;
    for (const s of a) { const d = distKm(x, y, s.x, s.y); if (d < best) best = d; }
  }
  return best;
}

/**
 * Stationen, die für irgendeinen Punkt innerhalb `marginKm` von (x, y) noch
 * relevant sein können (einfacher linearer Scan über alle aktiven Stationen,
 * mit ebener Näherung). Für die Feinraster-Verfeinerung einmal pro Randzelle
 * aufgerufen statt einmal pro Subzelle — hält die Kandidatenliste pro Zelle
 * kurz, ohne sich auf die Bucket-Größe des Haversine-Raumindex zu verlassen
 * (der ist auf den Radius selbst zugeschnitten, nicht auf Radius+Zellhälfte,
 * und seine Bucket-Breite verzerrt in Ost-West-Richtung mit cos(Breite)).
 */
function candidatesNear(x, y, stations, kx, ky, marginKm) {
  const m2 = marginKm * marginKm;
  const out = [];
  for (const s of stations) {
    const dx = (x - s.x) * kx, dy = (y - s.y) * ky;
    if (dx * dx + dy * dy <= m2) out.push(s);
  }
  return out;
}

// Zielauflösung an der Versteckzonen-Kante, und eine Obergrenze für die
// Subzellen-Tests beim Rasteraufbau (damit ein großes Spielgebiet mit vielen
// Stationen nicht zu einem spürbaren Hänger führt).
const ZONE_EDGE_TARGET_M = 5;
const ZONE_EDGE_BUDGET = 3000000;

/**
 * Versteckzone ins Raster einrechnen: Zellen, die weiter als der eingestellte
 * Radius von jeder zugelassenen Station entfernt sind, fallen aus dem
 * Spielgebiet heraus — dort darf sich der Hider nach euren Regeln nicht
 * aufhalten.
 *
 * Die grobe Zelle (150–300 m) entscheidet nur über den Mittelpunkt — an der
 * eigentlichen 500-m-Kante wäre das sichtbar blockig. Für Zellen nahe dieser
 * Kante (`zoneEdge`) wird deshalb zusätzlich ein feines Subraster (Ziel: 5 m)
 * exakt gegen die Stationsabstände getestet und in `zoneDetail` abgelegt;
 * `renderExclusion()` zeichnet dort das Subraster statt der groben Zelle.
 * Der Rest des Rasters (Fläche, Divisions, POI-Felder) bleibt unverändert grob.
 */
function applyHideZone(g, data) {
  g.inZone = new Uint8Array(g.xs.length);
  g.zoneEdge = new Uint8Array(g.xs.length);
  g.zoneDetail = null;
  g.zoneEdgeN = 0;
  g.hz = null;
  if (!S.hideZoneOn || !(data.stations || []).length) {
    g.inZone.set(g.inCity);
    g.zoneCount = g.count;
    return;
  }
  const st = hideStations();
  if (!st.length) { g.inZone.set(g.inCity); g.zoneCount = g.count; return; }

  const rKm = S.hideRadiusM / 1000;
  // Räumliches Gitter über die Stationen, damit die Suche nicht quadratisch wird
  const CS = Math.max(rKm / 111.32, 0.01);
  const cells = new Map();
  for (const s of st) {
    const key = hzKey(Math.floor(s.x / CS), Math.floor(s.y / CS));
    let a = cells.get(key); if (!a) { a = []; cells.set(key, a); }
    a.push(s);
  }
  const hz = { rKm, CS, cells };
  g.hz = hz;

  // Halbe Zellendiagonale in km — Toleranzband um den exakten Radius, in dem
  // die grobe Mittelpunkt-Entscheidung noch falsch liegen kann.
  const halfDiagKm = g.cellKm * Math.SQRT1_2;

  // Absichtlich NICHT auf g.inCity beschränkt: der 500-m-Kreis um eine
  // randnahe Station reicht bei manchen Stationen deutlich über die strikte
  // KVB-Polygonlinie hinaus (Dormagen Chempark z. B. zu 91 %, da der 600-m-
  // Puffer beim Polygonbau nur um die Eckstationen selbst gelegt wurde, nicht
  // gleichmäßig um jede Station). Eure Regel ist "500 m um eine zugelassene
  // Station", nicht "… und innerhalb der Polygonlinie" — deshalb zählt der
  // volle Kreis, auch wo er geometrisch außerhalb des Polygons liegt.
  let cnt = 0;
  const edgeIdx = [];
  for (let i = 0; i < g.xs.length; i++) {
    const d = nearestStationDistKm(g.xs[i], g.ys[i], hz);
    if (d <= rKm) { g.inZone[i] = 1; cnt++; }
    if (Number.isFinite(d) && Math.abs(d - rKm) <= halfDiagKm) { g.zoneEdge[i] = 1; edgeIdx.push(i); }
  }
  g.zoneCount = cnt;

  if (edgeIdx.length) {
    let n = Math.round((g.cellKm * 1000) / ZONE_EDGE_TARGET_M);
    n = Math.max(8, Math.min(80, n));
    if (edgeIdx.length * n * n > ZONE_EDGE_BUDGET) {
      n = Math.max(6, Math.floor(Math.sqrt(ZONE_EDGE_BUDGET / edgeIdx.length)));
    }
    const subDLon = g.dLon / n, subDLat = g.dLat / n;
    // Ebene Näherung statt Haversine: bei 500 m ist der Unterschied unter
    // einem Meter, aber ohne trig/sqrt sind die Millionen Subzellen-Tests
    // um Größenordnungen schneller (dieselbe Näherung nutzt schon fieldFor()).
    const kx = Math.cos(toRad(S.home.y)) * KM_PER_DEG_LAT, ky = KM_PER_DEG_LAT;
    const r2 = rKm * rKm;
    // Kandidaten-Suchradius: jede Subzelle kann bis zu einer halben
    // Zellendiagonale vom Zellenmittelpunkt entfernt sein.
    const candMarginKm = rKm + halfDiagKm * 1.001;
    const detail = new Map();
    for (const i of edgeIdx) {
      const r = Math.floor(i / g.cols), c = i % g.cols;
      const west = g.minX + c * g.dLon, south = g.minY + r * g.dLat;
      // Kandidaten einmal pro Randzelle holen statt einmal pro Subzelle.
      const cands = candidatesNear(g.xs[i], g.ys[i], st, kx, ky, candMarginKm);
      const mask = new Uint8Array(n * n);
      for (let sr = 0; sr < n; sr++) {
        const y = south + (sr + 0.5) * subDLat;
        for (let sc = 0; sc < n; sc++) {
          const x = west + (sc + 0.5) * subDLon;
          let inside = false;
          for (let k = 0; k < cands.length; k++) {
            const dx = (x - cands[k].x) * kx, dy = (y - cands[k].y) * ky;
            if (dx * dx + dy * dy <= r2) { inside = true; break; }
          }
          mask[sr * n + sc] = inside ? 0 : 1;
        }
      }
      detail.set(i, mask);
    }
    g.zoneDetail = detail;
    g.zoneEdgeN = n;
  }
}

/** Aktive (nicht abgeschaltete) POIs einer Kategorie. */
function activePois(cat) {
  const off = S.disabled[cat];
  const all = S.pois[cat] || [];
  return off && off.size ? all.filter((_, i) => !off.has(i)) : all;
}

/**
 * S.pois neu aus den eingebauten (S.data.pois) und den selbst hinzugefügten
 * Orten (S.customPois) zusammensetzen. Läuft nach jeder Änderung an
 * S.customPois — Caches (Felder, Fein-Kanten) müssen danach vom Aufrufer
 * selbst invalidiert werden (wie beim Ab-/Anschalten in renderData()).
 */
function rebuildPois() {
  S.pois = {};
  for (const p of S.data.pois) (S.pois[p.c] = S.pois[p.c] || []).push(p);
  for (const p of S.customPois) (S.pois[p.c] = S.pois[p.c] || []).push(p);
}

/** Nächster-Nachbar-Feld für eine Kategorie, mit Cache. */
function fieldFor(cat) {
  const key = cat + ':' + (S.disabled[cat] ? [...S.disabled[cat]].sort().join(',') : '');
  if (S.fields[key]) return S.fields[key];
  const pois = activePois(cat);
  const g = S.grid, n = g.xs.length;
  const idx = new Int16Array(n).fill(-1);
  const dist = new Float32Array(n).fill(Infinity);
  if (pois.length) {
    const kx = Math.cos(toRad(50.94)) * 111.32, ky = 110.57;
    for (let i = 0; i < n; i++) {
      if (!g.inCity[i]) continue;
      let best = Infinity, bk = -1;
      for (let k = 0; k < pois.length; k++) {
        const dx = (g.xs[i] - pois[k].x) * kx, dy = (g.ys[i] - pois[k].y) * ky;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bk = k; }
      }
      idx[i] = bk;
      dist[i] = distKm(g.xs[i], g.ys[i], pois[bk].x, pois[bk].y);
    }
  }
  S.fields[key] = { idx, dist, pois };
  return S.fields[key];
}

function nearestAt(cat, pt) {
  const pois = activePois(cat);
  let best = Infinity, bk = -1;
  for (let k = 0; k < pois.length; k++) {
    const d = distKm(pt[0], pt[1], pois[k].x, pois[k].y);
    if (d < best) { best = d; bk = k; }
  }
  return { k: bk, d: best, poi: pois[bk] };
}

function divIndexAt(level, pt) {
  const feats = S.data.divisions[level].features;
  for (let k = 0; k < feats.length; k++) if (pointInGeom(pt[0], pt[1], feats[k].geometry)) return k;
  return -1;
}

/* Grenzabstände: die Ringe werden einmal zu einer Punktwolke verdichtet,
   danach ist jede Abfrage eine reine Nächster-Nachbar-Suche statt einer
   Schleife über alle Segmente aller 86 Stadtteile. */
let _borders = {};
function borderPoints(level) {
  if (_borders[level]) return _borders[level];
  const STEP_DEG = 0.0012; // ~120 m Punktabstand entlang der Grenzen
  const pts = [];
  for (const f of S.data.divisions[level].features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        const n = Math.max(1, Math.ceil(len / STEP_DEG));
        for (let k = 0; k < n; k++) pts.push([a[0] + (dx * k) / n, a[1] + (dy * k) / n]);
      }
    }
  }
  // Räumliches Gitter für schnelle Nachbarsuche
  const CS = 0.01;
  const cells = new Map();
  for (const p of pts) {
    const key = Math.floor(p[0] / CS) + ':' + Math.floor(p[1] / CS);
    let arr = cells.get(key);
    if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(p);
  }
  _borders[level] = { cells, CS };
  return _borders[level];
}

function distToBorderKm(level, pt) {
  const { cells, CS } = borderPoints(level);
  const cx = Math.floor(pt[0] / CS), cy = Math.floor(pt[1] / CS);
  let best = Infinity;
  for (let ring = 0; ring < 12; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
      const arr = cells.get((cx + dx) + ':' + (cy + dy));
      if (!arr) continue;
      for (const p of arr) {
        const d = distKm(pt[0], pt[1], p[0], p[1]);
        if (d < best) best = d;
      }
    }
    // Sobald ein Treffer näher liegt als der bisher abgesuchte Radius, ist er optimal
    if (best < ring * CS * 78) break;
  }
  return best;
}

/* Rhein-Abstand für jede Rasterzelle, einmal. */
function rheinField() {
  if (S.rheinF) return S.rheinF;
  const g = S.grid, n = g.xs.length;
  const out = new Float32Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (g.inCity[i]) out[i] = distToLineKm(g.xs[i], g.ys[i], S.data.rhein);
  S.rheinF = out;
  return out;
}

/* Grenzabstand für jede Rasterzelle, einmal pro Ebene. */
function borderField(level) {
  if (!S.borderFields) S.borderFields = {};
  if (S.borderFields[level]) return S.borderFields[level];
  const g = S.grid, n = g.xs.length;
  const out = new Float32Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (g.inCity[i]) out[i] = distToBorderKm(level, [g.xs[i], g.ys[i]]);
  S.borderFields[level] = out;
  return out;
}

/* ============================================================
   Fragen anwenden
   ============================================================ */
/**
 * Baut für eine Frage+Antwort eine Prüffunktion (Zellindex -> bleibt möglich?).
 * Alle teuren Vorberechnungen passieren einmal beim Bauen, nicht pro Zelle.
 * Bewertung und Anwendung nutzen dieselbe Funktion — eine Quelle der Wahrheit.
 */
function cellTest(q, ans) {
  const g = S.grid;
  const pos = ans === 'yes' || ans === 'closer' || ans === 'hotter';
  const yes = (v) => pos === v;

  switch (q.type) {
    case 'match-poi': {
      const f = fieldFor(q.cat);
      const si = nearestAt(q.cat, q.seeker).k;
      return (i) => yes(f.idx[i] === si);
    }
    case 'match-div': {
      if (q.level === 'd1') {
        const s = sideOfLine(q.seeker[0], q.seeker[1], S.data.rhein);
        return (i) => yes(g.side[i] === s);
      }
      const arr = g[q.level], si = divIndexAt(q.level, q.seeker);
      return (i) => yes(si >= 0 && arr[i] === si);
    }
    case 'measure-poi': {
      const f = fieldFor(q.cat);
      const my = nearestAt(q.cat, q.seeker).d;
      return (i) => yes(f.dist[i] < my);
    }
    case 'measure-rhein': {
      const my = distToLineKm(q.seeker[0], q.seeker[1], S.data.rhein);
      const rf = rheinField();
      return (i) => yes(rf[i] < my);
    }
    case 'measure-border': {
      const my = distToBorderKm(q.level, q.seeker);
      const bf = borderField(q.level);
      return (i) => yes(bf[i] < my);
    }
    case 'radar': {
      const r = q.mi * MILE_KM;
      const sx = q.seeker[0], sy = q.seeker[1];
      return (i) => yes(distKm(g.xs[i], g.ys[i], sx, sy) <= r);
    }
    case 'thermo': {
      const [ax, ay] = q.from, [bx, by] = q.to;
      return (i) => yes(distKm(g.xs[i], g.ys[i], bx, by) < distKm(g.xs[i], g.ys[i], ax, ay));
    }
    case 'tentacle': {
      const r = q.mi * MILE_KM;
      const sx = q.seeker[0], sy = q.seeker[1];
      if (ans === 'none') return (i) => distKm(g.xs[i], g.ys[i], sx, sy) > r;
      const f = fieldFor(q.cat), t = +ans;
      return (i) => distKm(g.xs[i], g.ys[i], sx, sy) <= r && f.idx[i] === t;
    }
    default: return () => true;
  }
}

function applyQuestion(q, ans) {
  const g = S.grid, n = g.xs.length;
  const m = new Uint8Array(n);
  const test = cellTest(q, ans);
  for (let i = 0; i < n; i++) if (g.inCity[i] && test(i)) m[i] = 1;
  return m;
}

/**
 * Wie `cellTest`, nur als exakte Prüfung an einem beliebigen Punkt (x, y)
 * statt an einer Rasterzelle — für die Fein-Kanten-Verfeinerung unten, die
 * ja gerade *innerhalb* einer Zelle nachschauen muss. Nutzt dieselben
 * Punkt-Grundfunktionen, die im Rest der Datei schon existieren
 * (`nearestAt`, `divIndexAt`, `distToBorderKm`, `distToLineKm`, `sideOfLine`),
 * nur eben direkt aufgerufen statt aus vorgerechneten Zellenfeldern gelesen.
 *
 * `klass` sagt, wie teuer ein einzelner Aufruf ungefähr ist — davon hängt
 * ab, wie viele Subzellen sich `buildFineEdges()` für diese Frage leisten
 * kann, ohne spürbar zu hängen:
 *   'cheap' — O(1)/O(kleine Konstante): Radar, Thermometer, Rhein-/Grenz-
 *             abstand, Rheinseite.
 *   'poly'  — ein Punkt-in-Polygon-Test gegen einen bestimmten Stadtteil/
 *             Bezirk (Ringlänge kann groß sein, aber nur ein Polygon).
 *   'skip'  — Voronoi-artige Grenze über alle aktiven POIs einer Kategorie
 *             (match-poi, measure-poi, tentacle mit Ziel-POI): pro Punkt ein
 *             Scan über bis zu einigen hundert POIs, UND die Grenze selbst
 *             kann sehr lang sein. Bleibt auf dem groben Raster — siehe
 *             Projektstand.
 */
function pointTest(q, ans) {
  const pos = ans === 'yes' || ans === 'closer' || ans === 'hotter';
  const yes = (v) => pos === v;
  // Ebene Näherung statt Haversine, wie schon bei der Versteckzone — bei den
  // wenigen Kilometern Kartenausschnitt liegt der Fehler weit unter einem
  // Meter, aber ganz ohne trig/sqrt sind die Subzellen-Tests um ein
  // Vielfaches schneller.
  const kx = Math.cos(toRad(S.home.y)) * KM_PER_DEG_LAT, ky = KM_PER_DEG_LAT;

  switch (q.type) {
    case 'match-poi':
      return { klass: 'skip' };
    case 'match-div': {
      if (q.level === 'd1') {
        const s = sideOfLine(q.seeker[0], q.seeker[1], S.data.rhein);
        return { klass: 'cheap', test: (x, y) => yes(sideOfLine(x, y, S.data.rhein) === s) };
      }
      const si = divIndexAt(q.level, q.seeker);
      return { klass: 'poly', test: (x, y) => yes(si >= 0 && divIndexAt(q.level, [x, y]) === si) };
    }
    case 'measure-poi':
      return { klass: 'skip' };
    // measure-rhein/-border: distToLineKm/distToBorderKm sind selbst schon
    // Suchen (Liniensegmente bzw. eine sich ausweitende Ringsuche über
    // Grenzpunkte), je Aufruf ~100-300x teurer als die O(1)-Tests oben —
    // gemessen ~270µs/Aufruf, macht selbst ein kleines Subraster-Budget zu
    // mehreren Sekunden. Bleiben deshalb auf dem groben Raster wie die
    // POI-Fragen (siehe Projektstand).
    case 'measure-rhein':
    case 'measure-border':
      return { klass: 'skip' };
    case 'radar': {
      const r2 = (q.mi * MILE_KM) ** 2, sx = q.seeker[0], sy = q.seeker[1];
      return {
        klass: 'cheap',
        test: (x, y) => { const dx = (x - sx) * kx, dy = (y - sy) * ky; return yes(dx * dx + dy * dy <= r2); },
      };
    }
    case 'thermo': {
      const [ax, ay] = q.from, [bx, by] = q.to;
      return {
        klass: 'cheap',
        test: (x, y) => {
          const dxa = (x - ax) * kx, dya = (y - ay) * ky, dxb = (x - bx) * kx, dyb = (y - by) * ky;
          return yes(dxb * dxb + dyb * dyb < dxa * dxa + dya * dya);
        },
      };
    }
    case 'tentacle': {
      const r2 = (q.mi * MILE_KM) ** 2, sx = q.seeker[0], sy = q.seeker[1];
      if (ans === 'none') {
        return {
          klass: 'cheap',
          test: (x, y) => { const dx = (x - sx) * kx, dy = (y - sy) * ky; return dx * dx + dy * dy > r2; },
        };
      }
      return { klass: 'skip' };
    }
    default:
      return { klass: 'skip' };
  }
}

// Budgets für die Fein-Kanten-Verfeinerung, je nach Kosten pro Punkt-Test
// (siehe pointTest oben) — gleiche Logik wie ZONE_EDGE_BUDGET, nur pro Klasse.
// 'cheap' (Radar/Thermometer/Rheinseite): reine Arithmetik, günstig, gemessen
// <1µs/Test. 'poly' (Stadtteil/Bezirk): Punkt-in-Polygon ohne Raumindex,
// gemessen ~1,5µs/Test bei 9 Bezirken — das Budget hält den Extremfall
// (großflächiger Bezirk, viele Randzellen) unter ~350 ms.
const EDGE_BUDGETS = { cheap: 3000000, poly: 100000 };

/** Nachbarzellen einer Maske, bei denen sich der Wert ändert — die groben
    Kandidaten für eine Kante, ganz ohne fragen-spezifische Geometrie. */
function maskEdgeCells(mask, g) {
  const out = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c;
    if (!g.inCity[i]) continue;
    const right = c + 1 < g.cols ? i + 1 : -1;
    const down = r + 1 < g.rows ? i + g.cols : -1;
    let edge = false;
    if (right >= 0 && g.inCity[right] && mask[right] !== mask[i]) edge = true;
    if (down >= 0 && g.inCity[down] && mask[down] !== mask[i]) edge = true;
    if (edge) out.push(i);
  }
  return out;
}

/**
 * Vereinheitlichte Fein-Kanten-Verfeinerung: Versteckzone (aus applyHideZone,
 * schon exakt über den halben-Diagonale-Test) plus jede beantwortete Frage
 * mit einfacher Geometrie (aus maskEdgeCells) landen hier als "Quellen" in
 * einem gemeinsamen Topf. Für jede betroffene Zelle wird geprüft, ob *alle
 * anderen* Quellen die Zelle ohnehin schon vollständig freigeben — nur dann
 * ist es sicher, die Zelle über ein Subraster (statt als grobes Rechteck)
 * zu zeichnen, weil dann wirklich nur noch die hier geprüfte(n) Quelle(n)
 * über die Zelle entscheiden.
 *
 * Ergebnis in `S.fineEdge` (Map<Zellindex, {n, mask}>) und `S.fineEdgeN`
 * — von `renderExclusion()` genauso genutzt wie vorher `grid.zoneDetail`.
 */
function buildFineEdges() {
  S.fineEdge = null;
  if (!S.fineEdgesOn) return;
  const g = S.grid;
  if (!g) return;

  // Quellen sammeln: {mask, edgeIdx, test, klass, isHideZone}
  const sources = [];
  if (S.hideZoneOn && g.hz) {
    const hz = g.hz, rKm = hz.rKm, r2 = rKm * rKm, st = hideStations();
    const kx = Math.cos(toRad(S.home.y)) * KM_PER_DEG_LAT, ky = KM_PER_DEG_LAT;
    const edgeIdx = [];
    for (let i = 0; i < g.zoneEdge.length; i++) if (g.zoneEdge[i]) edgeIdx.push(i);
    sources.push({
      mask: g.inZone,
      edgeIdx,
      klass: 'cheap',
      isHideZone: true,
      // Gleiche ebene Näherung wie applyHideZone (kein Haversine hier — das
      // wäre bei Überlappung mit einer anderen Frage sonst wieder der alte
      // Performance-Fehler). Kandidaten werden hier nicht pro Zelle
      // vorgefiltert, weil dieser Pfad ohnehin nur bei einer echten
      // Überlappung mit einer anderen Frage läuft — also sehr selten.
      test: (x, y) => {
        for (const s of st) {
          const dx = (x - s.x) * kx, dy = (y - s.y) * ky;
          if (dx * dx + dy * dy <= r2) return true;
        }
        return false;
      },
    });
  }
  for (const h of S.history) {
    const pt = pointTest(h.q, h.ans);
    const m = applyQuestion(h.q, h.ans);
    if (pt.klass === 'skip') continue;
    sources.push({ mask: m, edgeIdx: maskEdgeCells(m, g), klass: pt.klass, test: pt.test });
  }
  if (!sources.length) return;

  // Pro Zelle: welche Quellen (Index in `sources`) sind hier an der Kante?
  const bySource = new Map(); // Zellindex -> [Quellindex, ...]
  sources.forEach((src, si) => {
    for (const i of src.edgeIdx) {
      let a = bySource.get(i); if (!a) { a = []; bySource.set(i, a); }
      a.push(si);
    }
  });
  if (!bySource.size) return;

  const detail = new Map();

  // Kosten-Klasse je betroffener Zelle bestimmen (die teuerste beteiligte
  // Quelle entscheidet über das Budget dieser Zelle), Subraster-Auflösung
  // pro Klasse einmal vorab festlegen (wie bei der Versteckzone).
  const nForClass = {};
  for (const klass of Object.keys(EDGE_BUDGETS)) {
    const cellsOfClass = [...bySource.values()].filter((list) =>
      list.some((si) => sources[si].klass === klass)).length || 1;
    let k = Math.round((g.cellKm * 1000) / ZONE_EDGE_TARGET_M);
    k = Math.max(8, Math.min(80, k));
    if (cellsOfClass * k * k > EDGE_BUDGETS[klass]) {
      k = Math.max(6, Math.floor(Math.sqrt(EDGE_BUDGETS[klass] / cellsOfClass)));
    }
    nForClass[klass] = k;
  }

  for (const [i, srcIdxs] of bySource) {
    // Ist jede NICHT hier beteiligte Quelle für diese Zelle schon vollständig
    // erfüllt? Nur dann bestimmen ausschließlich die hier geprüften Quellen
    // den wahren Zustand — sonst bliebe die Verfeinerung falsch-optimistisch.
    let othersOk = true;
    for (let si = 0; si < sources.length && othersOk; si++) {
      if (srcIdxs.includes(si)) continue;
      if (!sources[si].mask[i]) othersOk = false;
    }
    if (!othersOk) continue;

    const involved = srcIdxs.map((si) => sources[si]);

    // Schneller Sonderfall: Zelle nur an der Versteckzonen-Kante, keine
    // andere Frage beteiligt — dann die längst fertige, mit Kandidaten-Cache
    // vorberechnete Maske aus applyHideZone direkt übernehmen, statt sie
    // hier nochmal (langsamer, ohne Kandidaten-Vorfilterung) zu berechnen.
    if (involved.length === 1 && involved[0].isHideZone && g.zoneDetail && g.zoneDetail.has(i)) {
      detail.set(i, { n: g.zoneEdgeN, mask: g.zoneDetail.get(i) });
      continue;
    }

    const useN = Math.min(...involved.map((s) => nForClass[s.klass]));

    const r = Math.floor(i / g.cols), c = i % g.cols;
    const west = g.minX + c * g.dLon, south = g.minY + r * g.dLat;
    const subDLon = g.dLon / useN, subDLat = g.dLat / useN;
    const mask = new Uint8Array(useN * useN);
    for (let sr = 0; sr < useN; sr++) {
      const y = south + (sr + 0.5) * subDLat;
      for (let sc = 0; sc < useN; sc++) {
        const x = west + (sc + 0.5) * subDLon;
        let ok = true;
        for (const s of involved) if (!s.test(x, y)) { ok = false; break; }
        mask[sr * useN + sc] = ok ? 0 : 1; // 1 = ausgeschlossen
      }
    }
    // Wenn Zellen mit unterschiedlicher Auflösung vorkommen (verschiedene
    // Klassen gemischt), auf die kleinste gemeinsame Auflösung im Datensatz
    // zurechtstutzen ist unnötig — jede Zelle trägt ihre eigene `n` mit.
    detail.set(i, { n: useN, mask });
  }

  if (detail.size) S.fineEdge = detail;
}

const ANSWER_SETS = {
  'match-poi': ['yes', 'no'], 'match-div': ['yes', 'no'],
  'measure-poi': ['closer', 'further'], 'measure-rhein': ['closer', 'further'],
  'measure-border': ['closer', 'further'],
  radar: ['yes', 'no'], thermo: ['hotter', 'colder'],
};

function liveCount(mask) {
  let k = 0;
  for (let i = 0; i < S.live.length; i++) if (S.live[i] && (!mask || mask[i])) k++;
  return k;
}

/* Stichprobe der noch möglichen Zellen — für die Bewertung genügt ein
   repräsentativer Anteil, und die Liste bleibt dadurch sofort bedienbar. */
const SAMPLE_MAX = 2600;
function liveSample() {
  if (S._sample && S._sampleFor === S.stamp) return S._sample;
  const idx = [];
  for (let i = 0; i < S.live.length; i++) if (S.live[i]) idx.push(i);
  let s = idx;
  if (idx.length > SAMPLE_MAX) {
    const step = idx.length / SAMPLE_MAX;
    s = [];
    for (let k = 0; k < SAMPLE_MAX; k++) s.push(idx[Math.floor(k * step)]);
  }
  S._sample = { idx: s, total: idx.length, scale: idx.length / (s.length || 1) };
  S._sampleFor = S.stamp;
  return S._sample;
}

/**
 * Informationsgewinn einer Frage: welcher Anteil der Restfläche bleibt
 * im ungünstigsten Fall übrig? Gerechnet auf der Stichprobe.
 */
function evaluate(q) {
  const answers = ANSWER_SETS[q.type];
  if (!answers) return null;
  const sm = liveSample();
  if (!sm.total) return null;

  const opts = answers.map((a) => {
    const test = cellTest(q, a);
    let k = 0;
    for (const i of sm.idx) if (test(i)) k++;
    return { answer: a, keep: Math.round(k * sm.scale), frac: k / sm.idx.length };
  });
  const worst = Math.max(...opts.map((o) => o.frac));
  return { opts, worst, total: sm.total, useless: worst >= 0.999 };
}

/* ============================================================
   Fragenkatalog
   ============================================================ */
function buildCatalog() {
  const sk = S.seeker;
  const cat = [];

  /* --- Matching --- */
  const matching = [];
  matching.push({
    type: 'match-div', level: 'd1', seeker: sk,
    name: 'Rheinseite (1st Division)',
    sub: 'Bist du auf derselben Rheinseite wie ich?',
    ask: 'Ist deine <em>Rheinseite</em> dieselbe wie meine?',
    ctx: () => (sideOfLine(sk[0], sk[1], S.data.rhein) === 1 ? 'linksrheinisch' : 'rechtsrheinisch'),
  });
  matching.push({
    type: 'match-div', level: 'd2', seeker: sk,
    name: 'Stadtbezirk (2nd Division)',
    sub: 'Bist du im selben Stadtbezirk?',
    ask: 'Ist dein nächster <em>Stadtbezirk</em> derselbe wie meiner?',
    ctx: () => S.data.divisions.d2.features[divIndexAt('d2', sk)]?.name || 'außerhalb',
  });
  matching.push({
    type: 'match-div', level: 'd3', seeker: sk,
    name: 'Stadtteil (3rd Division)',
    sub: 'Bist du im selben Stadtteil?',
    ask: 'Ist dein <em>Stadtteil</em> derselbe wie meiner?',
    ctx: () => S.data.divisions.d3.features[divIndexAt('d3', sk)]?.name || 'außerhalb',
  });
  for (const c of CAT_ORDER) {
    if (!activePois(c).length) continue;
    matching.push({
      type: 'match-poi', cat: c, seeker: sk,
      name: CATS[c].label,
      sub: 'Ist dein nächstes ' + CATS[c].label + ' dasselbe?',
      ask: 'Ist dein nächstes <em>' + CATS[c].label + '</em> dasselbe wie meines?',
      ctx: () => nearestAt(c, sk).poi?.n || '—',
    });
  }
  cat.push({ title: 'Matching', hint: '3 Karten ziehen, 1 behalten', items: matching });

  /* --- Measuring --- */
  const measuring = [];
  measuring.push({
    type: 'measure-rhein', seeker: sk,
    name: 'Rhein', sub: 'Näher am Rhein oder weiter weg?',
    ask: 'Bist du näher am <em>Rhein</em> oder weiter weg als ich?',
    ctx: () => distToLineKm(sk[0], sk[1], S.data.rhein).toFixed(2) + ' km entfernt',
  });
  measuring.push({
    type: 'measure-border', level: 'd2', seeker: sk,
    name: 'Bezirksgrenze', sub: 'Näher an einer Bezirksgrenze?',
    ask: 'Bist du näher an einer <em>Stadtbezirksgrenze</em> oder weiter weg als ich?',
    ctx: () => distToBorderKm('d2', sk).toFixed(2) + ' km entfernt',
  });
  measuring.push({
    type: 'measure-border', level: 'd3', seeker: sk,
    name: 'Stadtteilgrenze', sub: 'Näher an einer Stadtteilgrenze?',
    ask: 'Bist du näher an einer <em>Stadtteilgrenze</em> oder weiter weg als ich?',
    ctx: () => distToBorderKm('d3', sk).toFixed(2) + ' km entfernt',
  });
  for (const c of CAT_ORDER) {
    if (!activePois(c).length) continue;
    measuring.push({
      type: 'measure-poi', cat: c, seeker: sk,
      name: CATS[c].label, sub: 'Näher am nächsten ' + CATS[c].label + '?',
      ask: 'Bist du näher an einem <em>' + CATS[c].label + '</em> oder weiter weg als ich?',
      ctx: () => { const r = nearestAt(c, sk); return r.poi ? r.d.toFixed(2) + ' km · ' + r.poi.n : '—'; },
    });
  }
  cat.push({ title: 'Measuring', hint: '3 Karten ziehen, 1 behalten', items: measuring });

  /* --- Radar --- */
  cat.push({
    title: 'Radar', hint: '2 Karten ziehen, 1 behalten',
    items: RADAR_MI.map((mi) => ({
      type: 'radar', mi, seeker: sk,
      name: fmtMi(mi), sub: (mi * MILE_KM).toFixed(2) + ' km Radius',
      ask: 'Bist du innerhalb von <em>' + fmtMi(mi) + '</em> von mir?',
      ctx: () => 'Radius ' + (mi * MILE_KM).toFixed(2) + ' km',
    })),
  });

  /* --- Thermometer --- */
  cat.push({
    title: 'Thermometer', hint: 'Erst fahren, dann Endpunkt setzen',
    items: THERMO_MI.map((mi) => ({
      type: 'thermo', mi, seeker: sk, needsSecond: true,
      name: fmtMi(mi) + ' fahren',
      sub: 'Startpunkt = aktuelle Position',
      ask: 'Nach <em>' + fmtMi(mi) + '</em> Fahrt: wärmer oder kälter?',
      ctx: () => 'Endpunkt auf der Karte setzen',
    })),
  });

  /* --- Tentacles --- */
  const tent = [];
  for (const c of ['museum', 'library', 'cinema', 'hospital']) {
    if (!activePois(c).length) continue;
    tent.push({
      type: 'tentacle', cat: c, mi: 1, seeker: sk,
      name: CATS[c].plural + ' · 1 Meile',
      sub: 'Welches ' + CATS[c].label + ' ist dir am nächsten?',
      ask: 'Welchem <em>' + CATS[c].label + '</em> im Umkreis von 1 Meile bist du am nächsten?',
      ctx: () => inReach(c, sk, 1).length + ' in Reichweite',
    });
  }
  cat.push({ title: 'Tentacles', hint: '4 Karten ziehen, 2 behalten · nur Medium+', items: tent });

  return cat;
}

function inReach(cat, pt, mi) {
  const r = mi * MILE_KM;
  const pois = activePois(cat);
  const out = [];
  pois.forEach((p, i) => { if (distKm(p.x, p.y, pt[0], pt[1]) <= r) out.push({ i, p }); });
  return out;
}

function fmtMi(mi) {
  if (mi === 0.25) return '¼ Meile';
  if (mi === 0.5) return '½ Meile';
  return mi + (mi === 1 ? ' Meile' : ' Meilen');
}

const ANS_LABEL = {
  yes: 'Ja', no: 'Nein', closer: 'Näher', further: 'Weiter weg',
  hotter: 'Wärmer', colder: 'Kälter', none: 'Nicht in Reichweite',
};

/* ============================================================
   Karte
   ============================================================ */
function initMap() {
  if (typeof L === 'undefined') { S.noMap = true; return; }
  const c = S.data.center;
  S.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([c[1], c[0]], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap',
  }).addTo(S.map);

  S.layers.excl = L.layerGroup().addTo(S.map);
  S.layers.area = L.layerGroup().addTo(S.map);
  S.layers.edges = L.layerGroup().addTo(S.map);
  S.layers.marks = L.layerGroup().addTo(S.map);
  defineExclusionLayer();

  // Stadtgrenze als Orientierung
  L.geoJSON({ type: 'Feature', geometry: S.data.city_boundary }, {
    style: { color: '#555', weight: 1.2, fill: false, dashArray: '3 4', opacity: .45 },
  }).addTo(S.map);

  S.map.on('click', onMapClick);
  drawArea();
  fitArea();
}

/** Grenze des Spielgebiets und die Stationen zeichnen. */
function drawArea() {
  if (S.noMap || !S.layers.area) return;
  S.layers.area.clearLayers();

  if (S.useArea && S.data.play_area) {
    L.polygon(S.data.play_area.ring.map((p) => [p[1], p[0]]), {
      color: '#555', weight: 1.8, opacity: .65, fill: false, dashArray: '7 4',
      interactive: false,
    }).addTo(S.layers.area);
  } else {
    L.circle([S.home.y, S.home.x], {
      radius: S.radiusKm * 1000,
      color: '#555', weight: 1.6, opacity: .6, fill: false, dashArray: '6 4',
      interactive: false,
    }).addTo(S.layers.area);
  }

  // Stationen als kleine Punkte — zeigt, worauf sich die Versteckzone stützt
  if (S.showStations) {
    const col = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#0a7f96';
    for (const s of hideStations()) {
      L.circleMarker([s.y, s.x], {
        radius: 2.5, color: col, weight: 1, opacity: .85,
        fillColor: col, fillOpacity: .7, interactive: false,
      }).addTo(S.layers.area);
    }
  }

  // Orte (Museen, Parks, eigene Einträge …) als Punkte — auf Wunsch im Orte-Tab
  if (S.showPois) {
    const poiCol = getComputedStyle(document.body).getPropertyValue('--warn').trim() || '#c0392b';
    for (const c of CAT_ORDER) {
      for (const p of activePois(c)) {
        L.circleMarker([p.y, p.x], {
          radius: p.custom ? 4 : 3, color: poiCol, weight: p.custom ? 1.6 : 1,
          fillColor: poiCol, fillOpacity: p.custom ? .85 : .55, opacity: .9,
          interactive: true,
        }).bindTooltip(esc(p.n) + ' · ' + CATS[c].label, { direction: 'top', offset: [0, -4] })
          .addTo(S.layers.area);
      }
    }
  }
}

/**
 * Exakte Kanten der beantworteten Fragen als scharfe Linien über das Raster
 * legen — ein Radar-Kreis ist ein Kreis, keine Treppe aus Rasterzellen.
 * Das Raster bleibt für die Flächenrechnung zuständig, diese Linien zeigen,
 * wo die Grenze tatsächlich verläuft.
 */
function drawEdges() {
  if (S.noMap || !S.layers.edges) return;
  S.layers.edges.clearLayers();
  const col = getComputedStyle(document.body).getPropertyValue('--edge').trim() || '#0a7f96';
  const style = { color: col, weight: 2, opacity: .9, fill: false, interactive: false };

  for (const h of S.history) {
    const q = h.q;
    if (q.type === 'radar') {
      L.circle([q.seeker[1], q.seeker[0]], {
        ...style, radius: q.mi * MILE_KM * 1000,
        dashArray: h.ans === 'yes' ? null : '5 4',
      }).addTo(S.layers.edges);
    } else if (q.type === 'tentacle') {
      L.circle([q.seeker[1], q.seeker[0]], {
        ...style, radius: q.mi * MILE_KM * 1000, dashArray: '5 4', weight: 1.5,
      }).addTo(S.layers.edges);
    } else if (q.type === 'thermo') {
      // Mittelsenkrechte zwischen Start- und Endpunkt
      const [ax, ay] = q.from, [bx, by] = q.to;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-9;
      // Senkrechte, verlängert über das Spielgebiet hinaus
      const ext = (S.radiusKm * 2.2) / 111.32;
      const px = (-dy / len) * ext, py = (dx / len) * ext / Math.cos(toRad(my));
      L.polyline([[my - py, mx - px], [my + py, mx + px]], {
        ...style, dashArray: '6 4',
      }).addTo(S.layers.edges);
    }
  }
}

/** Ausgeschlossene Zellen als Canvas-Overlay zeichnen. */
function renderExclusion() {
  if (S.noMap || !S.layers.excl) { updateStats(); return; }
  S.layers.excl.clearLayers();
  const g = S.grid;
  let any = false;
  for (let i = 0; i < S.live.length; i++) if (g.inCity[i] && !S.live[i]) { any = true; break; }
  if (!any) { updateStats(); return; }

  S.layers.excl.addLayer(new ExclusionLayer());
  updateStats();
}

/**
 * Overlay der ausgeschlossenen Zellen.
 * Zeichnet in Layer-Koordinaten und skaliert während der Zoom-Animation
 * per CSS mit, damit das Bild nicht hinterherhängt. Zusammenhängende Zellen
 * einer Rasterzeile werden zu einem Rechteck zusammengefasst.
 */
let ExclusionLayer = null;
function defineExclusionLayer() {
  if (ExclusionLayer || typeof L === 'undefined') return;
  ExclusionLayer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      const c = this._c = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
      c.style.pointerEvents = 'none';
      map.getPanes().overlayPane.appendChild(c);
      map.on('moveend zoomend resize', this._reset, this);
      if (map._zoomAnimated) map.on('zoomanim', this._animZoom, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      map.off('zoomanim', this._animZoom, this);
      if (this._c && this._c.parentNode) this._c.parentNode.removeChild(this._c);
    },

    /* Während der Zoom-Animation: dasselbe Bild mitskalieren statt neu rechnen. */
    _animZoom(e) {
      if (!this._origin) return;
      const scale = this._map.getZoomScale(e.zoom, this._zoom);
      const off = this._map._latLngToNewLayerPoint(this._origin, e.zoom, e.center);
      L.DomUtil.setTransform(this._c, off, scale);
    },

    _reset() {
      const map = this._map, c = this._c;
      const size = map.getSize();
      // Etwas größer als der Viewport, damit Wischen keine leeren Ränder zeigt
      const pad = 0.25;
      const padded = size.multiplyBy(pad);
      const min = map.containerPointToLayerPoint(padded.multiplyBy(-1)).round();
      this._bufSize = size.add(padded.multiplyBy(2));
      this._min = min;
      this._zoom = map.getZoom();
      this._origin = map.layerPointToLatLng(min);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = this._bufSize.x * dpr;
      c.height = this._bufSize.y * dpr;
      c.style.width = this._bufSize.x + 'px';
      c.style.height = this._bufSize.y + 'px';
      L.DomUtil.setTransform(c, min, 1);
      this._draw(dpr);
    },

    _draw(dpr) {
      const map = this._map, ctx = this._c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this._bufSize.x, this._bufSize.y);
      ctx.fillStyle = getComputedStyle(document.body)
        .getPropertyValue('--exclude').trim() || '#c0392b';
      ctx.globalAlpha = 0.5;

      const gg = S.grid, min = this._min;
      // Sichtbarer Bereich in Rasterspalten/-zeilen
      const nw = map.layerPointToLatLng(min);
      const se = map.layerPointToLatLng(min.add(this._bufSize));
      const c0 = Math.max(0, Math.floor((Math.min(nw.lng, se.lng) - gg.minX) / gg.dLon) - 1);
      const c1 = Math.min(gg.cols - 1, Math.ceil((Math.max(nw.lng, se.lng) - gg.minX) / gg.dLon) + 1);
      const r0 = Math.max(0, Math.floor((Math.min(nw.lat, se.lat) - gg.minY) / gg.dLat) - 1);
      const r1 = Math.min(gg.rows - 1, Math.ceil((Math.max(nw.lat, se.lat) - gg.minY) / gg.dLat) + 1);

      const px = (lat, lng) => {
        const p = map.latLngToLayerPoint([lat, lng]);
        return [p.x - min.x, p.y - min.y];
      };

      for (let r = r0; r <= r1; r++) {
        let runStart = -1;
        const flush = (endC) => {
          if (runStart < 0) return;
          const west = gg.minX + runStart * gg.dLon;
          const east = gg.minX + endC * gg.dLon;
          const south = gg.minY + r * gg.dLat;
          const north = gg.minY + (r + 1) * gg.dLat;
          const [x1, y1] = px(north, west);
          const [x2, y2] = px(south, east);
          ctx.fillRect(x1, y1, Math.max(1, x2 - x1 + 0.5), Math.max(1, y2 - y1 + 0.5));
          runStart = -1;
        };
        for (let c = c0; c <= c1; c++) {
          const i = r * gg.cols + c;
          // Zellen außerhalb der strikten Polygonlinie, aber noch innerhalb
          // der Versteckzone eines randnahen Stations-Kreises (S.live[i]
          // kommt aus grid.inZone, das seit Kurzem NICHT mehr an inCity
          // hängt — siehe applyHideZone), zählen als möglich und bleiben wie
          // vorher unbemalt statt komplett übersprungen — sonst wäre dieser
          // Teil des Kreises unsichtbar (weder rot noch als Kartenfläche
          // erkennbar). Außerhalb von inCity und nicht live bleibt wie
          // gehabt unbemalt (kein flächendeckendes Rot außerhalb des
          // Spielgebiets — das wäre eine größere optische Änderung, als
          // hier nötig ist).
          if (!gg.inCity[i]) { flush(c); continue; }
          // An einer Kante (Versteckzone oder eine beantwortete Frage mit
          // einfacher Geometrie, siehe buildFineEdges): feines Subraster
          // statt der groben Zelle. buildFineEdges hat schon geprüft, dass
          // hier keine andere Quelle mitredet — sonst gäbe es hier keinen
          // Eintrag und die Zelle bleibt unten die grobe, konservative.
          const fine = S.fineEdge && S.fineEdge.get(i);
          if (fine) {
            flush(c);
            drawFineCell(ctx, gg, fine, r, c, px);
            continue;
          }
          const excluded = !S.live[i];
          if (excluded) { if (runStart < 0) runStart = c; }
          else flush(c);
        }
        flush(c1 + 1);
      }
    },
  });
}

/** Zeichnet eine einzelne Randzelle über ihr feines Subraster
    (siehe buildFineEdges) statt als ein grobes Rechteck. */
function drawFineCell(ctx, gg, fine, r, c, px) {
  const n = fine.n, mask = fine.mask;
  const west = gg.minX + c * gg.dLon, south = gg.minY + r * gg.dLat;
  const subDLon = gg.dLon / n, subDLat = gg.dLat / n;
  for (let sr = 0; sr < n; sr++) {
    let runStart = -1;
    for (let sc = 0; sc <= n; sc++) {
      const excluded = sc < n && mask[sr * n + sc];
      if (excluded && runStart < 0) runStart = sc;
      if (!excluded && runStart >= 0) {
        const w = west + runStart * subDLon, e = west + sc * subDLon;
        const s = south + sr * subDLat, no = south + (sr + 1) * subDLat;
        const [x1, y1] = px(no, w);
        const [x2, y2] = px(s, e);
        ctx.fillRect(x1, y1, Math.max(1, x2 - x1 + 0.5), Math.max(1, y2 - y1 + 0.5));
        runStart = -1;
      }
    }
  }
}

function renderMarks() {
  if (S.noMap || !S.layers.marks) return;
  S.layers.marks.clearLayers();
  if (S.seeker) {
    const el = L.divIcon({
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      html: '<div style="width:18px;height:18px;border-radius:50%;background:var(--accent);' +
            'border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
    });
    L.marker([S.seeker[1], S.seeker[0]], { icon: el, interactive: false }).addTo(S.layers.marks);
  }
  if (S.thermoFrom) {
    const el = L.divIcon({
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      html: '<div style="width:14px;height:14px;border-radius:50%;background:var(--warn);' +
            'border:2px solid #fff"></div>',
    });
    L.marker([S.thermoFrom[1], S.thermoFrom[0]], { icon: el, interactive: false }).addTo(S.layers.marks);
  }
}

function updateStats() {
  const k = liveCount(null);
  const area = k * cellArea();
  const el = document.getElementById('statArea');
  const unit = document.getElementById('statUnit');
  if (area >= 10) { el.textContent = area.toFixed(0); unit.textContent = 'km² möglich'; }
  else if (area >= 0.05) { el.textContent = area.toFixed(1); unit.textContent = 'km² möglich'; }
  else { el.textContent = k; unit.textContent = 'Zellen'; }
  el.style.color = k === 0 ? 'var(--exclude)' : 'var(--keep)';
}

/* ============================================================
   Interaktion
   ============================================================ */
function onMapClick(e) {
  const pt = [e.latlng.lng, e.latlng.lat];
  if (S.picking) { const f = S.picking; S.picking = null; hint(null); f(pt); return; }
  setSeeker(pt, false);
}

/** Seeker-Position setzen; `center` zentriert die Karte darauf. */
function setSeeker(pt, center) {
  S.seeker = pt;
  if (center && S.map) S.map.setView([pt[1], pt[0]], Math.max(S.map.getZoom(), 13));
  renderMarks(); renderAsk(); save();
}

/** Lesbarer Name der Position: Stadtteil, sonst Lage zum Spielgebiet. */
function placeName(pt) {
  const k = divIndexAt('d3', pt);
  if (k >= 0) {
    const st = S.data.divisions.d3.features[k].name;
    const b = divIndexAt('d2', pt);
    return b >= 0 ? st + ' · ' + S.data.divisions.d2.features[b].name : st;
  }
  const d = distKm(pt[0], pt[1], S.home.x, S.home.y);
  return d <= S.radiusKm
    ? 'Außerhalb Kölns · ' + d.toFixed(1) + ' km vom Start'
    : 'Außerhalb des Spielgebiets';
}

/** Dialog zur Eingabe von Koordinaten. */
function askCoords() {
  const card = document.getElementById('sheetCard');
  const cur = S.seeker || [S.home.x, S.home.y];
  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">Koordinaten eingeben</div>' +
    '<div class="qmeta">Breite und Länge, z. B. <code>50.94278, 6.95907</code> — ' +
    'so wie Google Maps sie beim Langdruck anzeigt.</div>' +
    '<input class="sel" id="coordIn" inputmode="decimal" autocomplete="off" ' +
    'placeholder="50.94278, 6.95907" value="' + cur[1].toFixed(5) + ', ' + cur[0].toFixed(5) + '">' +
    '<div class="note" id="coordMsg"></div>' +
    '<div class="answers">' +
    '<button class="ans yes" id="coordOk">Position setzen</button>' +
    '</div><button class="ghost" data-a="">Abbrechen</button>';

  const input = card.querySelector('#coordIn');
  const msg = card.querySelector('#coordMsg');
  const apply = () => {
    const p = parseCoords(input.value);
    if (!p) { msg.textContent = 'Bitte zwei Zahlen eingeben, z. B. 50.94278, 6.95907'; return; }
    if (p[1] < 47 || p[1] > 55 || p[0] < 5 || p[0] > 10) {
      msg.textContent = 'Das liegt weit außerhalb der Region — Breite und Länge vertauscht?';
      return;
    }
    closeSheet(); setSeeker(p, true);
  };
  card.querySelector('#coordOk').onclick = apply;
  input.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 40);
}

/** Akzeptiert "50.94, 6.96", "50.94 6.96" und Google-Maps-Links. */
function parseCoords(s) {
  const txt = String(s);
  const url = txt.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (url) return [parseFloat(url[2]), parseFloat(url[1])];
  // Zahlen mit Punkt als Dezimaltrenner; Komma gilt nur als Trennzeichen.
  const nums = txt.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = parseFloat(nums[0]), lon = parseFloat(nums[1]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  return [lon, lat];
}

function hint(text) {
  const el = document.getElementById('mapHint');
  if (!text) { el.hidden = true; return; }
  el.textContent = text; el.hidden = false;
}

function pickPoint(text) {
  return new Promise((res) => { hint(text); S.picking = res; });
}

/* ---------- Fragen-Tab ---------- */
function renderAsk() {
  const box = document.getElementById('tabAsk');
  box.innerHTML = '';

  if (!S.seeker) {
    box.innerHTML =
      '<div class="empty"><b>Wo stehst du?</b>' +
      'Danach erscheinen alle Fragen mit ihrem Informationsgewinn.</div>' +
      '<div class="setgrid">' +
      '<button class="btn" id="btnGeo">Mein Standort</button>' +
      '<button class="btn flat" id="btnHome">' + esc(S.home.name) + '</button>' +
      '</div>' +
      '<button class="btn flat" id="btnCoord">Koordinaten eingeben</button>' +
      '<div class="note">Oder tippe direkt auf die Karte.</div>';
    document.getElementById('btnGeo').onclick = useGeolocation;
    document.getElementById('btnHome').onclick = () => setSeeker([S.home.x, S.home.y], true);
    document.getElementById('btnCoord').onclick = askCoords;
    return;
  }

  if (liveCount(null) === 0) {
    box.innerHTML =
      '<div class="empty"><b>Keine Fläche übrig</b>' +
      'Alle Zellen sind ausgeschlossen. Vermutlich wurde eine Antwort falsch ' +
      'eingetragen — lösche im Verlauf die letzte Frage.</div>';
    return;
  }

  // Standortleiste: zeigt die aktuelle Position und erlaubt sie zu ändern
  const bar = document.createElement('div');
  bar.className = 'posbar';
  const where = placeName(S.seeker);
  bar.innerHTML =
    '<div class="poswho"><span class="posdot"></span>' +
    '<div><div class="posname">' + esc(where) + '</div>' +
    '<div class="poscoord">' + S.seeker[1].toFixed(5) + ', ' + S.seeker[0].toFixed(5) + '</div></div></div>' +
    '<div class="posacts">' +
    '<button class="minibtn" id="pGeo" title="Mein Standort">GPS</button>' +
    '<button class="minibtn" id="pHome" title="' + esc(S.home.name) + '">Start</button>' +
    '<button class="minibtn" id="pCoord" title="Koordinaten eingeben">Koord.</button>' +
    '</div>';
  box.appendChild(bar);
  bar.querySelector('#pGeo').onclick = useGeolocation;
  bar.querySelector('#pHome').onclick = () => setSeeker([S.home.x, S.home.y], true);
  bar.querySelector('#pCoord').onclick = askCoords;

  const frag = document.createDocumentFragment();
  for (const grp of buildCatalog()) {
    if (!grp.items.length) continue;
    const key = 'ask:' + grp.title;
    const isOpen = !isCollapsed(key);
    const sec = document.createElement('div');
    sec.className = 'group' + (isOpen ? '' : ' collapsed');
    const hd = document.createElement('button');
    hd.type = 'button';
    hd.className = 'grouphd';
    hd.setAttribute('aria-expanded', String(isOpen));
    hd.innerHTML =
      '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
      '<span class="grouptitle">' + grp.title + '</span>' +
      ' <span class="ghint">' + grp.hint + '</span>';
    hd.onclick = () => { toggleCollapsed(key); renderAsk(); };
    sec.appendChild(hd);

    const body = document.createElement('div');
    body.className = 'groupbody';
    sec.appendChild(body);

    for (const q of grp.items) {
      const row = document.createElement('button');
      row.className = 'qrow';
      const ev = q.needsSecond || q.type === 'tentacle' ? null : evaluate(q);

      let gain = '';
      if (ev) {
        const pctKeep = Math.round(ev.worst * 100);
        const cut = 100 - pctKeep;
        gain =
          '<div class="gain"><div class="gainbar"><i style="width:' + cut + '%"></i></div>' +
          '<span class="gaintxt">' + (ev.useless ? 'ohne Wirkung' : '−' + cut + '% min.') + '</span></div>';
        if (ev.useless) row.classList.add('dead');
      } else if (q.type === 'tentacle') {
        const n = inReach(q.cat, S.seeker, q.mi).length;
        gain = '<div class="gain"><span class="gaintxt">' + n + ' in Reichweite</span></div>';
        if (n === 0) row.classList.add('dead');
      } else {
        gain = '<div class="gain"><span class="gaintxt">2 Punkte</span></div>';
      }

      row.innerHTML =
        '<div><div class="qname">' + q.name + '</div>' +
        '<div class="qsub">' + (q.ctx ? q.ctx() : q.sub) + '</div></div>' + gain;
      row.onclick = () => openSheet(q);
      body.appendChild(row);
    }
    frag.appendChild(sec);
  }
  box.appendChild(frag);
}

/** Ein-/Ausklapp-Zustand für Fragen- und Orte-Gruppen (Titel als Schlüssel).
    Standard ist zugeklappt — S.expanded hält nur die Ausnahmen. */
function isCollapsed(key) { return !S.expanded[key]; }
function toggleCollapsed(key) {
  if (S.expanded[key]) delete S.expanded[key]; else S.expanded[key] = true;
  save();
}

/* ---------- Antwort-Dialog ---------- */
async function openSheet(q) {
  if (q.type === 'thermo') {
    const from = S.seeker;
    S.thermoFrom = from;
    renderMarks();
    const to = await pickPoint('Endpunkt antippen — nach ' + fmtMi(q.mi) + ' Fahrt');
    S.thermoFrom = null;
    const realKm = distKm(from[0], from[1], to[0], to[1]);
    showSheet({ ...q, from, to, realKm }, null);
    return;
  }
  if (q.type === 'tentacle') {
    showTentacleSheet(q);
    return;
  }
  showSheet(q, evaluate(q));
}

function showSheet(q, ev) {
  const card = document.getElementById('sheetCard');
  const answers = ANSWER_SETS[q.type] || ['yes', 'no'];
  let meta = q.ctx ? q.ctx() : '';
  if (q.type === 'thermo') meta = 'Tatsächlich gefahren: ' + q.realKm.toFixed(2) + ' km';

  let html =
    '<div class="qtitle" id="sheetTitle">' + q.ask + '</div>' +
    '<div class="qmeta">' + meta + '</div><div class="answers">';

  for (const a of answers) {
    const o = ev && ev.opts.find((x) => x.answer === a);
    const cls = (a === 'no' || a === 'further' || a === 'colder') ? 'no' : 'yes';
    const sub = o ? (o.keep * cellArea()).toFixed(1) + ' km² übrig' : '';
    html += '<button class="ans ' + cls + '" data-a="' + a + '">' +
            ANS_LABEL[a] + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
  }
  html += '</div><button class="ghost" data-a="">Abbrechen</button>';
  card.innerHTML = html;

  card.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.a;
      closeSheet();
      if (a) commit(q, a);
    };
  });
  document.getElementById('sheet').hidden = false;
}

function showTentacleSheet(q) {
  const card = document.getElementById('sheetCard');
  const reach = inReach(q.cat, S.seeker, q.mi);
  let html =
    '<div class="qtitle" id="sheetTitle">' + q.ask + '</div>' +
    '<div class="qmeta">' + reach.length + ' ' + CATS[q.cat].plural +
    ' im Umkreis von ' + fmtMi(q.mi) + '</div>';

  if (!reach.length) {
    html += '<div class="note">Keine ' + CATS[q.cat].plural +
            ' in Reichweite — diese Frage bringt hier nichts.</div>' +
            '<button class="ghost" data-a="">Schließen</button>';
  } else {
    html += '<select class="sel" id="tentSel">';
    for (const r of reach) {
      html += '<option value="' + r.i + '">' + esc(r.p.n) + ' · ' +
              distKm(r.p.x, r.p.y, S.seeker[0], S.seeker[1]).toFixed(2) + ' km</option>';
    }
    html += '</select>' +
      '<div class="answers">' +
      '<button class="ans yes" id="tentOk">Diese Antwort übernehmen</button>' +
      '<button class="ans no" data-a="none">Nicht in Reichweite</button>' +
      '</div><button class="ghost" data-a="">Abbrechen</button>';
  }
  card.innerHTML = html;

  const ok = card.querySelector('#tentOk');
  if (ok) ok.onclick = () => {
    const v = card.querySelector('#tentSel').value;
    closeSheet(); commit(q, v);
  };
  card.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => { const a = b.dataset.a; closeSheet(); if (a) commit(q, a); };
  });
  document.getElementById('sheet').hidden = false;
}

function closeSheet() { document.getElementById('sheet').hidden = true; }

/** Antwort übernehmen und Restzone verkleinern. */
function commit(q, ans) {
  const before = liveCount(null);
  const m = applyQuestion(q, ans);
  for (let i = 0; i < S.live.length; i++) if (S.live[i] && !m[i]) S.live[i] = 0;
  const after = liveCount(null);
  S.stamp++;

  let label = q.name, answerText = ANS_LABEL[ans] || ans;
  if (q.type === 'tentacle' && ans !== 'none') {
    answerText = activePois(q.cat)[+ans]?.n || ans;
  }
  S.history.push({
    q: { ...q }, ans, label, answerText,
    before, after,
    area: after * cellArea(),
  });
  buildFineEdges();
  renderExclusion(); drawEdges(); renderAsk(); renderHist(); save();
}

function undoAt(i) {
  S.history.splice(i, 1);
  recompute();
}

function recompute() {
  S.live = new Uint8Array(S.grid.inZone);
  S.stamp++;
  for (const h of S.history) {
    const m = applyQuestion(h.q, h.ans);
    for (let j = 0; j < S.live.length; j++) if (S.live[j] && !m[j]) S.live[j] = 0;
    h.after = liveCount(null);
    h.area = h.after * cellArea();
  }
  buildFineEdges();
  renderExclusion(); drawEdges(); renderAsk(); renderHist(); save();
}

/* ---------- Verlauf ---------- */
function renderHist() {
  const box = document.getElementById('tabHist');
  const cnt = document.getElementById('histCount');
  cnt.textContent = S.history.length ? '(' + S.history.length + ')' : '';

  if (!S.history.length) {
    box.innerHTML = '<div class="empty"><b>Noch keine Frage</b>' +
      'Beantwortete Fragen erscheinen hier und lassen sich einzeln zurücknehmen.</div>';
    return;
  }
  let html = '<div class="hist">';
  S.history.forEach((h, i) => {
    const good = ['yes', 'closer', 'hotter'].includes(h.ans);
    html += '<div class="hrow"><div class="hnum">' + (i + 1) + '</div>' +
      '<div class="hmain"><div class="hq">' + esc(h.label) + '</div>' +
      '<div class="ha ' + (good ? 'yes' : 'no') + '">' + esc(h.answerText) + '</div></div>' +
      '<div class="hkm">' + h.area.toFixed(1) + ' km²</div>' +
      '<button class="del" data-i="' + i + '" aria-label="Frage entfernen">' +
      '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
  });
  html += '</div><button class="btn flat" id="btnClear">Verlauf leeren</button>';
  box.innerHTML = html;

  box.querySelectorAll('.del').forEach((b) => { b.onclick = () => undoAt(+b.dataset.i); });
  document.getElementById('btnClear').onclick = () => { S.history = []; recompute(); };
}

/* ---------- Gebiet-Tab ---------- */
function renderSetup() {
  const box = document.getElementById('tabSetup');
  const g = S.grid;
  const areaTotal = g.count * cellArea();
  const outside = g.count - g.koelnCount;
  const outPct = Math.round((outside / g.count) * 100);

  const stTotal = (S.data.stations || []).length;
  const stActive = hideStations().length;
  const zoneArea = g.zoneCount * cellArea();

  box.innerHTML =
    /* --- Versteckzone: die wichtigste Einstellung, deshalb zuerst --- */
    '<div class="group"><div class="grouphd">Versteckzone' +
    ' <span class="ghint">' + (S.hideZoneOn ? zoneArea.toFixed(1) + ' km² bespielbar' : 'aus') + '</span></div>' +
    '<div class="catrow"><b>Nur nahe einer Station</b>' +
    '<button class="tgl" role="switch" aria-checked="' + S.hideZoneOn + '" id="zoneOn" ' +
    'aria-label="Versteckzone aktiv"></button></div>' +
    (S.hideZoneOn
      ? '<div class="slider">' +
        '<input type="range" id="hideIn" min="100" max="1000" step="50" value="' + S.hideRadiusM + '">' +
        '<output id="hideOut">' + S.hideRadiusM + ' m</output></div>' +
        '<div class="chips">' +
        Object.entries(STATION_KINDS).map(([k, v]) =>
          '<button class="chip" data-kind="' + k + '" aria-pressed="' + !!S.hideKinds[k] + '">' +
          v.label + '</button>').join('') +
        '</div>' +
        '<div class="catrow"><b>Stationen anzeigen</b>' +
        '<button class="tgl" role="switch" aria-checked="' + !!S.showStations + '" id="stShow" ' +
        'aria-label="Stationen auf der Karte"></button></div>' +
        '<div class="note">' + stActive + ' von ' + stTotal + ' Stationen zählen. ' +
        'Der Hider muss sich innerhalb von ' + S.hideRadiusM + ' m zu einer davon aufhalten — ' +
        'das schrumpft das Suchgebiet von ' + areaTotal.toFixed(0) + ' auf ' +
        zoneArea.toFixed(1) + ' km².</div>'
      : '<div class="note">Ohne Versteckzone gilt das gesamte Spielgebiet. ' +
        'Schalte sie ein, wenn ihr die 500-m-Regel spielt.</div>') +
    '<button class="btn" id="zoneApply" hidden>Übernehmen</button>' +
    '</div>' +

    /* --- Spielgebiet --- */
    '<div class="group"><div class="grouphd">Spielgebiet' +
    ' <span class="ghint">' + areaTotal.toFixed(0) + ' km²</span></div>' +
    (S.data.play_area
      ? '<div class="catrow"><b>Grenze aus dem KVB-Netzplan</b>' +
        '<button class="tgl" role="switch" aria-checked="' + S.useArea + '" id="areaMode" ' +
        'aria-label="KVB-Grenze verwenden"></button></div>'
      : '') +
    (S.useArea && S.data.play_area
      ? '<div class="note">' + S.data.play_area.ring.length + ' Eckpunkte, abgeleitet aus euren ' +
        'Endstationen: ' + esc(S.data.play_area.names.slice(0, 4).join(', ')) + ' … ' +
        'Leverkusen, Bergisch Gladbach, Brühl und Wesseling liegen außerhalb.</div>'
      : '<div class="slider">' +
        '<input type="range" id="radIn" min="' + RADIUS_MIN_KM + '" max="' + RADIUS_MAX_KM + '" ' +
        'step="1" value="' + S.radiusKm + '">' +
        '<output id="radOut">' + S.radiusKm + ' km</output>' +
        '</div>' +
        '<div class="note" id="radNote">' + radiusNote(S.radiusKm) + '</div>' +
        '<button class="btn" id="radApply" hidden>Gebiet neu berechnen</button>') +
    '</div>' +

    '<div class="group"><div class="grouphd">Startpunkt' +
    ' <span class="ghint">für Radius und Schnellwahl</span></div>' +
    '<div class="catrow"><b>' + esc(S.home.name) + '</b>' +
    '<span class="cnt">' + S.home.y.toFixed(4) + ', ' + S.home.x.toFixed(4) + '</span></div>' +
    '<div class="setgrid">' +
    '<button class="btn flat" id="sHome">Auf Karte setzen</button>' +
    '<button class="btn flat" id="sHomeCoord">Koordinaten</button>' +
    '</div></div>' +

    '<div class="group"><div class="grouphd">Abdeckung</div>' +
    '<div class="catrow"><b>Im Kölner Stadtgebiet</b>' +
    '<span class="cnt">' + (100 - outPct) + '%</span></div>' +
    '<div class="catrow"><b>Außerhalb Kölns</b>' +
    '<span class="cnt">' + outPct + '%</span></div>' +
    (outside > 0
      ? '<div class="note">Im Außenbereich gibt es keine Stadtteil- und ' +
        'Bezirksgrenzen — Matching-Fragen auf diese Ebenen wirken dort nicht. ' +
        'Orte (Museen, Bahnhöfe …) sind bis 25 km um den Hbf erfasst, ' +
        'deshalb stimmen die „nächster Ort“-Fragen auch am Rand.</div>'
      : '<div class="note">Das Spielgebiet liegt vollständig in Köln — alle ' +
        'Fragen sind uneingeschränkt auswertbar.</div>') +
    '</div>' +

    '<div class="group"><div class="grouphd">Raster</div>' +
    '<div class="catrow"><b>Zellengröße</b><span class="cnt">' +
    (g.cellKm * 1000).toFixed(0) + ' m</span></div>' +
    '<div class="catrow"><b>Zellen im Gebiet</b><span class="cnt">' +
    g.count.toLocaleString('de-DE') + '</span></div>' +
    '<div class="note">Auf so genau kann die Karte eingrenzen. Bei großem ' +
    'Radius werden die Zellen gröber, damit die App schnell bleibt.</div>' +
    '<div class="catrow"><b>Feine Kanten</b>' +
    '<button class="tgl" role="switch" aria-checked="' + S.fineEdgesOn + '" id="fineOn" ' +
    'aria-label="Feine Kanten an Versteckzone und Fragen"></button></div>' +
    '<div class="note">Zeichnet die Versteckzone und Fragen mit einfacher ' +
    'Geometrie (Radar, Thermometer, Rheinseite/Bezirk/Stadtteil) auf ~5–10 m ' +
    'genau, statt in ' + (g.cellKm * 1000).toFixed(0) + '-m-Kästen. Fragen nach ' +
    'nächstem Ort oder Rhein-/Grenzabstand bleiben grob — deren Grenze lässt ' +
    'sich nicht schnell genug exakt nachrechnen. Kostet keine Internet-' +
    'verbindung, nur etwas Rechenzeit beim Neuberechnen — zum Ausschalten, ' +
    'falls das Handy alt ist oder der Akku zählt.</div></div>';

  /* Radius-Regler (nur wenn kein Polygon aktiv) */
  const slider = box.querySelector('#radIn');
  if (slider) {
    const out = box.querySelector('#radOut');
    const note = box.querySelector('#radNote');
    const apply = box.querySelector('#radApply');
    slider.oninput = () => {
      const v = +slider.value;
      out.textContent = v + ' km';
      note.textContent = radiusNote(v);
      apply.hidden = v === S.radiusKm;
    };
    apply.onclick = () => changeArea({ radiusKm: +slider.value });
  }

  /* Versteckzone */
  const zoneApply = box.querySelector('#zoneApply');
  const pending = {};
  const markPending = () => { zoneApply.hidden = !Object.keys(pending).length; };

  box.querySelector('#zoneOn').onclick = () => changeArea({ hideZoneOn: !S.hideZoneOn });

  const hideIn = box.querySelector('#hideIn');
  if (hideIn) {
    const hideOut = box.querySelector('#hideOut');
    hideIn.oninput = () => {
      hideOut.textContent = hideIn.value + ' m';
      if (+hideIn.value === S.hideRadiusM) delete pending.hideRadiusM;
      else pending.hideRadiusM = +hideIn.value;
      markPending();
    };
  }

  box.querySelectorAll('.chip[data-kind]').forEach((c) => {
    c.onclick = () => {
      const k = c.dataset.kind;
      const on = c.getAttribute('aria-pressed') !== 'true';
      c.setAttribute('aria-pressed', String(on));
      pending.hideKinds = { ...(pending.hideKinds || S.hideKinds), [k]: on };
      markPending();
    };
  });

  zoneApply.onclick = () => changeArea(pending);

  const stShow = box.querySelector('#stShow');
  if (stShow) stShow.onclick = () => {
    S.showStations = !S.showStations;
    stShow.setAttribute('aria-checked', String(S.showStations));
    drawArea(); save();
  };

  const areaMode = box.querySelector('#areaMode');
  if (areaMode) areaMode.onclick = () => changeArea({ useArea: !S.useArea });

  const fineOn = box.querySelector('#fineOn');
  if (fineOn) fineOn.onclick = () => {
    S.fineEdgesOn = !S.fineEdgesOn;
    fineOn.setAttribute('aria-checked', String(S.fineEdgesOn));
    buildFineEdges(); renderExclusion(); save();
  };

  box.querySelector('#sHome').onclick = async () => {
    const pt = await pickPoint('Startpunkt auf der Karte antippen');
    changeArea({ home: { name: placeName(pt), x: pt[0], y: pt[1] } });
  };
  box.querySelector('#sHomeCoord').onclick = () => askHomeCoords();
}

function radiusNote(km) {
  const area = Math.round(Math.PI * km * km);
  if (km <= 6) return area + ' km² — kleines Spiel, vor allem Innenstadt.';
  if (km <= 12) return area + ' km² — Köln und direkter Rand. Medium.';
  if (km <= 20) return area + ' km² — bis Leverkusen, Brühl, Bergisch Gladbach.';
  return area + ' km² — großes Gebiet bis Richtung Düsseldorf und Bonn.';
}

/** Spielgebiet ändern: Raster neu bauen, Verlauf neu anwenden. */
function changeArea(patch) {
  if (patch.home) S.home = patch.home;
  if (patch.radiusKm) S.radiusKm = patch.radiusKm;
  if (typeof patch.useArea === 'boolean') S.useArea = patch.useArea;
  if (typeof patch.hideZoneOn === 'boolean') S.hideZoneOn = patch.hideZoneOn;
  if (patch.hideRadiusM) S.hideRadiusM = patch.hideRadiusM;
  if (patch.hideKinds) S.hideKinds = patch.hideKinds;
  hint('Gebiet wird neu berechnet …');
  setTimeout(() => {
    S.grid = buildGrid(S.data);
    S.fields = {}; S.borderFields = null; S.rheinF = null; _borders = {};
    recompute();
    renderSetup();
    drawArea();
    hint(null);
    if (S.map) fitArea();
  }, 30);
}

/** Karte auf das aktuelle Spielgebiet zoomen. */
function fitArea() {
  if (!S.map) return;
  if (S.useArea && S.data.play_area) {
    const r = S.data.play_area.ring;
    S.map.fitBounds([
      [Math.min(...r.map((p) => p[1])), Math.min(...r.map((p) => p[0]))],
      [Math.max(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0]))],
    ], { padding: [16, 16] });
  } else {
    const dy = S.radiusKm / 110.57;
    const dx = S.radiusKm / (111.32 * Math.cos(toRad(S.home.y)));
    S.map.fitBounds([
      [S.home.y - dy, S.home.x - dx], [S.home.y + dy, S.home.x + dx],
    ], { padding: [16, 16] });
  }
}

function askHomeCoords() {
  const card = document.getElementById('sheetCard');
  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">Startpunkt festlegen</div>' +
    '<div class="qmeta">Mittelpunkt des Spielgebiets. Standard ist Köln Hbf.</div>' +
    '<input class="sel" id="hName" placeholder="Name, z. B. Köln Hauptbahnhof" ' +
    'value="' + esc(S.home.name) + '">' +
    '<input class="sel" id="hCoord" inputmode="decimal" placeholder="50.94278, 6.95907" ' +
    'value="' + S.home.y.toFixed(5) + ', ' + S.home.x.toFixed(5) + '">' +
    '<div class="note" id="hMsg"></div>' +
    '<div class="answers">' +
    '<button class="ans yes" id="hOk">Übernehmen</button>' +
    '<button class="ans no" id="hReset">Zurück auf Köln Hbf</button>' +
    '</div><button class="ghost" data-a="">Abbrechen</button>';

  const msg = card.querySelector('#hMsg');
  card.querySelector('#hOk').onclick = () => {
    const p = parseCoords(card.querySelector('#hCoord').value);
    if (!p) { msg.textContent = 'Bitte zwei Zahlen eingeben, z. B. 50.94278, 6.95907'; return; }
    const nm = card.querySelector('#hName').value.trim() || 'Startpunkt';
    closeSheet();
    changeArea({ home: { name: nm, x: p[0], y: p[1] } });
  };
  card.querySelector('#hReset').onclick = () => {
    closeSheet(); changeArea({ home: { ...HOME_DEFAULT } });
  };
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
}

/* ---------- Orte-Tab ---------- */
function renderData() {
  const box = document.getElementById('tabData');
  box.innerHTML = '';

  const intro = document.createElement('div');
  intro.className = 'note';
  intro.textContent = 'Schalte Orte ab, die im Spiel nicht zählen — etwa geschlossene ' +
    'Häuser oder Einträge, die eure Gruppe nicht anerkennt. Eigene Orte fehlen? Unten ' +
    'hinzufügen. Die Berechnung passt sich sofort an.';
  box.appendChild(intro);

  const actions = document.createElement('div');
  actions.className = 'setgrid';
  actions.innerHTML =
    '<button class="btn" id="btnAddPoi">+ Ort hinzufügen</button>' +
    '<button class="btn flat" id="btnShowPois" aria-pressed="' + !!S.showPois + '">' +
    (S.showPois ? 'Orte auf Karte: an' : 'Orte auf Karte: aus') + '</button>';
  box.appendChild(actions);
  actions.querySelector('#btnAddPoi').onclick = () => openPoiSheet(null);
  actions.querySelector('#btnShowPois').onclick = (e) => {
    S.showPois = !S.showPois;
    e.currentTarget.setAttribute('aria-pressed', String(S.showPois));
    e.currentTarget.textContent = S.showPois ? 'Orte auf Karte: an' : 'Orte auf Karte: aus';
    drawArea(); save();
  };

  const frag = document.createDocumentFragment();
  for (const c of CAT_ORDER) {
    const all = S.pois[c] || [];
    if (!all.length) continue;
    const off = S.disabled[c] || new Set();
    const key = 'data:' + c;
    const isOpen = !isCollapsed(key);

    const sec = document.createElement('div');
    sec.className = 'group' + (isOpen ? '' : ' collapsed');
    const hd = document.createElement('button');
    hd.type = 'button';
    hd.className = 'grouphd';
    hd.setAttribute('aria-expanded', String(isOpen));
    hd.innerHTML =
      '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
      '<span class="grouptitle">' + CATS[c].plural + '</span>' +
      ' <span class="ghint">' + (all.length - off.size) + ' aktiv</span>';
    hd.onclick = () => { toggleCollapsed(key); renderData(); };
    sec.appendChild(hd);

    const body = document.createElement('div');
    body.className = 'groupbody poilist';
    all.forEach((p, i) => {
      const isOff = off.has(i);
      const row = document.createElement('div');
      row.className = 'poiitem' + (isOff ? ' off' : '') + (p.custom ? ' custom' : '');
      row.innerHTML =
        '<b title="' + esc(p.n) + '">' + esc(p.n) + (p.custom ? ' <small>eigener</small>' : '') + '</b>' +
        '<div class="poiacts">' +
        (p.custom ? '<button class="minibtn" data-edit="' + c + ':' + i + '" aria-label="Bearbeiten">✎</button>' : '') +
        '<button class="tgl" role="switch" aria-checked="' + (!isOff) + '" ' +
        'data-c="' + c + '" data-i="' + i + '" aria-label="' + esc(p.n) + '"></button></div>';
      body.appendChild(row);
    });
    sec.appendChild(body);
    frag.appendChild(sec);
  }
  box.appendChild(frag);

  box.querySelectorAll('.tgl').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.c, i = +b.dataset.i;
      if (!S.disabled[c]) S.disabled[c] = new Set();
      if (S.disabled[c].has(i)) S.disabled[c].delete(i); else S.disabled[c].add(i);
      S.fields = {};
      renderData(); recompute();
    };
  });
  box.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => {
      const [c, i] = b.dataset.edit.split(':');
      const poi = (S.pois[c] || [])[+i];
      if (poi && poi.custom) openPoiSheet(poi);
    };
  });
}

/**
 * Formular zum Hinzufügen oder Bearbeiten eines eigenen Orts. `poi` ist ein
 * vorhandener Eintrag aus S.customPois (Bearbeiten) oder null (neu). Position
 * lässt sich auf drei Wegen setzen: Kartenklick, Koordinaten eintippen, oder
 * Adresssuche über Nominatim (OSM) — die braucht kurz Internet, nur in dem
 * Moment, in dem sie benutzt wird; der Rest der App bleibt offlinefähig.
 */
function openPoiSheet(poi) {
  const isEdit = !!poi;
  const card = document.getElementById('sheetCard');
  let pt = isEdit ? [poi.x, poi.y] : (S.seeker || [S.home.x, S.home.y]);

  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">' + (isEdit ? 'Ort bearbeiten' : 'Ort hinzufügen') + '</div>' +
    '<input class="sel" id="poiName" placeholder="Name, z. B. Vringstreff" value="' +
    (isEdit ? esc(poi.n) : '') + '">' +
    '<select class="sel" id="poiCat">' +
    CAT_ORDER.map((c) => '<option value="' + c + '"' +
      (isEdit && poi.c === c ? ' selected' : '') + '>' + CATS[c].label + '</option>').join('') +
    '</select>' +
    '<div class="poiposrow">' +
    '<button class="btn flat" id="poiPick">Auf Karte tippen</button>' +
    '<span class="poipos" id="poiPos">' + pt[1].toFixed(5) + ', ' + pt[0].toFixed(5) + '</span>' +
    '</div>' +
    '<input class="sel" id="poiSearch" placeholder="Adresse oder Name suchen (braucht Internet) …">' +
    '<div class="note" id="poiSearchMsg"></div>' +
    '<div id="poiSearchResults"></div>' +
    '<input class="sel" id="poiCoord" inputmode="decimal" placeholder="oder Koordinaten: 50.94278, 6.95907" ' +
    'value="' + pt[1].toFixed(5) + ', ' + pt[0].toFixed(5) + '">' +
    '<div class="note" id="poiMsg"></div>' +
    '<div class="answers">' +
    '<button class="ans yes" id="poiOk">' + (isEdit ? 'Speichern' : 'Hinzufügen') + '</button>' +
    (isEdit ? '<button class="ans no" id="poiDel">Löschen</button>' : '') +
    '</div><button class="ghost" data-a="">Abbrechen</button>';

  const posEl = card.querySelector('#poiPos');
  const coordEl = card.querySelector('#poiCoord');
  const msg = card.querySelector('#poiMsg');
  const setPt = (p) => {
    pt = p;
    posEl.textContent = p[1].toFixed(5) + ', ' + p[0].toFixed(5);
    coordEl.value = p[1].toFixed(5) + ', ' + p[0].toFixed(5);
  };

  coordEl.oninput = () => {
    const p = parseCoords(coordEl.value);
    if (p) { pt = p; posEl.textContent = p[1].toFixed(5) + ', ' + p[0].toFixed(5); }
  };

  card.querySelector('#poiPick').onclick = async () => {
    document.getElementById('sheet').hidden = true;
    const p = await pickPoint('Position des Orts antippen');
    document.getElementById('sheet').hidden = false;
    setPt(p);
  };

  /* Adresssuche über Nominatim (OpenStreetMap) — nur bei Benutzung ein
     Netzwerkzugriff, kein Hintergrunddienst. */
  const searchMsg = card.querySelector('#poiSearchMsg');
  const resultsBox = card.querySelector('#poiSearchResults');
  let searchTimer = null;
  card.querySelector('#poiSearch').oninput = (e) => {
    const q = e.target.value.trim();
    resultsBox.innerHTML = '';
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 3) { searchMsg.textContent = ''; return; }
    searchMsg.textContent = 'Suche …';
    searchTimer = setTimeout(async () => {
      try {
        const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' +
          encodeURIComponent(q + (/köln|koeln|cologne/i.test(q) ? '' : ', Köln'));
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const hits = await res.json();
        if (!hits.length) { searchMsg.textContent = 'Nichts gefunden.'; return; }
        searchMsg.textContent = '';
        resultsBox.innerHTML = hits.map((h, i) =>
          '<button class="btn flat searchhit" data-i="' + i + '">' +
          esc(h.display_name) + '</button>').join('');
        resultsBox.querySelectorAll('.searchhit').forEach((b) => {
          b.onclick = () => {
            const h = hits[+b.dataset.i];
            setPt([parseFloat(h.lon), parseFloat(h.lat)]);
            const nameEl = card.querySelector('#poiName');
            if (!nameEl.value.trim()) nameEl.value = h.display_name.split(',')[0];
            resultsBox.innerHTML = '';
            searchMsg.textContent = 'Übernommen: ' + h.display_name;
          };
        });
      } catch (err) {
        searchMsg.textContent = 'Suche fehlgeschlagen — kein Internet oder Dienst nicht erreichbar.';
      }
    }, 500);
  };

  card.querySelector('#poiOk').onclick = () => {
    const name = card.querySelector('#poiName').value.trim();
    const cat = card.querySelector('#poiCat').value;
    const p = parseCoords(coordEl.value) || pt;
    if (!name) { msg.textContent = 'Bitte einen Namen eingeben.'; return; }
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) { msg.textContent = 'Bitte eine gültige Position setzen.'; return; }
    closeSheet();
    if (isEdit) {
      poi.n = name; poi.c = cat; poi.x = p[0]; poi.y = p[1];
    } else {
      S.customPois.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        c: cat, n: name, x: p[0], y: p[1], custom: true });
    }
    onPoiListChanged();
  };

  if (isEdit) {
    card.querySelector('#poiDel').onclick = () => {
      closeSheet();
      S.customPois = S.customPois.filter((x) => x.id !== poi.id);
      onPoiListChanged();
    };
  }

  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
}

/** Nach Hinzufügen/Bearbeiten/Löschen eines eigenen Orts: Listen und Caches
    neu aufbauen und alles betroffene neu zeichnen. */
function onPoiListChanged() {
  rebuildPois();
  S.fields = {};
  save();
  renderData();
  drawArea();
  recompute();
}

/* ---------- Speichern ---------- */
function save() {
  try {
    localStorage.setItem('rheinjagd', JSON.stringify({
      seeker: S.seeker,
      home: S.home, radiusKm: S.radiusKm, useArea: S.useArea,
      hideZoneOn: S.hideZoneOn, hideRadiusM: S.hideRadiusM, hideKinds: S.hideKinds,
      showStations: S.showStations, fineEdgesOn: S.fineEdgesOn,
      history: S.history.map((h) => ({ q: h.q, ans: h.ans, label: h.label, answerText: h.answerText })),
      disabled: Object.fromEntries(Object.entries(S.disabled).map(([k, v]) => [k, [...v]])),
      expanded: Object.keys(S.expanded),
      customPois: S.customPois,
      showPois: S.showPois,
    }));
  } catch (e) { /* privater Modus: kein Problem */ }
}

function load() {
  try {
    const raw = localStorage.getItem('rheinjagd');
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.seeker) S.seeker = d.seeker;
    if (d.home && isFinite(d.home.x) && isFinite(d.home.y)) S.home = d.home;
    if (d.radiusKm >= RADIUS_MIN_KM && d.radiusKm <= RADIUS_MAX_KM) S.radiusKm = d.radiusKm;
    if (typeof d.useArea === 'boolean') S.useArea = d.useArea;
    if (typeof d.hideZoneOn === 'boolean') S.hideZoneOn = d.hideZoneOn;
    if (d.hideRadiusM >= 50 && d.hideRadiusM <= 2000) S.hideRadiusM = d.hideRadiusM;
    if (d.hideKinds) S.hideKinds = { ...S.hideKinds, ...d.hideKinds };
    if (typeof d.showStations === 'boolean') S.showStations = d.showStations;
    if (typeof d.fineEdgesOn === 'boolean') S.fineEdgesOn = d.fineEdgesOn;
    if (d.disabled) for (const [k, v] of Object.entries(d.disabled)) S.disabled[k] = new Set(v);
    if (d.history) S.history = d.history.map((h) => ({ ...h, before: 0, after: 0, area: 0 }));
    // Altes Schema (d.collapsed = explizit zugeklappte Gruppen) bewusst nicht
    // übernommen — der Standard ist jetzt zugeklappt, ein alter Spielstand
    // ohne "expanded" landet damit korrekt beim neuen Standard statt bei
    // "alles offen".
    if (Array.isArray(d.expanded)) for (const k of d.expanded) S.expanded[k] = true;
    if (Array.isArray(d.customPois)) {
      S.customPois = d.customPois.filter((p) =>
        p && CATS[p.c] && typeof p.n === 'string' && isFinite(p.x) && isFinite(p.y));
    }
    if (typeof d.showPois === 'boolean') S.showPois = d.showPois;
    return true;
  } catch (e) { return false; }
}

/* ---------- Geolocation ---------- */
function useGeolocation() {
  if (!navigator.geolocation) { hint('Standort nicht verfügbar'); setTimeout(() => hint(null), 2000); return; }
  hint('Standort wird gesucht …');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      hint(null);
      S.seeker = [pos.coords.longitude, pos.coords.latitude];
      S.map.setView([S.seeker[1], S.seeker[0]], 14);
      renderMarks(); renderAsk(); save();
    },
    () => { hint('Standort nicht verfügbar — tippe auf die Karte'); setTimeout(() => hint(null), 2600); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ---------- Diverses ---------- */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const TAB_IDS = { ask: 'tabAsk', hist: 'tabHist', data: 'tabData', setup: 'tabSetup' };

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((t) => {
    t.onclick = () => {
      const want = t.dataset.tab;
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      for (const [key, id] of Object.entries(TAB_IDS)) {
        document.getElementById(id).hidden = key !== want;
      }
      if (want === 'data') renderData();
      if (want === 'setup') renderSetup();
    };
  });
}

function initGrip() {
  const grip = document.getElementById('grip');
  const panel = document.getElementById('panel');
  let startY = 0, startH = 0, dragging = false;
  const down = (e) => {
    dragging = true; startY = (e.touches ? e.touches[0] : e).clientY;
    startH = panel.getBoundingClientRect().height;
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0] : e).clientY;
    const h = Math.max(120, Math.min(window.innerHeight * 0.85, startH - (y - startY)));
    panel.style.height = h + 'px';
    panel.style.maxHeight = h + 'px';
    if (S.map) S.map.invalidateSize();
  };
  const up = () => { dragging = false; };
  grip.addEventListener('mousedown', down);
  grip.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

function initTheme() {
  const btn = document.getElementById('btnTheme');
  btn.onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const isDark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    try { localStorage.setItem('rheinjagd-theme', isDark ? 'light' : 'dark'); } catch (e) {}
    renderExclusion();
  };
  try {
    const t = localStorage.getItem('rheinjagd-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
}

/* ============================================================
   Start
   ============================================================ */
function boot() {
  S.data = window.__KOELN__;
  if (!S.data.play_area) S.useArea = false;
  S.fields = {};

  // Erst gespeicherte Einstellungen laden — Startpunkt, Radius und eigene
  // Orte bestimmen Raster bzw. POI-Listen.
  const hadSave = load();
  rebuildPois();
  S.grid = buildGrid(S.data);
  S.live = new Uint8Array(S.grid.inZone);

  initTheme();
  initMap();
  initTabs();
  initGrip();

  // Neues Spiel: Verlauf und Position zurück, Gebiet bleibt eingestellt.
  document.getElementById('btnReset').onclick = () => {
    S.history = []; S.seeker = null; S.thermoFrom = null;
    renderMarks(); recompute();
  };
  document.getElementById('sheet').onclick = (e) => {
    if (e.target.id === 'sheet') closeSheet();
  };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  if (hadSave && S.history.length) recompute();
  else { buildFineEdges(); renderExclusion(); drawEdges(); renderAsk(); renderHist(); }
  renderMarks();
  if (S.seeker && S.map) S.map.setView([S.seeker[1], S.seeker[0]], 13);

  if (S.noMap) {
    document.getElementById('map').innerHTML =
      '<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;' +
      'color:var(--muted);font-size:13px;line-height:1.6">' +
      '<div><b style="display:block;font-family:var(--f-disp);font-size:18px;color:var(--ink-2);' +
      'margin-bottom:6px">Karte nicht geladen</b>' +
      'Die Kartenbibliothek konnte nicht abgerufen werden. Fragen und Berechnung ' +
      'funktionieren weiter — die Fläche steht oben rechts.</div></div>';
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
