/* ============================================================
   Rheinjagd — Seeker-Werkzeug für Jet Lag: Hide and Seek
   ============================================================ */
'use strict';

const MILE_KM = 1.609344;
/** Fläche einer Rasterzelle in km² — hängt vom gewählten Radius ab. */

/* ---------- Kategorien ----------
   `g` ist das Geschlecht des Kategoriennamens (m/f/n). Die Fragetexte werden
   daraus gebeugt — vorher stand über jeder Karte "Ist dein nächstes Bahnhof
   dasselbe?", was bei sieben der elf Kategorien falsch war. */
const CATS = {
  museum:     { label: 'Museum',        plural: 'Museen',        g: 'n' },
  library:    { label: 'Bibliothek',    plural: 'Bibliotheken',  g: 'f' },
  cinema:     { label: 'Kino',          plural: 'Kinos',         g: 'n' },
  hospital:   { label: 'Krankenhaus',   plural: 'Krankenhäuser', g: 'n' },
  station:    { label: 'Bahnhof',       plural: 'Bahnhöfe',      g: 'm' },
  park:       { label: 'Park',          plural: 'Parks',         g: 'm' },
  mangal:     { label: 'Mangal Döner',  plural: 'Mangal Döner',  g: 'm' },
  zoo:        { label: 'Zoo',           plural: 'Zoos',          g: 'm' },
  aquarium:   { label: 'Aquarium',      plural: 'Aquarien',      g: 'n' },
  theme_park: { label: 'Freizeitpark',  plural: 'Freizeitparks', g: 'm' },
  golf:       { label: 'Golfplatz',     plural: 'Golfplätze',    g: 'm' },
  consulate:  { label: 'Konsulat',      plural: 'Konsulate',     g: 'n' },
};

/** Reihenfolge in den Fragenlisten — häufige und nützliche zuerst. */
const CAT_ORDER = ['station', 'park', 'mangal', 'museum', 'cinema', 'library',
                   'hospital', 'zoo', 'aquarium', 'theme_park', 'golf', 'consulate'];

/* Beugung der Kategoriennamen in den Fragetexten. Ein Wort je Geschlecht,
   damit die Vorlagen unten lesbar bleiben. */
const DECL = {
  m: { nom: 'dein nächster',  pos: 'derselbe', mein: 'meiner', dem: 'am nächsten',   ein: 'an einem', welch: 'Welcher', welchem: 'Welchem' },
  f: { nom: 'deine nächste',  pos: 'dieselbe', mein: 'meine',  dem: 'an der nächsten', ein: 'an einer', welch: 'Welche',  welchem: 'Welcher' },
  n: { nom: 'dein nächstes',  pos: 'dasselbe', mein: 'meines', dem: 'am nächsten',   ein: 'an einem', welch: 'Welches', welchem: 'Welchem' },
};
const decl = (c) => DECL[CATS[c].g] || DECL.n;

const RADAR_MI = [0.25, 0.5, 1, 3, 5, 10];
const THERMO_MI = [0.5, 3, 10];

/* Verstecker-Seite: ab wann ist eine Antwort zu knapp, um sie der App zu
   glauben? Beim Radar hängt nur die eigene Position dran (GPS ±10 m, von Hand
   gesetzt exakt), beim Messen zusätzlich zwei OSM-Punkte, die selbst um ~20 m
   danebenliegen können. Darunter wird gemeldet statt behauptet — dieselbe
   Haltung wie bei den Grenzfällen der Stationen. */
const HIDE_NEAR_RADAR_KM = 0.025;
const HIDE_NEAR_MEASURE_KM = 0.05;

/* Spielgebiet: festes Rechteck aus der Stationsverteilung (`play_box` in
   koeln.json, siehe build-data.js) — kein Radius-Kreis und kein Polygon aus
   dem KVB-Netzplan mehr. Standard-Startpunkt ist die Domtreppe (Runde 15,
   vorher Köln Hbf) — dort startet Benes Gruppe. */
const HOME_DEFAULT = { name: 'Domtreppe', x: 6.95827, y: 50.94196 };
/* Startpunkt bis Runde 14. Ein gespeicherter Spielstand, der noch exakt hier
   steht, hat ihn nie von Hand geändert — der wird beim Laden mitgezogen.
   Ein selbst gesetzter Startpunkt bleibt unangetastet. */
const HOME_LEGACY = { x: 6.95907, y: 50.94278 };

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
  data: null, pois: null,
  stations: [],          // alle Stationen aus den Daten, mit Index (.i)
  sf: null,              // vorgerechnete Felder je Station (Rheinseite, Bezirk, …)
  killed: null,          // Uint8Array: durch eine Antwort ausgeschlossen
  manual: new Set(),     // von Hand ausgeschlossene Stationen (Index)
  endgame: new Set(),    // Stationen mit ausgelöstem Endgame — bleiben möglich
  force: new Set(),      // von Hand möglich gelassen, trotz Antwort
  history: [], stamp: 0,
  seeker: null,          // [lon, lat]
  hide: null,            // [lon, lat] — eigenes Versteck (Verstecker-Seite).
                         // Wandert nie von selbst mit, wird nie geteilt.
  picking: null,         // laufende Punktauswahl
  map: null, layers: {},
  geoWatch: null,        // laufende watchPosition-ID (Live-Standort)
  geoPos: null,          // letzte Live-Position [lon, lat]
  geoAcc: 0,             // deren Genauigkeit in Metern
  geoCentered: false,    // erste Ortung zentriert die Karte, spätere nicht
  disabled: {},          // cat -> Set(index) abgeschalteter POIs
  thermoFrom: null,
  home: { ...HOME_DEFAULT },   // Startpunkt (für Schnellwahl/Distanzangaben)
  box: null,                   // Spielgebiets-Rechteck {minX,maxX,minY,maxY} — aus data.play_box
  hideRadiusM: HIDE_RADIUS_M_DEFAULT,   // Versteckradius um Stationen
  hideKinds: { rail: true, kvb: true },
  panelOpen: false,            // Handy: Panel aufgeklappt? (Standard: zu, Karte groß)
  panelH: 0,                   // gemerkte Arbeitshöhe des Panels in px (0 = Stylesheet)
  panelReopen: false,          // war für eine Punktauswahl zugeklappt, soll zurück
  showZones: false,            // Stationspunkte UND Versteckradien auf der Karte
  expanded: {},                  // Titel aufgeklappter Gruppen (Fragen- und Orte-Tab) —
                                  // Standard ist zugeklappt, hier stehen nur Ausnahmen
  customPois: [],                // benutzerdefinierte Orte: {id,c,n,x,y}
  poiCat: null,                  // genau eine Ortskategorie auf der Karte (oder null)
  showDiv: { d2: false, d3: false },  // Bezirks-/Stadtteilgrenzen auf der Karte
  shared: null,          // von der anderen Gruppe geteilte Position
                         // { x, y, name, t } — t = Unix-Sekunden beim Teilen
  poiPicking: null,              // laufende Punktauswahl für den POI-Editor
};

/* ============================================================
   Geometrie (identisch zur getesteten Engine)
   ============================================================ */
const R_EARTH = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

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

/* ---------- Stationsmodell ----------
   Kandidaten sind die Stationen selbst, nicht mehr Rasterzellen. Der Hider
   versteckt sich an einer zugelassenen Station; die 500-m-Zone ist der
   Bereich, den man beim Endgame dort absuchen muss. Fällt eine Station durch
   eine Antwort, fällt ihre ganze Zone weg — das ist eure Regel, und es macht
   das Raster überflüssig: das mögliche Gebiet ist die Vereinigung der Kreise
   der übrig gebliebenen Stationen, also reine Vektorgeometrie.

   Eine Station ist kein Punkt: Bahnsteig und Zugang sind ein paar Meter groß,
   und eine Fragengrenze (Radarkreis, Stadtteilgrenze, Voronoi-Kante zwischen
   zwei Museen) kann genau dort hindurchlaufen. Deshalb entscheidet nicht der
   Mittelpunkt allein, sondern eine Scheibe von STATION_R_KM um ihn: nur wenn
   die ganze Scheibe auf der falschen Seite liegt, wird ausgeschlossen. Läuft
   die Grenze durch die Scheibe, bleibt die Station stehen ("knapp").

   5 m statt der anfänglichen 20 m (Bene, Runde 13): gemessen wirkt die
   Toleranz ohnehin fast nur bei der Stadtteil-Frage — Radar, Thermometer,
   Rheinseite und die Matching-Fragen haben am Hbf jeweils null bis zwei
   Grenzfälle, egal ob 5 oder 20 m. Bei den Stadtteilen dagegen sind es 28
   Stationen bei 20 m und nur noch 9 bei 5 m, und wer an einer Haltestelle
   steht, weiß in aller Regel, in welchem Stadtteil er ist. Ganz auf null
   sollte die Toleranz trotzdem nicht: die übrigen neun liegen zwischen 0,2 und
   5 m von einer Grenze entfernt, da entscheidet sonst die Messgenauigkeit des
   OSM-Punktes über die Antwort — und eine falsch ausgeschlossene Station kostet
   das Spiel. Eine zu Unrecht gestrichene Station lässt sich auf der Karte über
   „trotzdem möglich lassen" zurückholen. */
const STATION_R_KM = 0.005;   // 5 m

/** Diagonale des Spielgebiets-Rechtecks in km — als Längenmaßstab für
    Kartenelemente, die "über das Spielgebiet hinaus" reichen sollen. */
function boxDiagKm() {
  const box = S.box;
  if (!box) return 30;
  const midY = (box.minY + box.maxY) / 2;
  const w = (box.maxX - box.minX) * 111.32 * Math.cos(toRad(midY));
  const h = (box.maxY - box.minY) * 110.57;
  return Math.hypot(w, h);
}

/**
 * Stationen übernehmen und die Felder vorrechnen, die jede Fragenauswertung
 * braucht. Läuft einmal beim Start — bei 245 Stationen ist das ein Wimpernschlag
 * (das alte Raster hatte dafür 9.000 Zellen mit denselben Tests zu füllen).
 */
function buildStations(data) {
  const list = (data.stations || []).map((s, i) => ({ ...s, i }));
  const n = list.length;
  const F = {
    side: new Uint8Array(n),        // Rheinseite
    rhein: new Float64Array(n),     // Abstand zum Rhein (km)
    inKoeln: new Uint8Array(n),     // im Kölner Stadtgebiet?
    d2: new Int16Array(n).fill(-1), d3: new Int16Array(n).fill(-1),
    d2Dist: new Float64Array(n), d3Dist: new Float64Array(n),
    poi: {},                        // Cache je Kategorie (+ abgeschaltete Orte)
  };

  const cityBox = bboxOf(data.city_boundary);
  for (let i = 0; i < n; i++) {
    const s = list[i];
    F.side[i] = sideOfLine(s.x, s.y, data.rhein);
    F.rhein[i] = distToLineKm(s.x, s.y, data.rhein);
    F.inKoeln[i] = (s.x >= cityBox[0] && s.x <= cityBox[2] &&
                    s.y >= cityBox[1] && s.y <= cityBox[3] &&
                    pointInGeom(s.x, s.y, data.city_boundary)) ? 1 : 0;
  }

  for (const key of ['d2', 'd3']) {
    const feats = data.divisions[key].features;
    const boxes = feats.map((f) => bboxOf(f.geometry));
    for (let i = 0; i < n; i++) {
      const s = list[i];
      for (let k = 0; k < feats.length; k++) {
        const b = boxes[k];
        if (s.x < b[0] || s.x > b[2] || s.y < b[1] || s.y > b[3]) continue;
        if (pointInGeom(s.x, s.y, feats[k].geometry)) { F[key][i] = k; break; }
      }
      F[key + 'Dist'][i] = distToBorderKm(key, [s.x, s.y]);
    }
  }

  S.stations = list;
  S.sf = F;
  S.killed = new Uint8Array(n);
}

/** Zählt die Station nach den eingestellten Stationsarten? */
function kindOk(s) { return !!S.hideKinds[s.k]; }

/**
 * Ist die Station noch ein mögliches Versteck?
 * Reihenfolge: abgeschaltete Art und Handausschluss schlagen alles. Danach
 * halten zwei Markierungen eine Station am Leben, auch wenn eine Antwort gegen
 * sie spricht: ausgelöstes Endgame (der Hunter steht dort und sucht die Zone
 * ab) und „trotzdem möglich lassen" (man traut dem Ausschluss nicht — etwa
 * weil die Station knapp an einer Stadtteilgrenze liegt).
 */
function stationLive(s) {
  if (!kindOk(s)) return false;
  if (S.manual.has(s.i)) return false;
  if (S.endgame.has(s.i) || S.force.has(s.i)) return true;
  return !S.killed[s.i];
}

/** Bleibt die Station unabhängig von den Antworten möglich? */
function stationPinned(i) { return S.endgame.has(i) || S.force.has(i); }

function liveStations() {
  if (S._live && S._liveFor === S.stamp) return S._live;
  S._live = S.stations.filter(stationLive);
  S._liveFor = S.stamp;
  return S._live;
}

/** Stationen der eingestellten Arten, unabhängig von den Antworten. */
function hideStations() { return S.stations.filter(kindOk); }

/** Nächster-Nachbar-Feld einer POI-Kategorie, je Station — mit Cache. */
function stationPoiField(cat) {
  const key = cat + ':' + (S.disabled[cat] ? [...S.disabled[cat]].sort().join(',') : '');
  if (S.sf.poi[key]) return S.sf.poi[key];
  const pois = activePois(cat);
  const n = S.stations.length;
  const idx = new Int16Array(n).fill(-1);
  const dist = new Float64Array(n).fill(Infinity);
  // Abstand zum zweitnächsten Ort: daraus ergibt sich, wie weit die Station von
  // der Voronoi-Kante zwischen "mein nächster Ort" und dem nächsten Konkurrenten
  // entfernt ist — genau die Grenze, um die es bei Matching-Fragen geht.
  const dist2 = new Float64Array(n).fill(Infinity);
  // …und wer dieser Konkurrent ist: für den Abstand zur Voronoi-Kante wird
  // auch der Abstand der beiden Orte zueinander gebraucht (Runde 21).
  const idx2 = new Int16Array(n).fill(-1);
  if (pois.length) {
    /* Ebene Näherung nur zur **Vorauswahl**, die Reihenfolge entscheidet
       `distKm` (Runde 21). Vorher rangierte die ebene Näherung direkt, und bei
       einem knappen Rennen zwischen zwei Orten kam dabei ein anderer Sieger
       heraus als bei `nearestAt()` auf der Verstecker-Seite — gefunden an der
       Margaretastraße, die zwischen Märchenwald Altenberg und Phantasialand
       auf 13 mm genau in der Mitte liegt. Solange die Marge falsch gerechnet
       wurde, fiel das nicht auf; mit der richtigen Marge schloss eine wahre
       Antwort die eigene Station aus. Die Näherung weicht um weit unter einem
       Prozent ab, deshalb reicht ein Sicherheitsaufschlag von 5 % auf den
       zweitbesten Kandidaten, um alle in Frage kommenden Orte einzusammeln. */
    const kx = Math.cos(toRad(S.data.center[1])) * 111.32, ky = 110.57;
    const cand = [];
    for (let i = 0; i < n; i++) {
      const s = S.stations[i];
      let best = Infinity, second = Infinity;
      for (let k = 0; k < pois.length; k++) {
        const dx = (s.x - pois[k].x) * kx, dy = (s.y - pois[k].y) * ky;
        const d = dx * dx + dy * dy;
        if (d < best) { second = best; best = d; }
        else if (d < second) second = d;
      }
      const lim = (Math.sqrt(isFinite(second) ? second : best) * 1.05 + 0.02) ** 2;
      cand.length = 0;
      for (let k = 0; k < pois.length; k++) {
        const dx = (s.x - pois[k].x) * kx, dy = (s.y - pois[k].y) * ky;
        if (dx * dx + dy * dy <= lim) cand.push(k);
      }
      let b1 = Infinity, k1 = -1, b2 = Infinity, k2 = -1;
      for (const k of cand) {
        const d = distKm(s.x, s.y, pois[k].x, pois[k].y);
        if (d < b1) { b2 = b1; k2 = k1; b1 = d; k1 = k; }
        else if (d < b2) { b2 = d; k2 = k; }
      }
      idx[i] = k1; dist[i] = b1;
      idx2[i] = k2; dist2[i] = b2;
    }
  }
  S.sf.poi[key] = { idx, dist, dist2, idx2, pois };
  return S.sf.poi[key];
}

/**
 * Fläche der Vereinigung der Versteckzonen in km² — exakt.
 *
 * Der Rand einer Kreisvereinigung besteht nur aus Kreisbögen. Für jeden Kreis
 * werden die von anderen Kreisen überdeckten Winkelbereiche abgezogen; über
 * die frei liegenden Bögen läuft das Green'sche Linienintegral
 * ½∮(x dy − y dx), das genau die eingeschlossene Fläche liefert. Bei gleichen
 * Radien ist der überdeckte Halbwinkel schlicht acos(d / 2r).
 *
 * Gerechnet wird in einer lokalen km-Ebene (Ost/Nord um die Gebietsmitte) —
 * bei knapp 30 km Kantenlänge liegt der Projektionsfehler weit unter dem, was
 * eine Rasterzelle je auflösen konnte.
 */
function zoneArea(stations) {
  const n = stations.length;
  if (!n) return 0;
  const r = S.hideRadiusM / 1000;
  const lat0 = S.box ? (S.box.minY + S.box.maxY) / 2 : S.home.y;
  const kx = Math.cos(toRad(lat0)) * 111.32, ky = 110.57;
  const cx = new Float64Array(n), cy = new Float64Array(n);
  for (let i = 0; i < n; i++) { cx[i] = stations[i].x * kx; cy[i] = stations[i].y * ky; }

  const TAU = Math.PI * 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const iv = [];
    let swallowed = false;
    for (let j = 0; j < n && !swallowed; j++) {
      if (j === i) continue;
      const dx = cx[j] - cx[i], dy = cy[j] - cy[i];
      const d = Math.hypot(dx, dy);
      if (d >= 2 * r) continue;
      if (d < 1e-9) { if (j < i) swallowed = true; continue; }  // deckungsgleich
      const a = Math.atan2(dy, dx);
      const half = Math.acos(Math.min(1, d / (2 * r)));
      let s0 = ((a - half) % TAU + TAU) % TAU;
      let e0 = ((a + half) % TAU + TAU) % TAU;
      if (e0 < s0) { iv.push([s0, TAU]); iv.push([0, e0]); } else iv.push([s0, e0]);
    }
    if (swallowed) continue;

    iv.sort((p, q) => p[0] - q[0]);
    const free = [];
    let at = 0;
    for (const [s0, e0] of iv) {
      if (s0 > at) free.push([at, s0]);
      if (e0 > at) at = e0;
    }
    if (at < TAU) free.push([at, TAU]);

    for (const [a1, a2] of free) {
      area += 0.5 * (r * r * (a2 - a1) +
        cx[i] * r * (Math.sin(a2) - Math.sin(a1)) -
        cy[i] * r * (Math.cos(a2) - Math.cos(a1)));
    }
  }
  return Math.max(0, area);
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


function nearestAt(cat, pt) {
  const pois = activePois(cat);
  let best = Infinity, bk = -1;
  for (let k = 0; k < pois.length; k++) {
    const d = distKm(pt[0], pt[1], pois[k].x, pois[k].y);
    if (d < best) { best = d; bk = k; }
  }
  return { k: bk, d: best, poi: pois[bk] };
}

/**
 * Verwaltungsgrenzen aus der Bogenform ausrollen.
 *
 * In der Datei steht jede Grenzlinie **genau einmal** unter `divisions.arcs`;
 * eine Fläche ist nur noch eine Liste von Ringen aus vorzeichenbehafteten
 * Bogen-Indizes (negativ = rückwärts durchlaufen, ~i = -i-1 wie in TopoJSON).
 *
 * Das ist nicht bloß Platzersparnis: Solange jede Fläche ihren Rand selbst
 * speicherte, gab es von jeder Innengrenze zwei bis drei Kopien — und die
 * waren in der alten Datei bis zu 245 m auseinandergelaufen (Runde 19). Mit
 * einer einzigen Quelle je Linie kann das konstruktiv nicht mehr passieren.
 *
 * Ausgerollt wird einmal beim Start, damit der Rest der App unverändert mit
 * `feature.geometry` weiterarbeitet.
 */
function expandDivisions(data) {
  const arcs = data.divisions && data.divisions.arcs;
  if (!arcs) return;
  const ring = (idxs) => {
    const out = [];
    for (const k of idxs) {
      const a = k < 0 ? arcs[~k].slice().reverse() : arcs[k];
      // Der Anschlusspunkt gehört schon zum vorigen Bogen — nicht doppelt.
      for (let i = out.length ? 1 : 0; i < a.length; i++) out.push(a[i]);
    }
    return out;
  };
  for (const lvl of ['d2', 'd3']) {
    const D = data.divisions[lvl];
    if (!D || !D.features) continue;
    for (const f of D.features) {
      if (f.geometry || !f.rings) continue;
      f.geometry = f.rings.length > 1
        ? { type: 'MultiPolygon', coordinates: f.rings.map((r) => [ring(r)]) }
        : { type: 'Polygon', coordinates: [ring(f.rings[0])] };
    }
  }
}

function divIndexAt(level, pt) {
  const feats = S.data.divisions[level].features;
  for (let k = 0; k < feats.length; k++) if (pointInGeom(pt[0], pt[1], feats[k].geometry)) return k;
  return -1;
}

/* Grenzabstände: exakt gegen die Ringsegmente gerechnet.
   Früher lief das über eine verdichtete Punktwolke (alle ~120 m ein Punkt) mit
   Raumindex — schnell, aber der gemessene Abstand konnte um bis zu 60 m zu groß
   sein. Für die 20-m-Toleranz der Stationsentscheidung ist das zu grob: eine
   Station direkt auf einer Stadtteilgrenze hätte "eindeutig drinnen" gemeldet.
   Alle 86 Stadtteile zusammen haben nur 4.563 Segmente, die Bezirke 1.303 —
   ein voller Durchlauf kostet weniger als eine Millisekunde. */
let _rings = {};
function divisionRings(level) {
  if (_rings[level]) return _rings[level];
  const out = [];
  for (const f of S.data.divisions[level].features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) if (ring.length > 1) out.push(ring);
  }
  _rings[level] = out;
  return out;
}

function distToBorderKm(level, pt) {
  let best = Infinity;
  for (const ring of divisionRings(level)) {
    const d = distToLineKm(pt[0], pt[1], ring);
    if (d < best) best = d;
  }
  return best;
}

/* ============================================================
   Fragen anwenden
   ============================================================ */
/**
 * Entscheidungsgrundlage einer Frage + Antwort je Station:
 * `pos` ist die Antwortrichtung, `at(i)` liefert `{ hit, margin }` — erfüllt
 * die Station die Bedingung, und wie weit (km) ist sie von der Grenze entfernt.
 *
 * Getrennt von der Ja/Nein-Prüfung, weil die Marge auch außerhalb gebraucht
 * wird: `borderlineFor()` sammelt daraus die Stationen, die eine Antwort nur
 * wegen der Toleranz überleben, und meldet sie.
 *
 * Die Abstände zur Grenze:
 *   Radar         |d(Seeker) − Radius|
 *   Thermometer   Abstand zur Mittelsenkrechten  (`bisectorDistKm`)
 *   Rheinseite    Abstand zur Rheinlinie
 *   Bezirk/Teil   Abstand zur nächsten Grenze derselben Ebene
 *   Matching-Ort  Abstand zur Voronoi-Kante      (`bisectorDistKm`)
 *   Measuring     |d(Station) − d(Seeker)|
 */
/** Einheitsvektor auf der Kugel zu [lon, lat]. */
function unitVec(lon, lat) {
  const la = toRad(lat), lo = toRad(lon), c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

/**
 * Abstand eines Punktes zur Mittelsenkrechten von A und B — also zu der Linie,
 * auf der d(P,A) = d(P,B) gilt. Das ist die Grenze einer Thermometer-Frage und
 * zugleich die Voronoi-Kante zwischen zwei Orten.
 *
 * Exakt auf derselben Kugel wie `distKm`: d(P,A) = d(P,B) heißt P·Â = P·B̂,
 * also liegt die Grenze auf dem Großkreis mit der Normalen n̂ = (Â − B̂)/|Â − B̂|,
 * und der Abstand ist R · |asin(P̂ · n̂)|.
 *
 * **Runde 21 — das war Benes Bugreport.** Vorher stand an allen drei
 * Fundstellen nur `|da − db| / 2`. Das ist der Sonderfall, dass P *auf der
 * Strecke AB* liegt; sonst fehlt der Faktor (da + db)/ab, und der ist beliebig
 * groß: bei 800 m Fahrt (½ Meile) und einer Station 10 km abseits ist er 25.
 * Der gemeldete Abstand war dadurch um denselben Faktor **zu klein** —
 * Stationen bis über 100 m jenseits der Linie rutschten unter die
 * 5-m-Toleranz, überlebten die Antwort und wurden obendrein als „knapp"
 * gemeldet, obwohl die Linie sie nicht im Entferntesten streift.
 */
function bisectorDistKm(px, py, ax, ay, bx, by) {
  const a = unitVec(ax, ay), b = unitVec(bx, by);
  const nx = a[0] - b[0], ny = a[1] - b[1], nz = a[2] - b[2];
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-12) return Infinity;         // A = B: es gibt keine Grenze
  const p = unitVec(px, py);
  return R_EARTH * Math.abs(Math.asin((p[0] * nx + p[1] * ny + p[2] * nz) / L));
}

/**
 * Die Mittelsenkrechte als zeichenbarer Linienzug ([lat, lon]-Paare), `halfKm`
 * weit nach beiden Seiten.
 *
 * Gerechnet auf der Kugel, nicht im Gradnetz (Runde 21). Die alte Fassung
 * drehte den Richtungsvektor in *Graden* und setzte den cos-Faktor obendrein
 * auf die falsche Achse — bei einer Fahrt nach Nordosten stand die gezeichnete
 * Linie dadurch rund 31° schief, also quer durch Stationen, die sie gar nicht
 * trennt. Das war die zweite Hälfte von Benes Bugreport: die Linie auf der
 * Karte und die Rechnung dahinter zogen verschiedene Grenzen.
 *
 * Auf der Kugel: m̂ = normiert(Â + B̂) liegt auf der Grenze, n̂ = normiert(Â − B̂)
 * ist ihr Pol, t̂ = n̂ × m̂ zeigt entlang der Grenze. Abgetastet wird
 * m̂·cos θ + t̂·sin θ.
 */
function bisectorPath(A, B, halfKm, steps) {
  const a = unitVec(A[0], A[1]), b = unitVec(B[0], B[1]);
  const norm = (v) => { const L = Math.hypot(v[0], v[1], v[2]); return L < 1e-12 ? null : [v[0] / L, v[1] / L, v[2] / L]; };
  const n = norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
  const m = norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  if (!n || !m) return null;
  const t = norm([n[1] * m[2] - n[2] * m[1], n[2] * m[0] - n[0] * m[2], n[0] * m[1] - n[1] * m[0]]);
  if (!t) return null;
  const half = halfKm / R_EARTH, k = steps || 24;
  const out = [];
  for (let i = 0; i <= k; i++) {
    const th = -half + (2 * half * i) / k;
    const c = Math.cos(th), s = Math.sin(th);
    const p = [m[0] * c + t[0] * s, m[1] * c + t[1] * s, m[2] * c + t[2] * s];
    out.push([Math.asin(p[2]) * 180 / Math.PI, Math.atan2(p[1], p[0]) * 180 / Math.PI]);
  }
  return out;
}

function stationDecider(q, ans) {
  const pos = ans === 'yes' || ans === 'closer' || ans === 'hotter';
  const F = S.sf, ST = S.stations;
  const miss = { hit: false, margin: Infinity };

  switch (q.type) {
    case 'match-poi': {
      const f = stationPoiField(q.cat);
      const si = nearestAt(q.cat, q.seeker).k;
      const target = f.pois[si];
      if (!target) return { pos, at: () => miss };
      return { pos, at: (i) => {
        if (f.idx[i] < 0) return miss;
        const hit = f.idx[i] === si;
        /* Abstand zur Voronoi-Kante: ist mein Ort schon der nächste, zählt die
           Kante zum zweitnächsten — sonst die Kante zum Ort des Seekers.
           (Stand hier früher in beiden Fällen die Kante zum Seeker-Ort, war sie
           bei einem Treffer null: jede Station galt als knapp und eine
           Matching-Antwort schloss überhaupt nichts aus.) */
        const rival = hit ? f.pois[f.idx2[i]] : target;
        const mine = f.pois[f.idx[i]];
        if (!rival || !mine) return { hit, margin: Infinity };   // nur ein Ort: keine Kante
        return { hit, margin: bisectorDistKm(ST[i].x, ST[i].y,
                                             mine.x, mine.y, rival.x, rival.y) };
      } };
    }
    case 'match-div': {
      if (q.level === 'd1') {
        const sSide = sideOfLine(q.seeker[0], q.seeker[1], S.data.rhein);
        return { pos, at: (i) => ({ hit: F.side[i] === sSide, margin: F.rhein[i] }) };
      }
      const si = divIndexAt(q.level, q.seeker);
      const arr = F[q.level], dist = F[q.level + 'Dist'];
      return { pos, at: (i) => ({ hit: si >= 0 && arr[i] === si, margin: dist[i] }) };
    }
    case 'measure-poi': {
      const f = stationPoiField(q.cat);
      const my = nearestAt(q.cat, q.seeker).d;
      return { pos, at: (i) => ({ hit: f.dist[i] < my, margin: Math.abs(f.dist[i] - my) }) };
    }
    case 'measure-rhein': {
      const my = distToLineKm(q.seeker[0], q.seeker[1], S.data.rhein);
      return { pos, at: (i) => ({ hit: F.rhein[i] < my, margin: Math.abs(F.rhein[i] - my) }) };
    }
    case 'measure-border': {
      const my = distToBorderKm(q.level, q.seeker);
      const d = F[q.level + 'Dist'];
      return { pos, at: (i) => ({ hit: d[i] < my, margin: Math.abs(d[i] - my) }) };
    }
    case 'radar': {
      const r = q.mi * MILE_KM, sx = q.seeker[0], sy = q.seeker[1];
      return { pos, at: (i) => {
        const d = distKm(ST[i].x, ST[i].y, sx, sy);
        return { hit: d <= r, margin: Math.abs(d - r) };
      } };
    }
    case 'thermo': {
      const [ax, ay] = q.from, [bx, by] = q.to;
      return { pos, at: (i) => {
        const s = ST[i];
        const da = distKm(s.x, s.y, ax, ay), db = distKm(s.x, s.y, bx, by);
        return { hit: db < da, margin: bisectorDistKm(s.x, s.y, ax, ay, bx, by) };
      } };
    }
    case 'tentacle': {
      const r = q.mi * MILE_KM, sx = q.seeker[0], sy = q.seeker[1];
      if (ans === 'none') {
        return { pos: true, at: (i) => {
          const d = distKm(ST[i].x, ST[i].y, sx, sy);
          return { hit: d > r, margin: Math.abs(d - r) };
        } };
      }
      const f = stationPoiField(q.cat);
      const t = +ans, target = f.pois[t];
      if (!target) return { pos: true, at: () => miss };
      return { pos: true, at: (i) => {
        const s = ST[i];
        const d = distKm(s.x, s.y, sx, sy);
        const inR = d <= r, nearestOk = f.idx[i] === t;
        if (inR && nearestOk) return { hit: true, margin: 0 };
        /* Verletzte Bedingungen: die Station müsste über die nähere der beiden
           Grenzen wandern, um doch zu passen — also die kleinere Marge zählt. */
        let margin = Infinity;
        if (!inR) margin = Math.min(margin, Math.abs(d - r));
        if (!nearestOk && f.idx[i] >= 0) {
          const mine = f.pois[f.idx[i]];
          margin = Math.min(margin, bisectorDistKm(s.x, s.y, mine.x, mine.y, target.x, target.y));
        }
        return { hit: false, margin };
      } };
    }
    default:
      return { pos: true, at: () => ({ hit: true, margin: Infinity }) };
  }
}

/** Bleibt die Station bei dieser Antwort möglich? */
function stationTest(q, ans) {
  const d = stationDecider(q, ans);
  return (i) => {
    const r = d.at(i);
    return (d.pos === r.hit) || r.margin <= STATION_R_KM;
  };
}

/**
 * Grenzfälle: Stationen, die diese Antwort eigentlich ausschließt, die aber
 * nur wegen der Toleranz stehen bleiben — die Grenze der Frage läuft direkt
 * durch die Station. Genau die sind es wert, in der Gruppe besprochen zu
 * werden, deshalb meldet `commit()` sie und bietet den Handausschluss an.
 */
function borderlineFor(q, ans, stations) {
  const d = stationDecider(q, ans);
  const out = [];
  for (const s of stations) {
    if (stationPinned(s.i)) continue;   // bleibt ohnehin, egal was die Frage sagt
    const r = d.at(s.i);
    if (d.pos !== r.hit && r.margin <= STATION_R_KM) out.push({ i: s.i, m: r.margin });
  }
  return out.sort((a, b) => a.m - b.m);
}

/** Maske über alle Stationen: übersteht die Station diese Frage + Antwort? */
function applyQuestion(q, ans) {
  const test = stationTest(q, ans);
  const n = S.stations.length;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (test(i)) m[i] = 1;
  return m;
}

const ANSWER_SETS = {
  'match-poi': ['yes', 'no'], 'match-div': ['yes', 'no'],
  'measure-poi': ['closer', 'further'], 'measure-rhein': ['closer', 'further'],
  'measure-border': ['closer', 'further'],
  radar: ['yes', 'no'], thermo: ['hotter', 'colder'],
};

function liveCount() { return liveStations().length; }

/** Noch mögliche Fläche in km² (Vereinigung der Zonen), mit Cache je Stand. */
function liveArea() {
  if (S._area != null && S._areaFor === S.stamp) return S._area;
  S._area = zoneArea(liveStations());
  S._areaFor = S.stamp;
  return S._area;
}

/**
 * Informationsgewinn einer Frage: welcher Anteil der Restfläche bleibt im
 * ungünstigsten Fall übrig? Wird jetzt exakt gerechnet — über dieselbe
 * Kreisvereinigung wie die Anzeige, ohne Stichprobe und ohne Rasterfehler.
 */
function evaluate(q) {
  const answers = ANSWER_SETS[q.type];
  if (!answers) return null;
  const live = liveStations();
  if (!live.length) return null;
  const now = liveArea();

  const opts = answers.map((a) => {
    const test = stationTest(q, a);
    const keep = live.filter((s) => stationPinned(s.i) || test(s.i));
    const area = zoneArea(keep);
    return { answer: a, keep: keep.length, area, frac: now > 0 ? area / now : 0 };
  });
  const worst = Math.max(...opts.map((o) => o.frac));
  return { opts, worst, total: live.length, area: now, useless: worst >= 0.999 };
}

/* ============================================================
   Verstecker-Seite
   ============================================================
   Dieselben Daten, andere Blickrichtung: statt Stationen auszuschließen wird
   die Frage vom eigenen Versteck aus beantwortet. Radar, Measuring und
   Matching (Runde 19) — Thermometer und Tentacles bleiben außen vor. */

/** Entfernung kurz: unter 1 km in Metern, darüber in Kilometern. */
function fmtDist(km) {
  return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(2) + ' km';
}

/** Die zwei nächsten Orte einer Kategorie. Der zweite liefert den Abstand zur
    Voronoi-Kante, um die es bei Matching-Fragen geht. */
function nearestTwoAt(cat, pt) {
  const pois = activePois(cat);
  let b1 = Infinity, k1 = -1, b2 = Infinity, k2 = -1;
  for (let k = 0; k < pois.length; k++) {
    const d = distKm(pt[0], pt[1], pois[k].x, pois[k].y);
    if (d < b1) { b2 = b1; k2 = k1; b1 = d; k1 = k; }
    else if (d < b2) { b2 = d; k2 = k; }
  }
  return { k: k1, d: b1, poi: pois[k1], k2, d2: b2, poi2: pois[k2] };
}

/**
 * Die wahre Antwort auf eine Frage, gemessen vom Versteck aus.
 *
 * `kind` sagt, wie die Werte zu lesen sind:
 *   'radar'   `mine` = eigene Entfernung, `theirs` = Radius (km)
 *   'measure' `mine`/`theirs` = die beiden Entfernungen (km), dazu die Namen
 *   'match'   `mineName`/`theirsName` = die beiden Werte, die verglichen werden
 *
 * `margin` ist in allen Fällen der Abstand zur Entscheidungsgrenze in km.
 * Liegt er unter der Toleranz, sagt `near` das — die App kennt weder die
 * Messgenauigkeit des OSM-Punktes noch den Meter, auf dem du tatsächlich
 * sitzt, und soll dann nicht so tun als ob.
 *
 * Bezugspunkt ist `q.seeker`, also die beim Stellen eingefrorene
 * Jäger-Position — nicht die aktuelle. Das Versteck dagegen wird live
 * gelesen: es bewegt sich nicht, und wenn du es korrigierst, sollen die
 * Antworten sofort stimmen.
 */
function hideAnswer(q) {
  const h = S.hide;
  if (!h || !q || !q.seeker) return null;
  const cmp = (mine, theirs, tol, mineName, theirsName) => ({
    kind: 'measure',
    ans: mine < theirs ? 'closer' : 'further',
    mine, theirs, mineName, theirsName,
    margin: Math.abs(mine - theirs),
    near: Math.abs(mine - theirs) <= tol,
  });
  /* Matching vergleicht zwei Werte, keine Entfernungen. Die Marge ist der
     Abstand zu der Grenze, die die Antwort kippen würde — bei Orten die
     Voronoi-Kante, bei Verwaltungsebenen die Gebietsgrenze. */
  const same = (hit, mineName, theirsName, marginKm, tol) => ({
    kind: 'match', ans: hit ? 'yes' : 'no',
    mineName, theirsName, margin: marginKm, near: marginKm <= tol,
  });

  switch (q.type) {
    case 'radar': {
      const r = q.mi * MILE_KM;
      const d = distKm(h[0], h[1], q.seeker[0], q.seeker[1]);
      // „innerhalb" schließt den Rand ein — dieselbe Regel wie stationDecider().
      return { kind: 'radar', ans: d <= r ? 'yes' : 'no', mine: d, theirs: r,
               margin: Math.abs(d - r), near: Math.abs(d - r) <= HIDE_NEAR_RADAR_KM };
    }
    case 'measure-poi': {
      const a = nearestAt(q.cat, h), b = nearestAt(q.cat, q.seeker);
      if (!a.poi || !b.poi) return null;
      return cmp(a.d, b.d, HIDE_NEAR_MEASURE_KM, a.poi.n, b.poi.n);
    }
    case 'measure-rhein': {
      return cmp(distToLineKm(h[0], h[1], S.data.rhein),
                 distToLineKm(q.seeker[0], q.seeker[1], S.data.rhein),
                 HIDE_NEAR_MEASURE_KM);
    }
    case 'measure-border': {
      return cmp(distToBorderKm(q.level, h), distToBorderKm(q.level, q.seeker),
                 HIDE_NEAR_MEASURE_KM);
    }
    case 'match-poi': {
      const a = nearestTwoAt(q.cat, h), b = nearestAt(q.cat, q.seeker);
      if (!a.poi || !b.poi) return null;
      const hit = a.k === b.k;
      /* Ist mein Ort schon derselbe, zählt die Kante zum zweitnächsten; sonst
         die Kante zum Ort der Jäger. Genau wie in stationDecider() — stünde
         hier in beiden Fällen dasselbe, wäre die Marge bei einem Treffer
         null und jede Matching-Antwort wäre „knapp". */
      const rival = hit ? a.poi2 : b.poi;
      const margin = rival
        ? bisectorDistKm(h[0], h[1], a.poi.x, a.poi.y, rival.x, rival.y)
        : Infinity;
      return same(hit, a.poi.n, b.poi.n, margin, HIDE_NEAR_MEASURE_KM);
    }
    case 'match-div': {
      if (q.level === 'd1') {
        const side = (p) => (sideOfLine(p[0], p[1], S.data.rhein) === 1
          ? 'linksrheinisch' : 'rechtsrheinisch');
        const a = side(h), b = side(q.seeker);
        return same(a === b, a, b, distToLineKm(h[0], h[1], S.data.rhein),
                    HIDE_NEAR_RADAR_KM);
      }
      const feats = S.data.divisions[q.level].features;
      const ai = divIndexAt(q.level, h), bi = divIndexAt(q.level, q.seeker);
      const dh = distToBorderKm(q.level, h);
      /* Zwischen zwei Stadtteilgrenzen können in OSM Schlitze von wenigen
         Zentimetern liegen — der Rudolfplatz fällt in so einen. „Außerhalb"
         wäre für einen Punkt mitten in Köln eine falsche Auskunft; er liegt
         auf der Grenze, und genau das steht dann da. */
      const name = (k, d) => (k >= 0 ? feats[k].name
        : d <= HIDE_NEAR_RADAR_KM ? 'auf der Grenze' : 'außerhalb');
      return same(ai >= 0 && ai === bi,
                  name(ai, dh), name(bi, distToBorderKm(q.level, q.seeker)),
                  dh, HIDE_NEAR_RADAR_KM);
    }
    default: return null;
  }
}

/**
 * Steht das Versteck noch im möglichen Gebiet? Gezählt werden die Stationen,
 * in deren Versteckzone es liegt.
 *   n > 0        die Jäger können dich rechnerisch nicht ausschließen
 *   n = 0, c > 0 ausgeschlossen — entweder haben sie dich, oder eine Antwort
 *                im Verlauf ist falsch eingetragen
 *   c = 0        gar keine zugelassene Station in Reichweite: nach euren
 *                Regeln ist das kein gültiges Versteck
 */
function hideStatus() {
  if (!S.hide) return null;
  const r = S.hideRadiusM / 1000;
  let n = 0, c = 0;
  for (const s of hideStations()) {
    if (distKm(s.x, s.y, S.hide[0], S.hide[1]) > r) continue;
    c++;
    if (stationLive(s)) n++;
  }
  return { n, c, ok: n > 0, illegal: c === 0 };
}

function hideStatusText(st) {
  if (!st) return '';
  if (st.illegal) return 'keine Station in Reichweite';
  if (!st.ok) return 'ausgeschlossen';
  return 'im Gebiet · ' + st.n + (st.n === 1 ? ' Station' : ' Stationen');
}

/* ============================================================
   Fragenkatalog
   ============================================================ */
function buildCatalog() {
  /* Kopie, keine Referenz: die Koordinaten wandern mit in den Verlauf und
     müssen der Stand zum Zeitpunkt des Fragens bleiben. Eine geteilte
     Referenz würde bei einer späteren In-Place-Änderung alle bereits
     beantworteten Fragen rückwirkend verschieben. */
  const sk = S.seeker ? [S.seeker[0], S.seeker[1]] : S.seeker;
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
      sub: 'Ist ' + decl(c).nom + ' ' + CATS[c].label + ' ' + decl(c).pos + '?',
      ask: 'Ist ' + decl(c).nom + ' <em>' + CATS[c].label + '</em> ' +
           decl(c).pos + ' wie ' + decl(c).mein + '?',
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
      name: CATS[c].label, sub: 'Näher ' + decl(c).dem + ' ' + CATS[c].label + '?',
      ask: 'Bist du näher ' + decl(c).ein + ' <em>' + CATS[c].label +
           '</em> oder weiter weg als ich?',
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
      ctx: () => 'Endpunkt als Koordinate eingeben',
    })),
  });

  /* --- Tentacles --- */
  const tent = [];
  for (const c of ['museum', 'library', 'cinema', 'hospital']) {
    if (!activePois(c).length) continue;
    tent.push({
      type: 'tentacle', cat: c, mi: 1, seeker: sk,
      name: CATS[c].plural + ' · 1 Meile',
      sub: decl(c).welch + ' ' + CATS[c].label + ' ist dir am nächsten?',
      ask: decl(c).welchem + ' <em>' + CATS[c].label +
           '</em> im Umkreis von 1 Meile bist du am nächsten?',
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
  S.layers.divs = L.layerGroup().addTo(S.map);
  S.layers.area = L.layerGroup().addTo(S.map);
  S.layers.edges = L.layerGroup().addTo(S.map);
  S.layers.marks = L.layerGroup().addTo(S.map);
  defineExclusionLayer();

  // Stadtgrenze als Orientierung
  L.geoJSON({ type: 'Feature', geometry: S.data.city_boundary }, {
    style: { color: '#555', weight: 1.2, fill: false, dashArray: '3 4', opacity: .45 },
  }).addTo(S.map);

  S.map.on('click', onMapClick);
  // Die Strichstärke der Versteckradien hängt an der Zoomstufe (zoneWeight),
  // deshalb muss der Layer nach jedem Zoom neu gezeichnet werden. Leaflet
  // skaliert nur den Radius mit, nicht die Linienbreite.
  S.map.on('zoomend', () => {
    if (S.showZones || S.poiCat) drawArea();
    if (S.showDiv.d2 || S.showDiv.d3) drawDivisions();
  });
  drawArea();
  drawDivisions();
  fitArea();
}

/**
 * Strichstärke der Versteckradien in Pixeln, abhängig von der Zoomstufe.
 * Herausgezoomt liegen hunderte Kreise dicht beieinander — dünn ist dort
 * lesbarer. Hineingezoomt sieht man nur noch wenige und die dürfen kräftig
 * sein. Leaflet skaliert den Radius mit, die Linienbreite nicht, deshalb
 * zeichnet initMap() bei 'zoomend' neu.
 */
function zoneWeight() {
  const z = S.map ? S.map.getZoom() : 12;
  if (z >= 16) return 3.5;
  if (z >= 15) return 3;
  if (z >= 14) return 2.2;
  if (z >= 13) return 1.6;
  return 1.2;
}

/** Punkte wachsen beim Reinzoomen mit, damit sie neben den dickeren
    Kreislinien nicht verschwinden. */
function dotGrow() {
  const z = S.map ? S.map.getZoom() : 12;
  return z >= 16 ? 2 : (z >= 14 ? 1 : 0);
}

/** Stationen, Versteckradien und Orte zeichnen. */
function drawArea() {
  if (S.noMap || !S.layers.area) return;
  S.layers.area.clearLayers();

  // Kein eigener Umriss fürs Spielgebiet-Rechteck — die rote Ausschlussfläche
  // (ExclusionLayer) markiert die Grenze bereits eindeutig.

  const css = getComputedStyle(document.body);
  const cv = (n, fb) => css.getPropertyValue(n).trim() || fb;
  const zone = cv('--zone', '#1d4ed8');
  const poiCol = cv('--poi', '#7e22ce');
  const warn = cv('--warn', '#c0392b');
  const dead = cv('--muted', '#8a8a8a');

  /* Stationen und ihre Versteckradien — ein gemeinsamer Schalter. Im Zentrum
     überlappen sich die Zonen stark, die Umrisse zeigen, welche Station
     welchen Kreis beisteuert. */
  if (S.showZones) {
    const w = zoneWeight();
    const g = dotGrow();
    for (const s of liveStations()) {
      L.circle([s.y, s.x], {
        radius: S.hideRadiusM,
        color: S.endgame.has(s.i) ? warn : zone,
        weight: w, opacity: .85, fill: false, interactive: false,
      }).addTo(S.layers.area);
    }

    /* Stationspunkte — anklickbar, um eine Station von Hand auszuschließen
       oder das Endgame dort zu markieren. */
    for (const s of hideStations()) {
      const live = stationLive(s);
      const eg = S.endgame.has(s.i);
      const col = eg ? warn : (live ? zone : dead);
      L.circleMarker([s.y, s.x], {
        radius: (eg ? 5 : (live ? 4 : 2.5)) + (live || eg ? g : 0),
        color: col, weight: eg ? 2 : 1.5, opacity: live ? 1 : .5,
        fillColor: col, fillOpacity: live ? .9 : .3, interactive: true,
      }).bindTooltip(esc(s.n) + (eg ? ' · Endgame' : (live ? '' : ' · raus')),
                     { direction: 'top', offset: [0, -4] })
        .on('click', (e) => { L.DomEvent.stop(e); openStationSheet(s); })
        .addTo(S.layers.area);
    }
  }

  /* Orte einer einzigen Kategorie (alle Kinos ODER alle Zoos …) — welche,
     steht im Orte-Tab. Alles auf einmal war im Zentrum unlesbar. Weißer Ring
     um den lila Punkt, damit er auf hellen Kacheln wie auf der roten
     Ausschlussfläche sichtbar bleibt. */
  if (S.poiCat && CATS[S.poiCat]) {
    const c = S.poiCat;
    const g = dotGrow();
    for (const p of activePois(c)) {
      L.circleMarker([p.y, p.x], {
        radius: (p.custom ? 6.5 : 5.5) + g, color: '#ffffff', weight: 2.5, opacity: .95,
        fillColor: poiCol, fillOpacity: 1, interactive: true,
      }).bindTooltip(esc(p.n) + ' · ' + CATS[c].label + (p.custom ? ' · eigener' : ''),
                     { direction: 'top', offset: [0, -4] })
        .addTo(S.layers.area);
    }
  }
}

/**
 * Bezirks- und Stadtteilgrenzen als Linien. Genau die Grenzen, an denen die
 * Matching-Fragen „gleicher Stadtbezirk?“ / „gleicher Stadtteil?“ entscheiden —
 * eingeblendet sieht man sofort, warum eine Station knapp raus oder knapp drin
 * war. Nur Umrisse, keine Füllung: so verdecken sie nichts und fangen auch
 * keine Kartentipps ab (nur die Linie selbst ist anklickbar und zeigt dann den
 * Namen).
 */
function drawDivisions() {
  if (S.noMap || !S.layers.divs) return;
  S.layers.divs.clearLayers();
  const col = getComputedStyle(document.body).getPropertyValue('--poi').trim() || '#7e22ce';

  // Stadtteile zuerst (fein, gestrichelt), Bezirke darüber (kräftig, durch-
  // gezogen) — sonst verschwindet die gröbere Ebene unter der feineren.
  const dark = getComputedStyle(document.body).getPropertyValue('--div3').trim() || '#1f2937';
  const z = S.map ? S.map.getZoom() : 12;
  // 86 Stadtteilgrenzen sind herausgezoomt ein Knäuel — dort dünner, beim
  // Reinzoomen kräftig. Gleiche Logik wie bei den Versteckradien.
  const w3 = z >= 14 ? 2.4 : (z >= 12 ? 1.8 : 1.2);
  const w2 = z >= 14 ? 3.4 : (z >= 12 ? 2.8 : 2.0);

  /* Beide Ebenen durchgezogen und ähnlich dick (Bene, Runde 16) — gestrichelt
     und dünn war für die Stadtteile zu schlecht zu erkennen. Unterschieden
     werden sie jetzt über die Farbe: Bezirke lila wie die Orte, Stadtteile
     fast schwarz. Schwarz, weil es das einzige ist, was auch auf der roten
     Ausschlussfläche noch trägt (5,5:1 gegen 2,8:1 bei Lila). */
  const levels = [
    ['d3', { color: dark, weight: w3, opacity: .85 }],
    ['d2', { color: col, weight: w2, opacity: .95 }],
  ];
  for (const [key, style] of levels) {
    if (!S.showDiv[key]) continue;
    const src = S.data.divisions[key];
    if (!src || !src.features) continue;
    L.geoJSON(
      { type: 'FeatureCollection',
        features: src.features.map((f) => ({
          type: 'Feature', geometry: f.geometry, properties: { name: f.name },
        })) },
      {
        style: { fill: false, ...style },
        onEachFeature: (f, layer) => {
          layer.bindTooltip(esc(f.properties.name) + ' · ' + esc(src.label),
                            { sticky: true });
        },
      }
    ).addTo(S.layers.divs);
  }
}

/** Dialog für eine einzelne Station: Handausschluss, Endgame, Zweifelsfall. */
function openStationSheet(s) {
  const card = document.getElementById('sheetCard');
  const eg = S.endgame.has(s.i);
  const forced = S.force.has(s.i);
  const manual = S.manual.has(s.i);
  const state = manual ? 'von Hand ausgeschlossen'
    : eg ? 'Endgame ausgelöst — bleibt möglich'
    : forced ? 'von Hand möglich gelassen'
    : (S.killed[s.i] ? 'durch eine Antwort ausgeschlossen' : 'noch möglich');

  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">' + esc(s.n) + '</div>' +
    '<div class="qmeta">' + (STATION_KINDS[s.k] ? STATION_KINDS[s.k].label : s.k) +
    ' · ' + state + ' · ' + s.y.toFixed(5) + ', ' + s.x.toFixed(5) + '</div>' +
    '<div class="answers">' +
    '<button class="ans ' + (manual ? 'yes' : 'no') + '" id="stManual">' +
    (manual ? 'Ausschluss aufheben' : 'Von Hand ausschließen') + '</button>' +
    '<button class="ans ' + (eg ? 'no' : 'yes') + '" id="stEnd">' +
    (eg ? 'Endgame zurücknehmen' : 'Endgame hier ausgelöst') + '</button>' +
    '<button class="ans ' + (forced ? 'no' : 'yes') + '" id="stForce">' +
    (forced ? 'Doch ausschließen' : 'Trotzdem möglich lassen') + '</button>' +
    '</div>' +
    '<div class="note">Endgame und „trotzdem möglich lassen" halten die Zone ' +
    'offen, auch wenn eine Antwort gegen die Station spricht: einmal, weil du ' +
    'dort gerade suchst, einmal, weil du dem Ausschluss nicht traust — etwa bei ' +
    'einer Station direkt auf einer Stadtteilgrenze.</div>' +
    '<button class="ghost" data-a="">Schließen</button>';

  const only = (set) => { for (const x of [S.manual, S.endgame, S.force]) if (x !== set) x.delete(s.i); };
  card.querySelector('#stManual').onclick = () => {
    if (manual) S.manual.delete(s.i); else { only(S.manual); S.manual.add(s.i); }
    closeSheet(); afterStationChange();
  };
  card.querySelector('#stEnd').onclick = () => {
    if (eg) S.endgame.delete(s.i); else { only(S.endgame); S.endgame.add(s.i); }
    closeSheet(); afterStationChange();
  };
  card.querySelector('#stForce').onclick = () => {
    if (forced) S.force.delete(s.i); else { only(S.force); S.force.add(s.i); }
    closeSheet(); afterStationChange();
  };
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
}

/** Nach einer Änderung an einzelnen Stationen alles Betroffene auffrischen. */
function afterStationChange() {
  S.stamp++;
  renderExclusion(); drawArea(); renderAsk(); renderHist(); renderSetupIfOpen(); save();
}

function renderSetupIfOpen() {
  const el = document.getElementById('tabSetup');
  if (el && !el.hidden) renderSetup();
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
      const pts = bisectorPath(q.from, q.to, boxDiagKm() * 1.1);
      if (pts) L.polyline(pts, { ...style, dashArray: '6 4' }).addTo(S.layers.edges);
    }
  }
}
/** Ausschlussfläche als Canvas-Overlay zeichnen. */
function renderExclusion() {
  if (S.noMap || !S.layers.excl) { updateStats(); return; }
  S.layers.excl.clearLayers();
  S.layers.excl.addLayer(new ExclusionLayer());
  updateStats();
}

/**
 * Overlay der ausgeschlossenen Fläche — seit Runde 13 reine Vektorgeometrie.
 *
 * Gezeichnet wird: Spielgebiet deckend rot füllen, dann die 500-m-Kreise der
 * noch möglichen Stationen mit `destination-out` ausstanzen. Das passiert auf
 * einem unsichtbaren zweiten Canvas; erst das fertige Bild wird einmal mit
 * halber Deckkraft aufs sichtbare Canvas gelegt.
 *
 * Der Umweg über das zweite Canvas ist der Punkt: früher wurden Rasterzellen
 * und Subzellen einzeln mit halber Deckkraft gemalt, überlappten sich um
 * Bruchteile eines Pixels und ergaben dadurch dunklere Streifen und ein
 * Flickenmuster aus grob und fein gezeichneten Flächen. Ein einziger
 * Kompositionsschritt kann das nicht mehr — die Fläche ist überall gleich
 * deckend, und die Kante ist auf jeder Zoomstufe der echte Kreisbogen statt
 * einer Treppe aus Zellen.
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
      /* Zwei-Finger-Zoom feuert **kein** `zoomanim`: Leaflet schiebt dabei
         fortlaufend `_move()` mit gebrochener Zoomstufe durch und meldet das
         nur als `zoom`. Ohne diesen Zuhörer stand die rote Fläche während der
         ganzen Geste still und sprang erst am Ende an ihren Platz. */
      map.on('zoom', this._onZoom, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      map.off('zoomanim', this._animZoom, this);
      map.off('zoom', this._onZoom, this);
      if (this._c && this._c.parentNode) this._c.parentNode.removeChild(this._c);
    },

    /* Während der Zoom-Animation: dasselbe Bild mitskalieren statt neu rechnen. */
    _animZoom(e) {
      if (!this._origin) return;
      const scale = this._map.getZoomScale(e.zoom, this._zoom);
      const off = this._map._latLngToNewLayerPoint(this._origin, e.zoom, e.center);
      L.DomUtil.setTransform(this._c, off, scale);
    },

    /* Laufender Pinch: aktuelle (gebrochene) Zoomstufe und Mitte abgreifen und
       dieselbe Transformation fahren. `_latLngToNewLayerPoint` rechnet gegen
       einen frisch bestimmten Pixelursprung, funktioniert also auch mitten in
       der Geste. */
    _onZoom() {
      if (!this._origin) return;
      this._animZoom({ zoom: this._map.getZoom(), center: this._map.getCenter() });
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
      const map = this._map, c = this._c;
      const w = this._bufSize.x, h = this._bufSize.y, min = this._min;
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!S.box) return;

      /* Zweites Canvas zum Vorzeichnen. Name bewusst `_buf`: `this._off` wäre
         die interne Listener-Methode von L.Evented — die stünde hier still im
         Weg und das Overlay bliebe leer. */
      const buf = this._buf || (this._buf = document.createElement('canvas'));
      if (buf.width !== c.width || buf.height !== c.height) {
        buf.width = c.width; buf.height = c.height;
      }
      const o = buf.getContext('2d');
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, buf.width, buf.height);
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.fillStyle = getComputedStyle(document.body)
        .getPropertyValue('--exclude').trim() || '#c0392b';

      const px = (lat, lng) => {
        const p = map.latLngToLayerPoint([lat, lng]);
        return [p.x - min.x, p.y - min.y];
      };

      // Spielgebiet füllen — außerhalb bleibt unbemalt, wie gehabt.
      const b = S.box;
      const [x1, y1] = px(b.maxY, b.minX);
      const [x2, y2] = px(b.minY, b.maxX);
      const left = Math.max(-1, Math.min(x1, x2)), right = Math.min(w + 1, Math.max(x1, x2));
      const top = Math.max(-1, Math.min(y1, y2)), bot = Math.min(h + 1, Math.max(y1, y2));
      if (right <= left || bot <= top) return;
      o.fillRect(left, top, right - left, bot - top);

      // Versteckzonen der möglichen Stationen ausstanzen
      o.globalCompositeOperation = 'destination-out';
      const dLat = (S.hideRadiusM / 1000) / 110.574;
      for (const s of liveStations()) {
        const [sx, sy] = px(s.y, s.x);
        const [, ry] = px(s.y + dLat, s.x);
        const r = Math.abs(sy - ry);
        if (sx + r < left || sx - r > right || sy + r < top || sy - r > bot) continue;
        o.beginPath();
        o.arc(sx, sy, r, 0, Math.PI * 2);
        o.fill();
      }
      o.globalCompositeOperation = 'source-over';

      // Einmal komponieren — halbe Deckkraft, überall gleich.
      ctx.globalAlpha = 0.5;
      ctx.drawImage(buf, 0, 0, w, h);
      ctx.globalAlpha = 1;
    },
  });
}

function renderMarks() {
  if (S.noMap || !S.layers.marks) return;
  S.layers.marks.clearLayers();

  /* Live-Standort: Genauigkeitskreis in echten Metern plus Punkt. Grün, damit
     er weder mit der Seeker-Position (Türkis) noch mit den Versteckradien
     (Blau) oder den Orten (Lila) verwechselt werden kann. */
  if (S.geoPos) {
    const live = getComputedStyle(document.body).getPropertyValue('--keep').trim() || '#1f7a4d';
    if (S.geoAcc > 5) {
      L.circle([S.geoPos[1], S.geoPos[0]], {
        radius: S.geoAcc, color: live, weight: 1, opacity: .6,
        fillColor: live, fillOpacity: .12, interactive: false,
      }).addTo(S.layers.marks);
    }
    /* Ring statt Vollkreis: die Seeker-Position ist ein voller Punkt in
       Türkis, der Live-Standort ein Ring in Grün — dadurch sind die beiden
       auch bei schlechtem Licht und schräg gehaltenem Handy zu trennen,
       nicht nur an der Farbe. */
    const dot = L.divIcon({
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      html: '<div style="width:18px;height:18px;border-radius:50%;background:' + live + ';' +
            'border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);' +
            'display:grid;place-items:center">' +
            '<i style="width:6px;height:6px;border-radius:50%;background:#fff;display:block"></i>' +
            '</div>',
    });
    L.marker([S.geoPos[1], S.geoPos[0]], { icon: dot, interactive: false })
      .bindTooltip('Dein Standort · ±' + Math.round(S.geoAcc) + ' m',
                   { direction: 'top', offset: [0, -8] })
      .addTo(S.layers.marks);
  }

  if (S.seeker) {
    const el = L.divIcon({
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      html: '<div style="width:18px;height:18px;border-radius:50%;background:var(--accent);' +
            'border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
    });
    L.marker([S.seeker[1], S.seeker[0]], { icon: el, interactive: false }).addTo(S.layers.marks);
  }
  /* Von der anderen Gruppe geteilte Position: Raute in Bernstein, damit sie
     weder mit dem eigenen Live-Standort (grüner Ring) noch mit der
     Seeker-Position (türkiser Punkt) verwechselt wird. Andere Form, andere
     Farbe — im Zweifel entscheidet die Form. */
  if (S.shared) {
    const el = L.divIcon({
      className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      html: '<div style="width:14px;height:14px;background:var(--warn);' +
            'border:2.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);' +
            'transform:rotate(45deg);margin:3px"></div>',
    });
    L.marker([S.shared.y, S.shared.x], { icon: el, interactive: true })
      .bindTooltip((S.shared.name ? esc(S.shared.name) + ' · ' : '') + 'geteilt' +
                   (S.shared.t ? ' · ' + sharedAge(S.shared.t) : ''),
                   { direction: 'top', offset: [0, -8] })
      .on('click', () => showSharedSheet(S.shared, true))
      .addTo(S.layers.marks);
  }

  /* Eigenes Versteck: Dreieck in Pink. Die vierte Markerform im Spiel — voller
     Punkt (Seeker), Ring (Live-Standort), Raute (geteilt), Dreieck (Versteck);
     die Silhouette trägt, nicht die Farbe. Ist das Versteck rechnerisch
     ausgeschlossen, wird der weiße Rand rot: dann haben die Jäger dich, oder
     eine Antwort im Verlauf ist falsch eingetragen. */
  if (S.hide) {
    const st = hideStatus();
    const edge = st.ok ? '#fff'
      : getComputedStyle(document.body).getPropertyValue('--exclude').trim() || '#c0392b';
    const el = L.divIcon({
      className: '', iconSize: [22, 22], iconAnchor: [11, 13],
      html: '<svg width="22" height="22" viewBox="0 0 22 22" style="overflow:visible">' +
            '<polygon points="11,2 20,18 2,18" fill="var(--hide)" stroke="' + edge +
            '" stroke-width="2.5" stroke-linejoin="round" ' +
            'style="filter:drop-shadow(0 0 1px rgba(0,0,0,.45))"/></svg>',
    });
    L.marker([S.hide[1], S.hide[0]], { icon: el, interactive: true })
      .bindTooltip('Versteck · ' + hideStatusText(st), { direction: 'top', offset: [0, -12] })
      .addTo(S.layers.marks);
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
  const k = liveCount();
  const area = k ? liveArea() : 0;
  const el = document.getElementById('statArea');
  /* Die Einheit ist immer „km² möglich" — sie steht im HTML und wird auf
     schmalen Schirmen per CSS auf „km²" gekürzt. Hier nichts überschreiben,
     sonst fliegt das <span> für die Kurzform beim ersten Update raus. */
  if (!k) el.textContent = '0';
  else if (area >= 10) el.textContent = area.toFixed(0);
  else if (area >= 0.1) el.textContent = area.toFixed(1);
  else el.textContent = area.toFixed(2);
  el.style.color = k === 0 ? 'var(--exclude)' : 'var(--keep)';
  el.title = k + ' von ' + hideStations().length + ' Stationen noch möglich';
}

/* ============================================================
   Interaktion
   ============================================================ */
/**
 * Ein Tipp auf die Karte tut nur dann etwas, wenn vorher ausdrücklich eine
 * Punktauswahl gestartet wurde (Knopf „Karte“ in der Standortleiste, Startpunkt
 * setzen, Ort platzieren). Vorher verschob jeder versehentliche Tipp beim
 * Zoomen oder Scrollen die Seeker-Position — im Spiel ärgerlich, weil damit
 * stillschweigend die Bezugsposition aller Fragen wanderte.
 */
function onMapClick(e) {
  if (!S.picking) return;
  const pt = [e.latlng.lng, e.latlng.lat];
  const f = S.picking; S.picking = null; hint(null);
  restorePanelAfterPick();
  f(pt);
}

/** Laufende Punktauswahl abbrechen (Escape oder erneuter Knopfdruck).
    Das Versprechen wird mit `null` eingelöst, damit der Aufrufer aufräumen
    kann (Runde 21) — vorher hing es für immer, und `S.thermoFrom` blieb nach
    einem Abbruch als Geistermarker auf der Karte stehen. */
function cancelPicking() {
  if (!S.picking) return false;
  const res = S.picking;
  S.picking = null; hint(null);
  restorePanelAfterPick();
  res(null);
  return true;
}

/** Seeker-Position per Kartentipp setzen. */
async function pickSeeker() {
  if (cancelPicking()) return;
  const pt = await pickPoint('Position auf der Karte antippen — Esc bricht ab');
  if (pt) setSeeker(pt, false);
}

/** Seeker-Position setzen; `center` zentriert die Karte darauf. */
function setSeeker(pt, center) {
  S.seeker = pt;
  if (center && S.map) S.map.setView([pt[1], pt[0]], Math.max(S.map.getZoom(), 13));
  renderMarks(); renderAsk(); save();
}

/* ---------- Versteck setzen ---------- */
/** Versteck setzen; `center` zentriert die Karte darauf. */
function setHide(pt, center) {
  S.hide = pt;
  if (center && S.map) S.map.setView([pt[1], pt[0]], Math.max(S.map.getZoom(), 13));
  renderMarks(); renderAsk(); save();
}

/** Versteck per Kartentipp setzen. */
async function pickHide() {
  if (cancelPicking()) return;
  const pt = await pickPoint('Versteck auf der Karte antippen — Esc bricht ab');
  if (pt) setHide(pt, false);
}

/** Ortung als Versteck übernehmen. Bei laufendem Live-Standort ohne Umweg. */
function hideFromGeo() {
  if (S.geoPos) { setHide([...S.geoPos], true); return; }
  if (!navigator.geolocation) { hint('Standort nicht verfügbar'); setTimeout(() => hint(null), 2000); return; }
  hint('Standort wird gesucht …');
  navigator.geolocation.getCurrentPosition(
    (pos) => { hint(null); setHide([pos.coords.longitude, pos.coords.latitude], true); },
    () => { hint('Standort nicht verfügbar — tippe auf die Karte'); setTimeout(() => hint(null), 2600); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function askHideCoords() {
  askCoords({
    title: 'Versteck eingeben',
    cur: S.hide || S.seeker || [S.home.x, S.home.y],
    set: (p) => setHide(p, true),
  });
}

/** Womit wird das Versteck gesetzt? */
function showHideSheet() {
  const card = document.getElementById('sheetCard');
  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">Versteck setzen</div>' +
    '<div class="answers">' +
    '<button class="ans yes" data-h="geo">Mein Standort</button>' +
    '<button class="ans" data-h="map">Auf Karte tippen</button>' +
    '<button class="ans" data-h="coord">Koordinaten</button>' +
    '</div><button class="ghost" data-a="">Abbrechen</button>';
  card.querySelectorAll('[data-h]').forEach((b) => {
    b.onclick = () => {
      closeSheet();
      if (b.dataset.h === 'geo') hideFromGeo();
      else if (b.dataset.h === 'map') pickHide();
      else askHideCoords();
    };
  });
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
}

/** Lesbarer Name der Position: Stadtteil, sonst Lage zum Spielgebiet. */
function placeName(pt) {
  const k = divIndexAt('d3', pt);
  if (k >= 0) {
    const st = S.data.divisions.d3.features[k].name;
    const b = divIndexAt('d2', pt);
    return b >= 0 ? st + ' · ' + S.data.divisions.d2.features[b].name : st;
  }
  const inBox = S.box && pt[0] >= S.box.minX && pt[0] <= S.box.maxX &&
                pt[1] >= S.box.minY && pt[1] <= S.box.maxY;
  const d = distKm(pt[0], pt[1], S.home.x, S.home.y);
  return inBox
    ? 'Außerhalb Kölns · ' + d.toFixed(1) + ' km vom Start'
    : 'Außerhalb des Spielgebiets';
}

/** Kasten, der sich wie ein Knopf verhält: Tipp, Enter und Leertaste. */
function tapOpen(el, fn) {
  if (!el) return;
  el.onclick = fn;
  el.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  };
}

/**
 * Details zu einer gesetzten Position (Bene, Runde 23). Geöffnet über den
 * linken Teil der Standortleiste: Koordinaten zum Kopieren und Verschicken
 * und eine frische GPS-Messung. Mehr steht bewusst nicht drin (Bene,
 * Runde 23): Stadtteil und Bezirk stehen schon als Untertitel, alles
 * Weitere braucht dort niemand.
 *
 * Die Messung wird nur angezeigt, nicht übernommen — dafür gibt es einen
 * eigenen Knopf. Die Regel aus Runde 15 gilt weiter: die Ortung verschiebt den
 * Bezugspunkt der Fragen nie von selbst. `maximumAge: 0` erzwingt dabei eine
 * neue Messung, statt den gespeicherten Wert des Live-Standorts zu wiederholen
 * — genau dafür ist der Knopf da.
 *
 * `which` ist 'seeker' oder 'hide'.
 */
function showPosSheet(which) {
  const isHide = which === 'hide';
  const cur = () => (isHide ? S.hide : S.seeker);
  if (!cur()) { closeSheet(); return; }
  const card = document.getElementById('sheetCard');
  const fmtPt = (c) => c[1].toFixed(5) + ', ' + c[0].toFixed(5);
  let fresh = null;   // gemessen, noch nicht übernommen

  const render = () => {
    const pt = cur();

    card.innerHTML =
      '<div class="qtitle" id="sheetTitle">' +
      (isHide ? 'Dein Versteck' : 'Deine Position') + '</div>' +
      '<div class="qmeta">' + esc(placeName(pt)) + '</div>' +
      '<input class="sel" id="posCoord" readonly value="' + fmtPt(pt) + '">' +
      '<div class="answers">' +
      '<button class="ans yes" id="posCopy">Koordinaten kopieren</button>' +
      '</div>' +
      /* Als Verstecker steht man im Versteck — diese Zahlen sind genau die,
         die niemand bekommen soll. Gemeldet, nicht verboten (Runde 18). */
      (isHide ? '<div class="note warn">Das ist dein Versteck — nicht verschicken.</div>' : '') +
      '<div class="note" id="posMsg"></div>' +
      '<div class="setgrid one">' +
      '<button class="btn flat" id="posGeo">Standort aktualisieren</button></div>' +
      (fresh
        ? '<div class="poilist"><div class="poiitem">' +
          '<b>Neue Ortung <small>' + fmtPt(fresh.pt) + '</small></b>' +
          '<div class="poiacts">' +
          '<button class="minibtn" id="freshCopy">Kopieren</button>' +
          '<button class="minibtn" id="freshSet">Übernehmen</button>' +
          '</div></div></div>' +
          '<div class="note">' +
          (fresh.acc ? 'auf ' + Math.round(fresh.acc) + ' m genau · ' : '') +
          fmtDist(distKm(fresh.pt[0], fresh.pt[1], pt[0], pt[1])) +
          ' von der eingetragenen ' + (isHide ? 'Versteck-' : '') + 'Position</div>'
        : '') +
      '<button class="ghost" data-a="">Schließen</button>';

    const msg = card.querySelector('#posMsg');
    const copy = async (btn, txt, label) => {
      try { await navigator.clipboard.writeText(txt); btn.textContent = 'kopiert'; }
      catch (e) {
        const inp = card.querySelector('#posCoord');
        inp.value = txt; inp.focus(); inp.select();
        msg.textContent = 'Markiert — mit Strg/⌘+C kopieren.';
      }
      setTimeout(() => { btn.textContent = label; }, 1800);
    };
    card.querySelector('#posCopy').onclick = (e) =>
      copy(e.currentTarget, fmtPt(cur()), 'Koordinaten kopieren');

    card.querySelector('#posGeo').onclick = () => {
      if (!navigator.geolocation) { msg.textContent = 'Standort nicht verfügbar.'; return; }
      msg.textContent = 'Standort wird gesucht …';
      navigator.geolocation.getCurrentPosition(
        (p) => {
          fresh = { pt: [p.coords.longitude, p.coords.latitude], acc: p.coords.accuracy };
          render();
        },
        () => { msg.textContent = 'Standort nicht verfügbar — Koordinaten von Hand eintragen.'; },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    };

    const fc = card.querySelector('#freshCopy');
    if (fc) fc.onclick = (e) => copy(e.currentTarget, fmtPt(fresh.pt), 'Kopieren');
    const fs = card.querySelector('#freshSet');
    if (fs) fs.onclick = () => {
      const p = [fresh.pt[0], fresh.pt[1]];
      fresh = null;
      if (isHide) setHide(p, true); else setSeeker(p, true);
      render();
    };
    card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  };

  render();
  document.getElementById('sheet').hidden = false;
}

/**
 * Dialog zur Eingabe von Koordinaten.
 * `opts.title` / `opts.cur` / `opts.set` steuern Überschrift, Vorbelegung und
 * Ziel — ohne Argumente setzt er wie bisher die Seeker-Position. Deshalb
 * nirgends direkt als Klick-Handler hängen: das Klick-Ereignis käme sonst als
 * `opts` an.
 */
function askCoords(opts) {
  const o = opts || {};
  const card = document.getElementById('sheetCard');
  const cur = o.cur || S.seeker || [S.home.x, S.home.y];
  const set = o.set || ((p) => setSeeker(p, true));
  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">' + (o.title || 'Koordinaten eingeben') + '</div>' +
    '<div class="qmeta">Koordinaten oder ein eingefügter Link — Rheinjagd, ' +
    'Google Maps, Apple Karten, OpenStreetMap, <code>geo:</code>. Auch ' +
    '<code>50°56\'31"N 6°57\'30"E</code> geht.</div>' +
    '<input class="sel" id="coordIn" inputmode="decimal" autocomplete="off" ' +
    'placeholder="50.94196, 6.95827" value="' + cur[1].toFixed(5) + ', ' + cur[0].toFixed(5) + '">' +
    '<div class="note" id="coordMsg"></div>' +
    /* Die Ortung schreibt ihre Koordinaten **ins Feld**, statt sie sofort zu
       übernehmen (Bene, Runde 21): so stehen sie sichtbar da, lassen sich
       kopieren und an die andere Gruppe schicken — und man kann sie vor dem
       Setzen noch korrigieren. */
    (o.geo || o.map
      ? '<div class="setgrid' + (o.geo && o.map ? '' : ' one') + '">' +
        (o.geo ? '<button class="btn flat" id="coordGeo">Mein Standort</button>' : '') +
        (o.map ? '<button class="btn flat" id="coordMap">Auf Karte tippen</button>' : '') +
        '</div>'
      : '') +
    '<div class="answers">' +
    '<button class="ans yes" id="coordOk">' + (o.okLabel || 'Position setzen') + '</button>' +
    '</div><button class="ghost" data-a="">Abbrechen</button>';

  const input = card.querySelector('#coordIn');
  const msg = card.querySelector('#coordMsg');
  const fill = (p) => { input.value = p[1].toFixed(5) + ', ' + p[0].toFixed(5); input.select(); };
  const geoBtn = card.querySelector('#coordGeo');
  if (geoBtn) geoBtn.onclick = () => {
    if (S.geoPos) { fill(S.geoPos); msg.textContent = 'Ortung übernommen — ' +
      (S.geoAcc ? 'auf ' + Math.round(S.geoAcc) + ' m genau. ' : '') + 'Mit „Setzen" bestätigen.'; return; }
    if (!navigator.geolocation) { msg.textContent = 'Standort nicht verfügbar.'; return; }
    msg.textContent = 'Standort wird gesucht …';
    navigator.geolocation.getCurrentPosition(
      (pos) => { fill([pos.coords.longitude, pos.coords.latitude]);
        msg.textContent = 'Ortung übernommen — auf ' + Math.round(pos.coords.accuracy) +
          ' m genau. Mit „Setzen" bestätigen.'; },
      () => { msg.textContent = 'Standort nicht verfügbar — Koordinaten von Hand eintragen.'; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
  const mapBtn = card.querySelector('#coordMap');
  if (mapBtn) mapBtn.onclick = async () => {
    closeSheet();
    const p = await pickPoint(o.title || 'Punkt auf der Karte antippen — Esc bricht ab');
    if (p) set(p); else if (o.onCancel) o.onCancel();
  };
  const apply = () => {
    const r = parseLocationInfo(input.value);
    if (r && r.error === 'shortlink') {
      msg.textContent = 'Kurzlinks (maps.app.goo.gl) lassen sich hier nicht auflösen. ' +
        'Öffne ihn in Maps und teile von dort die Koordinaten.';
      return;
    }
    const p = r && r.pt;
    if (!p) {
      msg.textContent = 'Nichts gefunden. Zwei Zahlen wie 50.94196, 6.95827 oder ' +
        'einen Karten-Link einfügen.';
      return;
    }
    if (p[1] < 47 || p[1] > 55 || p[0] < 5 || p[0] > 10) {
      msg.textContent = 'Das liegt weit außerhalb der Region — Breite und Länge vertauscht?';
      return;
    }
    closeSheet(); set(p);
  };
  card.querySelector('#coordOk').onclick = apply;
  input.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
  card.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => { closeSheet(); if (o.onCancel) o.onCancel(); };
  });
  document.getElementById('sheet').hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 40);
}

const SHARE_PARAM = 'p';   // Name des Koordinaten-Parameters im geteilten Link

/**
 * Erkennt eine Position in beliebigem eingefügtem Text. Gedacht für das, was
 * im Spiel tatsächlich im Chat landet: ein Rheinjagd-Link, ein Google-Maps-
 * Link in seinen diversen Formen, ein geo:-Link, ein OSM-Link, Koordinaten aus
 * dem Langdruck in Maps — dezimal oder in Grad/Minuten/Sekunden.
 *
 * Gibt `{ pt: [lon, lat], how }` zurück, bei einem nicht auflösbaren Kurzlink
 * `{ error: 'shortlink' }`, sonst `null`. Reihenfolge ist Absicht: erst die
 * eindeutigen Muster, ganz zuletzt „irgendwo stehen zwei Zahlen“ — sonst
 * fischt man aus einer URL die Zoomstufe statt der Koordinate.
 */
function parseLocationInfo(text) {
  const txt = String(text || '').trim();
  if (!txt) return null;
  const N = '(-?\\d+(?:\\.\\d+)?)';
  const ok = (lat, lon, how) => {
    lat = parseFloat(lat); lon = parseFloat(lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { pt: [lon, lat], how };
  };

  // Kurzlinks lassen sich ohne Netz nicht auflösen — ehrlich melden statt
  // irgendeine Zahl aus der URL zu raten.
  if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(txt)) return { error: 'shortlink' };

  const pats = [
    // Rheinjagd-Link: #p=lat,lon
    [new RegExp('[#&?]' + SHARE_PARAM + '=' + N + '%2C' + N, 'i'), 'rheinjagd'],
    [new RegExp('[#&?]' + SHARE_PARAM + '=' + N + ',' + N), 'rheinjagd'],
    // geo:lat,lon
    [new RegExp('geo:' + N + ',' + N, 'i'), 'geo'],
    // Google/Apple: ?q=, ?query=, ?ll=, ?daddr=, ?destination=
    [new RegExp('[?&](?:q|query|ll|sll|daddr|destination|center)=' + N + '%2C' + N, 'i'), 'maps'],
    [new RegExp('[?&](?:q|query|ll|sll|daddr|destination|center)=' + N + ',' + N, 'i'), 'maps'],
    // Google-Ortsdaten: !3dlat!4dlon — der Ort selbst, deshalb vor dem
    // Kartenausschnitt @lat,lon (der nur die Bildmitte ist).
    [new RegExp('!3d' + N + '!4d' + N), 'maps'],
    [new RegExp('@' + N + ',' + N), 'maps'],
    // OpenStreetMap: #map=15/lat/lon
    [new RegExp('map=\\d+(?:\\.\\d+)?\\/' + N + '\\/' + N, 'i'), 'osm'],
  ];
  for (const [re, how] of pats) {
    const m = txt.match(re);
    if (m) { const r = ok(m[1], m[2], how); if (r) return r; }
  }

  // Grad/Minuten/Sekunden: 50°56'31.1"N 6°57'29.8"E
  const dms = txt.match(
    /(\d+)[°\s]+(\d+)['′\s]+([\d.]+)["″\s]*([NS])[,\s]+(\d+)[°\s]+(\d+)['′\s]+([\d.]+)["″\s]*([EWO])/i);
  if (dms) {
    const d2d = (d, m, sec, sign) =>
      (+d + +m / 60 + +sec / 3600) * (/[SW]/i.test(sign) ? -1 : 1);
    const r = ok(d2d(dms[1], dms[2], dms[3], dms[4]), d2d(dms[5], dms[6], dms[7], dms[8]), 'dms');
    if (r) return r;
  }

  // Zwei blanke Zahlen — nur wenn kein Link im Text steht, sonst erwischt man
  // Zoomstufen, Marker-IDs oder Zeitstempel.
  if (!/https?:\/\//i.test(txt)) {
    const nums = txt.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 2) return ok(nums[0], nums[1], 'zahlen');
  }
  return null;
}

/** Wie `parseLocationInfo`, aber nur die Koordinate (oder `null`). */
function parseCoords(s) {
  const r = parseLocationInfo(s);
  return r && r.pt ? r.pt : null;
}

function hint(text) {
  const el = document.getElementById('mapHint');
  if (!text) { el.hidden = true; return; }
  el.textContent = text; el.hidden = false;
}

function pickPoint(text) {
  /* Solange man die Karte antippen soll, gehört ihr der Platz. Das Panel
     steht auf dem Handy bei 78 dvh — bliebe es offen, wäre vom Zielpunkt
     nichts zu sehen. Danach fährt es von selbst wieder hoch, und der
     gespeicherte Zustand bleibt unberührt (`save2 = false`). */
  if (isNarrow() && S.panelOpen) { S.panelReopen = true; setPanelOpen(false, false); }
  return new Promise((res) => { hint(text); S.picking = res; });
}

/** Panel nach einer Punktauswahl wieder aufklappen, falls es dafür zuklappte. */
function restorePanelAfterPick() {
  if (!S.panelReopen) return;
  S.panelReopen = false;
  setPanelOpen(true, false);
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
      '<div class="setgrid">' +
      '<button class="btn flat" id="btnPick">Auf Karte tippen</button>' +
      '<button class="btn flat" id="btnCoord">Koordinaten</button>' +
      '</div>' +
      /* Auch ohne Jäger-Position setzbar: als Verstecker steht man im
         Versteck, lange bevor der erste Standort im Chat ankommt. */
      '<div class="setgrid one">' +
      '<button class="btn flat" id="btnHide">' +
      (S.hide ? 'Versteck ändern' : 'Versteck setzen') + '</button></div>';
    document.getElementById('btnGeo').onclick = useGeolocation;
    document.getElementById('btnHome').onclick = () => setSeeker([S.home.x, S.home.y], true);
    document.getElementById('btnPick').onclick = pickSeeker;
    document.getElementById('btnCoord').onclick = () => askCoords();
    document.getElementById('btnHide').onclick = showHideSheet;
    return;
  }

  if (liveCount() === 0) {
    box.innerHTML =
      '<div class="empty"><b>Keine Station übrig</b>' +
      'Alle Stationen sind ausgeschlossen. Vermutlich wurde eine Antwort falsch ' +
      'eingetragen — lösche im Verlauf die letzte Frage.</div>';
    return;
  }

  // Standortleiste: zeigt die aktuelle Position und erlaubt sie zu ändern
  const bar = document.createElement('div');
  bar.className = 'posbar';
  const where = placeName(S.seeker);
  bar.innerHTML =
    '<div class="poswho tap" id="pInfo" role="button" tabindex="0" ' +
    'title="Details zum Standort">' +
    '<span class="posdot"></span>' +
    '<div><div class="posname">' + esc(where) + '</div>' +
    '<div class="poscoord">' + S.seeker[1].toFixed(5) + ', ' + S.seeker[0].toFixed(5) + '</div></div>' +
    '<span class="posmore" aria-hidden="true">›</span></div>' +
    '<div class="posacts">' +
    '<button class="minibtn" id="pGeo" title="Mein Standort">GPS</button>' +
    '<button class="minibtn" id="pMap" title="Position auf der Karte antippen">Karte</button>' +
    '<button class="minibtn" id="pHome" title="' + esc(S.home.name) + '">Start</button>' +
    '<button class="minibtn" id="pCoord" title="Koordinaten eingeben">Koord.</button>' +
    '</div>';
  box.appendChild(bar);
  bar.querySelector('#pGeo').onclick = useGeolocation;
  bar.querySelector('#pMap').onclick = pickSeeker;
  bar.querySelector('#pHome').onclick = () => setSeeker([S.home.x, S.home.y], true);
  bar.querySelector('#pCoord').onclick = () => askCoords();
  tapOpen(bar.querySelector('#pInfo'), () => showPosSheet('seeker'));

  /* Versteck-Leiste: zweite Position in eigener Farbe, damit die beiden nie
     verwechselt werden. Solange keine gesetzt ist, steht hier nur ein Knopf. */
  if (!S.hide) {
    const set = document.createElement('div');
    set.className = 'setgrid one';
    set.innerHTML = '<button class="btn flat" id="btnHide">Versteck setzen</button>';
    box.appendChild(set);
    set.querySelector('#btnHide').onclick = showHideSheet;
  } else {
    const st = hideStatus();
    const hb = document.createElement('div');
    hb.className = 'posbar forhide';
    hb.innerHTML =
      '<div class="poswho tap" id="hInfo" role="button" tabindex="0" ' +
      'title="Details zum Versteck">' +
      '<span class="posdot"></span>' +
      '<div><div class="posname">Versteck · ' + esc(placeName(S.hide)) + '</div>' +
      '<div class="poscoord' + (st.ok ? '' : st.illegal ? ' warn' : ' bad') + '">' +
      hideStatusText(st) + '</div></div>' +
      '<span class="posmore" aria-hidden="true">›</span></div>' +
      '<div class="posacts">' +
      '<button class="minibtn" id="hGeo" title="Versteck = mein Standort">GPS</button>' +
      '<button class="minibtn" id="hMap" title="Versteck auf der Karte antippen">Karte</button>' +
      '<button class="minibtn" id="hCoord" title="Versteck als Koordinaten">Koord.</button>' +
      '<button class="minibtn" id="hOff" title="Versteck löschen" aria-label="Versteck löschen">✕</button>' +
      '</div>';
    box.appendChild(hb);
    hb.querySelector('#hGeo').onclick = hideFromGeo;
    hb.querySelector('#hMap').onclick = pickHide;
    tapOpen(hb.querySelector('#hInfo'), () => showPosSheet('hide'));
    hb.querySelector('#hCoord').onclick = askHideCoords;
    hb.querySelector('#hOff').onclick = () => { S.hide = null; renderMarks(); renderAsk(); save(); };
  }

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
      const ha = hideAnswer(q);

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

      /* Steht ein Versteck, ersetzt die wahre Antwort die Kontextzeile: die
         zeigt sonst nur die Zahl der Jäger-Seite, und zwei unbeschriftete
         Zahlen nebeneinander wären nicht auseinanderzuhalten. „knapp" steht
         im Text, nicht nur in der Farbe. */
      let sub = q.ctx ? q.ctx() : q.sub;
      if (ha) {
        sub = esc(hideRowText(ha) + (ha.near ? ' · knapp' : ''));
        gain = '<div class="gain"><span class="verdict ' +
               (ha.near ? 'near' : (ha.ans === 'yes' || ha.ans === 'closer' ? 'yes' : 'no')) +
               '">' + ANS_LABEL[ha.ans] + '</span></div>';
      }
      row.innerHTML =
        '<div><div class="qname">' + q.name + '</div>' +
        '<div class="qsub">' + sub + '</div></div>' + gain;
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

/* ---------- Thermometer: Endpunkt ----------
   Der Endpunkt kommt über **Koordinaten** herein (Bene, Runde 21): ein
   Kartentipp ist auf dem Handy ein paar Dutzend Meter ungenau, und bei einer
   ½-Meile-Fahrt entscheidet genau das über die Lage der Mittelsenkrechten.
   „Mein Standort" schreibt die Ortung ins Feld, statt sie still zu übernehmen
   — so steht die Koordinate sichtbar da und lässt sich an die andere Gruppe
   schicken. Der Kartentipp bleibt als dritter Weg. */
function askThermoEnd(q, from, done, onCancel) {
  const a = from || S.seeker;
  S.thermoFrom = a; renderMarks();
  const finish = (to) => {
    S.thermoFrom = null; renderMarks();
    if (to) done(to); else if (onCancel) onCancel();
  };
  askCoords({
    title: 'Endpunkt nach ' + fmtMi(q.mi) + ' Fahrt',
    cur: q.to || a, geo: true, map: true, okLabel: 'Endpunkt setzen',
    set: finish, onCancel: () => finish(null),
  });
}

/* ---------- Antwort-Dialog ---------- */
async function openSheet(q) {
  if (q.type === 'thermo') {
    const from = S.seeker;
    askThermoEnd(q, from, (to) => showSheet(
      { ...q, from, to, realKm: distKm(from[0], from[1], to[0], to[1]) }, null));
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
  const ha = hideAnswer(q);
  let meta = q.ctx ? q.ctx() : '';
  if (q.type === 'thermo') meta = 'Tatsächlich gefahren: ' + q.realKm.toFixed(2) + ' km';

  let html =
    '<div class="qtitle" id="sheetTitle">' + q.ask + '</div>' +
    '<div class="qmeta">' + meta + '</div>';
  /* Hier ist Platz für die Namen: gerade sie machen die Zahl prüfbar. Steht
     da ein Park, neben dem du gar nicht sitzt, fehlt er in den Daten — das
     sieht man nur, wenn er dasteht. */
  if (ha) html += '<div class="hidenote' + (ha.near ? ' near' : '') + '">' + hideSheetText(q, ha) + '</div>';
  html += '<div class="answers">';

  for (const a of answers) {
    const o = ev && ev.opts.find((x) => x.answer === a);
    const cls = (a === 'no' || a === 'further' || a === 'colder') ? 'no' : 'yes';
    const sub = o ? fmtArea(o.area) + ' km² · ' + o.keep + ' Stat.' : '';
    html += '<button class="ans ' + cls + (ha && ha.ans === a ? ' true' : '') +
            '" data-a="' + a + '">' +
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

/** Kurzfassung für die Fragenzeile: beide Werte, keine Namen beim Messen. */
function hideRowText(ha) {
  if (ha.kind === 'radar') return 'Versteck ' + fmtDist(ha.mine) + ' · Radius ' + fmtDist(ha.theirs);
  if (ha.kind === 'measure') return 'Versteck ' + fmtDist(ha.mine) + ' · Jäger ' + fmtDist(ha.theirs);
  return 'Versteck: ' + ha.mineName + ' · Jäger: ' + ha.theirsName;
}

/** Die wahre Antwort im Dialog — beim Messen mit den Namen beider Orte. */
function hideSheetText(q, ha) {
  const side = (label, km, name) =>
    label + ' ' + fmtDist(km) + (name ? ' · ' + esc(name) : '');
  let line;
  if (ha.kind === 'radar') line = side('Versteck', ha.mine) + ' — Radius ' + fmtDist(ha.theirs);
  else if (ha.kind === 'measure')
    line = side('Versteck', ha.mine, ha.mineName) + ' — ' + side('Jäger', ha.theirs, ha.theirsName);
  else line = 'Versteck: ' + esc(ha.mineName) + ' — Jäger: ' + esc(ha.theirsName);

  /* Beim Matching ist die Marge der Abstand zu der Grenze, die die Antwort
     kippen würde — beim Messen der Unterschied selbst. Zwei Sachen, zwei
     Beschriftungen; „Unterschied 0 m" über einer Stadtteilgrenze wäre Unsinn. */
  const m = ha.margin * 1000;
  const nah = (ha.kind === 'match' ? 'Abstand zur Grenze: ' : 'Unterschied: ') +
              (m < 1 ? 'unter 1 m' : Math.round(m) + ' m');
  return line + ' → <b>' + ANS_LABEL[ha.ans].toUpperCase() + '</b>' +
         (ha.near ? '<br>' + nah + ' — das entscheidet ihr besser vor Ort.' : '');
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

/** Antwort übernehmen: alle Stationen ausschließen, die sie nicht überstehen. */
function commit(q, ans) {
  const before = liveCount();
  // Grenzfälle vor dem Anwenden bestimmen — danach sind sie von den übrigen
  // möglichen Stationen nicht mehr zu unterscheiden.
  const grenz = borderlineFor(q, ans, liveStations());
  applyAnswer(q, ans);
  S.stamp++;
  const after = liveCount();

  let label = q.name, answerText = ANS_LABEL[ans] || ans;
  if (q.type === 'tentacle' && ans !== 'none') {
    answerText = activePois(q.cat)[+ans]?.n || ans;
  }
  S.history.push({
    q: { ...q }, ans, label, answerText,
    before, after, grenz,
    area: liveArea(),
  });
  renderExclusion(); drawEdges(); drawArea(); renderAsk(); renderHist(); save();
  if (grenz.length) showBorderlineSheet(S.history.length - 1);
}

/** Eine Antwort auf S.killed anwenden (ohne Neuzeichnen). */
function applyAnswer(q, ans) {
  const m = applyQuestion(q, ans);
  for (let i = 0; i < S.killed.length; i++) if (!m[i]) S.killed[i] = 1;
}

function undoAt(i) {
  S.history.splice(i, 1);
  recompute();
}

function recompute() {
  S.killed = new Uint8Array(S.stations.length);
  S.stamp++;
  for (const h of S.history) {
    h.grenz = borderlineFor(h.q, h.ans, liveStations());
    applyAnswer(h.q, h.ans);
    S.stamp++;
    h.after = liveCount();
    h.area = liveArea();
  }
  renderExclusion(); drawEdges(); drawArea(); renderAsk(); renderHist(); save();
}

/**
 * Meldung über die Grenzfälle einer Antwort: Stationen, durch die die Grenze
 * dieser Frage direkt hindurchläuft. Sie bleiben möglich, weil die App das
 * nicht entscheiden kann — ihr in der Gruppe schon ("die Haltestelle liegt
 * eindeutig in Sülz"). Deshalb hier gleich der Knopf zum Ausschließen.
 */
function showBorderlineSheet(hi) {
  const h = S.history[hi];
  if (!h || !h.grenz || !h.grenz.length) { closeSheet(); return; }
  const offen = h.grenz.filter((g) => !S.manual.has(g.i));
  const card = document.getElementById('sheetCard');

  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">' +
    (offen.length ? offen.length + (offen.length === 1 ? ' Grenzfall' : ' Grenzfälle')
                  : 'Grenzfälle erledigt') + '</div>' +
    '<div class="qmeta">' + esc(h.label) + ' · ' + esc(h.answerText) + '</div>' +
    '<div class="note">Die Grenze dieser Frage läuft direkt durch diese ' +
    'Stationen — angegeben ist ihr Abstand dazu. Sie bleiben deshalb möglich. ' +
    'Wenn ihr euch einig seid, dass dort niemand sein kann, hier ' +
    'ausschließen.</div>' +
    '<div class="poilist">' +
    h.grenz.map((g) => {
      const raus = S.manual.has(g.i);
      return '<div class="poiitem' + (raus ? ' off' : '') + '">' +
        '<b>' + esc(S.stations[g.i].n) + ' <small>' +
        (g.m * 1000).toFixed(1).replace('.', ',') + ' m</small></b>' +
        '<div class="poiacts"><button class="minibtn" data-st="' + g.i + '">' +
        (raus ? 'zurück' : 'ausschließen') + '</button></div></div>';
    }).join('') +
    '</div>' +
    '<button class="ghost" data-a="">Alle behalten</button>';

  card.querySelectorAll('[data-st]').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.st;
      if (S.manual.has(i)) S.manual.delete(i);
      else { S.endgame.delete(i); S.force.delete(i); S.manual.add(i); }
      afterStationChange();
      showBorderlineSheet(hi);   // Liste offen lassen, Stand aktualisieren
    };
  });
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
}

/**
 * Eine beantwortete Frage nachträglich korrigieren (Runde 21).
 *
 * Bis hierher war der einzige Weg: löschen und neu stellen — und beim
 * Thermometer hieß das, den Endpunkt noch einmal zu setzen. Im Spiel steht
 * aber genau das Gegenteil an: die Frage stimmt, nur der eingetippte Endpunkt
 * war ein Zahlendreher, oder die Jäger hatten ihre Position noch nicht genau
 * durchgegeben.
 *
 * Geändert werden Positionen und Antwort **an der eingefrorenen Kopie im
 * Verlauf** (`h.q`) — sie ist der Bezugspunkt der Auswertung, `S.seeker` bleibt
 * unberührt. Danach rechnet `recompute()` den ganzen Verlauf neu, inklusive
 * der Grenzfälle jeder folgenden Frage.
 */
function showEditSheet(i) {
  const h = S.history[i];
  if (!h) { closeSheet(); return; }
  const q = h.q;
  const card = document.getElementById('sheetCard');
  const pts = q.type === 'thermo'
    ? [{ k: 'from', label: 'Start' }, { k: 'to', label: 'Endpunkt' }]
    : [{ k: 'seeker', label: 'Jäger-Position' }];
  const answers = ANSWER_SETS[q.type];
  const fmtPt = (c) => c[1].toFixed(5) + ', ' + c[0].toFixed(5);

  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">' + esc(h.label) + '</div>' +
    '<div class="qmeta">' +
    (q.type === 'thermo' && q.realKm != null
      ? 'Tatsächlich gefahren: ' + q.realKm.toFixed(2) + ' km'
      : esc(placeName(q.seeker))) + '</div>' +
    '<div class="poilist">' +
    pts.filter((p) => q[p.k]).map((p) =>
      '<div class="poiitem"><b>' + p.label +
      ' <small>' + fmtPt(q[p.k]) + '</small></b>' +
      '<div class="poiacts">' +
      '<button class="minibtn" data-copy="' + p.k + '">Kopieren</button>' +
      '<button class="minibtn" data-pt="' + p.k + '">Ändern</button>' +
      '</div></div>').join('') +
    '</div>' +
    (answers
      ? '<div class="answers">' + answers.map((a) =>
          '<button class="ans ' +
          ((a === 'no' || a === 'further' || a === 'colder') ? 'no' : 'yes') +
          (a === h.ans ? ' true' : '') + '" data-ans="' + a + '">' +
          ANS_LABEL[a] + '</button>').join('') + '</div>'
      : '<div class="note">Antwort: ' + esc(h.answerText) + ' — bei Tentacles ' +
        'nicht umschaltbar. Dafür die Frage löschen und neu stellen.</div>') +
    '<button class="ghost" data-a="">Fertig</button>';

  /* Position ändern: dieselbe Koordinateneingabe wie beim Stellen der Frage,
     mit Ortung und Kartentipp als Alternativen. Danach wird neu gerechnet und
     der Dialog bleibt offen — man korrigiert selten nur eine Sache. */
  const setPt = (k, p) => {
    q[k] = p;
    if (q.type === 'thermo') {
      if (k === 'from') q.seeker = [p[0], p[1]];
      if (q.from && q.to) q.realKm = distKm(q.from[0], q.from[1], q.to[0], q.to[1]);
    }
    recompute();
    showEditSheet(i);
  };
  card.querySelectorAll('[data-pt]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.pt;
      const label = pts.find((p) => p.k === k).label;
      if (q.type === 'thermo' && k === 'to') {
        askThermoEnd(q, q.from, (p) => setPt('to', p), () => showEditSheet(i));
        return;
      }
      askCoords({
        title: label + ' ändern', cur: q[k], geo: true, map: true,
        okLabel: 'Übernehmen', set: (p) => setPt(k, p),
        onCancel: () => showEditSheet(i),
      });
    };
  });
  card.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      const txt = fmtPt(q[b.dataset.copy]);
      try { await navigator.clipboard.writeText(txt); b.textContent = 'kopiert'; }
      catch { b.textContent = txt; }
      setTimeout(() => { b.textContent = 'Kopieren'; }, 1800);
    };
  });
  card.querySelectorAll('[data-ans]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.ans;
      if (a === h.ans) return;
      h.ans = a; h.answerText = ANS_LABEL[a] || a;
      recompute();
      showEditSheet(i);
    };
  });
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
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
      '<div class="hkm">' + fmtArea(h.area) + ' km²' +
      (h.grenz && h.grenz.length
        ? '<button class="minibtn" data-grenz="' + i + '" title="Grenzfälle ansehen">' +
          h.grenz.length + ' knapp</button>'
        : '') + '</div>' +
      '<button class="edit" data-e="' + i + '" aria-label="Frage bearbeiten" ' +
      'title="Positionen und Antwort ändern">' +
      '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg></button>' +
      '<button class="del" data-i="' + i + '" aria-label="Frage entfernen">' +
      '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
  });
  html += '</div><button class="btn flat" id="btnClear">Verlauf leeren</button>';
  box.innerHTML = html;

  box.querySelectorAll('.del').forEach((b) => { b.onclick = () => undoAt(+b.dataset.i); });
  box.querySelectorAll('.edit').forEach((b) => { b.onclick = () => showEditSheet(+b.dataset.e); });
  box.querySelectorAll('[data-grenz]').forEach((b) => {
    b.onclick = () => showBorderlineSheet(+b.dataset.grenz);
  });
  document.getElementById('btnClear').onclick = () => { S.history = []; recompute(); };
}

/* ---------- Gebiet-Tab ---------- */
function renderSetup() {
  const box = document.getElementById('tabSetup');
  const active = hideStations();
  const live = liveStations();
  const manual = [...S.manual].filter((i) => kindOk(S.stations[i]));
  const endg = [...S.endgame].filter((i) => kindOk(S.stations[i]));
  const forced = [...S.force].filter((i) => kindOk(S.stations[i]));

  const stRow = (i, kind) =>
    '<div class="catrow"><b>' + esc(S.stations[i].n) + '</b>' +
    '<button class="minibtn" data-undo="' + kind + ':' + i + '">zurück</button></div>';

  box.innerHTML =
    /* --- Versteckzone: die wichtigste Einstellung, deshalb zuerst --- */
    '<div class="group"><div class="grouphd">Versteckzone' +
    ' <span class="ghint">' + fmtArea(liveArea()) + ' km² möglich</span></div>' +
    '<div class="slider">' +
    '<input type="range" id="hideIn" min="100" max="1000" step="50" value="' + S.hideRadiusM + '">' +
    '<output id="hideOut">' + S.hideRadiusM + ' m</output></div>' +
    '<div class="chips">' +
    Object.entries(STATION_KINDS).map(([k, v]) =>
      '<button class="chip" data-kind="' + k + '" aria-pressed="' + !!S.hideKinds[k] + '">' +
      v.label + '</button>').join('') +
    '</div>' +
    '<div class="catrow"><b>Stationen und Radien auf der Karte</b>' +
    '<button class="tgl" role="switch" aria-checked="' + !!S.showZones + '" id="zoneShow" ' +
    'aria-label="Stationen und Versteckradien auf der Karte"></button></div>' +
    '<div class="note">Punkt antippen, um eine Station von Hand zu behandeln.</div>' +
    '<button class="btn" id="zoneApply" hidden>Übernehmen</button>' +
    '</div>' +

    /* --- Stationen: die Zahl in der Überschrift, darunter nur noch das, was
       man zurücknehmen kann. Die Erklärtexte und Diagnosewerte (Bilanzzeile,
       Spielgebietsfläche, Anteil außerhalb Kölns, Toleranzregel) standen
       früher hier und sind auf Benes Wunsch raus — sie sagten nichts,
       woraufhin man etwas getan hätte (Runde 14 und 18). --- */
    '<div class="group"><div class="grouphd">Stationen' +
    ' <span class="ghint">' + live.length + ' von ' + active.length + ' möglich</span></div>' +
    (manual.length
      ? '<div class="catrow"><b>Von Hand ausgeschlossen</b><span class="cnt">' + manual.length + '</span></div>' +
        manual.map((i) => stRow(i, 'manual')).join('')
      : '') +
    (endg.length
      ? '<div class="catrow"><b>Endgame ausgelöst</b><span class="cnt">' + endg.length + '</span></div>' +
        endg.map((i) => stRow(i, 'endgame')).join('')
      : '') +
    (forced.length
      ? '<div class="catrow"><b>Trotzdem möglich gelassen</b><span class="cnt">' + forced.length + '</span></div>' +
        forced.map((i) => stRow(i, 'force')).join('')
      : '') +
    '</div>' +

    '<div class="group"><div class="grouphd">Startpunkt' +
    ' <span class="ghint">für Schnellwahl und Entfernungsangaben</span></div>' +
    '<div class="catrow"><b>' + esc(S.home.name) + '</b>' +
    '<span class="cnt">' + S.home.y.toFixed(4) + ', ' + S.home.x.toFixed(4) + '</span></div>' +
    '<div class="setgrid">' +
    '<button class="btn flat" id="sHome">Auf Karte setzen</button>' +
    '<button class="btn flat" id="sHomeCoord">Koordinaten</button>' +
    '</div></div>';

  /* Versteckzone */
  const zoneApply = box.querySelector('#zoneApply');
  const pending = {};
  const markPending = () => { zoneApply.hidden = !Object.keys(pending).length; };

  const hideIn = box.querySelector('#hideIn');
  const hideOut = box.querySelector('#hideOut');
  hideIn.oninput = () => {
    hideOut.textContent = hideIn.value + ' m';
    if (+hideIn.value === S.hideRadiusM) delete pending.hideRadiusM;
    else pending.hideRadiusM = +hideIn.value;
    markPending();
  };

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

  box.querySelector('#zoneShow').onclick = (e) => {
    S.showZones = !S.showZones;
    e.currentTarget.setAttribute('aria-checked', String(S.showZones));
    drawArea(); save();
  };

  box.querySelectorAll('[data-undo]').forEach((b) => {
    b.onclick = () => {
      const [kind, i] = b.dataset.undo.split(':');
      ({ manual: S.manual, endgame: S.endgame, force: S.force })[kind].delete(+i);
      afterStationChange();
    };
  });

  box.querySelector('#sHome').onclick = async () => {
    const pt = await pickPoint('Startpunkt auf der Karte antippen');
    changeArea({ home: { name: placeName(pt), x: pt[0], y: pt[1] } });
  };
  box.querySelector('#sHomeCoord').onclick = () => askHomeCoords();
}

/** Flächenangabe mit passender Genauigkeit. */
function fmtArea(a) {
  if (!isFinite(a) || a <= 0) return '0';
  if (a >= 10) return a.toFixed(0);
  if (a >= 1) return a.toFixed(1);
  return a.toFixed(2);
}

/** Versteckzone/Startpunkt ändern: Verlauf neu anwenden. Ohne Raster ist das
    sofort durch — kein Neuaufbau von Zellen, nur 245 Punktprüfungen je Frage. */
function changeArea(patch) {
  if (patch.home) S.home = patch.home;
  if (patch.hideRadiusM) S.hideRadiusM = patch.hideRadiusM;
  if (patch.hideKinds) S.hideKinds = patch.hideKinds;
  recompute();
  renderSetup();
  drawArea();
  if (S.map) fitArea();
}

/** Karte auf das aktuelle Spielgebiet zoomen. */
function fitArea() {
  if (!S.map || !S.box) return;
  const b = S.box;
  S.map.fitBounds([
    [b.minY, b.minX], [b.maxY, b.maxX],
  ], { padding: [16, 16] });
}

function askHomeCoords() {
  const card = document.getElementById('sheetCard');
  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">Startpunkt festlegen</div>' +
    '<div class="qmeta">Für Schnellwahl und Entfernungsangaben. Standard ist die ' +
    esc(HOME_DEFAULT.name) + '.</div>' +
    '<input class="sel" id="hName" placeholder="Name, z. B. Köln Hauptbahnhof" ' +
    'value="' + esc(S.home.name) + '">' +
    '<input class="sel" id="hCoord" inputmode="decimal" placeholder="50.94196, 6.95827" ' +
    'value="' + S.home.y.toFixed(5) + ', ' + S.home.x.toFixed(5) + '">' +
    '<div class="note" id="hMsg"></div>' +
    '<div class="answers">' +
    '<button class="ans yes" id="hOk">Übernehmen</button>' +
    '<button class="ans no" id="hReset">Zurück auf ' + esc(HOME_DEFAULT.name) + '</button>' +
    '</div><button class="ghost" data-a="">Abbrechen</button>';

  const msg = card.querySelector('#hMsg');
  card.querySelector('#hOk').onclick = () => {
    const p = parseCoords(card.querySelector('#hCoord').value);
    if (!p) { msg.textContent = 'Bitte zwei Zahlen eingeben, z. B. 50.94196, 6.95827'; return; }
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
  intro.textContent = 'Orte für Matching- und Measuring-Fragen';
  box.appendChild(intro);

  const actions = document.createElement('div');
  actions.className = 'setgrid';
  actions.innerHTML = '<button class="btn" id="btnAddPoi">+ Ort hinzufügen</button>';
  box.appendChild(actions);
  actions.querySelector('#btnAddPoi').onclick = () => openPoiSheet(null);

  /* Orte auf der Karte: immer nur genau eine Kategorie. Alle 783 gleichzeitig
     waren im Zentrum ein Punktbrei — und gefragt ist ohnehin immer eine
     Kategorie ("wo sind die Kinos?"). Nochmal auf dieselbe tippen = aus. */
  const mapSel = document.createElement('div');
  mapSel.className = 'group';
  mapSel.innerHTML =
    '<div class="grouphd"><span class="grouptitle">Auf der Karte</span>' +
    ' <span class="ghint">' +
    (S.poiCat ? esc(CATS[S.poiCat].plural) : 'aus') + '</span></div>' +
    '<div class="chips" id="poiCats">' +
    CAT_ORDER.filter((c) => (S.pois[c] || []).length).map((c) =>
      '<button class="chip poi" data-cat="' + c + '" aria-pressed="' +
      (S.poiCat === c) + '">' + esc(CATS[c].plural) + '</button>').join('') +
    '</div>';
  box.appendChild(mapSel);
  mapSel.querySelectorAll('.chip[data-cat]').forEach((b) => {
    b.onclick = () => {
      S.poiCat = S.poiCat === b.dataset.cat ? null : b.dataset.cat;
      renderData(); drawArea(); save();
    };
  });

  /* Verwaltungsgrenzen — anders als die Ortskategorien frei kombinierbar,
     weil Bezirk und Stadtteil zusammen gelesen werden (der grobe Rahmen und
     die feine Unterteilung darin). */
  const divSel = document.createElement('div');
  divSel.className = 'group';
  const divOn = ['d2', 'd3'].filter((k) => S.showDiv[k]).length;
  divSel.innerHTML =
    '<div class="grouphd"><span class="grouptitle">Grenzen</span>' +
    ' <span class="ghint">' + (divOn ? divOn + ' an' : 'aus') + '</span></div>' +
    '<div class="chips">' +
    ['d2', 'd3'].map((k) =>
      '<button class="chip poi" data-div="' + k + '" aria-pressed="' + !!S.showDiv[k] + '">' +
      esc(S.data.divisions[k].label) + 'e</button>').join('') +
    '</div>';
  box.appendChild(divSel);
  divSel.querySelectorAll('.chip[data-div]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.div;
      S.showDiv[k] = !S.showDiv[k];
      renderData(); drawDivisions(); save();
    };
  });

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
      S.sf.poi = {};
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
    '<input class="sel" id="poiCoord" inputmode="decimal" placeholder="oder Koordinaten: 50.94196, 6.95827" ' +
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
  S.sf.poi = {};
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
      hide: S.hide,
      home: S.home,
      hideRadiusM: S.hideRadiusM, hideKinds: S.hideKinds,
      showZones: S.showZones,
      manual: [...S.manual], endgame: [...S.endgame], force: [...S.force],
      history: S.history.map((h) => ({ q: h.q, ans: h.ans, label: h.label, answerText: h.answerText })),
      disabled: Object.fromEntries(Object.entries(S.disabled).map(([k, v]) => [k, [...v]])),
      expanded: Object.keys(S.expanded),
      customPois: S.customPois,
      poiCat: S.poiCat,
      showDiv: S.showDiv,
      shared: S.shared,
      live: S.geoWatch !== null,
    }));
  } catch (e) { /* privater Modus: kein Problem */ }
}

function load() {
  try {
    const raw = localStorage.getItem('rheinjagd');
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.seeker) S.seeker = d.seeker;
    if (Array.isArray(d.hide) && isFinite(d.hide[0]) && isFinite(d.hide[1])) S.hide = d.hide;
    if (d.home && isFinite(d.home.x) && isFinite(d.home.y)) {
      const untouched = Math.abs(d.home.x - HOME_LEGACY.x) < 1e-5 &&
                        Math.abs(d.home.y - HOME_LEGACY.y) < 1e-5;
      S.home = untouched ? { ...HOME_DEFAULT } : d.home;
    }
    // Alte Schlüssel bewusst nicht mehr gelesen: d.radiusKm (Radius-Kreis,
    // Runde 11), d.hideZoneOn und d.fineEdgesOn (Raster-Ära). Die Versteckzone
    // ist seit dem Stationsmodell keine Option mehr, sondern die Grundlage.
    if (d.hideRadiusM >= 50 && d.hideRadiusM <= 2000) S.hideRadiusM = d.hideRadiusM;
    if (d.hideKinds) S.hideKinds = { ...S.hideKinds, ...d.hideKinds };
    // Bis Runde 13 waren Stationspunkte und Radien zwei Schalter — ein alter
    // Spielstand zählt als "an", wenn einer der beiden an war.
    if (typeof d.showZones === 'boolean') S.showZones = d.showZones;
    else if (typeof d.showStations === 'boolean' || typeof d.showRadii === 'boolean')
      S.showZones = !!(d.showStations || d.showRadii);
    if (Array.isArray(d.manual)) S.manual = new Set(d.manual.filter(Number.isInteger));
    if (Array.isArray(d.endgame)) S.endgame = new Set(d.endgame.filter(Number.isInteger));
    if (Array.isArray(d.force)) S.force = new Set(d.force.filter(Number.isInteger));
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
    // d.showPois (alles-oder-nichts) wird bewusst nicht mehr gelesen: die
    // Anzeige läuft jetzt über genau eine Kategorie.
    if (typeof d.poiCat === 'string' && CATS[d.poiCat]) S.poiCat = d.poiCat;
    if (d.showDiv) S.showDiv = { d2: !!d.showDiv.d2, d3: !!d.showDiv.d3 };
    if (d.shared && isFinite(d.shared.x) && isFinite(d.shared.y)) S.shared = d.shared;
    S.wantLive = !!d.live;   // erst nach initMap() wirklich starten
    return true;
  } catch (e) { return false; }
}

/* ---------- Standort teilen ---------- */

/** Lesbares Alter einer geteilten Position. */
function sharedAge(t) {
  const min = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  if (min < 1) return 'gerade eben';
  if (min < 60) return 'vor ' + min + ' Min.';
  const h = Math.floor(min / 60);
  return 'vor ' + h + ' Std. ' + (min % 60) + ' Min.';
}

/**
 * Link auf eine Position bauen. Die Koordinaten stecken im Fragment (`#`) —
 * das schickt der Browser nie an den Server, die Position bleibt also
 * zwischen den beiden Chats. Fünf Nachkommastellen sind rund 1 m.
 */
function shareUrlFor(pt, name) {
  const base = location.origin + location.pathname + location.search;
  const sp = new URLSearchParams();
  sp.set(SHARE_PARAM, pt[1].toFixed(5) + ',' + pt[0].toFixed(5));
  if (name) sp.set('n', name);
  sp.set('t', String(Math.round(Date.now() / 1000)));
  return base + '#' + sp.toString();
}

/** Dialog „Standort teilen": welche Position, dann Teilen-Menü oder Kopieren. */
function showShareSheet() {
  const card = document.getElementById('sheetCard');
  const opts = [];
  if (S.geoPos) opts.push({ k: 'live', label: 'Mein aktueller Standort', pt: S.geoPos });
  if (S.seeker) opts.push({ k: 'seeker', label: 'Seeker-Position', pt: S.seeker });
  opts.push({ k: 'home', label: S.home.name, pt: [S.home.x, S.home.y] });

  if (!S.geoPos && !S.seeker) {
    card.innerHTML =
      '<div class="qtitle" id="sheetTitle">Standort teilen</div>' +
      '<div class="note">Es gibt noch keine Position zum Teilen. Schalte oben ' +
      'die Ortung ein oder setze eine Position im Fragen-Tab.</div>' +
      '<button class="ghost" data-a="">Schließen</button>';
    card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
    document.getElementById('sheet').hidden = false;
    return;
  }

  let sel = opts[0];
  const render = () => {
    const url = shareUrlFor(sel.pt, placeName(sel.pt));
    card.innerHTML =
      '<div class="qtitle" id="sheetTitle">Standort teilen</div>' +
      '<div class="qmeta">Der Link enthält die Koordinaten. Wer ihn antippt, ' +
      'bekommt die Position in der App angeboten.</div>' +
      '<div class="chips">' +
      opts.map((o) => '<button class="chip" data-k="' + o.k + '" aria-pressed="' +
        (o.k === sel.k) + '">' + esc(o.label) + '</button>').join('') +
      '</div>' +
      '<div class="note">' + sel.pt[1].toFixed(5) + ', ' + sel.pt[0].toFixed(5) +
      ' · ' + esc(placeName(sel.pt)) + '</div>' +
      /* Als Verstecker steht man im Versteck — „Mein aktueller Standort" ist
         dann genau die Koordinate, die niemand bekommen soll. Gemeldet, nicht
         verboten: es kann Gründe geben, sie trotzdem zu schicken. */
      (S.hide && distKm(sel.pt[0], sel.pt[1], S.hide[0], S.hide[1]) < 0.15
        ? '<div class="note warn">Das ist praktisch dein Versteck ('
          + Math.round(distKm(sel.pt[0], sel.pt[1], S.hide[0], S.hide[1]) * 1000)
          + ' m entfernt).</div>'
        : '') +
      '<input class="sel" id="shareUrl" readonly value="' + esc(url) + '">' +
      '<div class="note" id="shareMsg"></div>' +
      '<div class="answers">' +
      (navigator.share ? '<button class="ans yes" id="shareGo">Teilen …</button>' : '') +
      '<button class="ans ' + (navigator.share ? 'no' : 'yes') + '" id="shareCopy">' +
      'Link kopieren</button>' +
      '</div><button class="ghost" data-a="">Schließen</button>';

    const msg = card.querySelector('#shareMsg');
    card.querySelectorAll('.chip[data-k]').forEach((b) => {
      b.onclick = () => { sel = opts.find((o) => o.k === b.dataset.k); render(); };
    });
    const go = card.querySelector('#shareGo');
    if (go) go.onclick = () => {
      navigator.share({ title: 'Rheinjagd — Standort', text: placeName(sel.pt), url })
        .catch(() => { /* abgebrochen ist kein Fehler */ });
    };
    card.querySelector('#shareCopy').onclick = async () => {
      const inp = card.querySelector('#shareUrl');
      try {
        await navigator.clipboard.writeText(url);
        msg.textContent = 'Kopiert — jetzt im Chat einfügen.';
      } catch (e) {
        inp.focus(); inp.select();
        msg.textContent = 'Markiert — mit Strg/⌘+C kopieren.';
      }
    };
    card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  };
  render();
  document.getElementById('sheet').hidden = false;
}

/** Geteilte Position aus der Adresse lesen (`#p=lat,lon&n=…&t=…`). */
function sharedFromUrl() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return null;
  let sp;
  try { sp = new URLSearchParams(raw); } catch (e) { return null; }
  const v = sp.get(SHARE_PARAM);
  if (!v) return null;
  const pt = parseCoords(v);
  if (!pt) return null;
  const t = parseInt(sp.get('t') || '', 10);
  return { x: pt[0], y: pt[1], name: sp.get('n') || '', t: isFinite(t) ? t : 0 };
}

/** Steht eine Position in der Adresse, sie anbieten und die Adresse säubern. */
function offerSharedFromUrl() {
  const incoming = sharedFromUrl();
  if (!incoming) return;
  clearUrlShare();
  if (S.map) S.map.setView([incoming.y, incoming.x], Math.max(S.map.getZoom(), 14));
  showSharedSheet(incoming, false);
}

/** Die Adresse wieder säubern, damit ein Reload nicht erneut fragt. */
function clearUrlShare() {
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (e) { location.hash = ''; }
}

/**
 * Angebot für eine empfangene Position. Bewusst eine Rückfrage und keine
 * stille Übernahme: ein Link aus dem Chat darf die Bezugsposition der eigenen
 * Fragen nicht einfach überschreiben.
 */
function showSharedSheet(sh, onMap) {
  const card = document.getElementById('sheetCard');
  const where = placeName([sh.x, sh.y]);
  card.innerHTML =
    '<div class="qtitle" id="sheetTitle">Geteilter Standort</div>' +
    '<div class="qmeta">' + (sh.name ? esc(sh.name) + ' · ' : '') + where + ' · ' +
    sh.y.toFixed(5) + ', ' + sh.x.toFixed(5) +
    (sh.t ? ' · ' + sharedAge(sh.t) : '') + '</div>' +
    '<div class="answers">' +
    '<button class="ans yes" id="shTake">Als Seeker-Position setzen</button>' +
    (onMap ? '' : '<button class="ans yes" id="shMark">Nur auf der Karte zeigen</button>') +
    (onMap ? '<button class="ans no" id="shDrop">Markierung entfernen</button>' : '') +
    '</div>' +
    '<div class="note">„Seeker-Position" heißt: alle neuen Fragen beziehen sich ' +
    'auf diesen Punkt. Schon beantwortete Fragen bleiben unberührt — die ' +
    'behalten ihre eigenen Koordinaten.</div>' +
    '<button class="ghost" data-a="">' + (onMap ? 'Schließen' : 'Verwerfen') + '</button>';

  const take = card.querySelector('#shTake');
  if (take) take.onclick = () => { closeSheet(); setSeeker([sh.x, sh.y], true); };
  const mark = card.querySelector('#shMark');
  if (mark) mark.onclick = () => {
    closeSheet();
    S.shared = sh;
    renderMarks(); save();
    if (S.map) S.map.setView([sh.y, sh.x], Math.max(S.map.getZoom(), 14));
  };
  const drop = card.querySelector('#shDrop');
  if (drop) drop.onclick = () => { closeSheet(); S.shared = null; renderMarks(); save(); };
  card.querySelectorAll('[data-a]').forEach((b) => { b.onclick = closeSheet; });
  document.getElementById('sheet').hidden = false;
}

/* ---------- Geolocation ---------- */

/**
 * Live-Standort an/aus. Getrennt von der Seeker-Position, und das mit Absicht:
 * die Seeker-Position ist der Bezugspunkt, auf den sich die gestellten Fragen
 * beziehen — die darf nicht mitwandern, während man weiterläuft. Der
 * Live-Punkt zeigt nur, wo man gerade ist; mit „GPS“ in der Standortleiste
 * übernimmt man ihn bewusst als Seeker-Position.
 */
function toggleLive() {
  if (S.geoWatch !== null) { stopLive(); hint('Standort aus'); setTimeout(() => hint(null), 1200); return; }
  if (!navigator.geolocation) { hint('Standort nicht verfügbar'); setTimeout(() => hint(null), 2000); return; }
  hint('Standort wird gesucht …');
  S.geoCentered = false;
  S.geoWatch = navigator.geolocation.watchPosition(
    (pos) => {
      S.geoPos = [pos.coords.longitude, pos.coords.latitude];
      S.geoAcc = pos.coords.accuracy || 0;
      if (!S.geoCentered) {
        S.geoCentered = true;
        hint(null);
        if (S.map) S.map.setView([S.geoPos[1], S.geoPos[0]], Math.max(S.map.getZoom(), 15));
      }
      renderMarks();
    },
    () => {
      stopLive();
      hint('Standort nicht verfügbar — Ortung im Browser erlauben?');
      setTimeout(() => hint(null), 3000);
    },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
  );
  syncLiveButton(); save();
}

function stopLive() {
  if (S.geoWatch !== null) navigator.geolocation.clearWatch(S.geoWatch);
  S.geoWatch = null; S.geoPos = null; S.geoAcc = 0;
  renderMarks(); syncLiveButton(); save();
}

function syncLiveButton() {
  const b = document.getElementById('btnLive');
  if (b) b.setAttribute('aria-pressed', String(S.geoWatch !== null));
}

function useGeolocation() {
  // Läuft der Live-Standort schon, ist die Position bereits da — kein zweiter
  // Ortungsvorgang nötig.
  if (S.geoPos) { setSeeker([...S.geoPos], true); return; }
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
      const wasTab = t.getAttribute('aria-selected') === 'true' ? want : null;
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      for (const [key, id] of Object.entries(TAB_IDS)) {
        document.getElementById(id).hidden = key !== want;
      }
      if (want === 'data') renderData();
      if (want === 'setup') renderSetup();
      // Auf dem Handy: ein Reiter holt das Panel hoch. Nochmal auf den schon
      // offenen Reiter klappt es wieder zu — das ist neben dem Griff die
      // zweite Handbewegung zum Schließen.
      if (isNarrow()) setPanelOpen(!(S.panelOpen && want === wasTab));
    };
  });
}

/* ---------- Panel auf-/zuklappen (nur schmale Schirme) ----------
   Auf dem Handy soll die Karte den meisten Platz haben (Bene, Runde 17). Das
   Panel steht deshalb standardmäßig zugeklappt da — nur Griff und Reiterleiste
   — und fährt hoch, sobald man einen Reiter antippt. Zugeklappt wird es nur
   von Hand (Griff oder nochmal auf den offenen Reiter); nichts schließt sich
   von selbst, während man daran arbeitet.
   Auf dem Desktop (≥900px) ist das Panel eine Spalte neben der Karte — dort
   gibt es weder Griff noch Zuklappen. */
const PANEL_KEY = 'rheinjagd-panel';

/** Schmaler Schirm? Dieselbe Schwelle wie im Stylesheet. */
function isNarrow() { return !matchMedia('(min-width:900px)').matches; }

/** Zugeklappt/aufgeklappt setzen. `h` ist die gemerkte Arbeitshöhe in px. */
function setPanelOpen(open, save2) {
  const panel = document.getElementById('panel');
  const grip = document.getElementById('grip');
  S.panelOpen = !!open;
  panel.classList.toggle('collapsed', !S.panelOpen);
  grip.setAttribute('aria-expanded', String(S.panelOpen));
  if (S.panelOpen && S.panelH) {
    panel.style.height = S.panelH + 'px';
    panel.style.maxHeight = S.panelH + 'px';
  } else {
    // Zugeklappt darf keine feste Höhe stehen bleiben, sonst bleibt der
    // leere Rest des Panels als Streifen über der Karte liegen.
    panel.style.height = '';
    panel.style.maxHeight = '';
  }
  if (S.map) S.map.invalidateSize();
  if (save2 !== false) savePanel();
}

function savePanel() {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ open: S.panelOpen, h: S.panelH }));
  } catch (e) { /* privater Modus: kein Problem */ }
}

function initGrip() {
  const grip = document.getElementById('grip');
  const panel = document.getElementById('panel');

  // Gemerkte Höhe und letzter Zustand. Das ist eine Oberflächen-Einstellung
  // wie das Thema, kein Spielstand — „Neues Spiel" fasst sie nicht an.
  try {
    const d = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
    if (d.h >= 120) S.panelH = d.h;
    if (typeof d.open === 'boolean') S.panelOpen = d.open;
  } catch (e) { /* egal */ }
  setPanelOpen(S.panelOpen, false);

  let startY = 0, startH = 0, dragging = false, moved = false;
  const down = (e) => {
    if (!isNarrow()) return;
    dragging = true; moved = false;
    startY = (e.touches ? e.touches[0] : e).clientY;
    startH = panel.getBoundingClientRect().height;
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0] : e).clientY;
    // Erst ab 6 px gilt es als Ziehen — darunter ist es ein Tipp auf den
    // Griff, und der soll auf-/zuklappen statt die Höhe um 2 px zu ändern.
    if (!moved && Math.abs(y - startY) < 6) return;
    if (!moved) {
      moved = true;
      // Aus dem zugeklappten Zustand heraus hochziehen klappt auf.
      if (!S.panelOpen) { setPanelOpen(true, false); startH = panel.getBoundingClientRect().height; }
    }
    const h = Math.max(120, Math.min(window.innerHeight * 0.85, startH - (y - startY)));
    panel.style.height = h + 'px';
    panel.style.maxHeight = h + 'px';
    S.panelH = Math.round(h);
    if (S.map) S.map.invalidateSize();
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    if (moved) savePanel();
    else setPanelOpen(!S.panelOpen);   // kurzer Tipp auf den Griff
  };
  grip.addEventListener('mousedown', down);
  grip.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
  // Tastatur: der Griff ist ein Button, Enter/Space klappen um. Die Maus-
  // Variante läuft über mouseup, sonst käme der Klick doppelt.
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    setPanelOpen(!S.panelOpen);
  });
  // Wird das Fenster breit (Desktop-Layout), muss die per Hand gesetzte
  // Pixelhöhe weg — sonst hängt die Seitenspalte auf Handyhöhe fest.
  matchMedia('(min-width:900px)').addEventListener('change', (e) => {
    if (e.matches) { panel.style.height = ''; panel.style.maxHeight = ''; }
    else setPanelOpen(S.panelOpen, false);
    if (S.map) S.map.invalidateSize();
  });
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
  // iOS-Safari ignoriert user-scalable=no; ohne das zoomt ein schneller
  // Pinch die ganze Seite statt der Karte, und man kommt nicht mehr heraus.
  // Leaflets eigener Zwei-Finger-Zoom läuft über touch-Ereignisse und bleibt.
  ['gesturestart', 'gesturechange'].forEach(t =>
    document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  S.data = window.__KOELN__;
  expandDivisions(S.data);

  // Spielgebiet: festes Rechteck aus den Daten (Bounding-Box der Stationen
  // + Puffer, siehe build-data.js). Fallback nur zur Sicherheit, falls
  // play_box in koeln.json fehlt.
  S.box = S.data.play_box || {
    minX: S.home.x - 0.15, maxX: S.home.x + 0.15,
    minY: S.home.y - 0.1, maxY: S.home.y + 0.1,
  };

  // Erst gespeicherte Einstellungen laden — Startpunkt und eigene Orte
  // bestimmen Schnellwahl bzw. POI-Listen.
  const hadSave = load();
  rebuildPois();
  buildStations(S.data);

  initTheme();
  initMap();
  initTabs();
  initGrip();

  // Neues Spiel: Verlauf, Position und Stationsmarkierungen zurück,
  // Gebietseinstellungen bleiben.
  document.getElementById('btnReset').onclick = () => {
    // Das Versteck gehört zur Runde, nicht zur Oberfläche: neue Runde,
    // neues Versteck.
    S.history = []; S.seeker = null; S.hide = null; S.thermoFrom = null;
    S.manual.clear(); S.endgame.clear(); S.force.clear();
    S.shared = null;
    cancelPicking();
    renderMarks(); recompute(); drawArea();
  };
  document.getElementById('sheet').onclick = (e) => {
    if (e.target.id === 'sheet') closeSheet();
  };
  document.getElementById('btnLive').onclick = toggleLive;
  document.getElementById('btnShare').onclick = showShareSheet;
  syncLiveButton();
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Escape bricht zuerst eine laufende Kartenauswahl ab, sonst schließt es
    // den Dialog — sonst bliebe man im Auswahlmodus hängen.
    if (!cancelPicking()) closeSheet();
  });

  if (hadSave && S.history.length) recompute();
  else { renderExclusion(); drawEdges(); renderAsk(); renderHist(); }
  renderMarks();
  if (S.seeker && S.map) S.map.setView([S.seeker[1], S.seeker[0]], 13);
  // War der Live-Standort beim letzten Mal an, wieder anschalten. Die
  // Ortungsfreigabe hat der Browser dann bereits.
  if (S.wantLive && !S.noMap) toggleLive();

  /* Kam die App über einen geteilten Link, die Position anbieten — erst nach
     dem Laden des Spielstands, damit nichts überschrieben wird, und die
     Adresse danach säubern, damit ein Reload nicht wieder fragt. */
  offerSharedFromUrl();
  /* Ist die App schon offen und man tippt im Chat den nächsten Link an, lädt
     der Browser die Seite nicht neu — er ändert nur das Fragment. Ohne diesen
     Zuhörer würde genau der zweite geteilte Standort stillschweigend
     verpuffen. */
  window.addEventListener('hashchange', offerSharedFromUrl);

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
