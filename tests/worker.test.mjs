// Cloudflare Worker 側の純粋関数（worker/src/lib.js）のテスト。シートの書式・元の GymMo と同じ判定規則であることも確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../worker/src/lib.js';

test('normalizeDateKey / jstKey: 各種表記を yyyy/MM/dd に、Date は日本時間で', () => {
  assert.equal(W.normalizeDateKey('2026-10-08'), '2026/10/08');
  assert.equal(W.normalizeDateKey('2026/10/8'), '2026/10/08');
  assert.equal(W.normalizeDateKey(''), '');
  assert.equal(W.normalizeDateKey('2026/13/01'), '');
  assert.equal(W.normalizeDateKey(new Date(Date.UTC(2026, 9, 7, 15, 0, 0))), '2026/10/08'); // JST 0 時
  assert.equal(W.jstKey(new Date(Date.UTC(2026, 9, 7, 14, 59, 59))), '2026/10/07');
});

test('isValidIsoDate / nextIsoDate / toHealthSheetDate / recentIsoDates', () => {
  assert.equal(W.isValidIsoDate('2026-10-08'), true);
  assert.equal(W.isValidIsoDate('2026/10/08'), false);
  assert.equal(W.isValidIsoDate("2026-10-08'; DROP"), false);
  assert.equal(W.nextIsoDate('2026-12-31'), '2027-01-01');
  assert.equal(W.toHealthSheetDate('2026/10/08'), '2026/10/8');
  assert.deepEqual(W.recentIsoDates(3, new Date(Date.UTC(2026, 9, 27, 3))), ['2026-10-25', '2026-10-26', '2026-10-27']);
});

test('ヘルス: 有効値の判定・統合・シートの書式（元の GymMo と同じ）', () => {
  assert.equal(W.isValidSleep('記録なし'), false);
  assert.equal(W.isValidNumberMetric('0 g'), false);
  assert.equal(W.isValidNumberMetric('105 g'), true);
  const saved = { sleep: '6時間8分', protein: '0 g', fat: '0 g', carb: '0 g', intake: '0', burned: '630' };
  const m = W.mergeHealthRecords(saved, { sleep: '', burned: 900, intake: 500, protein: 30, fat: 10, carb: 60 });
  assert.equal(m.sleep, '6時間8分');
  const row = W.toSheetRow('2026/10/22', m);
  assert.deepEqual(row, { date: '2026/10/22', sleep: '6時間8分', protein: '30 g', fat: '10 g', carb: '60 g', intake: '500', burned: '900' });
  assert.deepEqual(W.healthSheetValues(row), ['2026/10/22', '6時間8分', '30 g', '10 g', '60 g', '500', '900', '-400 kcal']);
  assert.equal(W.formatDiff(2990, 2573), '+417 kcal');
  assert.equal(W.toSheetRow('2026/10/22', W.mergeHealthRecords(null, null)).sleep, '記録なし');
});

test('sanitizeTrainingRow: 長さ制限・空行の除外・種目不明・末尾のローはロウに', () => {
  assert.equal(W.sanitizeTrainingRow({ part: '', exercise: '', details: '', memo: '' }), null);
  assert.equal(W.sanitizeTrainingRow({ part: '胸', exercise: '', details: '1セット目: 10kg × 1回', memo: '' }).exercise, '種目不明');
  assert.equal(W.sanitizeTrainingRow({ part: '背中', exercise: 'スミスベントロー', details: '', memo: 'x' }).exercise, 'スミスベントロウ');
  assert.equal(W.sanitizeTrainingRow({ part: '背中', exercise: 'ローイング', details: '', memo: 'x' }).exercise, 'ローイング');
  assert.equal(W.sanitizeTrainingRow({ part: 'x'.repeat(99), exercise: 'a', details: '', memo: '' }).part.length, W.LIMITS.part);
});

test('sanitizeRenameRequest: 項目・変更前・変更後を検証する', () => {
  assert.deepEqual(W.sanitizeRenameRequest('part', [' 脚 ', '足', '脚'], ' 大腿 '), { field: 'part', from: ['脚', '足'], to: '大腿' });
  assert.throws(() => W.sanitizeRenameRequest('date', ['a'], 'b'));
  assert.throws(() => W.sanitizeRenameRequest('part', [], 'b'));
  assert.throws(() => W.sanitizeRenameRequest('part', ['a'], '  '));
});

test('safeEquals: 一致・不一致・型の揺れ', () => {
  assert.equal(W.safeEquals('abc', 'abc'), true);
  assert.equal(W.safeEquals('abc', 'abd'), false);
  assert.equal(W.safeEquals('abc', 'abcd'), false);
  assert.equal(W.safeEquals(undefined, ''), true);
});
