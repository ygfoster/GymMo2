/**
 * GymMo2 の Cloudflare Worker: 画面（web/ の静的ファイル）と API を同じ住所で配信する。
 *
 * API: POST /api（本文は JSON。パスコードは URL ではなく本文の token で送る）
 *   ping                                → 認証確認
 *   status                              → Google 連携・シートへのコピーの状態
 *   bootstrap                           → ワークアウト全行 + ヘルス全行
 *   health   { date: 'YYYY-MM-DD' }     → その日のヘルスを Google ヘルスから取り直して保存し、1 行返す
 *   saveDay  { date, rows: [...] }      → その日のワークアウト行を置き換え
 *   deleteDay{ date }                   → その日のワークアウト行を削除
 *   renameValues { field, from, to }    → 部位名（または種目名）の一括変更
 *   oauthStart                          → Google の許可画面の URL（初回・許可が切れたとき）
 *
 * データの本体は D1。変更があるたびに、Google スプレッドシート（複製したシート）へ自動でコピーする（一方向）。
 * 1 時間ごとの Cron で直近 7 日分のヘルスを取得して保存し、シートにも反映する。
 */
import * as db from './db.js';
import { authorizationUrl, handleCallback, fetchHealthForDates, mirrorToSheet, GoogleAuthError } from './google.js';
import {
  normalizeDateKey,
  isValidIsoDate,
  isValidSleep,
  isValidNumberMetric,
  hasAnyValidHealthMetric,
  mergeHealthRecords,
  toSheetRow,
  sanitizeTrainingRow,
  sanitizeRenameRequest,
  safeEquals,
  recentIsoDates,
  jstKey,
  LIMITS,
} from './lib.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const page = (title, body) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.7 -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px;color:#111;background:#f2f2f7}@media(prefers-color-scheme:dark){body{color:#eee;background:#000}}</style>
<h1 style="font-size:22px">${title}</h1><p>${body}</p>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );

/** Android アプリ（App Links）の所有確認。署名鍵の SHA-256 指紋 */
const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'io.github.ygfoster.gymmo2',
      sha256_cert_fingerprints: ['6F:DB:A5:9A:FA:08:4E:74:A6:2F:4B:EC:A2:2C:6E:11:5A:ED:2C:43:D8:F1:8C:5D:14:48:2B:38:F7:30:3B:2E'],
    },
  },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api') {
      if (request.method !== 'POST') return json({ ok: true, app: 'GymMo2 API', note: 'POST のみ対応しています。' });
      return handleApi(request, env, ctx, url);
    }
    if (url.pathname === '/oauth/callback') {
      try {
        await handleCallback(env, url);
        ctx.waitUntil(mirror(env)); // 許可が済んだら、すぐシートへ反映
        return page('連携が完了しました', 'Google ヘルスとスプレッドシートへのアクセスを許可しました。このタブを閉じて、GymMo2 に戻ってください。');
      } catch (e) {
        return page('連携できませんでした', String(e.message || e));
      }
    }
    if (url.pathname === '/.well-known/assetlinks.json') return json(ASSET_LINKS);
    return env.ASSETS.fetch(request);
  },

  /** 1 時間ごと: 直近 7 日分のヘルスを取得して保存し、シートへ反映 */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await syncRecentHealth(env, 7);
        } catch (e) {
          console.error('scheduled health sync', String(e));
        }
        await mirror(env);
      })()
    );
  },
};

/* ---------- API ---------- */
async function handleApi(request, env, ctx, url) {
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ ok: false, error: 'リクエストを解析できませんでした' });
  }
  if (!body || !env.API_TOKEN || !safeEquals(body.token, env.API_TOKEN)) {
    await new Promise((r) => setTimeout(r, 400)); // 総当たりを少し遅くする
    return json({ ok: false, code: 'AUTH', error: 'パスコードが違います' });
  }
  try {
    switch (body.action) {
      case 'ping':
        return json({ ok: true, time: Date.now() });
      case 'status':
        return json({ ok: true, ...(await status(env)) });
      case 'bootstrap': {
        const [training, health] = await Promise.all([db.allWorkouts(env), db.allHealth(env)]);
        return json({ ok: true, training, health, serverTime: Date.now() });
      }
      case 'health':
        return json(await handleHealth(env, ctx, body.date));
      case 'saveDay':
        return json(await handleSaveDay(env, ctx, body.date, body.rows));
      case 'deleteDay': {
        if (!isValidIsoDate(body.date)) throw new Error('日付の形式が正しくありません');
        const removed = await db.deleteDay(env, normalizeDateKey(body.date));
        ctx.waitUntil(mirror(env));
        return json({ ok: true, removed });
      }
      case 'renameValues': {
        const req = sanitizeRenameRequest(body.field, body.from, body.to);
        const count = await db.renameValues(env, req.field, req.from, req.to);
        ctx.waitUntil(mirror(env));
        return json({ ok: true, count });
      }
      case 'oauthStart':
        return json({ ok: true, url: await authorizationUrl(env, url.origin) });
      default:
        return json({ ok: false, error: '不明な操作です' });
    }
  } catch (e) {
    console.error(body.action, String(e));
    return json({ ok: false, error: String(e.message || e) });
  }
}

async function handleSaveDay(env, ctx, dateIso, rows) {
  if (!isValidIsoDate(dateIso)) throw new Error('日付の形式が正しくありません');
  if (!Array.isArray(rows)) throw new Error('rows が配列ではありません');
  const clean = rows.slice(0, LIMITS.rows).map(sanitizeTrainingRow).filter(Boolean);
  await db.replaceDay(env, normalizeDateKey(dateIso), clean);
  ctx.waitUntil(mirror(env));
  return { ok: true, count: clean.length };
}

async function handleHealth(env, ctx, dateIso) {
  if (!isValidIsoDate(dateIso)) throw new Error('日付の形式が正しくありません');
  const key = normalizeDateKey(dateIso);
  const saved = await db.getHealth(env, key);
  // 過去日で睡眠と消費カロリーがすでに揃っていれば、API を呼ばずに保存済みの値を返す
  if (key !== jstKey() && saved && isValidSleep(saved.sleep) && isValidNumberMetric(saved.burned)) {
    return { ok: true, row: saved, source: 'db' };
  }
  let api;
  try {
    api = (await fetchHealthForDates(env, [dateIso]))[dateIso];
  } catch (e) {
    if (e instanceof GoogleAuthError) return { ok: true, row: saved || null, authWarning: e.message, source: 'db' };
    throw e;
  }
  const merged = mergeHealthRecords(saved, api);
  if (!hasAnyValidHealthMetric(merged)) return { ok: true, row: null, source: 'api' };
  const row = toSheetRow(key, merged);
  if (hasAnyValidHealthMetric(api)) {
    await db.upsertHealthStmt(env, row).run();
    ctx.waitUntil(mirror(env));
  }
  return { ok: true, row, source: 'api' };
}

/** 直近 n 日分を Google ヘルスから取得し、意味のある値がある日だけ保存する */
async function syncRecentHealth(env, n) {
  const dates = recentIsoDates(n);
  const results = await fetchHealthForDates(env, dates);
  const stmts = [];
  for (const iso of dates) {
    const api = results[iso];
    if (!hasAnyValidHealthMetric(api)) continue;
    const key = normalizeDateKey(iso);
    const saved = await db.getHealth(env, key);
    stmts.push(db.upsertHealthStmt(env, toSheetRow(key, mergeHealthRecords(saved, api))));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await db.setMeta(env, 'health_synced_at', Date.now());
  return stmts.length;
}

/** シートへのコピー。失敗しても記録は D1 にあるので、エラーを残して次の機会（保存時・毎時）にやり直す */
async function mirror(env) {
  try {
    const [workouts, health] = await Promise.all([db.allWorkouts(env), db.allHealth(env)]);
    await mirrorToSheet(env, { workouts, health });
    await db.setMeta(env, 'sheet_mirrored_at', Date.now());
    await db.deleteMeta(env, 'sheet_error');
  } catch (e) {
    console.error('mirror', String(e));
    await db.setMeta(env, 'sheet_error', String(e.message || e)).catch(() => {});
  }
}

async function status(env) {
  const [refresh, authError, sheetError, mirroredAt, healthAt, scopes] = await Promise.all(
    ['google_refresh_token', 'google_auth_error', 'sheet_error', 'sheet_mirrored_at', 'health_synced_at', 'google_scopes'].map((k) => db.getMeta(env, k))
  );
  return {
    google: { connected: !!refresh && !authError, error: authError || null, scopes: scopes || '' },
    sheet: { mirroredAt: mirroredAt ? Number(mirroredAt) : null, error: sheetError || null },
    health: { syncedAt: healthAt ? Number(healthAt) : null },
  };
}
