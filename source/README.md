# Gym Tracker source

- `src/logic.js`: exercise catalog, default A/B program, progression engine (double progression, back-off sets, per-machine weight steps), A/B rotation. No DOM; runs in Node too.
- `src/app.js`: screens, set-by-set logging, rest timer, history editing, program editor, themes, backups. `window.GYM_MODE = "pwa"` switches on the installed-app features (offline, keep screen on, back button, install prompt, backup files); without it the page syncs through the Claude artifact database.
- `src/style.css`, `src/shell.html`: styles and page shell (CSS and JS are inlined at build time).
- `src/sw.js`, `src/manifest.webmanifest`: offline support and install manifest.

Build: `node source/build.mjs` (Node 18+). It rewrites `index.html`, `sw.js`, `manifest.webmanifest` and, if `sharp` is installed, the icons in the repo root. Commit and push; GitHub Pages serves the root. Installed apps update the next time they're opened online.

Workout data never lives in this repo: it stays on the phone (and in backup files the user keeps).
