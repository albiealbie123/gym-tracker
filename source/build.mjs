// Builds two versions from the same source (run: node source/build.mjs):
//   repo root            installable Android web app served by GitHub Pages (offline, data on the phone)
//   source/dist-artifact one-file page for the Claude artifact version (syncs to the Claude account; not served)
// Every build stamps sw.js with a new cache version, so installed apps pick up the update on next open.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = (p) => new URL(p, import.meta.url);
const r = (p) => fs.readFileSync(here(p), 'utf8');

function page(mode) {
  let html = r('./src/shell.html');
  const head = mode === 'pwa'
    ? '<meta name="theme-color" content="#121416">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">\n<link rel="apple-touch-icon" href="icons/apple-180.png">\n<script>window.GYM_MODE = "pwa";</script>'
    : '';
  const parts = { '<!--__HEAD__-->': head, '/*__CSS__*/': r('./src/style.css'), '/*__LOGIC__*/': r('./src/logic.js'), '/*__APP__*/': r('./src/app.js') };
  for (const [k, v] of Object.entries(parts)) {
    if (k !== '<!--__HEAD__-->' && /<\/script/i.test(v)) throw new Error('closing script tag inside ' + k);
    if (!html.includes(k)) throw new Error('missing placeholder ' + k);
    html = html.split(k).join(v);
  }
  return html;
}

fs.mkdirSync(here('./dist-artifact/'), { recursive: true });
fs.writeFileSync(here('./dist-artifact/index.html'), page('artifact'));

const out = '../';
fs.mkdirSync(here(out + 'icons/'), { recursive: true });
fs.writeFileSync(here(out + 'index.html'), page('pwa'));
fs.writeFileSync(here(out + 'manifest.webmanifest'), r('./src/manifest.webmanifest'));
fs.writeFileSync(here(out + 'sw.js'), r('./src/sw.js').replace('__BUILD__', String(Date.now())));
fs.writeFileSync(here(out + '.nojekyll'), '');
fs.writeFileSync(here(out + 'README.md'), '# Gym Tracker\n\nAn installable A/B workout tracker. Open https://albiealbie123.github.io/gym-tracker/ in Chrome on Android and choose **Install app**.\n\nWorkout data is stored only on the phone that uses the app; nothing is uploaded. This repository holds only the app code.\n');

// Icons: an amber bumper plate (any) and a full-bleed version for Android's adaptive icon mask (maskable)
let sharp = null;
try { sharp = require('sharp'); } catch (e) { try { sharp = require('/home/claude/.npm-global/lib/node_modules/sharp'); } catch (e2) { sharp = null; } }
const plate = (cx, r) => `
  <circle cx="${cx}" cy="${cx}" r="${r}" fill="#f0a93a"/>
  <circle cx="${cx}" cy="${cx}" r="${r * 0.9}" fill="none" stroke="#1a1206" stroke-opacity=".28" stroke-width="${r * 0.055}"/>
  <circle cx="${cx}" cy="${cx}" r="${r * 0.72}" fill="none" stroke="#1a1206" stroke-opacity=".16" stroke-width="${r * 0.03}"/>
  <circle cx="${cx}" cy="${cx}" r="${r * 0.3}" fill="#1a1206" fill-opacity=".82"/>
  <circle cx="${cx}" cy="${cx}" r="${r * 0.15}" fill="#121416"/>`;
const anySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#121416"/>${plate(256, 196)}</svg>`;
const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#121416"/>${plate(256, 168)}</svg>`;
const jobs = [
  [anySvg, 192, 'icon-192.png'], [anySvg, 512, 'icon-512.png'],
  [maskSvg, 192, 'maskable-192.png'], [maskSvg, 512, 'maskable-512.png'], [maskSvg, 180, 'apple-180.png']
];
if (sharp) await Promise.all(jobs.map(([svg, size, name]) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(out + 'icons/' + name, import.meta.url).pathname)));
console.log('built index.html, sw.js, manifest' + (sharp ? ', icons' : ' (icons unchanged: sharp not installed)') + ' and source/dist-artifact/index.html');
