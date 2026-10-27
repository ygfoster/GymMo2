import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../web/js/lib/dates.js';
import * as P from '../web/js/lib/parse.js';
import * as M from '../web/js/lib/metrics.js';

/* ---------- dates ---------- */
test('parseSheetDate: シート由来の各種表記を YYYY-MM-DD に揃える', () => {
  assert.equal(D.parseSheetDate('2026/10/8'), '2026-10-08');
  assert.equal(D.parseSheetDate('2026/10/08'), '2026-10-08');
  assert.equal(D.parseSheetDate('2026-10-08'), '2026-10-08');
  assert.equal(D.parseSheetDate(new Date(2026, 9, 8)), '2026-10-08');
  assert.equal(D.parseSheetDate(''), null);
  assert.equal(D.parseSheetDate('abc'), null);
  assert.equal(D.parseSheetDate('2026/13/40'), null);
});

test('日付演算: 月またぎ・週の開始（月曜）', () => {
  assert.equal(D.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(D.startOfWeek('2026-10-22'), '2026-10-19'); // 木 → 月
  assert.equal(D.startOfWeek('2026-10-25'), '2026-10-19'); // 日 → 月
  assert.equal(D.startOfWeek('2026-10-19'), '2026-10-19');
  assert.equal(D.diffDays('2026-10-22', '2026-10-01'), 21);
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.weekKeys('2026-10-22').length, 7);
});

test('monthMatrix: 月曜始まりで 7 の倍数', () => {
  const cells = D.monthMatrix(2026, 9); // 2026年10月: 1日は木曜
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].key, '2026-09-28');
  assert.equal(cells.find((c) => c.inMonth).key, '2026-10-01');
  assert.equal(cells.filter((c) => c.inMonth).length, 31);
});

/* ---------- parse ---------- */
test('parseSets: 実データの書式を読める', () => {
  assert.deepEqual(P.parseSets('1セット目: 50kg × 11回\n2セット目: 40kg × 17回'), [
    { w: 50, r: 11 },
    { w: 40, r: 17 },
  ]);
  assert.deepEqual(P.parseSets('1セット目: - × 15回'), [{ w: null, r: 15 }]);
  assert.deepEqual(P.parseSets('4セット目: 22.5kg × -'), [{ w: 22.5, r: null }]);
  assert.deepEqual(P.parseSets('1セット目: 60kg ﾗ 8回'), [{ w: 60, r: 8 }]);
  assert.deepEqual(P.parseSets(''), []);
  assert.deepEqual(P.parseSets('なんかメモ'), []);
});

test('formatSets: 元アプリと同じ書式で書き出す（空セットは詰めて連番）', () => {
  const text = P.formatSets([{ w: 50, r: 11 }, { w: null, r: null }, { w: null, r: 9 }, { w: 22.5, r: null }]);
  assert.equal(text, '1セット目: 50kg × 11回\n2セット目: - × 9回\n3セット目: 22.5kg × -');
  assert.deepEqual(P.parseSets(text), [{ w: 50, r: 11 }, { w: null, r: 9 }, { w: 22.5, r: null }]);
});

test('parseSleep / parseNumber', () => {
  assert.equal(P.parseSleep('6時間32分'), 392);
  assert.equal(P.parseSleep('7時間'), 420);
  assert.equal(P.parseSleep('45分'), 45);
  assert.equal(P.parseSleep('記録なし'), null);
  assert.equal(P.parseSleep(''), null);
  assert.equal(P.formatSleep(392), '6時間32分');
  assert.equal(P.formatSleep(420), '7時間');
  assert.equal(P.parseNumber('105 g'), 105);
  assert.equal(P.parseNumber('+617 kcal'), 617);
  assert.equal(P.parseNumber('-1319 kcal'), -1319);
  assert.equal(P.parseNumber('2,378'), 2378);
  assert.equal(P.parseNumber('記録なし'), null);
  assert.equal(P.parseNumber(0), 0);
});

test('rowsToTraining: 日付ごとにまとめ、足→脚、表記ゆれの日付を吸収', () => {
  const t = P.rowsToTraining([
    { date: '2026/10/08', part: '背中', exercise: 'チンニング', details: '1セット目: - × 15回', memo: '' },
    { date: '2026/10/8', part: '背中', exercise: 'ラットプル', details: '1セット目: 50kg × 11回', memo: 'メモ' },
    { date: '2026/10/09', part: '足', exercise: 'スクワット', details: '1セット目: 100kg × 5回', memo: '' },
  ]);
  assert.deepEqual(Object.keys(t), ['2026-10-08', '2026-10-09']);
  assert.equal(t['2026-10-08'].exercises.length, 2);
  assert.equal(t['2026-10-08'].part, '背中');
  assert.equal(t['2026-10-09'].part, '脚');
  assert.equal(t['2026-10-08'].exercises[1].memo, 'メモ');
});

test('trainingToRows: 空の種目は捨て、日付は YYYY/MM/DD', () => {
  const rows = P.trainingToRows({
    date: '2026-10-08',
    part: '胸',
    exercises: [
      { name: 'ベンチプレス', sets: [{ w: 75, r: 6 }], memo: '' },
      { name: '', sets: [{ w: null, r: null }], memo: '' },
      { name: '', sets: [{ w: 10, r: 10 }], memo: '' },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026/10/08');
  assert.equal(rows[1].exercise, '種目不明');
});

test('normalizeHealthRow / rowsToHealth: 実データの行', () => {
  const h = P.rowsToHealth([
    { date: '2026/10/1', sleep: '記録なし', protein: '0 g', fat: '0 g', carb: '0 g', intake: '0', burned: '3306' },
    { date: '2026/10/2', sleep: '6時間32分', protein: '105 g', fat: '30 g', carb: '229 g', intake: '1537', burned: '2856' },
  ]);
  assert.equal(h['2026-10-01'].sleepMin, null);
  assert.equal(h['2026-10-01'].burned, 3306);
  assert.equal(h['2026-10-02'].sleepMin, 392);
  assert.equal(h['2026-10-02'].protein, 105);
});

test('mergeHealth: 意味のある値だけで上書き', () => {
  const a = { date: '2026-10-22', sleepMin: 368, protein: 0, fat: 0, carb: 0, intake: 0, burned: 630 };
  const b = { date: '2026-10-22', sleepMin: null, protein: 50, fat: 10, carb: 80, intake: 700, burned: 900 };
  const m = P.mergeHealth(a, b);
  assert.equal(m.sleepMin, 368);
  assert.equal(m.protein, 50);
  assert.equal(m.burned, 900);
});

/* ---------- metrics ---------- */
test('est1RM: Epley、12 回で頭打ち', () => {
  assert.equal(M.est1RM(100, 0), 0);
  assert.equal(M.est1RM(0, 10), 0);
  assert.ok(Math.abs(M.est1RM(75, 6) - 90) < 1e-9);
  assert.equal(M.est1RM(40, 17), M.est1RM(40, 12));
});

test('exerciseStats: 自重種目は volume 0、reps は集計', () => {
  const st = M.exerciseStats([{ w: null, r: 15 }, { w: null, r: 9 }]);
  assert.equal(st.volume, 0);
  assert.equal(st.totalReps, 24);
  assert.equal(st.maxReps, 15);
  assert.equal(st.weighted, false);
  const st2 = M.exerciseStats([{ w: 22.5, r: 10 }, { w: 22.5, r: null }]);
  assert.equal(st2.volume, 225);
  assert.equal(st2.workSets, 2);
});

const training = P.rowsToTraining([
  { date: '2026/10/02', part: '胸', exercise: 'ベンチプレス', details: '1セット目: 75kg × 6回\n2セット目: 75kg × 5回', memo: '' },
  { date: '2026/10/11', part: '胸', exercise: 'ベンチプレス', details: '1セット目: 80kg × 4回\n2セット目: 80kg × 3回', memo: '' },
  { date: '2026/10/12', part: '胸', exercise: 'ベンチプレス', details: '1セット目: 80kg × 4回', memo: '' },
  { date: '2026/10/20', part: '胸', exercise: 'チンニング', details: '1セット目: - × 10回', memo: '' },
  { date: '2026/10/21', part: '背中', exercise: 'チンニング', details: '1セット目: - × 13回', memo: '' },
]);

test('buildExerciseIndex: PR 判定（初回は PR にしない）', () => {
  const idx = M.buildExerciseIndex(training);
  const bench = idx.get(M.exerciseKey('ベンチプレス'));
  assert.equal(bench.sessions.length, 3);
  assert.deepEqual(bench.sessions[0].pr, { rm: false, weight: false, reps: false });
  // 75kg×6=90 → 80kg×4=90.67（わずかに更新）、最高重量も更新
  assert.equal(bench.sessions[1].pr.rm, true);
  assert.equal(bench.sessions[1].pr.weight, true);
  // 80kg×4 を再度: 更新なし
  assert.equal(bench.sessions[2].pr.rm, false);
  const chin = idx.get(M.exerciseKey('チンニング'));
  assert.equal(chin.sessions[1].pr.reps, true); // 10 → 13 回
});

test('previousSession / bestBefore', () => {
  const idx = M.buildExerciseIndex(training);
  assert.equal(M.previousSession(idx, 'ベンチプレス', '2026-10-12').date, '2026-10-11');
  assert.equal(M.previousSession(idx, 'ベンチプレス', '2026-10-02'), null);
  const b = M.bestBefore(idx, 'ベンチプレス', '2026-10-12');
  assert.equal(b.weight, 80);
  assert.equal(b.sessions, 2);
  assert.equal(M.bestBefore(idx, '存在しない', '2026-10-12').sessions, 0);
});

test('exerciseKey: 全角/半角・大文字小文字・空白の揺れを吸収', () => {
  assert.equal(M.exerciseKey('Ez バーカール'), M.exerciseKey('EZバーカール'));
  assert.equal(M.exerciseKey('ＥＺバーカール'), M.exerciseKey('ezバーカール'));
});

test('suggestExercises: 部位一致を優先、完全一致は除外', () => {
  const idx = M.buildExerciseIndex(training);
  const s = M.suggestExercises(idx, 'ン', '背中');
  assert.ok(s.length >= 1);
  assert.equal(M.suggestExercises(idx, 'ベンチプレス', '胸').length, 0);
});

test('weeklySetsByPart', () => {
  const w = M.weeklySetsByPart(training, '2026-10-01', '2026-10-22');
  const wk = w.find((x) => x.start === '2026-10-19');
  assert.equal(wk.parts['胸'], 1);
  assert.equal(wk.parts['背中'], 1);
  assert.equal(wk.total, 2);
});

test('healthView: 摂取未記録の日は収支を出さない', () => {
  const none = M.healthView({ date: '2026-10-10', sleepMin: 284, protein: 0, fat: 0, carb: 0, intake: 0, burned: 4235 }, '2026-10-10', '2026-10-22');
  assert.equal(none.hasIntake, false);
  assert.equal(none.balance, null);
  assert.equal(none.burned, 4235);
  const ok = M.healthView({ date: '2026-10-02', sleepMin: 392, protein: 105, fat: 30, carb: 229, intake: 1537, burned: 2856 }, '2026-10-02', '2026-10-22');
  assert.equal(ok.balance, -1319);
  assert.ok(Math.abs(ok.shares.p + ok.shares.f + ok.shares.c - 1) < 1e-9);
  const p = M.healthView(undefined, '2026-10-05', '2026-10-22');
  assert.equal(p.hasAny, false);
});

test('periodRange: 期間と直前の同期間', () => {
  const r = M.periodRange('1M', '2026-10-22', '2026-01-01');
  assert.equal(r.to, '2026-10-22');
  assert.equal(r.from, '2026-09-23');
  assert.equal(r.prevTo, '2026-09-22');
  const all = M.periodRange('ALL', '2026-10-22', '2026-10-01');
  assert.equal(all.from, '2026-10-01');
});

test('sleepVsPerformance: 種目平均に対する比で睡眠区分ごとに集計', () => {
  const rows = [];
  const mk = (d, w) => rows.push({ date: d, part: '胸', exercise: 'ベンチプレス', details: `1セット目: ${w}kg × 5回`, memo: '' });
  mk('2026/10/01', 80); mk('2026/10/03', 80); mk('2026/10/05', 76); mk('2026/10/07', 84);
  const tr = P.rowsToTraining(rows);
  const idx = M.buildExerciseIndex(tr);
  const health = {
    '2026-10-01': { sleepMin: 450 }, '2026-10-03': { sleepMin: 450 },
    '2026-10-05': { sleepMin: 300 }, '2026-10-07': { sleepMin: 480 },
  };
  const r = M.sleepVsPerformance(tr, health, idx, '2026-10-01', '2026-10-31');
  assert.equal(r.samples, 4);
  const short = r.buckets.find((b) => b.id === 'short');
  const long = r.buckets.find((b) => b.id === 'long');
  assert.equal(short.n, 1);
  assert.equal(long.n, 3);
  assert.ok(short.perf < 1 && long.perf > short.perf);
});

/* ---------- Service Worker のプリキャッシュ一覧が実ファイルを網羅しているか ---------- */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

test('sw.js のプリキャッシュに js/css の全ファイルが含まれる', () => {
  const root = new URL('../web/', import.meta.url).pathname;
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = [...walk(join(root, 'js')), ...walk(join(root, 'css'))].map((p) => './' + relative(root, p));
  const missing = files.filter((f) => !sw.includes(`'${f}'`));
  assert.deepEqual(missing, []);
});

/* ---------- html テンプレート ---------- */
import { html, toString as htmlToString } from '../web/js/lib/html.js';

test('html``: 値は自動エスケープされ、真偽値は属性用に true/false になる', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const out = htmlToString(html`<div title="${evil}" aria-pressed="${true}" aria-checked="${false}">${evil}</div>`);
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('aria-pressed="true"'));
  assert.ok(out.includes('aria-checked="false"'));
  assert.ok(out.includes('&lt;img'));
});

test('html``: ネストした html と配列はそのまま埋め込まれ、null は空', () => {
  const out = htmlToString(html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}${null}${undefined}</ul>`);
  assert.equal(out, '<ul><li>1</li><li>2</li></ul>');
});

test('normalizeExerciseName: 末尾の「ロー」だけを「ロウ」に統一する', () => {
  assert.equal(P.normalizeExerciseName('プーリーロー'), 'プーリーロウ');
  assert.equal(P.normalizeExerciseName('プーリーロウ'), 'プーリーロウ');
  assert.equal(P.normalizeExerciseName(' スミスベントロー '), 'スミスベントロウ');
  assert.equal(P.normalizeExerciseName('ﾜﾝﾊﾝﾄﾞﾛｰ'), 'ﾜﾝﾊﾝﾄﾞロウ');
  assert.equal(P.normalizeExerciseName('ローイング'), 'ローイング'); // 末尾以外は変えない
  assert.equal(P.normalizeExerciseName('ロープエクステンション'), 'ロープエクステンション');
  assert.equal(P.normalizeExerciseName('ケーブルロープロー'), 'ケーブルロープロウ');
  assert.equal(P.normalizeExerciseName('ベンチプレス'), 'ベンチプレス');
  assert.equal(P.normalizeExerciseName(''), '');
});

test('ロー/ロウの表記ゆれは同じ種目として集計し、読み込み・保存の両方で「ロウ」にそろえる', () => {
  assert.equal(M.exerciseKey('プーリーロー'), M.exerciseKey('プーリーロウ'));
  const t = P.rowsToTraining([
    { date: '2026/10/01', part: '背中', exercise: 'プーリーロー', details: '1セット目: 50kg × 10回' },
    { date: '2026/10/05', part: '背中', exercise: 'プーリーロウ', details: '1セット目: 55kg × 10回' },
  ]);
  assert.equal(t['2026-10-01'].exercises[0].name, 'プーリーロウ');
  const idx = M.buildExerciseIndex(t);
  assert.equal(idx.size, 1);
  assert.equal([...idx.values()][0].sessions.length, 2);
  const rows = P.trainingToRows({ date: '2026-10-07', part: '背中', exercises: [{ name: 'シーテッドロー', sets: [{ w: 40, r: 10 }], memo: '' }] });
  assert.equal(rows[0].exercise, 'シーテッドロウ');
});

test('partCategory: 登録された部位以外（削除した部位・自由入力）は「その他」', () => {
  try {
    P.setKnownParts(['胸', '背中', '大腿四頭筋']);
    assert.equal(P.partCategory('大腿四頭筋'), '大腿四頭筋');
    assert.equal(P.partCategory('肩'), 'その他');
    assert.equal(P.partCategory('足'), 'その他'); // 「脚」が無ければ足→脚の読み替えもしない
    assert.deepEqual(P.getKnownParts(), ['胸', '背中', '大腿四頭筋']);
    P.setKnownParts(['脚']);
    assert.equal(P.partCategory('足'), '脚');
  } finally {
    P.setKnownParts(P.DEFAULT_PARTS);
  }
});
