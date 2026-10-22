// Apps Script 側の純粋関数（backend/src/Lib.gs）を Node の vm 上でテストする
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../backend/src/Lib.gs', import.meta.url), 'utf8');
// Utilities.formatDate の最小スタブ（Date を Asia/Tokyo の yyyy/MM/dd にする）
const ctx = {
  module: { exports: {} },
  Utilities: {
    formatDate(d) {
      const j = new Date(d.getTime() + 9 * 3600 * 1000);
      return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, '0')}/${String(j.getUTCDate()).padStart(2, '0')}`;
    },
  },
};
vm.runInNewContext(code, ctx);
const L = ctx.module.exports;

test('normalizeDateKey_: 各種表記を yyyy/MM/dd に', () => {
  assert.equal(L.normalizeDateKey_('2026-10-08'), '2026/10/08');
  assert.equal(L.normalizeDateKey_('2026/10/8'), '2026/10/08');
  assert.equal(L.normalizeDateKey_('2026/10/08'), '2026/10/08');
  assert.equal(L.normalizeDateKey_(''), '');
  assert.equal(L.normalizeDateKey_('abc'), '');
  assert.equal(L.normalizeDateKey_('2026/13/01'), '');
  assert.equal(L.normalizeDateKey_(new Date(Date.UTC(2026, 9, 7, 15, 0, 0))), '2026/10/08'); // JST 0 時
});

test('isValidIsoDate_ / nextIsoDate_ / toHealthSheetDate_', () => {
  assert.equal(L.isValidIsoDate_('2026-10-08'), true);
  assert.equal(L.isValidIsoDate_('2026/10/08'), false);
  assert.equal(L.isValidIsoDate_("2026-10-08'; DROP"), false);
  assert.equal(L.nextIsoDate_('2026-10-31'), '2026-11-01');
  assert.equal(L.nextIsoDate_('2026-12-31'), '2027-01-01');
  assert.equal(L.toHealthSheetDate_('2026/10/08'), '2026/10/8');
});

test('有効値の判定は元の GymMo と同じ（0・記録なしは無効）', () => {
  assert.equal(L.isValidSleep_('6時間32分'), true);
  assert.equal(L.isValidSleep_('記録なし'), false);
  assert.equal(L.isValidNumberMetric_('105 g'), true);
  assert.equal(L.isValidNumberMetric_('0 g'), false);
  assert.equal(L.isValidNumberMetric_(''), false);
  assert.equal(L.hasAnyValidHealthMetric_({ sleep: '', burned: 630 }), true);
  assert.equal(L.hasAnyValidHealthMetric_({ sleep: '記録なし', intake: '0' }), false);
});

test('mergeHealthRecords_ / toSheetRow_: API の有効値を優先し、無ければシートの値を残す', () => {
  const saved = { sleep: '6時間8分', protein: '0 g', fat: '0 g', carb: '0 g', intake: '0', burned: '630' };
  const api = { sleep: '', burned: 900, intake: 500, protein: 30, fat: 10, carb: 60 };
  const m = L.mergeHealthRecords_(saved, api);
  assert.equal(m.sleep, '6時間8分');
  assert.equal(m.burned, 900);
  const row = L.toSheetRow_('2026/10/22', m);
  assert.deepEqual(JSON.parse(JSON.stringify(row)), { date: '2026/10/22', sleep: '6時間8分', protein: '30 g', fat: '10 g', carb: '60 g', intake: '500', burned: '900' });
  const none = L.toSheetRow_('2026/10/22', L.mergeHealthRecords_(null, null));
  assert.equal(none.sleep, '記録なし');
});

test('formatDiff_: 元のシート表記（+617 kcal / -85 kcal）', () => {
  assert.equal(L.formatDiff_(3180, 2563), '+617 kcal');
  assert.equal(L.formatDiff_(2542, 2627), '-85 kcal');
  assert.equal(L.formatDiff_(0, 630), '-630 kcal');
});

test('sanitizeTrainingRow_: 長さ制限・空行の除外・種目不明', () => {
  assert.equal(L.sanitizeTrainingRow_(null), null);
  assert.equal(L.sanitizeTrainingRow_({ part: '胸', exercise: '', details: '', memo: '' }), null);
  assert.equal(L.sanitizeTrainingRow_({ part: '胸', exercise: '', details: '1セット目: 10kg × 10回', memo: '' }).exercise, '種目不明');
  const long = L.sanitizeTrainingRow_({ part: '胸', exercise: 'x'.repeat(500), details: '', memo: 'y'.repeat(9000) });
  assert.equal(long.exercise.length, 120);
  assert.equal(long.memo.length, 4000);
  // 数式として解釈されうる文字列もそのまま（書き込み側でテキスト書式にする）
  assert.equal(L.sanitizeTrainingRow_({ part: '胸', exercise: '=IMPORTXML("x")', details: '', memo: '' }).exercise, '=IMPORTXML("x")');
});

test('groupConsecutive_: 連続行をまとめ、下から削除できる順で返す', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(L.groupConsecutive_([5, 6, 7, 20, 21, 40]))), [
    { start: 40, count: 1 },
    { start: 20, count: 2 },
    { start: 5, count: 3 },
  ]);
  assert.equal(L.groupConsecutive_([]).length, 0);
});

test('safeEquals_: 一致・不一致・型の揺れ', () => {
  assert.equal(L.safeEquals_('abc', 'abc'), true);
  assert.equal(L.safeEquals_('abc', 'abd'), false);
  assert.equal(L.safeEquals_('abc', 'abcd'), false);
  assert.equal(L.safeEquals_(undefined, 'abc'), false);
  assert.equal(L.safeEquals_('', ''), true);
});
