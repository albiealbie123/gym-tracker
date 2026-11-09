/* Gym Tracker — UI, storage and sync. Depends on GymLogic (logic.js). */
(function () {
  'use strict';
  const L = window.GymLogic;
  const LS_KEY = 'gymtracker.v1';
  const PWA = window.GYM_MODE === 'pwa';   // installed-app build (GitHub Pages) vs the Claude artifact build
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtW = L.fmtW, fmtR = L.fmtReps;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // [id, name, bg, accent, ink]
  const THEMES = [
    ['auto', 'Match phone', '#121416', '#f0a93a', '#f1f2f4'],
    ['iron', 'Iron', '#121416', '#f0a93a', '#eef1f4'],
    ['red25', 'Red 25', '#140f10', '#ff5a52', '#f7eeee'],
    ['blue20', 'Blue 20', '#0b111e', '#4f8dff', '#eaf0ff'],
    ['yellow15', 'Yellow 15', '#0f0f0b', '#ffd23f', '#f8f6e8'],
    ['green10', 'Green 10', '#0c1410', '#3ddc84', '#eaf5ee'],
    ['amoled', 'Black OLED', '#000000', '#b28cff', '#f2f2f5'],
    ['ocean', 'Ocean', '#08161a', '#2fd4d0', '#e6f6f7'],
    ['plum', 'Plum', '#170f17', '#ff7eb6', '#f7ecf5'],
    ['chalk', 'Chalk', '#f1f2f4', '#2350d8', '#15181c'],
    ['steel', 'Steel', '#e7edf0', '#0d8579', '#0f1f29'],
    ['daylight', 'Daylight', '#fafafa', '#d7262d', '#111111'],
    ['lilac', 'Lilac', '#f3f1fa', '#6a4be4', '#1b1630']
  ];
  const BASES = ['kg', 'kg per arm', 'kg per side', 'kg per hand', 'kg plates', 'kg plates + 2 bands'];

  // =====================================================================
  // Store: every record is a document. Kept on this phone (localStorage)
  // and, when available, in the artifact's private database (collection "gym").
  // =====================================================================
  const store = { docs: {}, dirty: new Set(), sync: 'local', db: null, loadedRemote: false, writing: false, err: null };

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { const o = JSON.parse(raw); store.docs = o.docs || {}; (o.dirty || []).forEach((d) => store.dirty.add(d)); }
    } catch (e) { /* storage unavailable: run in memory */ }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ docs: store.docs, dirty: Array.from(store.dirty) })); } catch (e) { /* ignore */ }
  }
  function put(id, data) {
    const prev = store.docs[id];
    const doc = Object.assign({}, data, { updatedAt: Math.max(Date.now(), ((prev && prev.updatedAt) || 0) + 1) });
    store.docs[id] = doc;
    if (!PWA) store.dirty.add(id);
    saveLocal();
    if (!PWA) flushSoon();
    return doc;
  }

  const DEFAULT_SETTINGS = { theme: 'auto', restTimer: true, beep: true, keepAwake: true, lastBackupAt: null };
  function settings() { return Object.assign({}, DEFAULT_SETTINGS, store.docs.settings || {}); }
  function program() {
    const p = store.docs.program;
    if (p && p.days && p.order) return p;
    // older A/B program (or none saved): use the current default plan, keeping any machine settings you changed
    const d = L.defaultProgram();
    if (p) { d.overrides = p.overrides || {}; d.custom = p.custom || {}; }
    return d;
  }
  function sessions() { return Object.keys(store.docs).filter((k) => k.indexOf('s-') === 0).map((k) => store.docs[k]).filter((s) => s && !s.deleted && s.exercises); }
  function active() { const a = store.docs.active; return a && a.workout ? a.workout : null; }
  function saveActive(w) { put('active', { workout: w }); }
  function clearActive() { put('active', { workout: null }); }
  function saveSession(s) { s.doneSets = L.countSets(s); put('s-' + s.id, s); }
  function saveProgram(p) { const c = L.clone(p); delete c.updatedAt; put('program', c); }
  function saveSettings(patch) { const s = Object.assign(settings(), patch); delete s.updatedAt; put('settings', s); }

  // ---------- sync with the Claude account ----------
  async function connect() {
    if (PWA) { setSync('local'); return; }
    if (!window.claude || typeof window.claude.use !== 'function') { setSync('local'); return; }
    setSync('connecting');
    let db = null;
    try { db = await window.claude.use('db'); } catch (e) { db = null; }
    if (!db) { setSync('local'); return; }
    store.db = db;
    const timer = setTimeout(() => { if (!store.loadedRemote) setSync('offline'); }, 10000);
    try {
      db.collection('gym').onSnapshot((snap) => {
        let changed = false;
        snap.docs.forEach((d) => { if (d.exists && mergeRemote(d.id, d.data())) changed = true; });
        if (!snap.metadata.fromCache) {
          if (!store.loadedRemote) {
            store.loadedRemote = true;
            clearTimeout(timer);
            const remote = new Set(snap.docs.map((d) => d.id));
            Object.keys(store.docs).forEach((id) => { if (!remote.has(id)) store.dirty.add(id); });
          }
          if (!store.writing) setSync(store.dirty.size ? 'saving' : 'synced');
        }
        if (changed) { saveLocal(); onRemoteChange(); }
        flushSoon();
      }, (err) => { clearTimeout(timer); store.err = err && err.code; setSync('error'); });
    } catch (e) { clearTimeout(timer); setSync('error'); }
  }
  function mergeRemote(id, data) {
    if (!data) return false;
    const local = store.docs[id];
    const ru = data.updatedAt || 0;
    const lu = local ? (local.updatedAt || 0) : -1;
    if (ru > lu) { store.docs[id] = JSON.parse(JSON.stringify(data)); store.dirty.delete(id); return true; }
    if (lu > ru) store.dirty.add(id);
    return false;
  }
  let flushTimer = null;
  function flushSoon(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms == null ? 400 : ms); }
  async function flush() {
    if (!store.db || !store.loadedRemote || store.writing) return;
    if (!store.dirty.size) { setSync('synced'); return; }
    store.writing = true; setSync('saving');
    let failed = false;
    for (const id of Array.from(store.dirty)) {
      const data = store.docs[id];
      if (!data) { store.dirty.delete(id); continue; }
      try {
        await store.db.doc('gym/' + id).set(JSON.parse(JSON.stringify(data)));
        if (store.docs[id] === data) store.dirty.delete(id);
      } catch (e) {
        failed = true; store.err = e && e.code;
        if (e && (e.code === 'invalid_argument' || e.code === 'quota_exceeded' || e.code === 'revoked')) { store.writing = false; saveLocal(); setSync('error'); return; }
        break;
      }
    }
    store.writing = false; saveLocal();
    if (failed) { setSync('offline'); flushSoon(15000); }
    else if (store.dirty.size) flushSoon(50);
    else setSync('synced');
  }
  window.addEventListener('online', () => flushSoon(100));

  function setSync(s) { store.sync = s; renderSync(); }
  function renderSync() {
    const el = document.getElementById('sync');
    if (!el) return;
    if (PWA) {
      const b = backupStatus();
      el.dataset.s = b.s; el.setAttribute('aria-label', 'Backup status: ' + b.text);
      document.getElementById('sync-t').textContent = b.text;
      return;
    }
    const map = { local: 'On this phone', connecting: 'Connecting…', synced: 'Synced', saving: 'Saving…', offline: 'Offline · saved on phone', error: 'Not syncing' };
    el.dataset.s = store.sync;
    document.getElementById('sync-t').textContent = map[store.sync] || '';
  }
  function backupStatus() {
    const lb = settings().lastBackupAt;
    if (!sessions().length) return { s: 'local', text: 'On this phone', days: null };
    if (!lb) return { s: 'saving', text: 'No backup yet', days: null };
    const d = Math.floor((Date.now() - lb) / 86400000);
    return { s: d <= 14 ? 'synced' : 'saving', text: d === 0 ? 'Backed up today' : 'Backup ' + d + (d === 1 ? ' day' : ' days') + ' ago', days: d };
  }
  function onRemoteChange() {
    const ae = document.activeElement;
    if (ui.dlg || (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) { ui.pendingRender = true; return; }
    render();
  }
  document.addEventListener('focusout', () => {
    if (!ui.pendingRender) return;
    setTimeout(() => {
      const ae = document.activeElement;
      if (ui.pendingRender && !ui.dlg && !(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) { ui.pendingRender = false; render(); }
    }, 250);
  });

  // =====================================================================
  // UI state
  // =====================================================================
  const ui = { tab: 'today', plan: null, summaryId: null, historyId: null, exId: null, progDay: null, progDraft: null,
    rirSel: null, dlg: null, dlgCtx: null, undo: null, editRir: null, pendingRender: false, buzzedFor: null };

  // ---------- theme ----------
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    let t = settings().theme || 'auto';
    if (t === 'auto') {
      const host = document.documentElement.getAttribute('data-theme');
      const dark = host ? host === 'dark' : (mq ? mq.matches : true);
      t = dark ? 'iron' : 'chalk';
    }
    document.documentElement.setAttribute('data-skin', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); if (bg) meta.setAttribute('content', bg); }
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  try { new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* ignore */ }

  // ---------- audio cue for the rest timer (scheduled from a tap, so it is allowed to play) ----------
  let actx = null, beepNodes = [];
  function ensureAudio() {
    try {
      if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  function cancelBeep() { beepNodes.forEach((o) => { try { o.stop(); } catch (e) { /* ignore */ } }); beepNodes = []; }
  function scheduleBeep(sec) {
    cancelBeep();
    if (!settings().beep || sec <= 0) return;
    ensureAudio();
    if (!actx) return;
    try {
      const t0 = actx.currentTime + sec;
      [0, 0.28, 0.56].forEach((d, k) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = k === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.22);
        beepNodes.push(o);
      });
    } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  function info(v, prog) { return L.variantInfo(v, prog || program()); }
  function recAt(e, i) { return e.recs[i] || e.recs[e.recs.length - 1] || { w: null }; }
  function rirAt(e, i) { if (!e.rir || !e.rir.length) return null; return e.rir[Math.min(i, e.rir.length - 1)]; }
  function rirLabel(v) { return v == null ? '—' : v >= 4 ? '4+' : String(v); }
  function basisTag(b) { return b && b !== 'kg' ? '<span class="basis">' + esc(b) + '</span>' : ''; }
  function kindName(s) { return s.label || L.dayTitle(s.kind, program()); }
  function plateCls(kind) {
    if (kind === 'extra' || kind === 'legacy') return 'k-' + kind;
    return L.dayTone(kind, program()) === 'lower' ? 'k-B' : 'k-A';
  }
  function plateChar(s) {
    if (s.kind === 'A' || s.kind === 'B') return s.kind;
    const n = L.dayNumber(s.kind, program()); if (n) return String(n);
    if (s.kind === 'extra') return '+';
    if (/Workout A/.test(s.label || '')) return 'A';
    if (/Workout B/.test(s.label || '')) return 'B';
    return 'P';
  }
  function missingSets(s) { return (s.missing || []).reduce((n, m) => n + (m.sets || 0), 0); }
  function statusTag(s) {
    if (s.kind === 'extra') return '<span class="tag">Extra</span>';
    if (s.status === 'complete') return '<span class="tag good">Complete</span>';
    return '<span class="tag warn">Partly done</span>';
  }
  function findEx(w, key) { return w.exercises.findIndex((e) => e.key === key); }
  function scrollTop() { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } }
  function parseNum(v) { if (v == null) return NaN; const s = String(v).trim().replace(',', '.'); return s === '' ? NaN : Number(s); }
  function trendTag(t, e) {
    if (e && e.v !== e.planned) return '<span class="tag">Swapped</span>';
    if (t === 'up') return '<span class="tag good">↑ Heavier</span>';
    if (t === 'down') return '<span class="tag warn">↓ Lighter</span>';
    if (t === 'plan') return '<span class="tag">Planned start</span>';
    if (t === 'new') return '<span class="tag accent">New</span>';
    return '';
  }

  // =====================================================================
  // Views
  // =====================================================================
  function render() {
    applyTheme();
    const main = document.getElementById('main');
    let html;
    if (ui.tab === 'today') {
      const w = active();
      if (ui.summaryId) html = viewSummary();
      else if (w) html = viewWorkout(w);
      else if (ui.plan) html = viewPlan();
      else html = viewHome();
    } else if (ui.tab === 'history') html = ui.historyId ? viewSession() : viewHistory();
    else if (ui.tab === 'exercises') html = ui.progDay ? viewProgramEditor() : ui.exId ? viewExercise() : viewExercises();
    else html = viewSettings();
    main.innerHTML = html;
    document.querySelectorAll('.nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
    const navToday = document.getElementById('nav-today-t');
    if (navToday) navToday.textContent = active() ? 'Workout' : 'Today';
    renderSync();
    tickRest();
    if (PWA) { manageWakeLock(); syncHistory(); }
  }

  // ---------- installed-app extras: keep screen on, back button, install, storage ----------
  let wakeLock = null, wakeBusy = false;
  async function manageWakeLock() {
    if (wakeBusy) return;
    const want = settings().keepAwake && !!active() && document.visibilityState === 'visible';
    wakeBusy = true;
    try {
      if (want && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!want && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
    } catch (e) { wakeLock = null; }
    wakeBusy = false;
  }
  // Android back button: one extra history entry whenever you're not on the main screen.
  let ignorePop = false;
  function isDeep() { return !!(ui.dlg || ui.plan || ui.historyId || ui.exId || ui.progDay || ui.summaryId || ui.tab !== 'today'); }
  function syncHistory() {
    if (ignorePop) return;   // a back step is already on its way
    try {
      const st = history.state && history.state.gymDeep;
      if (isDeep() && !st) history.pushState({ gymDeep: true }, '');
      else if (!isDeep() && st) { ignorePop = true; history.back(); }
    } catch (e) { /* ignore */ }
  }
  function goBack() {
    if (ui.dlg) { closeDialog(); return; }
    if (ui.tab === 'today') {
      if (ui.summaryId) { ui.summaryId = null; }
      else if (ui.plan && !active()) { ui.plan = null; }
    } else if (ui.tab === 'history' && ui.historyId) { ui.historyId = null; }
    else if (ui.tab === 'exercises' && ui.progDay) { A['prog-back'](); return; }
    else if (ui.tab === 'exercises' && ui.exId) { ui.exId = null; }
    else { ui.tab = 'today'; }
    render(); scrollTop();
  }
  if (PWA) window.addEventListener('popstate', () => { if (ignorePop) { ignorePop = false; syncHistory(); return; } goBack(); });

  let installEvt = null;
  const isStandalone = () => !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  if (PWA) {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!active() && !ui.dlg) render(); });
    window.addEventListener('appinstalled', () => { installEvt = null; toast('Installed. Open Gym Tracker from your home screen or app drawer.'); if (!active()) render(); });
  }
  function installCard() {
    if (!PWA || isStandalone()) return '';
    return '<article class="card" style="display:grid;gap:10px;border-color:var(--accent)"><p class="h3">Install Gym Tracker on your phone</p>' +
      '<p class="small muted">It gets its own icon, opens full screen like any app, and works offline at the gym.</p>' +
      '<button class="btn block" data-act="install">' + (installEvt ? 'Install app' : 'How to install') + '</button></article>';
  }
  async function persistStorage() {
    try { if (navigator.storage && navigator.storage.persist) ui.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (e) { /* ignore */ }
  }
  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  function markBackup() { saveSettings({ lastBackupAt: Date.now() }); renderSync(); }
  const backupName = () => 'gym-tracker-backup-' + L.isoDate() + '.json';

  // ---------- Home ----------
  function viewWeek(prog, ss, today) {
    const sched = prog.schedule;
    if (!sched || sched.length !== 7) return '';
    const t = L.parseISO(today);
    const monday = new Date(t); monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((nm, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const iso = L.isoDate(d); const k = sched[d.getDay()];
      const trained = ss.some((x) => x.date === iso);
      const cls = (iso === today ? ' today' : '') + (k ? '' : ' off') + (trained ? ' done' : '');
      const label = nm + ': ' + (k ? L.dayTitle(k, prog) : 'rest') + (trained ? ', trained' : '');
      return '<div class="wd' + cls + '" aria-label="' + esc(label) + '"><span>' + nm + '</span><b>' + (k ? L.dayNumber(k, prog) : '–') + '</b><i>' + (trained ? '✓' : '') + '</i></div>';
    }).join('');
    return '<section><p class="eyebrow" style="margin-bottom:6px">Your week</p><div class="week">' + cells + '</div></section>';
  }

  function viewHome() {
    const ss = sessions(); const prog = program(); const today = L.isoDate();
    const order = L.dayOrder(prog);
    const last = L.lastRegular(ss, prog); const next = L.suggestNext(ss, prog);
    const sched = prog.schedule || [];
    const restToday = sched.length === 7 && !sched[L.parseISO(today).getDay()];
    const doneToday = ss.some((x) => x.date === today && x.kind !== 'extra');
    let lastHtml;
    if (last) {
      const miss = missingSets(last);
      lastHtml = '<article class="card last"><span class="plate lg ' + plateCls(last.kind) + '">' + plateChar(last) + '</span><div class="grow">' +
        '<p class="eyebrow">Last workout</p><p class="big">' + esc(kindName(last)) + ' · ' + L.fmtDate(last.date) + '</p>' +
        '<p class="muted">' + cap(L.relDay(last.date, today)) + ' · ' + L.countSets(last) + ' sets' + (miss ? ' · ' + miss + ' planned sets not done' : '') + '</p></div></article>';
    } else if ((store.sync === 'connecting' || (store.db && !store.loadedRemote)) && !ss.length) {
      lastHtml = '<article class="card"><p class="h3">Loading your workouts…</p><p class="muted small">Getting your history from your Claude account.</p></article>';
    } else if (PWA) {
      lastHtml = '<article class="card" style="display:grid;gap:10px"><p class="h3">Bring your workout history</p>' +
        '<p class="small muted">Open your history file (gym-tracker-history.json) or any backup. Your last workout and all the suggested weights come from it. Or just pick a day below to start fresh.</p>' +
        '<label class="btn primary block" for="imp-file-home">Choose history file</label><input id="imp-file-home" type="file" accept=".json,.txt,application/json,text/plain" hidden></article>';
    } else {
      lastHtml = '<article class="card"><p class="h3">No workouts yet</p><p class="muted small">Pick a day below to start your first one.</p></article>';
    }
    const extras = ss.filter((x) => x.kind === 'extra' && last && x.date >= last.date && (x.finishedAt || 0) > (last.finishedAt || 0));
    const extraNote = extras.length ? '<p class="note">Extra session on ' + L.fmtDate(extras[extras.length - 1].date) + '. Extra sessions don\'t change which day is next.</p>' : '';

    const meta = (k) => {
      const day = prog.days[k] || [];
      const sets = day.reduce((n, e) => n + e.sets, 0);
      const mins = L.estimateMinutes(L.buildWorkout(k, prog, ss, today));
      return { day, sets, mins };
    };
    const big = (k) => {
      const m = meta(k); const inf = (prog.dayInfo || {})[k] || {};
      return '<button class="choice is-next" data-act="choose" data-kind="' + k + '">' +
        '<span class="plate lg ' + plateCls(k) + '">' + L.dayNumber(k, prog) + '</span><span class="choice-body">' +
        '<span class="choice-title">' + esc(L.dayTitle(k, prog, true)) + ' <span class="tag accent">Up next</span></span>' +
        '<span class="choice-meta">' + esc(inf.name || '') + (inf.focus ? ' · ' + esc(inf.focus) : '') + '</span>' +
        '<span class="choice-meta muted" style="font-weight:400">' + m.day.length + ' exercises · ' + m.sets + ' sets · about ' + m.mins + ' min</span>' +
        '<span class="choice-list">' + m.day.map((e) => esc(info(e.v, prog).name)).join(' · ') + '</span></span></button>';
    };
    const small = (k) => {
      const m = meta(k); const inf = (prog.dayInfo || {})[k] || {};
      return '<button class="item" data-act="choose" data-kind="' + k + '"><span class="plate sm ' + plateCls(k) + '">' + L.dayNumber(k, prog) + '</span>' +
        '<div class="grow"><div class="t">' + esc(L.dayTitle(k, prog)) + '</div><div class="s">' + esc(inf.focus || '') + ' · ' + m.sets + ' sets · ~' + m.mins + ' min</div></div><span class="chev" aria-hidden="true">›</span></button>';
    };
    const ni = order.indexOf(next);
    const others = order.slice(ni + 1).concat(order.slice(0, ni));

    const since7 = L.isoDate(new Date(Date.now() - 6 * 86400000));
    const recent = ss.filter((x) => x.date >= since7);
    const daysSince = last ? L.daysBetween(last.date, today) : null;
    let h1, sub = '';
    if (!last) h1 = 'Let\'s train';
    else if (doneToday) { h1 = 'Done for today'; sub = 'Next up: ' + L.dayTitle(next, prog) + '.'; }
    else if (restToday) { h1 = 'Rest day'; sub = 'Today is a planned rest day: recovery is when muscle grows. Next up: ' + L.dayTitle(next, prog) + '.'; }
    else h1 = L.dayTitle(next, prog, true) + ' is up';

    return '<section class="screen home">' +
      '<div><p class="eyebrow">' + L.fmtDate(today, true) + '</p><h1 class="h-display">' + h1 + '</h1>' + (sub ? '<p class="muted" style="margin-top:6px">' + esc(sub) + '</p>' : '') + '</div>' +
      viewWeek(prog, ss, today) +
      lastHtml + extraNote + installCard() +
      '<h2 class="section-title">Choose today\'s workout</h2>' +
      '<div class="choices">' + big(next) + '</div>' +
      '<div class="list">' + others.map(small).join('') + '</div>' +
      '<button class="linkish" data-act="choose" data-kind="extra">+ Extra session (doesn\'t change which day is next)</button>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + recent.length + '</b><span>sessions, last 7 days</span></div>' +
      '<div class="stat"><b>' + recent.reduce((n, x) => n + L.countSets(x), 0) + '</b><span>sets, last 7 days</span></div>' +
      '<div class="stat"><b>' + (daysSince == null ? '—' : daysSince) + '</b><span>days since last workout</span></div>' +
      '</div></section>';
  }

  // ---------- Plan (today's workout before starting) ----------
  function viewPlan() {
    const w = ui.plan; const prog = program();
    const title = L.dayTitle(w.kind, prog);
    const items = w.exercises.map((e, i) => {
      const inf = info(e.v, prog);
      const skipped = e.status === 'skipped';
      const sets = e.recs.slice(0, e.sets).map((r, j) =>
        '<div class="pset"><span class="small muted">Set ' + (j + 1) + '</span><span class="w">' + (r.w == null ? '?' : fmtW(r.w)) + '<small>kg</small></span>' +
        '<span class="small muted">' + e.lo + '–' + e.hi + ' reps · RIR ' + rirLabel(rirAt(e, j)) + '</span>' +
        (r.why ? '<span class="note">' + esc(r.why) + '</span>' : '') + '</div>').join('');
      return '<li class="pe' + (skipped ? ' skipped' : '') + '">' +
        '<div class="pe-top"><span class="pe-num">' + (i + 1) + '</span><div class="grow"><div class="pe-name">' + esc(inf.name) + basisTag(inf.basis) + '</div>' +
        '<div class="small muted">' + e.sets + ' × ' + e.lo + '–' + e.hi + (skipped ? ' · skipped today' : '') + '</div></div>' + trendTag(e.trend, e) + '</div>' +
        '<div class="pe-sets">' + sets + '</div>' +
        (skipped ? '' : '<p class="why">' + esc(e.summary) + '</p>') +
        '<div class="pe-actions">' +
        '<button class="chip-btn" data-act="plan-move" data-k="' + e.key + '" data-d="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑ Up</button>' +
        '<button class="chip-btn" data-act="plan-move" data-k="' + e.key + '" data-d="1" aria-label="Move down"' + (i === w.exercises.length - 1 ? ' disabled' : '') + '>↓ Down</button>' +
        '<button class="chip-btn" data-act="plan-swap" data-k="' + e.key + '">Swap machine</button>' +
        '<button class="chip-btn" data-act="plan-skip" data-k="' + e.key + '">' + (skipped ? 'Restore' : 'Skip today') + '</button>' +
        '</div></li>';
    }).join('');
    const pending = L.nextPendingIndex(w, 0) >= 0;
    return '<section class="screen plan">' +
      '<button class="back" data-act="plan-back">‹ Back</button>' +
      '<header class="plan-head"><span class="plate lg ' + plateCls(w.kind) + '">' + L.dayMark(w.kind, prog) + '</span><div class="grow">' +
      '<h1 class="h-display">' + title + '</h1><p class="muted">Today · ' + L.fmtDate(w.date) + ' · ' + w.exercises.length + ' exercises · ' + L.plannedCount(w) + ' sets' + (w.exercises.length ? ' · about ' + L.estimateMinutes(w) + ' min' : '') + '</p></div></header>' +
      (w.kind === 'extra' ? '<p class="note">Extra sessions are logged like any other, but they don\'t change which day is next.</p>'
        : '<p class="muted small">Weights come from your last sessions on the same machine. You can reorder, swap or skip now, or change things as you go.</p>') +
      (items ? '<ol class="plan-list">' + items + '</ol>' : '') +
      '<button class="btn block" data-act="plan-add">+ Add exercise</button>' +
      '<div class="sticky-cta"><button class="btn primary xl" data-act="start"' + (pending ? '' : ' disabled') + '>Start ' + esc(L.dayTitle(w.kind, prog, true)) + '</button></div>' +
      '</section>';
  }

  // ---------- Workout (one set at a time) ----------
  function viewWorkout(w) {
    let cur = w.exercises[w.cur];
    if (!cur || L.isExDone(cur)) {
      const nx = L.nextPendingIndex(w, w.cur || 0);
      if (nx >= 0) { w.cur = nx; cur = w.exercises[nx]; } else cur = null;
    }
    const planned = L.plannedCount(w), done = L.doneCount(w);
    const pct = planned ? Math.min(100, Math.round((done / planned) * 100)) : 0;
    const title = L.dayTitle(w.kind, program());
    const top = '<div><div class="wk-progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + planned + '" aria-valuenow="' + done + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="wk-meta"><span>' + title + ' · ' + L.fmtDate(w.date) + '</span><span>' + done + ' of ' + planned + ' sets</span></div></div>';
    const rest = '<div id="rest" class="rest" hidden><div class="rest-t"><span id="rest-time">0:00</span><small id="rest-lbl">Rest</small></div>' +
      '<button class="chip-btn" data-act="rest-add">+30 s</button><button class="chip-btn" data-act="rest-skip">Skip</button><span class="rest-bar" id="rest-bar"></span></div>';
    const card = cur ? setCard(w, cur) : allDoneCard(w, planned, done);
    const loggedHtml = cur && cur.logged.length ? loggedBlock(cur) : '';
    const queue = w.exercises.map((e) => queueItem(e, w, cur)).join('');
    const allDone = !cur;
    return '<section class="screen workout">' + top + rest + card + loggedHtml +
      '<section class="ex-block"><div class="ex-block-h"><h3 class="h3">Today\'s plan</h3><button class="linkish" data-act="add-ex">+ Add exercise</button></div>' +
      '<div class="queue">' + queue + '</div></section>' +
      (allDone ? '' : '<button class="btn block" data-act="finish">Finish workout</button>') +
      '<button class="linkish" data-act="discard" style="color:var(--danger)">Discard this workout</button>' +
      '</section>';
  }

  function setCard(w, e) {
    const inf = info(e.v);
    const i = e.logged.length;
    const rec = recAt(e, i);
    const trir = rirAt(e, i);
    const idx = w.exercises.indexOf(e);
    const dots = Array.from({ length: e.sets }, (_, j) => '<i class="' + (j < i ? 'done' : j === i ? 'cur' : '') + '"></i>').join('');
    const lastSet = e.lastSets && e.lastSets[i];
    const inc = Number(inf.inc) || 2.5;
    const coach = [];
    if (rec.aim) coach.push('<p class="aim">Aim for ' + rec.aim + '+ reps' + (lastSet ? ' (beat ' + fmtR(lastSet.r) + ')' : '') + '</p>');
    else if (rec.w == null) coach.push('<p class="aim">Pick a weight you can lift for ' + e.lo + '–' + e.hi + ' clean reps</p>');
    if (rec.why) coach.push('<p class="why-now">' + esc(rec.why) + '</p>');
    else if (i === 0 && e.summary) coach.push('<p class="why-now">' + esc(e.summary) + '</p>');
    if (lastSet) coach.push('<p class="lastline">Last time (' + L.fmtDate(e.lastDate) + '), set ' + (i + 1) + ': ' + fmtR(lastSet.r) + ' × ' + fmtW(lastSet.w) + ' kg</p>');
    else if (e.lastTxt) coach.push('<p class="lastline">Last time (' + L.fmtDate(e.lastDate) + '): ' + esc(e.lastTxt) + ' kg</p>');
    const chips = []; for (let r = Math.max(1, e.lo - 1); r <= e.hi + 1; r++) chips.push('<button type="button" data-act="rep-chip" data-r="' + r + '" aria-pressed="false">' + r + '</button>');
    const rirChips = [0, 1, 2, 3, 4].map((v) => '<button type="button" data-act="rir" data-v="' + v + '" aria-pressed="' + (ui.rirSel === v) + '">' + rirLabel(v) + '</button>').join('');
    return '<article class="setcard" id="setcard">' +
      '<div class="ex-kicker"><span>Exercise ' + (idx + 1) + ' of ' + w.exercises.length + '</span><span>' + esc(inf.muscle || '') + '</span></div>' +
      '<div><h2 class="ex-name">' + esc(inf.name) + '</h2>' + (inf.setup ? '<p class="ex-setup">' + esc(inf.setup) + '</p>' : '') + '</div>' +
      '<div class="setline"><span class="set-label">Set ' + (i + 1) + ' of ' + e.sets + '</span><span class="dots" aria-hidden="true">' + dots + '</span></div>' +
      '<div class="target">' +
      (rec.w == null ? '<div class="big-w unknown">Your pick</div>' : '<div class="big-w">' + fmtW(rec.w) + '<small>kg</small></div>') +
      '<div class="target-side"><div class="target-reps">' + e.lo + '–' + e.hi + '<small>reps</small></div><div class="target-rir">RIR ' + rirLabel(trir) + '<small>in the tank</small></div></div>' +
      (inf.basis && inf.basis !== 'kg' ? '<div class="basis-line">' + esc(inf.basis) + '</div>' : '') +
      '</div>' +
      '<div class="coach">' + coach.join('') + '</div>' +
      '<form id="logform" autocomplete="off" novalidate>' +
      '<div class="field"><label for="reps">Reps you did</label>' +
      '<div class="stepper"><button type="button" data-act="reps-step" data-d="-1" aria-label="One rep fewer">−</button>' +
      '<input id="reps" name="reps" inputmode="decimal" enterkeyhint="done" placeholder="' + (rec.aim || e.lo) + '" aria-describedby="reps-err">' +
      '<button type="button" data-act="reps-step" data-d="1" aria-label="One rep more">+</button></div>' +
      '<div class="chips fit" style="--n:' + chips.length + '" role="group" aria-label="Quick reps">' + chips.join('') + '</div>' +
      '<p class="err-msg" id="reps-err" hidden></p></div>' +
      '<div class="field"><label for="wt">Weight used <span class="lbl-sub">' + (rec.w == null ? '(kg, needed for a new exercise)' : '· leave empty if you did ' + fmtW(rec.w) + ' kg') + '</span></label>' +
      '<div class="stepper"><button type="button" class="w-step" data-act="w-step" data-d="-1" aria-label="Lighter by ' + fmtW(inc) + ' kg">−' + fmtW(inc) + '</button>' +
      '<input id="wt" name="wt" inputmode="decimal" enterkeyhint="done" placeholder="' + (rec.w == null ? 'kg' : fmtW(rec.w)) + '" aria-describedby="wt-err">' +
      '<button type="button" class="w-step" data-act="w-step" data-d="1" aria-label="Heavier by ' + fmtW(inc) + ' kg">+' + fmtW(inc) + '</button></div>' +
      '<p class="err-msg" id="wt-err" hidden></p></div>' +
      '<div class="field"><span class="lbl">Reps left in the tank <span class="lbl-sub">· optional, target ' + rirLabel(trir) + '</span></span>' +
      '<div class="chips fit" style="--n:5" role="group" aria-label="Reps in reserve">' + rirChips + '</div></div>' +
      '<button type="submit" class="btn primary xl" id="logbtn">Log set ' + (i + 1) + '</button>' +
      '</form>' +
      '<div class="ex-actions">' +
      '<button type="button" data-act="defer">Busy: do later</button>' +
      '<button type="button" data-act="swap">Swap machine</button>' +
      '<button type="button" data-act="skip-ex">' + (i > 0 ? 'End exercise' : 'Skip exercise') + '</button>' +
      '</div></article>';
  }

  function allDoneCard(w, planned, done) {
    return '<article class="setcard alldone"><span class="plate lg ' + plateCls(w.kind) + '">✓</span>' +
      '<h2 class="h2">All sets done</h2><p class="muted">' + done + ' of ' + planned + ' planned sets logged. Tap Finish to save this workout.</p>' +
      '<button class="btn primary xl" data-act="finish">Finish workout</button></article>';
  }

  function loggedBlock(e) {
    return '<section class="ex-block"><div class="ex-block-h"><h3 class="h3">' + esc(info(e.v).name) + ' so far</h3><span class="muted small">Tap a set to fix it</span></div><div class="logged">' +
      e.logged.map((s, j) => '<button class="lset' + (s.orig ? ' edited' : '') + '" data-act="edit-set" data-k="' + e.key + '" data-j="' + j + '"><span class="n">Set ' + (j + 1) + '</span>' +
        '<span class="v">' + fmtR(s.r) + ' × ' + fmtW(s.w) + ' kg</span><span class="x">' + (s.rir != null ? 'RIR ' + rirLabel(s.rir) : 'Edit') + '</span></button>').join('') +
      '</div></section>';
  }

  function queueItem(e, w, cur) {
    const inf = info(e.v);
    const idx = w.exercises.indexOf(e);
    const isCur = cur && e.key === cur.key;
    const done = L.isExDone(e) && e.status !== 'skipped';
    const skipped = e.status === 'skipped';
    let sub, btn = '';
    if (skipped) { sub = 'Skipped'; btn = '<button class="chip-btn" data-act="unskip" data-k="' + e.key + '">Restore</button>'; }
    else if (done) { sub = e.logged.length ? L.lastString(e.logged) + ' kg' + (e.logged.length < e.sets ? ' · ended early' : '') : 'Done'; btn = '<button class="chip-btn" data-act="add-set" data-k="' + e.key + '" aria-label="Add another set">+ Set</button>'; }
    else {
      const left = e.sets - e.logged.length;
      const loads = e.recs.slice(e.logged.length, e.sets).map((r) => (r.w == null ? '?' : fmtW(r.w)));
      sub = (e.logged.length ? e.logged.length + ' done, ' + left + ' to go · ' : e.sets + ' × ' + e.lo + '–' + e.hi + ' · ') + loads.join(' / ') + ' kg' + (e.deferred ? ' · moved (busy)' : '');
      if (!isCur) btn = '<button class="chip-btn" data-act="do-now" data-k="' + e.key + '">Do now</button>';
      else btn = '<span class="tag accent">Now</span>';
    }
    return '<div class="q' + (isCur ? ' cur' : '') + (done ? ' done' : '') + (skipped ? ' skipped' : '') + '">' +
      '<span class="qn">' + (done ? '✓' : idx + 1) + '</span><div class="grow"><div class="qt">' + esc(inf.name) + '</div><div class="qs">' + esc(sub) + '</div></div>' + btn + '</div>';
  }

  // ---------- Summary after finishing ----------
  function viewSummary() {
    const s = store.docs['s-' + ui.summaryId];
    if (!s) { ui.summaryId = null; return viewHome(); }
    const prog = program(); const ss = sessions();
    const mins = s.finishedAt && s.startedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
    const rows = s.exercises.map((e) => {
      const inf = info(e.v, prog);
      const sets = L.loggedSets(e);
      const tag = e.status === 'skipped' ? '<span class="tag">Skipped</span>' : e.status === 'not done' ? '<span class="tag warn">Not done</span>' : e.status === 'partial' ? '<span class="tag warn">' + sets.length + ' of ' + e.plan.sets + '</span>' : '';
      return '<div class="item" style="min-height:56px"><div class="grow"><div class="t">' + esc(inf.name) + '</div><div class="s">' + (sets.length ? esc(L.lastString(sets)) + ' kg' : '—') + '</div></div>' + tag + '</div>';
    }).join('');
    const ups = [];
    s.exercises.forEach((e) => {
      if (!L.loggedSets(e).length || !e.plan) return;
      const r = L.recommend(e.v, e.plan, ss, prog);
      if (r.trend === 'up') ups.push('<li><b>' + esc(info(e.v, prog).name) + '</b>: ' + r.loads.map(fmtW).join(' / ') + ' kg next time</li>');
    });
    const miss = (s.missing || []).map((m) => '<li>' + m.sets + ' × ' + esc(info(m.v, prog).name) + ' (' + esc(m.why) + ')</li>').join('');
    return '<section class="screen">' +
      '<header class="plan-head"><span class="plate lg ' + plateCls(s.kind) + '">' + plateChar(s) + '</span><div class="grow"><p class="eyebrow">Saved</p><h1 class="h-display">' + esc(kindName(s)) + ' done</h1>' +
      '<p class="muted">' + L.fmtDate(s.date, true) + (mins != null ? ' · ' + mins + ' min' : '') + '</p></div></header>' +
      '<div class="stats"><div class="stat"><b>' + L.countSets(s) + '</b><span>sets logged</span></div><div class="stat"><b>' + (s.plannedSets || '—') + '</b><span>sets planned</span></div><div class="stat"><b>' + s.exercises.filter((e) => L.loggedSets(e).length).length + '</b><span>exercises</span></div></div>' +
      (ups.length ? '<section class="card"><h2 class="h3">Going up next time</h2><ul class="small" style="margin:8px 0 0;padding-left:20px">' + ups.join('') + '</ul></section>' : '') +
      (miss ? '<section class="card"><h2 class="h3">Not done today</h2><p class="small muted">Saved as not done. Nothing is carried over automatically.</p><ul class="small" style="margin:8px 0 0;padding-left:20px">' + miss + '</ul></section>' : '') +
      '<div class="list">' + rows + '</div>' +
      '<button class="btn primary xl" data-act="summary-done">Done</button></section>';
  }

  // ---------- History ----------
  function viewHistory() {
    const ss = L.liveSessions(sessions()).reverse();
    if (!ss.length) return '<section class="screen"><h1 class="h-display">History</h1><p class="muted">No workouts saved yet.</p></section>';
    const total = ss.reduce((n, s) => n + L.countSets(s), 0);
    let lastMonth = '';
    const items = ss.map((s) => {
      const d = L.parseISO(s.date);
      const m = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
      const head = m !== lastMonth ? '<p class="month">' + m + '</p>' : '';
      lastMonth = m;
      return head + '<button class="item" data-act="open-session" data-id="' + esc(s.id) + '"><span class="plate sm ' + plateCls(s.kind) + '">' + plateChar(s) + '</span>' +
        '<div class="grow"><div class="t">' + esc(kindName(s)) + '</div><div class="s">' + L.fmtDate(s.date) + ' · ' + L.countSets(s) + ' sets' + (s.imported ? ' · imported' : '') + '</div></div>' + statusTag(s) + '<span class="chev" aria-hidden="true">›</span></button>';
    }).join('');
    return '<section class="screen"><div><h1 class="h-display">History</h1><p class="muted">' + ss.length + ' sessions · ' + total + ' sets since ' + L.fmtDate(ss[ss.length - 1].date) + '</p></div>' +
      '<div class="list">' + items + '</div></section>';
  }

  function viewSession() {
    const s = store.docs['s-' + ui.historyId];
    if (!s || s.deleted) { ui.historyId = null; return viewHistory(); }
    const prog = program();
    const mins = s.finishedAt && s.startedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
    const notes = (s.notes || []).map((n) => '<p class="note">' + esc(n) + '</p>').join('');
    const miss = (s.missing || []).map((m) => '<li>' + m.sets + ' × ' + esc(info(m.v, prog).name) + ' (' + esc(m.why) + ')</li>').join('');
    const omitted = (s.omitted || []).map((m) => '<li>' + m.sets + ' × ' + esc(info(m.v, prog).name) + ' (' + esc(m.why) + ')</li>').join('');
    const ex = s.exercises.map((e, k) => {
      const inf = info(e.v, prog);
      const sets = (e.sets || []).map((x, j) => x.r == null ? '' :
        '<button class="lset' + (x.orig ? ' edited' : '') + '" data-act="hedit-set" data-k="' + k + '" data-j="' + j + '"><span class="n">Set ' + (j + 1) + '</span><span class="v">' + fmtR(x.r) + ' × ' + fmtW(x.w) + ' kg</span>' +
        '<span class="x">' + (x.rir != null ? 'RIR ' + rirLabel(x.rir) : x.trir != null ? 'target RIR ' + x.trir : '') + '</span></button>').join('');
      const tag = e.status === 'skipped' ? '<span class="tag">Skipped</span>' : e.status === 'not done' ? '<span class="tag warn">Not done</span>' : e.status === 'partial' ? '<span class="tag warn">Fewer sets</span>' : '';
      return '<div class="ex-block card"><div class="ex-block-h"><div class="h3">' + esc(inf.name) + basisTag(inf.basis) + '</div>' + tag + '</div>' +
        (e.swappedFrom ? '<p class="small muted">Swapped from ' + esc(info(e.swappedFrom, prog).name) + '</p>' : '') +
        (e.loggedAs ? '<p class="small muted">Logged as: ' + esc(e.loggedAs) + '</p>' : '') +
        (e.note ? '<p class="small muted">' + esc(e.note) + '</p>' : '') +
        '<div class="logged">' + (sets || '<p class="small muted">No sets logged.</p>') + '</div></div>';
    }).join('');
    return '<section class="screen">' +
      '<button class="back" data-act="session-back">‹ History</button>' +
      '<header class="plan-head"><span class="plate lg ' + plateCls(s.kind) + '">' + plateChar(s) + '</span><div class="grow"><h1 class="h2">' + esc(kindName(s)) + '</h1>' +
      '<p class="muted">' + L.fmtDate(s.date, true) + ' · ' + L.countSets(s) + (s.plannedSets ? ' of ' + s.plannedSets : '') + ' sets' + (mins != null ? ' · ' + mins + ' min' : '') + '</p></div>' + statusTag(s) + '</header>' +
      (s.imported ? '<p class="small muted">Imported from your ChatGPT handover. Actual RIR was never reported for these sets, so it stays empty.</p>' : '') +
      notes +
      (miss ? '<section class="card"><h2 class="h3">Not done</h2><ul class="small" style="margin:6px 0 0;padding-left:20px">' + miss + '</ul></section>' : '') +
      (omitted ? '<section class="card"><h2 class="h3">Moved to another day</h2><ul class="small" style="margin:6px 0 0;padding-left:20px">' + omitted + '</ul></section>' : '') +
      ex +
      '<p class="small muted">Tap any set to correct it. Corrections change that set; they never add a new one.</p>' +
      '<button class="btn danger block" data-act="delete-session">Delete this workout</button></section>';
  }

  // ---------- Exercises & program ----------
  function viewExercises() {
    const prog = program(); const ss = sessions();
    const dayBlock = (d) => {
      const rows = (prog.days[d] || []).map((p) => {
        const inf = info(p.v, prog);
        const r = L.recommend(p.v, p, ss, prog);
        const loads = r.loads.map((w) => (w == null ? '?' : fmtW(w))).join(' / ');
        return '<button class="item" data-act="open-ex" data-v="' + esc(p.v) + '"><div class="grow"><div class="t">' + esc(inf.name) + basisTag(inf.basis) + '</div>' +
          '<div class="s">' + p.sets + ' × ' + p.lo + '–' + p.hi + ' · next ' + loads + ' kg</div></div>' + trendTag(r.trend) + '<span class="chev" aria-hidden="true">›</span></button>';
      }).join('');
      const sets = (prog.days[d] || []).reduce((n, e) => n + e.sets, 0);
      return '<div class="ex-block-h"><h2 class="section-title">' + esc(L.dayTitle(d, prog)) + ' · ' + sets + ' sets</h2><button class="linkish" data-act="edit-day" data-kind="' + d + '">Edit</button></div><div class="list">' + rows + '</div>';
    };
    const order = L.dayOrder(prog);
    const inProg = new Set([].concat.apply([], order.map((d) => prog.days[d] || [])).map((p) => p.v));
    const others = L.allVariantIds(prog).filter((v) => !inProg.has(v)).map((v) => {
      const inf = info(v, prog); const ex = L.exposures(ss, v); const last = ex[ex.length - 1];
      return { v, inf, last };
    }).sort((a, b) => (b.last ? 1 : 0) - (a.last ? 1 : 0) || a.inf.name.localeCompare(b.inf.name));
    const otherRows = others.map((o) => '<button class="item" data-act="open-ex" data-v="' + esc(o.v) + '"><div class="grow"><div class="t">' + esc(o.inf.name) + basisTag(o.inf.basis) + '</div>' +
      '<div class="s">' + (o.last ? 'Last: ' + esc(L.lastString(o.last.sets)) + ' kg · ' + L.fmtDate(o.last.date) : 'No sets logged yet') + (o.inf.legacy ? ' · older split' : '') + '</div></div><span class="chev" aria-hidden="true">›</span></button>').join('');
    return '<section class="screen"><div><h1 class="h-display">Exercises</h1><p class="muted">Your ' + order.length + '-day plan with next weights. Tap an exercise for its history and settings.</p></div>' +
      order.map(dayBlock).join('') +
      '<h2 class="section-title">Alternatives &amp; others</h2><div class="list">' + otherRows + '</div></section>';
  }

  function spark(exps) {
    if (exps.length < 2) return '';
    const pts = exps.map((x) => ({ d: x.date, w: Math.max.apply(null, x.sets.map((s) => s.w || 0)) }));
    const W = 320, H = 96, px = 10, py = 18;
    const ws = pts.map((p) => p.w); const mn = Math.min.apply(null, ws), mx = Math.max.apply(null, ws);
    const X = (i) => px + (i * (W - 2 * px)) / (pts.length - 1);
    const Y = (w) => (mx === mn ? H / 2 : H - py - ((w - mn) / (mx - mn)) * (H - 2 * py));
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.w).toFixed(1)).join('');
    const area = line + 'L' + X(pts.length - 1).toFixed(1) + ',' + (H - 4) + 'L' + X(0).toFixed(1) + ',' + (H - 4) + 'Z';
    const lastI = pts.length - 1;
    const iMax = ws.indexOf(mx);
    let labels = '<text x="' + X(lastI) + '" y="' + (Y(pts[lastI].w) - 9) + '" text-anchor="end">' + fmtW(pts[lastI].w) + ' kg</text>';
    if (iMax !== lastI && mx !== pts[lastI].w) labels += '<text x="' + X(iMax) + '" y="' + (Y(mx) - 9) + '" text-anchor="middle">' + fmtW(mx) + '</text>';
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + (H + 18) + '" role="img" aria-label="Heaviest set per session">' +
      '<line class="gd" x1="0" x2="' + W + '" y1="' + (H - 4) + '" y2="' + (H - 4) + '"/>' +
      '<path class="ar" d="' + area + '"/><path class="ln" d="' + line + '"/>' +
      pts.map((p, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.w).toFixed(1) + '" r="' + (i === lastI ? 4.5 : 3) + '"/>').join('') + labels +
      '<text x="' + px + '" y="' + (H + 14) + '">' + L.fmtDate(pts[0].d) + '</text><text x="' + (W - px) + '" y="' + (H + 14) + '" text-anchor="end">' + L.fmtDate(pts[lastI].d) + '</text></svg>';
  }

  function viewExercise() {
    const v = ui.exId; const prog = program(); const ss = sessions();
    const inf = info(v, prog);
    const exps = L.exposures(ss, v);
    const best = L.bestInHistory(ss, v);
    const nextCards = L.dayOrder(prog).filter((d) => (prog.days[d] || []).some((p) => p.v === v)).map((d) => {
      const p = prog.days[d].find((x) => x.v === v);
      const r = L.recommend(v, p, ss, prog);
      return '<section class="card" style="display:grid;gap:6px"><div class="ex-block-h"><p class="eyebrow">Next ' + esc(L.dayTitle(d, prog)) + '</p>' + trendTag(r.trend) + '</div>' +
        '<p class="h2">' + r.loads.map((w) => (w == null ? '?' : fmtW(w))).join(' / ') + ' kg</p>' +
        '<p class="small">' + p.sets + ' sets × ' + p.lo + '–' + p.hi + ' reps · RIR ' + p.rir.map(rirLabel).join(' / ') + '</p><p class="why">' + esc(r.summary) + '</p></section>';
    }).join('');
    const histRows = exps.slice().reverse().map((x) => '<div class="lset"><span class="n">' + L.fmtDate(x.date) + '</span><span class="v">' + esc(L.lastString(x.sets)) + ' kg</span><span class="x">' + (x.kind === 'A' || x.kind === 'B' ? 'Old ' + x.kind : x.kind === 'extra' ? 'Extra' : L.dayNumber(x.kind, prog) ? 'Day ' + L.dayNumber(x.kind, prog) : 'Older') + '</span></div>').join('');
    const basisOpts = (BASES.indexOf(inf.basis) < 0 ? [inf.basis].concat(BASES) : BASES).map((b) => '<option' + (b === inf.basis ? ' selected' : '') + '>' + esc(b) + '</option>').join('');
    return '<section class="screen">' +
      '<button class="back" data-act="ex-back">‹ Exercises</button>' +
      '<div><p class="eyebrow">' + esc(inf.muscle || 'Exercise') + '</p><h1 class="h-display">' + esc(inf.name) + '</h1>' + (inf.setup ? '<p class="muted" style="margin-top:6px">' + esc(inf.setup) + '</p>' : '') + '</div>' +
      nextCards +
      '<div class="kv"><div class="stat"><b>' + (best ? fmtW(best.w) + '×' + fmtR(best.r) : '—') + '</b><span>heaviest set in your log' + (best ? ' · ' + L.fmtDate(best.date) : '') + '</span></div>' +
      '<div class="stat"><b>' + exps.length + '</b><span>sessions · ' + exps.reduce((n, x) => n + x.sets.length, 0) + ' sets</span></div></div>' +
      (exps.length > 1 ? '<section class="card"><p class="eyebrow" style="margin-bottom:6px">Heaviest set per session</p>' + spark(exps) + '</section>' : '') +
      (histRows ? '<section class="ex-block"><h2 class="h3">History</h2><div class="logged">' + histRows + '</div></section>' : '<p class="muted">No sets logged on this machine yet. Your first session sets its starting point.</p>') +
      '<form id="exform" class="card" style="display:grid;gap:12px" autocomplete="off"><h2 class="h3">Machine settings</h2>' +
      '<div class="field"><label for="ef-name">Name</label><input class="input" id="ef-name" value="' + esc(inf.name) + '"></div>' +
      '<div class="form-grid"><div class="field"><label for="ef-inc">Weight step (kg)</label><input class="input" id="ef-inc" inputmode="decimal" value="' + fmtW(inf.inc) + '"></div>' +
      '<div class="field"><label for="ef-rest">Rest (seconds)</label><input class="input" id="ef-rest" inputmode="numeric" value="' + (inf.rest || 105) + '"></div></div>' +
      '<div class="field"><label for="ef-basis">How the kg is counted</label><select class="input" id="ef-basis">' + basisOpts + '</select></div>' +
      '<div class="field"><label for="ef-setup">Setup notes</label><textarea class="input" id="ef-setup">' + esc(inf.setup || '') + '</textarea></div>' +
      '<p class="small muted">The weight step is the smallest jump this machine allows. It sets the − / + buttons and how much the weight goes up when you earn it.</p>' +
      '<button class="btn primary block" type="submit">Save settings</button></form></section>';
  }

  function viewProgramEditor() {
    const d = ui.progDay; const draft = ui.progDraft;
    const list = draft.days[d] || [];
    const total = list.reduce((n, e) => n + e.sets, 0);
    const items = list.map((p, i) => {
      const inf = info(p.v, draft);
      return '<div class="pg"><div class="row"><span class="pe-num">' + (i + 1) + '</span><div class="grow h3">' + esc(inf.name) + '</div>' +
        '<button class="chip-btn" data-act="prog-move" data-i="' + i + '" data-d="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="chip-btn" data-act="prog-move" data-i="' + i + '" data-d="1" aria-label="Move down"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="chip-btn" data-act="prog-del" data-i="' + i + '" aria-label="Remove">✕</button></div>' +
        '<div class="pg-fields"><div><span class="small muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em;font-size:12px">Sets</span><div class="mini-step"><button type="button" data-act="prog-sets" data-i="' + i + '" data-d="-1" aria-label="Fewer sets">−</button><span>' + p.sets + '</span><button type="button" data-act="prog-sets" data-i="' + i + '" data-d="1" aria-label="More sets">+</button></div></div>' +
        '<label>Reps<input class="input" id="pg-rep-' + i + '" value="' + p.lo + '–' + p.hi + '"></label>' +
        '<label>Target RIR<input class="input" id="pg-rir-' + i + '" value="' + p.rir.join(' ') + '"></label></div></div>';
    }).join('');
    return '<section class="screen">' +
      '<button class="back" data-act="prog-back">‹ Exercises</button>' +
      '<div><h1 class="h-display">Edit ' + esc(L.dayTitle(d, draft)) + '</h1><p class="muted">' + list.length + ' exercises · ' + total + ' sets. Changes apply from your next workout; past workouts keep exactly what you did.</p></div>' +
      items +
      '<button class="btn block" data-act="prog-add">+ Add exercise</button>' +
      '<div class="sticky-cta"><button class="btn primary xl" data-act="prog-save">Save ' + esc(L.dayTitle(d, draft, true)) + '</button></div></section>';
  }

  // ---------- Settings ----------
  function viewSettings() {
    const st = settings(); const prog = program();
    const themes = THEMES.map((t) => '<button class="theme" data-act="theme" data-theme="' + t[0] + '" aria-pressed="' + (st.theme === t[0]) + '" style="background:' + t[2] + ';color:' + t[4] + '">' +
      '<span class="sw">' + (t[0] === 'auto' ? '<i style="background:linear-gradient(90deg,#f0a93a 50%,#2350d8 50%)"></i>' : '<i style="background:' + t[3] + '"></i>') + '<b style="background:' + t[4] + '"></b></span>' +
      '<span class="nm">' + esc(t[1]) + '</span></button>').join('');
    const syncText = {
      synced: 'Saved to your Claude account (private to you) and on this phone. Changes sync automatically.',
      saving: 'Saving to your Claude account…',
      connecting: 'Connecting to your Claude account…',
      offline: 'Can\'t reach your Claude account right now. Everything is saved on this phone and syncs when you\'re back online.',
      error: 'Syncing with your Claude account isn\'t working in this view' + (store.err ? ' (' + esc(store.err) + ')' : '') + '. Your data is saved on this phone; keep a backup.',
      local: 'Saved on this phone only in this view (your Claude account isn\'t connected here). Keep a backup now and then.'
    }[store.sync];
    const b = backupStatus();
    const lb = settings().lastBackupAt;
    const appData = '<section class="card" id="data" style="display:grid;gap:12px"><h2 class="h3">Your data</h2>' +
      '<p class="small">Your workouts are saved on this phone' + (ui.persisted ? ' and protected from automatic clearing' : '') + '. Nothing is uploaded anywhere.</p>' +
      '<p class="small ' + (b.days == null || b.days > 14 ? '' : 'muted') + '"><b>Last backup:</b> ' + (lb ? new Date(lb).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'never') + '. Save one every week or two, and before you change phones. Keep it in Google Drive or email it to yourself.</p>' +
      '<div class="btn-row"><button class="btn primary" data-act="export">Download backup</button>' + (navigator.share ? '<button class="btn" data-act="share-backup">Share backup…</button>' : '') + '</div>' +
      '<div class="field"><label for="imp-file">Restore from a backup file</label><input id="imp-file" type="file" accept=".json,.txt,application/json,text/plain" class="input"></div>' +
      '<details><summary class="small" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Or paste backup text</summary><div style="display:grid;gap:8px"><textarea id="imp-text" class="input" placeholder="Paste a backup here"></textarea><button class="btn block" data-act="import-paste">Restore pasted backup</button></div></details>' +
      '<p class="small muted">Uninstalling the app or clearing Chrome\'s data for this site deletes the workouts on this phone, so keep a recent backup.</p></section>';
    const tog = (key, title, sub) => '<button class="toggle" role="switch" aria-checked="' + !!st[key] + '" data-act="toggle" data-key="' + key + '"><span><b>' + title + '</b><br><span class="small muted">' + sub + '</span></span><span class="switch" aria-hidden="true"></span></button>';
    return '<section class="screen"><h1 class="h-display">Settings</h1>' +
      '<section class="card" style="display:grid;gap:12px"><h2 class="h3">Theme</h2><div class="themes">' + themes + '</div></section>' +
      '<section class="card"><h2 class="h3">During a workout</h2>' +
      tog('restTimer', 'Rest timer', 'Starts after each set: 2½ min for big lifts, 90–105 s for the rest. Change it per exercise under Exercises.') +
      tog('beep', 'Beep when rest is over', 'Plays while the app is open. Phone volume must be on.') +
      (PWA ? tog('keepAwake', 'Keep the screen on', 'During a workout the screen won\'t turn off, so the timer and next set stay visible.') : '') +
      '</section>' + installCard() + (PWA ? appData : '') +
      (PWA ? '' : '<section class="card" id="data" style="display:grid;gap:12px"><h2 class="h3">Your data</h2><p class="small">' + syncText + '</p>' +
      '<div class="btn-row"><button class="btn" data-act="export">Save backup file</button><button class="btn" data-act="copy-backup">Copy backup</button></div>' +
      '<div class="field"><label for="imp-file">Restore from a backup file</label><input id="imp-file" type="file" accept=".json,application/json" class="input"></div>' +
      '<details><summary class="small" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Or paste backup text</summary><div style="display:grid;gap:8px"><textarea id="imp-text" class="input" placeholder="Paste a backup here"></textarea><button class="btn block" data-act="import-paste">Restore pasted backup</button></div></details>' +
      '</section>') +
      '<section class="card" style="display:grid;gap:8px"><h2 class="h3">How the weights are chosen</h2>' +
      '<p class="small muted">Same weight until every set of an exercise reaches the top of its rep range, then the smallest step that machine allows. If a set drops below the range, the next time has a lighter finishing set. Fractional reps aren\'t rounded up. Big relative jumps (like 3.4 → 5.7 kg on cables) are tried on one set first. Each machine keeps its own history, so swapping machines never copies weights across.</p>' +
      '<p class="small muted">Program: ' + esc(prog.name || 'A/B') + ' · version ' + (prog.version || 1) + '. Weights in kg. No data is sent to any outside service.</p></section>' +
      '</section>';
  }

  // =====================================================================
  // Dialogs & toast
  // =====================================================================
  function openDialog(html, ctx) {
    ui.dlg = html; if (ctx !== undefined) ui.dlgCtx = ctx;
    const root = document.getElementById('dlg');
    root.innerHTML = '<div class="scrim" data-act="dlg-close"></div><div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    const f = root.querySelector('.sheet [autofocus]'); if (f) setTimeout(() => f.focus(), 50);
    if (PWA) syncHistory();
  }
  function closeDialog() {
    ui.dlg = null; ui.dlgCtx = null;
    document.getElementById('dlg').innerHTML = '';
    if (ui.pendingRender) { ui.pendingRender = false; render(); }
    else if (PWA) syncHistory();
  }
  let toastTimer = null;
  function toast(msg, undoFn) {
    ui.undo = undoFn || null;
    const el = document.getElementById('toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (undoFn ? '<button data-act="toast-undo">Undo</button>' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undoFn ? 7000 : 3500);
  }
  function hideToast() { const el = document.getElementById('toast'); if (el) el.hidden = true; ui.undo = null; }

  function ctxWorkout(mode) { if (mode && mode.indexOf('plan') === 0) return ui.plan; if (mode === 'add-program') return null; return active(); }

  function openCatalog(mode, key) {
    const prog = mode === 'add-program' ? ui.progDraft : program();
    const ss = sessions();
    let alts = [], current = null;
    if (key) {
      const w = ctxWorkout(mode); const e = w && w.exercises.find((x) => x.key === key);
      if (e) { current = e.v; alts = (e.alts || []).concat(e.planned !== e.v ? [e.planned] : []).filter((v) => v !== e.v); }
    }
    const row = (v) => {
      const inf = info(v, prog); const ex = L.exposures(ss, v); const last = ex[ex.length - 1];
      return '<button class="item" data-act="dlg-pick" data-v="' + esc(v) + '"><div class="grow"><div class="t">' + esc(inf.name) + basisTag(inf.basis) + '</div>' +
        '<div class="s">' + esc(inf.muscle || '') + (last ? ' · last ' + esc(L.lastString(last.sets)) + ' kg' : ' · new: you pick the first weight') + '</div></div></button>';
    };
    const all = L.allVariantIds(prog).filter((v) => v !== current && alts.indexOf(v) < 0)
      .sort((a, b) => info(a, prog).name.localeCompare(info(b, prog).name));
    const title = { 'plan-swap': 'Swap machine', swap: 'Swap machine', 'plan-add': 'Add exercise', 'add-workout': 'Add exercise', 'add-program': 'Add exercise' }[mode];
    openDialog('<h2 class="h2">' + title + '</h2>' +
      (key ? '<p class="small muted">The new machine keeps its own weights. They\'re never converted from the old one.</p>' : '') +
      (alts.length ? '<p class="month">Usual alternatives</p><div class="pick">' + alts.map(row).join('') + '</div>' : '') +
      '<p class="month">All exercises</p><div class="pick">' + all.map(row).join('') + '</div>' +
      '<details class="card"><summary class="h3" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Create a new exercise</summary><div style="display:grid;gap:10px;margin-top:10px">' +
      '<div class="field"><label for="nx-name">Name</label><input class="input" id="nx-name" placeholder="e.g. Pec deck"></div>' +
      '<div class="form-grid"><div class="field"><label for="nx-basis">Counted as</label><select class="input" id="nx-basis">' + BASES.map((b) => '<option>' + b + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="nx-inc">Weight step (kg)</label><input class="input" id="nx-inc" inputmode="decimal" value="2.5"></div></div>' +
      '<p class="err-msg" id="nx-err" hidden></p><button class="btn primary block" data-act="dlg-create-ex">Create and add</button></div></details>' +
      '<button class="btn ghost block" data-act="dlg-close">Cancel</button>', { mode, key });
  }

  function planFor(v) {
    const prog = program();
    const p = [].concat.apply([], L.dayOrder(prog).map((d) => prog.days[d] || [])).find((x) => x.v === v);
    return p ? { v, sets: p.sets, lo: p.lo, hi: p.hi, rir: p.rir.slice(), alts: (p.alts || []).slice() } : { v, sets: 2, lo: 10, hi: 15, rir: [2, 1], alts: [] };
  }

  function pickVariant(v) {
    const ctx = ui.dlgCtx || {}; const mode = ctx.mode;
    const name = info(v, mode === 'add-program' ? ui.progDraft : null).name;
    if (mode === 'add-program') {
      syncDraftFromInputs();
      ui.progDraft.days[ui.progDay].push({ v, sets: 2, lo: 10, hi: 15, rir: [2, 1], alts: [] });
      closeDialog(); render(); toast(name + ' added. Set its sets and reps, then Save.');
      return;
    }
    const w = ctxWorkout(mode);
    if (!w) { closeDialog(); return; }
    if (mode === 'plan-swap' || mode === 'swap') {
      const i = findEx(w, ctx.key); if (i < 0) { closeDialog(); return; }
      const e = w.exercises[i];
      if (e.logged.length) {
        // keep what was done on the old machine; the rest of the sets move to the new one
        const rest = e.sets - e.logged.length;
        e.sets = e.logged.length; e.status = 'done';
        const n = L.makeExercise({ v, sets: Math.max(1, rest), lo: e.lo, hi: e.hi, rir: e.rir.slice(e.logged.length).length ? e.rir.slice(e.logged.length) : [e.rir[e.rir.length - 1]], alts: e.alts }, sessions(), program());
        n.planned = e.planned;
        w.exercises.splice(i + 1, 0, n); w.cur = i + 1;
      } else {
        e.v = v; L.refreshRecs(e, sessions(), program());
        if (e.status === 'skipped') e.status = 'pending';
      }
      toast('Swapped to ' + name + '. Its weights come from its own history.');
    } else {
      const n = L.makeExercise(planFor(v), sessions(), program());
      w.exercises.push(n);
      if (mode === 'add-workout') { const cur = w.exercises[w.cur]; if (!cur || L.isExDone(cur)) w.cur = w.exercises.length - 1; }
      toast(name + ' added.');
    }
    if (mode === 'swap' || mode === 'add-workout') saveActive(w);
    closeDialog(); render();
  }

  // ---------- edit a logged set (in a workout or in history) ----------
  function getSetRef(src, a, j) {
    if (src === 'w') { const w = active(); if (!w) return null; const e = w.exercises.find((x) => x.key === a); return e ? { list: e.logged, set: e.logged[j], e, w } : null; }
    const s = store.docs['s-' + ui.historyId]; if (!s) return null; const e = s.exercises[+a]; return e ? { list: e.sets, set: e.sets[j], e, s } : null;
  }
  function openEditSet(src, a, j) {
    const ref = getSetRef(src, a, j); if (!ref || !ref.set) return;
    const x = ref.set; ui.editRir = x.rir == null ? null : x.rir;
    const rirChips = [0, 1, 2, 3, 4].map((v) => '<button type="button" data-act="dlg-rir" data-v="' + v + '" aria-pressed="' + (ui.editRir === v) + '">' + rirLabel(v) + '</button>').join('') +
      '<button type="button" data-act="dlg-rir" data-v="" aria-pressed="' + (ui.editRir == null) + '">Not sure</button>';
    openDialog('<h2 class="h2">Fix set ' + (j + 1) + '</h2><p class="muted">' + esc(info(ref.e.v).name) + '</p>' +
      '<div class="form-grid"><div class="field"><label for="ed-r">Reps</label><input class="input" id="ed-r" inputmode="decimal" value="' + fmtR(x.r) + '"></div>' +
      '<div class="field"><label for="ed-w">Weight (kg)</label><input class="input" id="ed-w" inputmode="decimal" value="' + (x.w == null ? '' : fmtW(x.w)) + '"></div></div>' +
      '<div class="field"><span class="lbl">Reps left in the tank</span><div class="chips" id="ed-rir">' + rirChips + '</div></div>' +
      (x.orig ? '<p class="small muted">First logged as ' + fmtR(x.orig.r) + ' × ' + fmtW(x.orig.w) + ' kg.</p>' : '') +
      '<p class="err-msg" id="ed-err" hidden></p>' +
      '<div class="btn-row"><button class="btn primary" data-act="dlg-save-set">Save</button><button class="btn danger" data-act="dlg-del-set">Delete set</button></div>' +
      '<button class="btn ghost block" data-act="dlg-close">Cancel</button>', { mode: 'edit-set', src, a, j });
  }

  // ---------- backup ----------
  function backupText() { return JSON.stringify({ format: 'gym-tracker-backup', version: 1, exportedAt: new Date().toISOString(), docs: store.docs }); }
  function showBackupText(msg) {
    openDialog('<h2 class="h2">Backup</h2><p class="small muted">' + esc(msg) + '</p><textarea class="input" id="bk-text" readonly style="min-height:180px;font-size:12px">' + esc(backupText()) + '</textarea>' +
      '<button class="btn ghost block" data-act="dlg-close">Close</button>');
    const t = document.getElementById('bk-text'); if (t) { t.focus(); t.select(); }
  }
  function parseBackup(text) {
    let o; try { o = JSON.parse(text); } catch (e) { return null; }
    if (!o || o.format !== 'gym-tracker-backup' || !o.docs || typeof o.docs !== 'object') return null;
    return o;
  }
  function confirmImport(o) {
    const ids = Object.keys(o.docs);
    const n = ids.filter((k) => k.indexOf('s-') === 0 && o.docs[k] && !o.docs[k].deleted).length;
    ui.pendingImport = o;
    openDialog('<h2 class="h2">Restore backup?</h2><p>This backup has <b>' + n + ' workouts</b>' + (o.docs.program ? ', your program' : '') + (o.docs.settings ? ' and settings' : '') + '. Saved ' + esc((o.exportedAt || '').slice(0, 10)) + '.</p>' +
      '<p class="small muted">Workouts in the backup replace the same workouts here. Workouts that aren\'t in the backup stay.</p>' +
      '<div class="btn-row"><button class="btn primary" data-act="dlg-import">Restore</button><button class="btn ghost" data-act="dlg-close">Cancel</button></div>');
  }

  // =====================================================================
  // Actions
  // =====================================================================
  function syncRepChips() {
    const v = parseNum((document.getElementById('reps') || {}).value);
    document.querySelectorAll('[data-act="rep-chip"]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.r) === v)));
  }
  function showErr(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.hidden = !msg; } }
  function readRange(s) { const m = String(s || '').match(/(\d+)\s*[-–—to ]+\s*(\d+)/); if (!m) return null; const lo = +m[1], hi = +m[2]; return lo >= 1 && hi >= lo && hi <= 50 ? [lo, hi] : null; }
  function readRir(s) { const a = String(s || '').split(/[\s,/]+/).filter(Boolean).map(Number).filter((n) => n >= 0 && n <= 5); return a.length ? a : null; }
  function syncDraftFromInputs() {
    if (!ui.progDraft) return;
    (ui.progDraft.days[ui.progDay] || []).forEach((p, i) => {
      const r = readRange((document.getElementById('pg-rep-' + i) || {}).value); if (r) { p.lo = r[0]; p.hi = r[1]; }
      const q = readRir((document.getElementById('pg-rir-' + i) || {}).value); if (q) p.rir = q;
    });
  }
  function fitRir(p) { const r = p.rir.slice(0, p.sets); while (r.length < p.sets) r.push(r.length ? r[r.length - 1] : 1); p.rir = r; }

  const A = {
    nav(t) {
      const tab = t.dataset.tab;
      if (ui.tab === tab) { if (tab === 'history') ui.historyId = null; if (tab === 'exercises') { ui.exId = null; ui.progDay = null; ui.progDraft = null; } }
      ui.tab = tab; render(); scrollTop();
    },
    'go-data'() { ui.tab = 'settings'; render(); const d = document.getElementById('data'); if (d) d.scrollIntoView(); },

    // ----- home & plan -----
    choose(t) {
      const kind = t.dataset.kind; const prog = program(); const today = L.isoDate();
      ui.plan = kind === 'extra'
        ? { id: today + '-extra-' + L.uid(), kind: 'extra', date: today, startedAt: Date.now(), programVersion: prog.version, exercises: [], cur: 0, restEndsAt: null, restTotal: 0 }
        : L.buildWorkout(kind, prog, sessions(), today);
      render(); scrollTop();
    },
    'plan-back'() { ui.plan = null; render(); scrollTop(); },
    'plan-move'(t) {
      const w = ui.plan; const i = findEx(w, t.dataset.k); const j = i + Number(t.dataset.d);
      if (i < 0 || j < 0 || j >= w.exercises.length) return;
      const x = w.exercises[i]; w.exercises[i] = w.exercises[j]; w.exercises[j] = x; render();
    },
    'plan-skip'(t) { const e = ui.plan.exercises[findEx(ui.plan, t.dataset.k)]; if (e) { e.status = e.status === 'skipped' ? 'pending' : 'skipped'; render(); } },
    'plan-swap'(t) { openCatalog('plan-swap', t.dataset.k); },
    'plan-add'() { openCatalog('plan-add'); },
    start() {
      const w = ui.plan; if (!w) return;
      const first = L.nextPendingIndex(w, 0); if (first < 0) return;
      w.startedAt = Date.now(); w.cur = first; ui.plan = null; ui.rirSel = null;
      ensureAudio(); saveActive(w); render(); scrollTop();
    },

    // ----- set entry -----
    'reps-step'(t) {
      const el = document.getElementById('reps'); const w = active(); const e = w.exercises[w.cur];
      const cur = parseNum(el.value); const d = Number(t.dataset.d);
      const base = isNaN(cur) ? (recAt(e, e.logged.length).aim || e.lo) : Math.max(0, cur + d);
      el.value = String(base); syncRepChips(); showErr('reps-err', '');
    },
    'rep-chip'(t) { const el = document.getElementById('reps'); el.value = t.dataset.r; syncRepChips(); showErr('reps-err', ''); },
    'w-step'(t) {
      const el = document.getElementById('wt'); const w = active(); const e = w.exercises[w.cur];
      const inc = Number(info(e.v).inc) || 2.5; const rec = recAt(e, e.logged.length).w;
      const cur = parseNum(el.value); const base = isNaN(cur) ? (rec || 0) : cur;
      el.value = fmtW(Math.max(0, L.r1(base + Number(t.dataset.d) * inc))); showErr('wt-err', '');
    },
    rir(t) {
      const v = Number(t.dataset.v); ui.rirSel = ui.rirSel === v ? null : v;
      document.querySelectorAll('[data-act="rir"]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === ui.rirSel)));
    },
    logSet() {
      const w = active(); if (!w) return; const e = w.exercises[w.cur]; if (!e) return;
      const r = parseNum(document.getElementById('reps').value);
      if (isNaN(r) || r <= 0 || r > 100) { showErr('reps-err', 'Enter the number of reps you did.'); document.getElementById('reps').classList.add('err'); return; }
      const i = e.logged.length; const rec = recAt(e, i);
      const wRaw = document.getElementById('wt').value.trim();
      let wt = wRaw === '' ? rec.w : parseNum(wRaw);
      if (wt == null || isNaN(wt) || wt < 0 || wt > 1000) { showErr('wt-err', rec.w == null ? 'Enter the weight you used (kg).' : 'Enter the weight as a number, e.g. 42.5.'); document.getElementById('wt').classList.add('err'); return; }
      wt = L.r1(wt);
      const prevRecs = L.clone(e.recs); const prevStatus = e.status; const prevCur = w.cur; const prevRest = [w.restEndsAt, w.restTotal];
      const set = { r: L.r1(r), w: wt, rec: rec.w == null ? null : rec.w, rir: ui.rirSel, trir: rirAt(e, i), t: Date.now() };
      e.logged.push(set);
      L.adjustAfterSet(e, i, set, info(e.v));
      e.status = e.logged.length >= e.sets ? 'done' : 'active';
      const nx = L.nextPendingIndex(w, w.cur);
      if (nx >= 0 && nx !== w.cur) w.cur = nx;
      const st = settings();
      if (st.restTimer && nx >= 0) { w.restTotal = Number(info(e.v).rest) || 105; w.restEndsAt = Date.now() + w.restTotal * 1000; scheduleBeep(w.restTotal); }
      else { w.restEndsAt = null; cancelBeep(); }
      ui.rirSel = null;
      saveActive(w);
      const name = info(e.v).name;
      const nextE = nx >= 0 ? w.exercises[nx] : null;
      let msg = name + ' set ' + (i + 1) + ': ' + fmtR(set.r) + ' × ' + fmtW(set.w) + ' kg';
      if (nextE && nextE.key !== e.key) msg += '. Next: ' + info(nextE.v).name;
      toast(msg, () => {
        const ww = active(); if (!ww) return; const ee = ww.exercises.find((x) => x.key === e.key); if (!ee) return;
        const j = ee.logged.findIndex((s) => s.t === set.t); if (j < 0) return;
        ee.logged.splice(j, 1); ee.recs = prevRecs; ee.status = prevStatus === 'done' ? 'active' : prevStatus;
        ww.cur = ww.exercises.indexOf(ee) >= 0 ? ww.exercises.indexOf(ee) : prevCur;
        ww.restEndsAt = prevRest[0]; ww.restTotal = prevRest[1]; cancelBeep();
        saveActive(ww); render();
      });
      render(); scrollTop();
    },
    'rest-add'() { const w = active(); if (!w || !w.restEndsAt) return; const base = Math.max(Date.now(), w.restEndsAt); w.restEndsAt = base + 30000; w.restTotal = (w.restTotal || 90) + 30; scheduleBeep((w.restEndsAt - Date.now()) / 1000); saveActive(w); tickRest(); },
    'rest-skip'() { const w = active(); if (!w) return; w.restEndsAt = null; cancelBeep(); saveActive(w); tickRest(); },
    defer() {
      const w = active(); const i = w.cur; const e = w.exercises[i];
      const others = w.exercises.filter((x, k) => k !== i && !L.isExDone(x));
      if (!others.length) { toast('This is the last exercise left, so there\'s nothing to do first.'); return; }
      w.exercises.splice(i, 1); e.deferred = true; w.exercises.push(e);
      w.cur = L.nextPendingIndex(w, i >= w.exercises.length ? 0 : i);
      saveActive(w);
      toast(info(e.v).name + ' moved to the end. Now: ' + info(w.exercises[w.cur].v).name + '.');
      render(); scrollTop();
    },
    swap() { const w = active(); openCatalog('swap', w.exercises[w.cur].key); },
    'skip-ex'() {
      const w = active(); const e = w.exercises[w.cur]; const prev = e.status; const prevCur = w.cur;
      e.status = e.logged.length ? 'ended' : 'skipped';
      const nx = L.nextPendingIndex(w, w.cur); if (nx >= 0) w.cur = nx;
      w.restEndsAt = null; cancelBeep();
      saveActive(w);
      toast((e.logged.length ? 'Ended ' : 'Skipped ') + info(e.v).name, () => { const ww = active(); const ee = ww && ww.exercises.find((x) => x.key === e.key); if (!ee) return; ee.status = prev; ww.cur = ww.exercises.indexOf(ee) >= 0 ? ww.exercises.indexOf(ee) : prevCur; saveActive(ww); render(); });
      render(); scrollTop();
    },
    'do-now'(t) {
      const w = active(); const from = findEx(w, t.dataset.k); if (from < 0) return;
      const e = w.exercises.splice(from, 1)[0];
      let to = w.cur; if (from < w.cur) to = w.cur - 1;
      w.exercises.splice(to, 0, e); w.cur = to;
      if (e.status === 'skipped') e.status = 'pending';
      saveActive(w); render(); scrollTop();
    },
    unskip(t) {
      const w = active(); const i = findEx(w, t.dataset.k); if (i < 0) return; const e = w.exercises[i];
      e.status = e.logged.length ? 'active' : 'pending';
      const cur = w.exercises[w.cur]; if (!cur || L.isExDone(cur)) w.cur = i;
      saveActive(w); render();
    },
    'add-set'(t) {
      const w = active(); const i = findEx(w, t.dataset.k); if (i < 0) return; const e = w.exercises[i];
      const lastW = e.logged.length ? e.logged[e.logged.length - 1].w : recAt(e, e.sets - 1).w;
      e.sets = Math.max(e.sets, e.logged.length) + 1;
      while (e.recs.length < e.sets) e.recs.push({ w: lastW, why: 'Extra set', aim: null });
      e.status = 'active'; w.cur = i;
      saveActive(w); render(); scrollTop();
    },
    'add-ex'() { openCatalog('add-workout'); },
    'edit-set'(t) { openEditSet('w', t.dataset.k, Number(t.dataset.j)); },
    finish() {
      const w = active(); if (!w) return;
      const planned = L.plannedCount(w), done = L.doneCount(w);
      if (!done) {
        openDialog('<h2 class="h2">No sets logged yet</h2><p>There\'s nothing to save. Discard this workout, or keep going?</p>' +
          '<div class="btn-row"><button class="btn primary" data-act="dlg-close">Keep going</button><button class="btn danger" data-act="dlg-discard">Discard</button></div>');
        return;
      }
      if (done < planned) {
        const miss = w.exercises.filter((e) => e.status === 'skipped' || e.logged.length < e.sets)
          .map((e) => '<li>' + esc(info(e.v).name) + ': ' + (e.status === 'skipped' ? 'skipped' : (e.sets - e.logged.length) + ' of ' + e.sets + ' sets not done') + '</li>').join('');
        openDialog('<h2 class="h2">Finish with ' + (planned - done) + ' sets not done?</h2><ul class="small" style="margin:0;padding-left:20px">' + miss + '</ul>' +
          '<p class="small muted">They\'re saved as not done. Nothing is invented or carried over automatically.</p>' +
          '<div class="btn-row"><button class="btn primary" data-act="dlg-finish">Finish workout</button><button class="btn ghost" data-act="dlg-close">Keep going</button></div>');
        return;
      }
      A['dlg-finish']();
    },
    'dlg-finish'() {
      const w = active(); if (!w) return;
      const s = L.finishWorkout(w, program());
      saveSession(s); clearActive(); cancelBeep();
      ui.summaryId = s.id; ui.rirSel = null;
      if (ui.dlg) closeDialog();
      hideToast(); render(); scrollTop();
    },
    discard() {
      const w = active(); const n = w ? L.doneCount(w) : 0;
      openDialog('<h2 class="h2">Discard this workout?</h2><p>' + (n ? 'The ' + n + ' sets you logged today will be deleted.' : 'Nothing has been logged yet.') + ' This can\'t be undone.</p>' +
        '<div class="btn-row"><button class="btn danger" data-act="dlg-discard">Discard workout</button><button class="btn ghost" data-act="dlg-close">Keep it</button></div>');
    },
    'dlg-discard'() { clearActive(); cancelBeep(); closeDialog(); hideToast(); render(); scrollTop(); },
    'summary-done'() { ui.summaryId = null; render(); scrollTop(); },

    // ----- history -----
    'open-session'(t) { ui.historyId = t.dataset.id; render(); scrollTop(); },
    'session-back'() { ui.historyId = null; render(); },
    'hedit-set'(t) { openEditSet('h', t.dataset.k, Number(t.dataset.j)); },
    'delete-session'() {
      const s = store.docs['s-' + ui.historyId]; if (!s) return;
      openDialog('<h2 class="h2">Delete this workout?</h2><p>' + esc(kindName(s)) + ' on ' + L.fmtDate(s.date) + ' with ' + L.countSets(s) + ' sets will be removed from your history and from the weight suggestions.</p>' +
        '<div class="btn-row"><button class="btn danger" data-act="dlg-delete-session">Delete</button><button class="btn ghost" data-act="dlg-close">Cancel</button></div>');
    },
    'dlg-delete-session'() {
      const id = ui.historyId; const s = store.docs['s-' + id]; if (!s) return;
      const backup = L.clone(s);
      put('s-' + id, { id, deleted: true });
      ui.historyId = null; closeDialog(); render();
      toast('Workout deleted', () => { const b = L.clone(backup); delete b.updatedAt; put('s-' + id, b); render(); });
    },

    // ----- edit-set dialog -----
    'dlg-rir'(t) {
      ui.editRir = t.dataset.v === '' ? null : Number(t.dataset.v);
      document.querySelectorAll('[data-act="dlg-rir"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === '' ? ui.editRir == null : Number(b.dataset.v) === ui.editRir)));
    },
    'dlg-save-set'() {
      const c = ui.dlgCtx; const ref = getSetRef(c.src, c.a, c.j); if (!ref) return closeDialog();
      const r = parseNum(document.getElementById('ed-r').value); const wv = parseNum(document.getElementById('ed-w').value);
      if (isNaN(r) || r <= 0 || r > 100) return showErr('ed-err', 'Enter the reps as a number.');
      if (isNaN(wv) || wv < 0 || wv > 1000) return showErr('ed-err', 'Enter the weight as a number.');
      const x = ref.set;
      if ((L.r1(r) !== x.r || L.r1(wv) !== x.w) && !x.orig) x.orig = { r: x.r, w: x.w };
      x.r = L.r1(r); x.w = L.r1(wv); x.rir = ui.editRir;
      if (c.src === 'w') saveActive(ref.w); else saveSession(ref.s);
      closeDialog(); render(); toast('Set ' + (c.j + 1) + ' corrected: ' + fmtR(x.r) + ' × ' + fmtW(x.w) + ' kg');
    },
    'dlg-del-set'() {
      const c = ui.dlgCtx; const ref = getSetRef(c.src, c.a, c.j); if (!ref) return closeDialog();
      ref.list.splice(c.j, 1);
      if (c.src === 'w') {
        const e = ref.e; if (e.status === 'done' && e.logged.length < e.sets) e.status = 'active';
        saveActive(ref.w);
      } else {
        if (!ref.e.sets.length) ref.s.exercises.splice(+c.a, 1);
        saveSession(ref.s);
      }
      closeDialog(); render(); toast('Set deleted');
    },

    // ----- catalog dialog -----
    'dlg-pick'(t) { pickVariant(t.dataset.v); },
    'dlg-create-ex'() {
      const name = (document.getElementById('nx-name').value || '').trim();
      const basis = document.getElementById('nx-basis').value;
      const inc = parseNum(document.getElementById('nx-inc').value);
      if (!name) return showErr('nx-err', 'Give the exercise a name.');
      if (isNaN(inc) || inc <= 0 || inc > 50) return showErr('nx-err', 'Enter the weight step in kg, e.g. 2.5.');
      const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) + '_' + L.uid();
      const def = { name, basis, inc: L.r1(inc), rest: 105, muscle: '', setup: 'Your own exercise.' };
      if (ui.dlgCtx && ui.dlgCtx.mode === 'add-program') { ui.progDraft.custom = ui.progDraft.custom || {}; ui.progDraft.custom[id] = def; }
      const p = L.clone(program()); p.custom = p.custom || {}; p.custom[id] = def; saveProgram(p);
      pickVariant(id);
    },
    'dlg-close'() { closeDialog(); },
    'toast-undo'() { const fn = ui.undo; hideToast(); if (fn) fn(); },

    // ----- exercises & program -----
    'open-ex'(t) { ui.exId = t.dataset.v; render(); scrollTop(); },
    'ex-back'() { ui.exId = null; render(); },
    'ex-save'() {
      const v = ui.exId; const p = L.clone(program()); p.overrides = p.overrides || {};
      const inc = parseNum(document.getElementById('ef-inc').value); const rest = parseNum(document.getElementById('ef-rest').value);
      const name = document.getElementById('ef-name').value.trim();
      if (isNaN(inc) || inc <= 0 || inc > 50) { toast('Weight step must be a number of kg, e.g. 2.5'); return; }
      if (isNaN(rest) || rest < 10 || rest > 900) { toast('Rest must be between 10 and 900 seconds'); return; }
      p.overrides[v] = Object.assign({}, p.overrides[v] || {}, { inc: L.r1(inc), rest: Math.round(rest), basis: document.getElementById('ef-basis').value, setup: document.getElementById('ef-setup').value.trim() });
      if (name) p.overrides[v].name = name;
      saveProgram(p); render(); toast('Saved. New weights use a ' + fmtW(inc) + ' kg step.');
    },
    'edit-day'(t) { ui.progDay = t.dataset.kind; ui.progDraft = L.clone(program()); render(); scrollTop(); },
    'prog-back'() {
      syncDraftFromInputs();
      const before = L.clone(program()); delete before.updatedAt; const after = L.clone(ui.progDraft); delete after.updatedAt;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        openDialog('<h2 class="h2">Discard changes?</h2><p>Your edits to ' + esc(L.dayTitle(ui.progDay, ui.progDraft)) + ' haven\'t been saved.</p><div class="btn-row"><button class="btn primary" data-act="dlg-close">Keep editing</button><button class="btn danger" data-act="dlg-prog-discard">Discard</button></div>');
        return;
      }
      ui.progDay = null; ui.progDraft = null; render();
    },
    'dlg-prog-discard'() { ui.progDay = null; ui.progDraft = null; closeDialog(); render(); },
    'prog-sets'(t) { syncDraftFromInputs(); const p = ui.progDraft.days[ui.progDay][+t.dataset.i]; p.sets = Math.max(1, Math.min(10, p.sets + Number(t.dataset.d))); fitRir(p); render(); },
    'prog-move'(t) {
      syncDraftFromInputs(); const list = ui.progDraft.days[ui.progDay]; const i = +t.dataset.i; const j = i + Number(t.dataset.d);
      if (j < 0 || j >= list.length) return; const x = list[i]; list[i] = list[j]; list[j] = x; render();
    },
    'prog-del'(t) { syncDraftFromInputs(); const list = ui.progDraft.days[ui.progDay]; const x = list.splice(+t.dataset.i, 1)[0]; render(); toast(info(x.v, ui.progDraft).name + ' removed (not saved yet)', () => { list.splice(+t.dataset.i, 0, x); render(); }); },
    'prog-add'() { syncDraftFromInputs(); openCatalog('add-program'); },
    'prog-save'() {
      syncDraftFromInputs();
      const d = ui.progDraft; (d.days[ui.progDay] || []).forEach(fitRir);
      d.version = (program().version || 1) + 1;
      saveProgram(d);
      const v = d.version; ui.progDay = null; ui.progDraft = null; render(); scrollTop();
      toast('Program saved (version ' + v + '). Your next workout uses it.');
    },

    // ----- settings -----
    theme(t) { saveSettings({ theme: t.dataset.theme }); render(); },
    toggle(t) { const k = t.dataset.key; const s = {}; s[k] = !settings()[k]; saveSettings(s); render(); },
    async export() {
      if (PWA) { downloadText(backupName(), backupText()); markBackup(); toast('Backup saved to your Downloads folder.'); return; }
      let dl = null;
      try { dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
      if (dl) {
        try { await dl.save({ filename: 'gym-tracker-backup-' + L.isoDate() + '.json', data: backupText() }); toast('Backup file saved'); return; }
        catch (e) { toast('Backup file not saved'); return; }
      }
      showBackupText('Saving files isn\'t available in this view. Copy this text and keep it somewhere safe, for example in an email to yourself.');
    },
    async 'share-backup'() {
      const text = backupText();
      const tries = [new File([text], backupName(), { type: 'application/json' }), new File([text], backupName().replace(/\.json$/, '.txt'), { type: 'text/plain' })];
      const file = tries.find((f) => navigator.canShare && navigator.canShare({ files: [f] }));
      if (!file) { downloadText(backupName(), text); markBackup(); toast('Sharing files isn\'t supported here, so it was saved to Downloads.'); return; }
      try { await navigator.share({ files: [file], title: 'Gym Tracker backup' }); markBackup(); toast('Backup shared.'); }
      catch (e) { if (!e || e.name !== 'AbortError') toast('Sharing didn\'t work. Use Download backup instead.'); }
    },
    async install() {
      if (installEvt) { const e = installEvt; installEvt = null; try { e.prompt(); await e.userChoice; } catch (err) { /* ignore */ } render(); return; }
      openDialog('<h2 class="h2">Install the app</h2><ol class="small" style="margin:0;padding-left:20px;display:grid;gap:8px">' +
        '<li>Open this page in <b>Chrome</b> on your phone.</li><li>Tap the <b>⋮</b> menu (top right).</li><li>Tap <b>Install app</b>, or <b>Add to Home screen</b> → <b>Install</b>.</li></ol>' +
        '<p class="small muted">Gym Tracker then appears in your app drawer and on your home screen, and opens full screen.</p><button class="btn primary block" data-act="dlg-close">OK</button>');
    },
    async 'copy-backup'() {
      try { await navigator.clipboard.writeText(backupText()); if (PWA) markBackup(); toast('Backup copied. Paste it somewhere safe.'); }
      catch (e) { showBackupText('Copying isn\'t allowed here. Select all of this text and copy it yourself.'); }
    },
    'import-paste'() {
      const o = parseBackup(document.getElementById('imp-text').value);
      if (!o) { toast('That doesn\'t look like a Gym Tracker backup.'); return; }
      confirmImport(o);
    },
    'dlg-import'() {
      const o = ui.pendingImport; ui.pendingImport = null; if (!o) return closeDialog();
      Object.keys(o.docs).forEach((id) => { if (/^[A-Za-z0-9_.~:@+-]+$/.test(id) && o.docs[id] && typeof o.docs[id] === 'object') { const d = L.clone(o.docs[id]); delete d.updatedAt; put(id, d); } });
      closeDialog(); render(); toast('Backup restored');
      if (PWA) persistStorage();
    }
  };

  // ---------- rest timer ticker (updates text only; never writes data) ----------
  function tickRest() {
    const el = document.getElementById('rest'); if (!el) return;
    const w = active(); const end = w && w.restEndsAt;
    if (!end) { el.hidden = true; return; }
    const ms = end - Date.now();
    if (ms < -90000) { el.hidden = true; return; }
    el.hidden = false;
    const tEl = document.getElementById('rest-time'), lbl = document.getElementById('rest-lbl'), bar = document.getElementById('rest-bar');
    if (ms > 0) {
      const s = Math.ceil(ms / 1000);
      tEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      lbl.textContent = 'Rest'; el.classList.remove('over');
      bar.style.width = Math.max(0, Math.min(100, (ms / ((w.restTotal || 90) * 1000)) * 100)) + '%';
    } else {
      tEl.textContent = 'Go'; lbl.textContent = 'Rest over · next set'; el.classList.add('over'); bar.style.width = '0%';
      if (ui.buzzedFor !== end) { ui.buzzedFor = end; try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
    }
  }
  setInterval(tickRest, 250);

  // ---------- events ----------
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-act]'); if (!t || t.disabled) return;
    const fn = A[t.dataset.act]; if (!fn) return;
    ev.preventDefault(); fn(t, ev);
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'logform') { ev.preventDefault(); A.logSet(); }
    else if (ev.target.id === 'exform') { ev.preventDefault(); A['ex-save'](); }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'reps') { syncRepChips(); ev.target.classList.remove('err'); showErr('reps-err', ''); }
    if (ev.target.id === 'wt') { ev.target.classList.remove('err'); showErr('wt-err', ''); }
  });
  document.addEventListener('change', (ev) => {
    if ((ev.target.id !== 'imp-file' && ev.target.id !== 'imp-file-home') || !ev.target.files || !ev.target.files[0]) return;
    const fr = new FileReader();
    fr.onload = () => { const o = parseBackup(String(fr.result)); if (!o) toast('That file isn\'t a Gym Tracker backup.'); else confirmImport(o); ev.target.value = ''; };
    fr.readAsText(ev.target.files[0]);
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.dlg) closeDialog(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickRest(); if (!PWA) flushSoon(100); } if (PWA) manageWakeLock(); });

  // ---------- boot ----------
  loadLocal();
  if (PWA) {
    const go = new URLSearchParams(location.search).get('go');
    const goKind = go === 'next' ? L.suggestNext(sessions(), program()) : go;
    if (goKind && L.dayOrder(program()).indexOf(goKind) >= 0 && !active()) A.choose({ dataset: { kind: goKind } });
    persistStorage().then(() => { if (ui.tab === 'settings' && !ui.dlg) render(); });
    if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }
  render();
  connect();
})();
