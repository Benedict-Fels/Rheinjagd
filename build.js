#!/usr/bin/env node
/**
 * Baut aus src/ + data/koeln.json die fertige Seite.
 *   node build.js   ->  index.html   (komplette Seite, für GitHub Pages / lokal)
 *
 * Bis Runde 21 entstand hier zusätzlich eine artifact.html — dieselbe Seite
 * ohne doctype-Hülle, für einen Artifact-Publish, den es nie gab. Raus in
 * Runde 22: gehostet wird auf GitHub Pages, und das liefert index.html.
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const head = R('src/head.html').trimEnd();
const body = R('src/body.html').trimEnd();
const app = R('src/app.js');
// koeln.json liegt eingerückt auf der Platte (lesbar im Diff), wird aber
// kompakt eingebettet — sonst wäre index.html rund dreimal so groß.
const data = JSON.stringify(JSON.parse(R('data/koeln.json')));
// Favicon: icon.svg wird eingebettet (keine zusätzliche Anfrage). iOS kann
// kein SVG als Homescreen-Symbol, dafür liegt apple-touch-icon.png daneben
// (180 px, ohne runde Ecken — die setzt iOS selbst).
const favicon = 'data:image/svg+xml,' + encodeURIComponent(R('icon.svg').trim());

const payload =
  '<script>window.__KOELN__=' + data + ';</script>\n' +
  '<script>\n' + app + '</script>';

const standalone =
  '<!doctype html>\n<html lang="de">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n' +
  '<meta name="description" content="Werkzeug für Jet Lag: Hide and Seek in Köln — Seeker kreisen das Suchgebiet ein, der Verstecker rechnet sich seine Antworten aus.">\n' +
  '<meta name="theme-color" content="#0a7f96">\n' +
  '<link rel="icon" type="image/svg+xml" href="' + favicon + '">\n' +
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n' +
  head + '\n</head>\n<body>\n' +
  body + '\n\n' + payload + '\n' +
  '</body>\n</html>\n';

fs.writeFileSync(path.join(__dirname, 'index.html'), standalone);

const kb = (s) => Math.round(Buffer.byteLength(s) / 1024) + ' KB';
console.log('index.html:', kb(standalone));
