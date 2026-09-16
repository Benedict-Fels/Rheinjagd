#!/usr/bin/env node
/**
 * Baut aus data/koeln-boundaries-raw.json (Overpass-Export, Runde 20) die
 * Verwaltungsebenen für koeln.json — in Bogenform.
 *
 * Kern der Sache: In OSM ist eine Grenze zwischen zwei Stadtteilen **ein**
 * Weg, den sich beide teilen; die Bezirksgrenzen bestehen aus denselben Wegen.
 * Wer daraus pro Fläche einen eigenen Ring schreibt, legt jede Linie zwei- bis
 * dreimal ab — und genau diese Kopien sind in der alten Datei
 * auseinandergelaufen (bis zu 245 m, Runde 19).
 *
 * Deshalb: jeder Weg steht **einmal** in `arcs`, jede Fläche verweist nur noch
 * darauf. Negativer Index heißt „rückwärts durchlaufen" (~i = -i-1, wie in
 * TopoJSON). Damit können zwei Nachbarn gar nicht mehr verschiedene Vorstellungen
 * von ihrer gemeinsamen Grenze haben.
 */
const fs = require('fs');
const path = require('path');

const KEY = (c) => c[0].toFixed(6) + ',' + c[1].toFixed(6);

/**
 * Wegstücke zu geschlossenen Ringen zusammensetzen.
 * Overpass liefert die Mitglieder einer Relation unsortiert und in beliebiger
 * Richtung — es wird also an den Endpunkten gesucht, nicht auf die Reihenfolge
 * vertraut. Rückgabe: Ringe als Listen vorzeichenbehafteter Bogen-Indizes.
 */
function buildRings(memberIds, arcIndex, arcs) {
  const open = memberIds.slice();
  const rings = [];
  while (open.length) {
    const startId = open.shift();
    const ring = [arcIndex.get(startId)];
    let first = arcs[arcIndex.get(startId)][0];
    let last = arcs[arcIndex.get(startId)].slice(-1)[0];
    let guard = 0;
    while (KEY(first) !== KEY(last) && guard++ < 10000) {
      let found = -1, rev = false;
      for (let i = 0; i < open.length; i++) {
        const a = arcs[arcIndex.get(open[i])];
        if (KEY(a[0]) === KEY(last)) { found = i; rev = false; break; }
        if (KEY(a.slice(-1)[0]) === KEY(last)) { found = i; rev = true; break; }
      }
      if (found < 0) break;                      // offener Ring — wird unten gemeldet
      const id = open.splice(found, 1)[0];
      const idx = arcIndex.get(id);
      ring.push(rev ? ~idx : idx);
      const a = arcs[idx];
      last = rev ? a[0] : a.slice(-1)[0];
    }
    rings.push({ ring, closed: KEY(first) === KEY(last) });
  }
  return rings;
}

/** Ring aus Bogen-Indizes zu einer Koordinatenliste ausrollen. */
function expandRing(ring, arcs) {
  const out = [];
  for (const k of ring) {
    const a = k < 0 ? arcs[~k].slice().reverse() : arcs[k];
    for (let i = out.length ? 1 : 0; i < a.length; i++) out.push(a[i]);
  }
  return out;
}

function ringAreaKm2(ring) {
  const rad = (x) => x * Math.PI / 180;
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const kx = Math.cos(rad(lat0)) * 111.32, ky = 110.574;
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++)
    s += (ring[i][0] * kx) * (ring[i + 1][1] * ky) - (ring[i + 1][0] * kx) * (ring[i][1] * ky);
  return Math.abs(s) / 2;
}

function build(rawPath) {
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  // Bögen in eine feste Reihenfolge bringen, damit der Build reproduzierbar ist.
  const ids = Object.keys(raw.arcs).sort((a, b) => +a - +b);
  const arcs = ids.map((id) => raw.arcs[id]);
  const arcIndex = new Map(ids.map((id, i) => [+id, i]));

  const problems = [];
  const make = (rel) => {
    const memberIds = rel.members.map((m) => m.ref);
    const rings = buildRings(memberIds, arcIndex, arcs);
    for (const r of rings) if (!r.closed) problems.push(rel.name + ': offener Ring');
    // Größter Ring zuerst — der Rest sind Exklaven.
    const withArea = rings.map((r) => ({ ...r, km2: ringAreaKm2(expandRing(r.ring, arcs)) }));
    withArea.sort((a, b) => b.km2 - a.km2);
    return { name: rel.name, rings: withArea.map((r) => r.ring),
             km2: withArea.reduce((s, r) => s + r.km2, 0) };
  };

  const d2 = raw.relations.filter((r) => r.level === 9).map(make);
  const d3 = raw.relations.filter((r) => r.level === 10).map(make);
  const city = raw.city ? make(raw.city) : null;
  return { arcs, d2, d3, city, problems, expandRing };
}

module.exports = { build, expandRing, ringAreaKm2 };

if (require.main === module) {
  const r = build(path.join(__dirname, 'data/koeln-boundaries-raw.json'));
  console.log('Bögen:', r.arcs.length, '· Punkte:', r.arcs.reduce((s, a) => s + a.length, 0));
  console.log('Stadtbezirke:', r.d2.length, '· Stadtteile:', r.d3.length, '· Stadt:', !!r.city);
  const sum = (l) => l.reduce((s, f) => s + f.km2, 0).toFixed(1);
  console.log('Fläche d2:', sum(r.d2), 'km² · d3:', sum(r.d3), 'km² · Stadt:',
              r.city ? r.city.km2.toFixed(1) : '—', 'km²');
  const multi = [...r.d2, ...r.d3].filter((f) => f.rings.length > 1);
  console.log('Flächen mit mehr als einem Ring:', multi.length,
              multi.map((f) => f.name + '(' + f.rings.length + ')').join(', ') || '—');
  console.log('Probleme:', r.problems.length ? r.problems.join(' | ') : 'keine');
}
