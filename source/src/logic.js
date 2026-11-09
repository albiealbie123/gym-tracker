/* Gym Tracker — pure logic: catalog, program, progression engine, rotation. No DOM. */
(function (root) {
  'use strict';

  // ---------- Exercise catalog (one entry per machine/setup) ----------
  // inc = smallest practical weight step on that machine (editable in the app)
  // rest = default rest in seconds
  const VARIANTS = {
    d1_incline_usual: { name: 'D1 Incline Chest Press', basis: 'kg', inc: 4.5, rest: 150, muscle: 'Upper chest', setup: 'Usual incline setup. Keep the same seat, grip and setup each time.' },
    v_squat_usual: { name: 'V-Squat', basis: 'kg', inc: 5, rest: 150, muscle: 'Quads & glutes', setup: 'Your hack-squat replacement. Keep stance and depth the same.' },
    seated_leg_curl_usual: { name: 'Seated Leg Curl', basis: 'kg', inc: 4.5, rest: 105, muscle: 'Hamstrings', setup: 'Usual machine. Range is 8–12 since Nov 4 (the original written program said 10–15).' },
    egym_chest_press: { name: 'EGYM Chest Press', basis: 'kg', inc: 5, rest: 150, muscle: 'Chest', setup: 'Flat-press slot. Separate from D1 and from the iso-lateral bench.' },
    iso_lateral_bench: { name: 'Iso-Lateral Bench Press', basis: 'kg per side', inc: 2.5, rest: 150, muscle: 'Chest', setup: 'Plates per side (you confirmed this on Nov 6).' },
    flat_dumbbell_press_new_variant: { name: 'Flat Dumbbell Press', basis: 'kg per hand', inc: 2, rest: 150, muscle: 'Chest', setup: 'Calibrate separately from the machine presses.' },
    incline_dumbbell_press_new_variant: { name: 'Incline Dumbbell Press', basis: 'kg per hand', inc: 2, rest: 150, muscle: 'Upper chest', setup: 'Calibrate separately from D1.' },
    booty_builder_banded: { name: 'Booty Builder', basis: 'kg plates + 2 bands', inc: 5, rest: 150, muscle: 'Glutes', setup: 'Two bands, each rated 20–23 kg. The bands are not added to the kg.' },
    overhead_cable_triceps: { name: 'Overhead Cable Triceps', basis: 'kg', inc: 2.4, rest: 105, muscle: 'Triceps', setup: 'Overhead extension (not pushdowns).' },
    leg_press_calf: { name: 'Leg Press Calf Raise', basis: 'kg', inc: 4.5, rest: 105, muscle: 'Calves', setup: 'On the leg press machine.' },
    v_squat_calf: { name: 'V-Squat Calf Raise', basis: 'kg', inc: 5, rest: 105, muscle: 'Calves', setup: 'Different from leg-press calves; its weights are tracked separately.' },
    standing_calf_raise_new_variant: { name: 'Standing Calf Raise', basis: 'kg', inc: 5, rest: 105, muscle: 'Calves', setup: 'Tracked separately from the other calf machines.' },
    cable_lateral_usual: { name: 'Cable Lateral Raise', basis: 'kg per arm', inc: 2.3, rest: 90, muscle: 'Side delts', setup: 'Do both arms; the pair counts as one set.' },
    hip_adduction_usual: { name: 'Hip Adduction', basis: 'kg', inc: 4.5, rest: 90, muscle: 'Inner thighs', setup: 'Usual machine.' },
    hip_abduction_usual: { name: 'Hip Abduction', basis: 'kg', inc: 4.5, rest: 90, muscle: 'Outer hips', setup: 'Usual machine.' },
    hammer_strength_abs: { name: 'Hammer Strength Abs', basis: 'kg plates', inc: 2.5, rest: 90, muscle: 'Abs', setup: 'Plate-loaded. The kg is the plates you load.' },
    egym_pulldown: { name: 'EGYM Pulldown', basis: 'kg', inc: 5, rest: 150, muscle: 'Lats', setup: 'Separate from other pulldown machines.' },
    iso_lateral_row: { name: 'Iso-Lateral Row', basis: 'kg per arm', inc: 2.5, rest: 150, muscle: 'Upper back', setup: 'Chest-supported. Plates per arm.' },
    leg_extension_usual: { name: 'Leg Extension', basis: 'kg', inc: 4.5, rest: 105, muscle: 'Quads', setup: 'Usual machine.' },
    rear_delt_usual: { name: 'Rear-Delt Machine', basis: 'kg', inc: 4.5, rest: 90, muscle: 'Rear delts', setup: 'Usual setup.' },
    egym_biceps_curl: { name: 'EGYM Biceps Curl', basis: 'kg', inc: 5, rest: 105, muscle: 'Biceps', setup: 'Your current biceps choice.' },
    preacher_curl_new_variant: { name: 'Preacher Curl', basis: 'kg', inc: 2.5, rest: 105, muscle: 'Biceps', setup: 'Tracked separately from the EGYM curl.' },
    b3_back_extension: { name: 'B3 Back Extension', basis: 'kg', inc: 4.5, rest: 105, muscle: 'Lower back', setup: 'Back-extension machine: lower-back work.' },
    straight_arm_cable_pulldown_legacy: { name: 'Straight-Arm Cable Pulldown', basis: 'kg', inc: 2.3, rest: 90, muscle: 'Lats', setup: 'Arms almost straight, pull the bar down to your thighs. Lats only, no biceps.' },
    one_arm_cable_curl_legacy: { name: 'One-Arm Cable Curl', basis: 'kg per arm', inc: 2.3, rest: 90, muscle: 'Biceps', setup: 'From your older split.', legacy: true }
  };

  const COMPOUND_REST = 150;

  function ex(v, sets, lo, hi, rir, alts) { return { v, sets, lo, hi, rir, alts: alts || [] }; }

  // 5-day V-taper split (from 9 Nov 2026): back, side delts and arms 3x a week; legs and chest twice.
  function defaultProgram() {
    return {
      version: 2,
      id: 'vtaper5',
      name: '5-day V-taper split (9 Nov 2026)',
      order: ['D1', 'D2', 'D3', 'D4', 'D5'],
      dayInfo: {
        D1: { name: 'Upper 1', focus: 'Back first', tone: 'upper' },
        D2: { name: 'Lower 1', focus: 'Legs & abs', tone: 'lower' },
        D3: { name: 'Upper 2', focus: 'Shoulders & arms first', tone: 'upper' },
        D4: { name: 'Lower 2', focus: 'Legs, glutes & abs', tone: 'lower' },
        D5: { name: 'V-taper', focus: 'Lats, delts & arms', tone: 'upper' }
      },
      // usual week, indexed like Date.getDay(): Sun, Mon … Sat (null = rest)
      schedule: [null, 'D1', 'D2', null, 'D3', 'D4', 'D5'],
      days: {
        D1: [
          ex('egym_pulldown', 3, 8, 12, [2, 1, 1]),
          ex('iso_lateral_row', 3, 8, 12, [2, 1, 1]),
          ex('d1_incline_usual', 3, 8, 12, [2, 1, 1], ['incline_dumbbell_press_new_variant']),
          ex('cable_lateral_usual', 4, 10, 15, [2, 1, 1, 1]),
          ex('egym_biceps_curl', 2, 8, 12, [2, 1], ['preacher_curl_new_variant']),
          ex('overhead_cable_triceps', 2, 10, 15, [2, 1])
        ],
        D2: [
          ex('v_squat_usual', 3, 8, 12, [2, 2, 1]),
          ex('seated_leg_curl_usual', 2, 8, 12, [2, 1]),
          ex('leg_press_calf', 3, 10, 15, [2, 1, 1], ['v_squat_calf', 'standing_calf_raise_new_variant']),
          ex('hip_adduction_usual', 2, 10, 15, [2, 1]),
          ex('hammer_strength_abs', 2, 10, 15, [2, 1])
        ],
        D3: [
          ex('cable_lateral_usual', 4, 10, 15, [2, 1, 1, 1]),
          ex('egym_chest_press', 3, 8, 12, [2, 1, 1], ['iso_lateral_bench', 'flat_dumbbell_press_new_variant']),
          ex('straight_arm_cable_pulldown_legacy', 3, 10, 15, [2, 1, 1]),
          ex('rear_delt_usual', 2, 8, 12, [2, 1]),
          ex('overhead_cable_triceps', 3, 10, 15, [2, 1, 1]),
          ex('egym_biceps_curl', 2, 8, 12, [2, 1], ['preacher_curl_new_variant'])
        ],
        D4: [
          ex('leg_extension_usual', 2, 10, 15, [2, 1]),
          ex('booty_builder_banded', 2, 8, 12, [2, 1]),
          ex('seated_leg_curl_usual', 2, 8, 12, [2, 1]),
          ex('b3_back_extension', 2, 10, 15, [2, 2]),
          ex('hip_abduction_usual', 2, 10, 15, [2, 1]),
          ex('hammer_strength_abs', 2, 10, 15, [2, 1])
        ],
        D5: [
          ex('egym_pulldown', 3, 8, 12, [2, 1, 1]),
          ex('iso_lateral_row', 2, 8, 12, [2, 1]),
          ex('cable_lateral_usual', 4, 10, 15, [2, 1, 1, 1]),
          ex('rear_delt_usual', 2, 8, 12, [2, 1]),
          ex('egym_biceps_curl', 2, 8, 12, [2, 1], ['preacher_curl_new_variant']),
          ex('overhead_cable_triceps', 2, 10, 15, [2, 1])
        ]
      },
      overrides: {},   // per-exercise edits: { inc, rest, setup, name, basis }
      custom: {},      // exercises you add yourself
      // One-off starting loads from the handover where they differ from the rule engine.
      nextLoads: {
        egym_chest_press: { loads: [75, 75], asOf: '2026-11-06', note: 'Starting point from your handover: about 75 kg, then adjust set 2 to how it feels.' }
      }
    };
  }

  // ---------- small helpers ----------
  const r1 = (x) => Math.round(x * 10) / 10;
  function fmtW(w) {
    if (w == null || isNaN(w)) return '—';
    const v = r1(w);
    return (Number.isInteger(v) ? String(v) : v.toFixed(1));
  }
  function fmtReps(r) { return r == null ? '—' : (Number.isInteger(r) ? String(r) : String(r1(r))); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s, long) { const d = parseISO(s); return (long ? DOWL : DOW)[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function relDay(s, today) {
    const n = daysBetween(s, today || isoDate());
    if (n === 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n > 1) return n + ' days ago';
    if (n === -1) return 'tomorrow';
    return 'in ' + (-n) + ' days';
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- program days ----------
  function dayOrder(program) { return (program && program.order && program.order.length) ? program.order.slice() : Object.keys((program && program.days) || {}); }
  function dayNumber(kind, program) { const i = dayOrder(program).indexOf(kind); return i >= 0 ? i + 1 : null; }
  function dayTitle(kind, program, short) {
    if (kind === 'extra') return 'Extra session';
    const n = dayNumber(kind, program);
    const inf = program && program.dayInfo && program.dayInfo[kind];
    if (n && inf) return short ? 'Day ' + n : 'Day ' + n + ' · ' + inf.name;
    return 'Workout ' + kind;
  }
  function dayTone(kind, program) { const inf = program && program.dayInfo && program.dayInfo[kind]; return inf ? inf.tone : (kind === 'B' ? 'lower' : 'upper'); }
  function dayMark(kind, program) { const n = dayNumber(kind, program); if (n) return String(n); if (kind === 'extra') return '+'; return kind === 'A' || kind === 'B' ? kind : 'P'; }

  function variantInfo(id, program) {
    const p = program || {};
    const base = VARIANTS[id] || (p.custom || {})[id] || { name: id.replace(/_/g, ' '), basis: 'kg', inc: 2.5, rest: 105, muscle: '', setup: '' };
    const ov = (p.overrides || {})[id] || {};
    return Object.assign({ id }, base, ov);
  }
  function allVariantIds(program) {
    return Object.keys(VARIANTS).concat(Object.keys((program && program.custom) || {}));
  }

  // ---------- history queries ----------
  function liveSessions(sessions) {
    return (sessions || []).filter((s) => s && !s.deleted)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.finishedAt || a.startedAt || 0) - (b.finishedAt || b.startedAt || 0)));
  }
  function loggedSets(e) { return (e.sets || []).filter((s) => s && s.r != null); }
  function countSets(session) { return (session.exercises || []).reduce((n, e) => n + loggedSets(e).length, 0); }

  /** Every session in which this exercise has logged sets, oldest first. */
  function exposures(sessions, vid) {
    const out = [];
    liveSessions(sessions).forEach((s) => {
      const sets = [];
      (s.exercises || []).forEach((e) => { if (e.v === vid) loggedSets(e).forEach((x) => sets.push(x)); });
      if (sets.length) out.push({ date: s.date, kind: s.kind, sessionId: s.id, imported: !!s.imported, sets });
    });
    return out;
  }

  /** Latest regular (non-extra) workout: a day of the current program, or an older A/B session. */
  function lastRegular(sessions, program) {
    const order = dayOrder(program || defaultProgram());
    const regs = liveSessions(sessions).filter((s) => order.indexOf(s.kind) >= 0 || s.kind === 'A' || s.kind === 'B');
    return regs[regs.length - 1] || null;
  }
  /** Next day in the rotation: the day after the last one done; Day 1 when coming from another program. */
  function suggestNext(sessions, program) {
    const order = dayOrder(program || defaultProgram());
    const done = liveSessions(sessions).filter((s) => order.indexOf(s.kind) >= 0);
    const l = done[done.length - 1];
    if (!l) return order[0];
    return order[(order.indexOf(l.kind) + 1) % order.length];
  }

  // ---------- progression engine ----------
  // Reps credited for progression: fractional reps are not rounded up, and an easier target RIR
  // (or a reported actual RIR above target) adds at most 2 reps of "room".
  function effReps(set, targetRir) {
    let r = Math.floor(set.r);
    let bonus = 0;
    if (targetRir != null) {
      if (set.rir != null) bonus = Math.max(0, Math.min(2, set.rir - targetRir));
      else if (set.trir != null) bonus = Math.max(0, Math.min(2, set.trir - targetRir));
    }
    return r + bonus;
  }
  function backoffAmount(w, inc) { return Math.max(inc, Math.round((0.1 * w) / inc) * inc); }
  function lastString(sets) {
    if (!sets || !sets.length) return '';
    const ws = sets.map((s) => s.w);
    const same = ws.every((w) => w === ws[0]);
    if (same) return sets.map((s) => fmtReps(s.r)).join(' / ') + ' × ' + fmtW(ws[0]);
    return sets.map((s) => fmtReps(s.r) + '×' + fmtW(s.w)).join(', ');
  }

  /**
   * Recommend loads for each planned set.
   * plan: {sets, lo, hi, rir:[...]}. Returns {loads[], whys[], aims[], summary, trend, last}.
   * trend: 'up' | 'hold' | 'down' | 'new' | 'plan'
   */
  function recommend(vid, plan, sessions, program) {
    const info = variantInfo(vid, program);
    const inc = Number(info.inc) || 2.5;
    const n = Math.max(1, plan.sets | 0);
    const tr = (i) => (plan.rir && plan.rir.length ? plan.rir[Math.min(i, plan.rir.length - 1)] : null);
    const exps = exposures(sessions, vid);
    const last = exps[exps.length - 1] || null;
    const out = { loads: new Array(n).fill(null), whys: new Array(n).fill(''), aims: new Array(n).fill(null), summary: '', trend: 'new', last };

    const nl = program && program.nextLoads && program.nextLoads[vid];
    if (nl && nl.loads && nl.loads.length && (!last || last.imported)) {
      for (let i = 0; i < n; i++) out.loads[i] = nl.loads[Math.min(i, nl.loads.length - 1)];
      out.summary = nl.note || 'Planned starting weight.';
      out.trend = 'plan';
      return out;
    }
    if (!last) {
      out.summary = 'New exercise for the app: pick a comfortable weight. Next time it suggests one from what you log today.';
      return out;
    }
    const L = last.sets.filter((s) => s.w != null);
    if (!L.length) { out.summary = 'No weight logged last time: pick one.'; return out; }
    const top = Math.max.apply(null, L.map((s) => s.w));
    const firstN = L.slice(0, n);
    const allTop = L.length >= n && firstN.every((s, i) => s.w === top && effReps(s, tr(i)) >= plan.hi);

    if (allTop) {
      const next = r1(top + inc);
      const pct = Math.round((inc / top) * 100);
      if (inc / top > 0.25) {
        for (let i = 0; i < n; i++) out.loads[i] = i === 0 ? next : top;
        out.whys[0] = 'Trial set: ' + fmtW(next) + ' is +' + pct + '%';
        out.summary = 'All ' + n + ' sets reached ' + plan.hi + '+ at ' + fmtW(top) + '. The next step (' + fmtW(next) + ') is a big jump (+' + pct + '%), so try it on set 1 only.';
      } else {
        for (let i = 0; i < n; i++) { out.loads[i] = next; out.aims[i] = plan.lo; }
        out.summary = 'All ' + n + ' sets reached ' + plan.hi + '+ at ' + fmtW(top) + ' last time, so go up ' + fmtW(inc) + ' kg.';
      }
      out.trend = 'up';
      return out;
    }

    // A heavier weight that fell below the range blocks moving lighter sets up toward it.
    const topFail = L.some((s, i) => s.w === top && effReps(s, tr(i)) < plan.lo);
    // ...and if that heavier weight came after a lighter set, it was a trial that did not work yet.
    const trialIdx = L.findIndex((s, j) => s.w === top && effReps(s, tr(j)) < plan.lo && L.slice(0, j).some((p) => p.w < top));
    const lighter = [];
    let atTop = 0;
    for (let i = 0; i < n; i++) {
      const padded = !L[i];
      const s = L[i] || L[L.length - 1];
      const e = effReps(s, tr(i));
      let w = s.w;
      if (!padded && Math.floor(s.r) >= plan.hi) atTop++;
      if (e < plan.lo) {
        const nw = r1(w - backoffAmount(w, inc));
        if (nw > 0) { w = nw; lighter.push(i); out.whys[i] = (padded ? 'Last set' : 'Set ' + (i + 1)) + ' was ' + fmtReps(s.r) + ' reps at ' + fmtW(s.w) + ', so lighter'; }
      } else if (e >= plan.hi && w < top && !topFail) {
        w = r1(Math.min(top, w + inc));
        out.whys[i] = 'Hit ' + fmtReps(s.r) + ' at ' + fmtW(s.w) + ', so move up';
      } else if (!padded) {
        const aim = Math.min(plan.hi, Math.max(plan.lo, Math.floor(s.r) + 1));
        out.aims[i] = aim;
      }
      out.loads[i] = w;
    }
    const lastTxt = lastString(L);
    if (trialIdx >= 0) {
      out.trend = 'hold';
      out.summary = 'Your ' + fmtW(top) + ' try gave ' + fmtReps(L[trialIdx].r) + ' reps (below ' + plan.lo + '), so stay at ' + fmtW(Math.max.apply(null, out.loads)) + ' and build reps (' + lastTxt + ').';
    } else if (lighter[0] === 0) {
      out.trend = 'down';
      out.summary = 'Set 1 was below ' + plan.lo + ' reps last time (' + lastTxt + '), so start a bit lighter.';
    } else if (lighter.length) {
      out.trend = 'hold';
      out.summary = 'Keep ' + fmtW(top) + ' and add reps. Lighter set ' + lighter.map((i) => i + 1).join(' & ') + ' because it dropped below ' + plan.lo + ' (' + lastTxt + ').';
    } else if (atTop > 0) {
      out.trend = 'hold';
      out.summary = atTop + ' of ' + n + ' sets reached ' + plan.hi + '+ (' + lastTxt + '). The weight goes up once every set gets there.';
    } else {
      out.trend = 'hold';
      out.summary = 'Same weight, beat your reps (' + lastTxt + '). Up once every set reaches ' + plan.hi + '.';
    }
    if (L.length < n) out.summary += ' Last time had only ' + L.length + ' set' + (L.length > 1 ? 's' : '') + '.';
    return out;
  }

  /**
   * After a set is logged during a workout, adjust the remaining sets of that exercise.
   * ex: workout exercise {sets, lo, hi, recs:[{w, why, aim}], logged:[...]}. i = index of the set just logged.
   */
  function adjustAfterSet(ex, i, set, info) {
    const inc = Number(info.inc) || 2.5;
    const rec = ex.recs[i] && ex.recs[i].w;
    if (set.w == null) return;
    // 1) you chose a different weight: the rest of the sets follow your choice
    if (rec != null && set.w !== rec) {
      const delta = r1(set.w - rec);
      for (let j = i + 1; j < ex.recs.length; j++) {
        if (ex.recs[j].w != null) { ex.recs[j].w = r1(Math.max(0, ex.recs[j].w + delta)); ex.recs[j].why = 'Following your ' + fmtW(set.w) + ' on set ' + (i + 1); ex.recs[j].aim = null; }
      }
    } else if (rec == null) {
      for (let j = i + 1; j < ex.recs.length; j++) { if (ex.recs[j].w == null) { ex.recs[j].w = set.w; ex.recs[j].why = 'Same as set ' + (i + 1); } }
    }
    // 2) the very next set reacts to how this one went
    const j = i + 1;
    if (j >= ex.recs.length) return;
    const r = Math.floor(set.r);
    if (r < ex.lo) {
      const nw = r1(set.w - backoffAmount(set.w, inc));
      if (nw > 0 && (ex.recs[j].w == null || ex.recs[j].w > nw)) {
        ex.recs[j].w = nw; ex.recs[j].aim = null;
        ex.recs[j].why = 'Set ' + (i + 1) + ' was ' + fmtReps(set.r) + ' (below ' + ex.lo + '), so lighter';
      }
    } else if (r >= ex.hi + 3 && (set.rir == null || set.rir >= 2)) {
      const nw = r1(set.w + inc);
      if (ex.recs[j].w == null || ex.recs[j].w < nw) {
        ex.recs[j].w = nw; ex.recs[j].aim = ex.lo;
        ex.recs[j].why = fmtReps(set.r) + ' reps is well over ' + ex.hi + ', so a bit heavier';
      }
    }
  }

  // ---------- building a workout ----------
  function uid() { return Math.random().toString(36).slice(2, 8); }

  function makeExercise(p, sessions, program) {
    const plan = { sets: p.sets, lo: p.lo, hi: p.hi, rir: p.rir };
    const rec = recommend(p.v, plan, sessions, program);
    const info = variantInfo(p.v, program);
    return {
      key: uid(), v: p.v, planned: p.v, sets: p.sets, lo: p.lo, hi: p.hi, rir: p.rir.slice(), alts: (p.alts || []).slice(), rest: info.rest,
      recs: rec.loads.map((w, i) => ({ w, why: rec.whys[i], aim: rec.aims[i] })),
      summary: rec.summary, trend: rec.trend, lastTxt: rec.last ? lastString(rec.last.sets) : '', lastDate: rec.last ? rec.last.date : null,
      lastSets: rec.last ? rec.last.sets.map((s) => ({ r: s.r, w: s.w })) : [],
      logged: [], status: 'pending'
    };
  }

  function buildWorkout(kind, program, sessions, date) {
    const day = (program.days[kind] || []);
    date = date || isoDate();
    return {
      id: date + '-' + kind + '-' + uid(), kind, date, startedAt: Date.now(), programVersion: program.version,
      exercises: day.map((p) => makeExercise(p, sessions, program)),
      cur: 0, restEndsAt: null, restTotal: 0
    };
  }

  function refreshRecs(exItem, sessions, program) {
    const fresh = makeExercise({ v: exItem.v, sets: exItem.sets, lo: exItem.lo, hi: exItem.hi, rir: exItem.rir, alts: exItem.alts }, sessions, program);
    exItem.recs = fresh.recs; exItem.rest = fresh.rest; exItem.summary = fresh.summary; exItem.trend = fresh.trend; exItem.lastTxt = fresh.lastTxt; exItem.lastDate = fresh.lastDate; exItem.lastSets = fresh.lastSets;
  }

  function plannedCount(w) { return w.exercises.reduce((n, e) => n + (e.status === 'skipped' ? 0 : e.sets), 0); }
  function doneCount(w) { return w.exercises.reduce((n, e) => n + e.logged.length, 0); }
  function isExDone(e) { return e.status === 'skipped' || e.status === 'ended' || e.logged.length >= e.sets; }
  function nextPendingIndex(w, from) {
    const n = w.exercises.length;
    for (let k = 0; k < n; k++) { const i = (from + k) % n; if (!isExDone(w.exercises[i])) return i; }
    return -1;
  }

  /** Turn a finished workout into a stored session record. Nothing is invented: only logged sets are kept. */
  function finishWorkout(w, program) {
    const exercises = w.exercises.map((e) => ({
      v: e.v, swappedFrom: e.v !== e.planned ? e.planned : undefined,
      plan: { sets: e.sets, lo: e.lo, hi: e.hi, rir: e.rir },
      sets: e.logged.map((s) => ({ r: s.r, w: s.w, rec: s.rec, rir: s.rir, trir: s.trir, t: s.t })),
      status: e.status === 'skipped' ? 'skipped' : e.logged.length >= e.sets ? 'done' : e.logged.length ? 'partial' : 'not done'
    }));
    const planned = plannedCount(w);
    const done = doneCount(w);
    const missing = [];
    w.exercises.forEach((e) => {
      if (e.status === 'skipped') missing.push({ v: e.v, sets: e.sets, why: 'skipped' });
      else if (e.logged.length < e.sets) missing.push({ v: e.v, sets: e.sets - e.logged.length, why: e.logged.length ? 'fewer sets' : 'not done' });
    });
    return {
      id: w.id, kind: w.kind, label: dayTitle(w.kind, program), date: w.date,
      startedAt: w.startedAt, finishedAt: Date.now(), programVersion: w.programVersion,
      status: missing.length ? 'partial' : 'complete', plannedSets: planned, doneSets: done, missing,
      source: 'app', exercises
    };
  }

  /** Whole-session summary used on History cards. */
  function sessionSummary(s, program) {
    const n = countSets(s);
    const names = (s.exercises || []).filter((e) => loggedSets(e).length).map((e) => variantInfo(e.v, program).name);
    return { sets: n, names };
  }

  function bestInHistory(sessions, vid) {
    let best = null;
    exposures(sessions, vid).forEach((x) => x.sets.forEach((s) => {
      if (s.w == null) return;
      if (!best || s.w > best.w || (s.w === best.w && s.r > best.r)) best = { w: s.w, r: s.r, date: x.date };
    }));
    return best;
  }

  function estimateMinutes(w) {
    let sec = 0;
    w.exercises.forEach((e) => { if (e.status !== 'skipped') sec += e.sets * (45 + (e.rest || 105)) + 60; });
    return Math.round(sec / 60 / 5) * 5;
  }

  const api = {
    VARIANTS, COMPOUND_REST, defaultProgram, dayOrder, dayNumber, dayTitle, dayTone, dayMark, variantInfo, allVariantIds, r1, fmtW, fmtReps, isoDate, parseISO, daysBetween,
    fmtDate, relDay, clone, liveSessions, loggedSets, countSets, exposures, lastRegular, suggestNext, effReps,
    backoffAmount, lastString, recommend, adjustAfterSet, buildWorkout, makeExercise, refreshRecs, plannedCount, doneCount,
    isExDone, nextPendingIndex, finishWorkout, sessionSummary, bestInHistory, estimateMinutes, uid
  };
  root.GymLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
