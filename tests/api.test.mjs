// フロントの API クライアント（ライブ/デモ）と、ストアの記録整形をテストする。fetch はモック。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveApi, createDemoApi, ApiError } from '../web/js/api.js';
import { cleanDay } from '../web/js/store.js';
import { rowsToTraining, rowsToHealth } from '../web/js/lib/parse.js';
import { todayKey } from '../web/js/lib/dates.js';

const mockFetch = (impl) => {
  globalThis.fetch = async (url, opts) => impl(url, opts);
};
const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

test('live: POST + text/plain、トークンは URL ではなく本文で送る', async () => {
  let seen;
  mockFetch((url, opts) => {
    seen = { url, opts };
    return jsonRes({ ok: true });
  });
  const api = createLiveApi({ url: 'https://example.test/exec', getToken: () => 'sekret' });
  await api.ping();
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.ok(!seen.url.includes('sekret'));
  assert.deepEqual(JSON.parse(seen.opts.body), { action: 'ping', token: 'sekret' });
});

test('live: 認証エラー・サーバーエラー・通信失敗・JSON 不正を種別つきで投げ分ける', async () => {
  const api = createLiveApi({ url: 'https://example.test/exec', getToken: () => 't' });
  mockFetch(() => jsonRes({ ok: false, code: 'AUTH', error: 'パスコードが違います' }));
  await assert.rejects(api.ping(), (e) => e instanceof ApiError && e.kind === 'auth' && e.message.includes('パスコード'));
  mockFetch(() => jsonRes({ ok: false, error: 'boom' }));
  await assert.rejects(api.ping(), (e) => e.kind === 'server');
  mockFetch(() => jsonRes({}, 500));
  await assert.rejects(api.ping(), (e) => e.kind === 'server' && e.message.includes('500'));
  mockFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.ping(), (e) => e.kind === 'network');
  mockFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }));
  await assert.rejects(api.ping(), (e) => e.kind === 'server' && e.message.includes('解析'));
});

test('demo: bootstrap の行は本番と同じパース経路で読める。保存・削除が反映される', async () => {
  const api = createDemoApi();
  const res = await api.bootstrap();
  const training = rowsToTraining(res.training);
  const health = rowsToHealth(res.health);
  assert.ok(Object.keys(training).length > 20);
  assert.ok(Object.keys(health).length > 50);
  const today = todayKey();
  assert.ok(health[today]); // 今日は暫定値
  await api.saveDay('2026-01-02', [{ date: '2026/01/02', part: '胸', exercise: 'テスト', details: '1セット目: 10kg × 10回', memo: '' }]);
  let after = rowsToTraining((await api.bootstrap()).training);
  assert.equal(after['2026-01-02'].exercises[0].name, 'テスト');
  await api.deleteDay('2026-01-02');
  after = rowsToTraining((await api.bootstrap()).training);
  assert.equal(after['2026-01-02'], undefined);
});

test('cleanDay: 空の種目と空のセットを落とし、id と部位を整える', () => {
  const day = cleanDay({
    date: '2026-10-22',
    part: '足',
    exercises: [
      { name: ' スクワット ', memo: ' メモ ', sets: [{ w: 100, r: 5 }, { w: null, r: null }] },
      { name: '', memo: '', sets: [{ w: null, r: null }] },
      { name: '', memo: '', sets: [{ w: 20, r: 10 }] },
    ],
  });
  assert.equal(day.part, '脚');
  assert.equal(day.exercises.length, 2);
  assert.equal(day.exercises[0].name, 'スクワット');
  assert.equal(day.exercises[0].sets.length, 1);
  assert.equal(day.exercises[0].memo, 'メモ');
  assert.equal(day.exercises[1].name, '種目不明');
  assert.equal(day.exercises[1].id, '2026-10-22#1');
});

test('demo: renameValues で部位名を一括変更できる（足は脚と一緒に）', async () => {
  const api = createDemoApi();
  api.reset();
  const fresh = createDemoApi();
  await fresh.saveDay('2026-01-03', [{ date: '2026/01/03', part: '足', exercise: 'スクワット', details: '1セット目: 60kg × 5回', memo: '' }]);
  const res = await fresh.renameValues('part', ['脚', '足'], '大腿');
  assert.ok(res.count >= 2);
  const t = rowsToTraining((await fresh.bootstrap()).training);
  assert.equal(t['2026-01-03'].part, '大腿');
  assert.ok(!Object.values(t).some((d) => d.part === '脚' || d.part === '足'));
  fresh.reset();
});

test('cleanDay: 種目名の末尾「ロー」を「ロウ」にそろえる', () => {
  const day = cleanDay({ date: '2026-10-22', part: '背中', exercises: [{ name: 'プーリーロー', memo: '', sets: [{ w: 40, r: 10 }] }] });
  assert.equal(day.exercises[0].name, 'プーリーロウ');
});

import { normalizeTemplates, TEMPLATE_LIMITS } from '../web/js/store.js';
test('normalizeTemplates: 5 秒刻み・10 秒〜10 分・重複なし・短い順・最大 8 個', () => {
  assert.deepEqual(normalizeTemplates([300, 62, 300, 3, 999, 'x', 88]), [10, 60, 90, 300, 600]);
  assert.equal(normalizeTemplates([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]).length, TEMPLATE_LIMITS.count);
  assert.deepEqual(normalizeTemplates([]), [60, 90, 120, 150, 180, 240, 300]); // 空なら既定に戻す
  assert.deepEqual(normalizeTemplates(null), [60, 90, 120, 150, 180, 240, 300]);
});
