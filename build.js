#!/usr/bin/env node
/**
 * Baut aus src/ + data/koeln.json die fertige Seite.
 *   node build.js   ->  index.html    (komplette Seite, für GitHub Pages / lokal)
 *                       artifact.html (ohne doctype-Hülle, für den Artifact-Publish)
 */
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const head = R('src/head.html').trimEnd();
const body = R('src/body.html').trimEnd();
const app = R('src/app.js');
const data = R('data/koeln.json');

const payload =
  '<script>window.__KOELN__=' + data + ';</script>\n' +
  '<script>\n' + app + '</script>';

// Artifact: die Plattform ergänzt doctype/head/body selbst.
const artifact = head + '\n\n' + body + '\n\n' + payload + '\n';

// Standalone: vollständiges HTML-Dokument.
const standalone =
  '<!doctype html>\n<html lang="de">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
  '<meta name="description" content="Seeker-Werkzeug für Jet Lag: Hide and Seek in Köln — Hunter-Fragen eintragen, Suchgebiet einkreisen.">\n' +
  '<meta name="theme-color" content="#0a7f96">\n' +
  head + '\n</head>\n<body>\n' +
  body + '\n\n' + payload + '\n' +
  '</body>\n</html>\n';

fs.writeFileSync(path.join(__dirname, 'artifact.html'), artifact);
fs.writeFileSync(path.join(__dirname, 'index.html'), standalone);

const kb = (s) => Math.round(Buffer.byteLength(s) / 1024) + ' KB';
console.log('artifact.html:', kb(artifact));
console.log('index.html:   ', kb(standalone));
