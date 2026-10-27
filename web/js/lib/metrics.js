// トレーニング・ヘルスデータから指標を計算する純粋関数群。DOM には触れない。
import { addDays, diffDays, startOfWeek, rangeKeys } from './dates.js';
import { partCategory, normalizeExerciseName } from './parse.js';

/* ---------- 1RM・ボリューム ---------- */

export const REP_CAP_1RM = 12;

/** Epley 式による推定 1RM。回数が多すぎると誤差が大きいので 12 回までを考慮する。 */
export function est1RM(w, r) {
  if (!(w > 0) || !(r > 0)) return 0;
  return w * (1 + Math.min(r, REP_CAP_1RM) / 30);
}

export function exerciseStats(sets) {
  let volume = 0;
  let maxWeight = 0;
  let maxReps = 0;
  let totalReps = 0;
  let best1RM = 0;
  let workSets = 0;
  let weighted = false;
  sets.forEach((s) => {
    const w = s.w || 0;
    const r = s.r || 0;
    if (!w && !r) return;
    workSets += 1;
    if (w) weighted = true;
    volume += w * r;
    totalReps += r;
    if (r > maxReps) maxReps = r;
    if (w > maxWeight && r > 0) maxWeight = w;
    const rm = est1RM(w, r);
    if (rm > best1RM) best1RM = rm;
  });
  return { workSets, volume, maxWeight, maxReps, totalReps, best1RM, weighted };
}

export function dayStats(day) {
  let sets = 0;
  let volume = 0;
  let totalReps = 0;
  const parts = [];
  for (const ex of day?.exercises || []) {
    const st = exerciseStats(ex.sets);
    sets += st.workSets;
    volume += st.volume;
    totalReps += st.totalReps;
    const p = partCategory(ex.part || day.part);
    if (!parts.includes(p)) parts.push(p);
  }
  return { exercises: day?.exercises?.length || 0, sets, volume, totalReps, parts };
}

/* ---------- 種目インデックスと自己ベスト ---------- */

export function exerciseKey(name) {
  return normalizeExerciseName(name).normalize('NFKC').toLowerCase().replace(/[\s・･·]/g, '');
}

/**
 * 全期間のトレーニングから種目別のセッション履歴を作る。
 * 戻り値: Map<key, { key, name, part, sessions: [{ date, sets, memo, ...stats, pr }] }>（sessions は日付昇順）
 */
export function buildExerciseIndex(training) {
  const index = new Map();
  const dates = Object.keys(training).sort();
  for (const date of dates) {
    const day = training[date];
    for (const ex of day.exercises) {
      if (!ex.name || ex.name === '種目不明') continue;
      const key = exerciseKey(ex.name);
      let entry = index.get(key);
      if (!entry) {
        entry = { key, name: ex.name, part: partCategory(ex.part || day.part), sessions: [] };
        index.set(key, entry);
      }
      entry.name = ex.name; // 最新の表記を採用
      entry.part = partCategory(ex.part || day.part);
      let session = entry.sessions[entry.sessions.length - 1];
      if (!session || session.date !== date) {
        session = { date, sets: [], memo: '' };
        entry.sessions.push(session);
      }
      session.sets = session.sets.concat(ex.sets);
      if (ex.memo) session.memo = session.memo ? `${session.memo}\n${ex.memo}` : ex.memo;
    }
  }
  for (const entry of index.values()) {
    let prevRm = 0;
    let prevW = 0;
    let prevReps = 0;
    entry.sessions.forEach((s, i) => {
      Object.assign(s, exerciseStats(s.sets));
      s.pr = {
        rm: i > 0 && prevRm > 0 && s.best1RM > prevRm + 1e-9,
        weight: i > 0 && prevW > 0 && s.maxWeight > prevW + 1e-9,
        reps: i > 0 && !s.weighted && prevReps > 0 && s.maxReps > prevReps,
      };
      prevRm = Math.max(prevRm, s.best1RM);
      prevW = Math.max(prevW, s.maxWeight);
      prevReps = Math.max(prevReps, s.maxReps);
    });
  }
  return index;
}

export function sessionOn(index, name, date) {
  return index.get(exerciseKey(name))?.sessions.find((s) => s.date === date) || null;
}

/** date より前の直近セッション（「前回」表示用） */
export function previousSession(index, name, beforeDate) {
  const entry = index.get(exerciseKey(name));
  if (!entry) return null;
  for (let i = entry.sessions.length - 1; i >= 0; i--) {
    if (entry.sessions[i].date < beforeDate) return entry.sessions[i];
  }
  return null;
}

/** date より前の自己ベスト（記録中のリアルタイム PR 判定用） */
export function bestBefore(index, name, beforeDate) {
  const entry = index.get(exerciseKey(name));
  const best = { rm: 0, weight: 0, reps: 0, weighted: false, sessions: 0 };
  if (!entry) return best;
  for (const s of entry.sessions) {
    if (s.date >= beforeDate) break;
    best.sessions += 1;
    best.rm = Math.max(best.rm, s.best1RM);
    best.weight = Math.max(best.weight, s.maxWeight);
    best.reps = Math.max(best.reps, s.maxReps);
    best.weighted = best.weighted || s.weighted;
  }
  return best;
}

export function personalRecords(entry) {
  const pr = { rm: null, weight: null, reps: null, volume: null };
  for (const s of entry.sessions) {
    if (s.best1RM > (pr.rm?.value ?? 0)) pr.rm = { value: s.best1RM, date: s.date };
    if (s.maxWeight > (pr.weight?.value ?? 0)) pr.weight = { value: s.maxWeight, date: s.date };
    if (s.maxReps > (pr.reps?.value ?? 0)) pr.reps = { value: s.maxReps, date: s.date };
    if (s.volume > (pr.volume?.value ?? 0)) pr.volume = { value: s.volume, date: s.date };
  }
  return pr;
}

/** 種目名サジェスト。部位が一致する種目を優先し、使用回数の多い順。 */
export function suggestExercises(index, query, part, limit = 6) {
  const q = exerciseKey(query || '');
  const list = [];
  for (const e of index.values()) {
    const k = e.key;
    if (q && (!k.includes(q) || k === q)) continue;
    list.push({ name: e.name, part: e.part, count: e.sessions.length, last: e.sessions[e.sessions.length - 1].date });
  }
  const cat = part ? partCategory(part) : '';
  list.sort((a, b) => {
    const pa = cat && a.part === cat ? 0 : 1;
    const pb = cat && b.part === cat ? 0 : 1;
    return pa - pb || b.count - a.count || (a.last < b.last ? 1 : -1);
  });
  return list.slice(0, limit);
}

/* ---------- 期間集計 ---------- */

export function trainingDates(training) {
  return Object.keys(training)
    .filter((d) => training[d].exercises.length > 0)
    .sort();
}

export function daysInRange(training, from, to) {
  return trainingDates(training).filter((d) => d >= from && d <= to);
}

/** 週ごと（月曜始まり）× 部位ごとのセット数 */
export function weeklySetsByPart(training, from, to) {
  const weeks = [];
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) {
    const parts = {};
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const day = training[addDays(w, i)];
      if (!day) continue;
      for (const ex of day.exercises) {
        const n = exerciseStats(ex.sets).workSets;
        if (!n) continue;
        const p = partCategory(ex.part || day.part);
        parts[p] = (parts[p] || 0) + n;
        total += n;
      }
    }
    weeks.push({ start: w, parts, total });
  }
  return weeks;
}

export function periodTotals(training, from, to) {
  let days = 0;
  let sets = 0;
  let volume = 0;
  for (const d of daysInRange(training, from, to)) {
    const st = dayStats(training[d]);
    days += 1;
    sets += st.sets;
    volume += st.volume;
  }
  return { days, sets, volume };
}

/* ---------- ヘルス ---------- */

export const KCAL = { p: 4, f: 9, c: 4 };

/**
 * 1 日分のヘルス記録を表示用に整える。
 * 摂取が未記録の日は収支を出さない（0 kcal 摂取＝巨大な赤字、という誤表示を防ぐ）。
 */
export function healthView(rec, key, today) {
  const r = rec || {};
  const p = r.protein || 0;
  const f = r.fat || 0;
  const c = r.carb || 0;
  const macroKcal = p * KCAL.p + f * KCAL.f + c * KCAL.c;
  const hasMacros = macroKcal > 0;
  const hasIntake = (r.intake || 0) > 0 || hasMacros;
  const intake = (r.intake || 0) > 0 ? r.intake : hasMacros ? Math.round(macroKcal) : null;
  const burned = (r.burned || 0) > 0 ? r.burned : null;
  return {
    hasAny: !!rec && (r.sleepMin != null || hasIntake || burned != null),
    sleepMin: r.sleepMin ?? null,
    intake,
    burned,
    hasIntake,
    balance: hasIntake && burned != null ? Math.round(intake - burned) : null,
    protein: hasMacros ? p : null,
    fat: hasMacros ? f : null,
    carb: hasMacros ? c : null,
    macroKcal: hasMacros ? Math.round(macroKcal) : null,
    shares: hasMacros ? { p: (p * KCAL.p) / macroKcal, f: (f * KCAL.f) / macroKcal, c: (c * KCAL.c) / macroKcal } : null,
    provisional: key === today,
  };
}

/** 日付→healthView の配列（range） */
export function healthSeries(health, from, to, today) {
  return rangeKeys(from, to).map((k) => ({ date: k, ...healthView(health[k], k, today) }));
}

/* ---------- 汎用統計 ---------- */

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : null);

export function pctDelta(cur, prev) {
  if (prev == null || prev === 0 || cur == null) return null;
  return (cur - prev) / prev;
}

/** 分析タブの期間指定 → { from, to, prevFrom, prevTo } */
export function periodRange(period, today, earliest) {
  const days = { '1M': 30, '3M': 90, '6M': 180 }[period];
  if (!days) {
    const from = earliest && earliest < today ? earliest : addDays(today, -30);
    const span = diffDays(today, from) + 1;
    return { from, to: today, prevFrom: addDays(from, -span), prevTo: addDays(from, -1), days: span };
  }
  const from = addDays(today, -(days - 1));
  return { from, to: today, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days };
}

/**
 * 睡眠とトレーニングパフォーマンスの関係。
 * パフォーマンス = その日の各種目の推定 1RM ÷ その種目の期間内平均（部位・種目差を打ち消す）。
 * 睡眠は「その日の朝までの睡眠」（元アプリの定義と同じ）。
 */
export function sleepVsPerformance(training, health, index, from, to) {
  const buckets = [
    { id: 'short', label: '6時間未満', test: (m) => m < 360, values: [] },
    { id: 'mid', label: '6〜7時間', test: (m) => m >= 360 && m < 420, values: [] },
    { id: 'long', label: '7時間以上', test: (m) => m >= 420, values: [] },
  ];
  const means = new Map();
  for (const e of index.values()) {
    const vals = e.sessions.filter((s) => s.date >= from && s.date <= to && s.best1RM > 0).map((s) => s.best1RM);
    if (vals.length >= 3) means.set(e.key, mean(vals));
  }
  let samples = 0;
  for (const d of daysInRange(training, from, to)) {
    const sleep = health[d]?.sleepMin;
    if (!sleep) continue;
    const ratios = [];
    for (const ex of training[d].exercises) {
      const k = means.get(exerciseKey(ex.name));
      if (!k) continue;
      const rm = exerciseStats(ex.sets).best1RM;
      if (rm > 0) ratios.push(rm / k);
    }
    if (!ratios.length) continue;
    const perf = mean(ratios);
    const b = buckets.find((x) => x.test(sleep));
    b.values.push(perf);
    samples += 1;
  }
  return {
    samples,
    buckets: buckets.map((b) => ({ id: b.id, label: b.label, n: b.values.length, perf: b.values.length ? mean(b.values) : null })),
  };
}
