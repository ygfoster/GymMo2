// フロントの API クライアント（ライブ/デモ）と、ストアの記録整形をテストする。fetch はモック。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveApi, createDemoApi, ApiError } from '../js/api.js';
import { cleanDay } from '../js/store.js';
import { rowsToTraining, rowsToHealth } from '../js/lib/parse.js';
import { todayKey } from '../js/lib/dates.js';

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
