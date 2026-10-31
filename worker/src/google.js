// Google との連携: OAuth（初回の許可とトークン更新）・Google ヘルス API v4 の取得・スプレッドシートへのコピー。
// 取得ロジックは元の GymMo と同じ API・同じ解釈（睡眠・消費カロリー・栄養ログ）。
import { civilDayRange, nextIsoDate, minutesToSleepText, healthSheetValues } from './lib.js';
import { getMeta, setMeta, deleteMeta } from './db.js';

const HEALTH_BASE = 'https://health.googleapis.com/v4/users/me';
export const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
];
// 記録をスプレッドシートへ自動コピーするため
export const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
/** 許可画面で一度にもらうスコープ（全部） */
export const SCOPES = [...HEALTH_SCOPES, ...SHEETS_SCOPES];
/**
 * 用途ごとのスコープ。Google ヘルス API は、アクセストークンにヘルス以外のスコープ（スプレッドシート）が
 * 混ざっていると 403 DISALLOWED_OAUTH_SCOPES で全リクエストを拒否する。そのため許可は 1 回（SCOPES 全部）で取り、
 * アクセストークンは用途ごとにスコープを絞って発行する（更新トークンのスコープの部分集合なら発行できる）。
 */
export const SCOPES_BY_KIND = { health: HEALTH_SCOPES, sheets: SHEETS_SCOPES };

/** 許可がない・切れている（許可し直しが必要） */
export class GoogleAuthError extends Error {}
/** Google の API が 2xx 以外を返した（許可切れ以外。設定や API 側の問題） */
export class GoogleApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- OAuth ---------- */

/** 許可画面の URL を作る（state は 10 分だけ有効） */
export async function authorizationUrl(env, origin) {
  const state = crypto.randomUUID();
  await setMeta(env, 'oauth_state', JSON.stringify({ state, exp: Date.now() + 10 * 60_000 }));
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/oauth/callback`,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** 許可画面からの戻り。成功すれば更新用トークンを保存する。 */
export async function handleCallback(env, url) {
  const saved = JSON.parse((await getMeta(env, 'oauth_state')) || 'null');
  const state = url.searchParams.get('state');
  if (!saved || !state || saved.state !== state || saved.exp < Date.now()) throw new Error('許可の手続きの有効期限が切れています。もう一度やり直してください。');
  await deleteMeta(env, 'oauth_state');
  const err = url.searchParams.get('error');
  if (err) throw new Error(`許可されませんでした（${err}）`);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/oauth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token) throw new Error(`トークンを取得できませんでした（${json.error || res.status}）`);
  await setMeta(env, 'google_refresh_token', json.refresh_token);
  await setMeta(env, 'google_scopes', json.scope || '');
  // 許可画面で得たアクセストークンは全スコープ入りなのでヘルス API には使えない。用途別のキャッシュを空にして取り直させる
  for (const kind of Object.keys(SCOPES_BY_KIND)) await deleteMeta(env, `google_access_token_${kind}`);
  await deleteMeta(env, 'google_access_token');
  await deleteMeta(env, 'google_auth_error');
  await deleteMeta(env, 'health_error');
}

/** トークン更新リクエストの本文。kind（health / sheets）のスコープだけに絞ったアクセストークンを求める */
export function refreshTokenParams(env, refresh, kind) {
  const scopes = SCOPES_BY_KIND[kind];
  if (!scopes) throw new Error(`不明なトークンの用途: ${kind}`);
  return { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token', scope: scopes.join(' ') };
}

/** 用途（kind）に合ったアクセストークン（期限が近ければ更新）。未許可・失効なら GoogleAuthError。 */
export async function accessToken(env, kind) {
  const cacheKey = `google_access_token_${kind}`;
  const cached = JSON.parse((await getMeta(env, cacheKey)) || 'null');
  if (cached?.token && cached.exp > Date.now()) return cached.token;
  const refresh = await getMeta(env, 'google_refresh_token');
  if (!refresh) throw new GoogleAuthError('Google との連携がまだ許可されていません');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(refreshTokenParams(env, refresh, kind)),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const msg = `Google の許可が切れています（${json.error || res.status}）。もう一度許可してください。`;
    if (json.error === 'invalid_grant' || json.error === 'invalid_scope') await setMeta(env, 'google_auth_error', msg);
    throw new GoogleAuthError(msg);
  }
  // 絞り込みが効かず余計なスコープが残ったら、ヘルス API は 403 を返す。原因が分かるように記録しておく
  const granted = String(json.scope || '').split(' ').filter(Boolean);
  const extra = granted.filter((sc) => !SCOPES_BY_KIND[kind].includes(sc));
  if (extra.length) console.error('access token has extra scopes', kind, extra.join(' '));
  await setMeta(env, cacheKey, JSON.stringify({ token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 }));
  return json.access_token;
}

/* ---------- Google ヘルス API v4 ---------- */
const getJson = async (url, init) => {
  const res = await fetch(url, init);
  if (res.status === 401) throw new GoogleAuthError('Google ヘルスの許可が切れています');
  if (!res.ok) {
    // 「データなし」扱いにせず、何が返ったかを残す（以前は無言で空扱いにしていて、403 に気づけなかった）
    const text = await res.text().catch(() => '');
    let reason = '';
    try {
      const err = JSON.parse(text).error;
      reason = err?.details?.find((d) => d.reason)?.reason || err?.status || '';
    } catch {}
    throw new GoogleApiError(res.status, `Google ヘルス API が ${res.status}${reason ? ` ${reason}` : ''} を返しました`);
  }
  return res.json().catch(() => null);
};

async function fetchSleepMinutes(iso, headers) {
  const filter = `sleep.interval.civil_end_time >= "${iso}" AND sleep.interval.civil_end_time < "${nextIsoDate(iso)}"`;
  const data = await getJson(`${HEALTH_BASE}/dataTypes/sleep/dataPoints:reconcile?filter=${encodeURIComponent(filter)}`, { headers });
  let total = 0;
  for (const pt of data?.dataPoints || []) {
    const slp = pt.sleep || pt;
    if (slp?.summary?.minutesAsleep) total += parseInt(slp.summary.minutesAsleep, 10) || 0;
    else if (slp?.minutesAsleep) total += parseInt(slp.minutesAsleep, 10) || 0;
    else if (Array.isArray(slp?.summary?.stagesSummary)) {
      for (const st of slp.summary.stagesSummary) {
        if (st.type && st.type !== 'AWAKE' && st.type !== 'OUT_OF_BED') total += parseInt(st.minutes, 10) || 0;
      }
    }
  }
  return total;
}

async function fetchBurnedKcal(iso, headers) {
  const data = await getJson(`${HEALTH_BASE}/dataTypes/total-calories/dataPoints:dailyRollUp`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: civilDayRange(iso), windowSizeDays: 1 }),
  });
  let kcal = 0;
  for (const p of data?.rollupDataPoints || data?.dailyRollupDataPoints || []) {
    if (p.totalCalories?.kcalSum !== undefined) kcal += Number(p.totalCalories.kcalSum) || 0;
  }
  return Math.round(kcal);
}

function addNutrients(acc, nl, sumKey) {
  // sumKey: ロールアップは 'kcalSum'/'gramsSum'、個別ログは 'kcal'/'grams'
  const k = sumKey === 'sum' ? { kcal: 'kcalSum', g: 'gramsSum' } : { kcal: 'kcal', g: 'grams' };
  if (nl.energy?.[k.kcal] !== undefined) acc.intake += Number(nl.energy[k.kcal]) || 0;
  if (nl.totalFat?.[k.g] !== undefined) acc.fat += Number(nl.totalFat[k.g]) || 0;
  if (nl.totalCarbohydrate?.[k.g] !== undefined) acc.carb += Number(nl.totalCarbohydrate[k.g]) || 0;
  for (const n of Array.isArray(nl.nutrients) ? nl.nutrients : []) {
    const type = String(n.nutrient || '').toUpperCase();
    const g = n.quantity?.[k.g] !== undefined ? Number(n.quantity[k.g]) : 0;
    if (type === 'PROTEIN') acc.protein += g;
    if ((type === 'TOTAL_FAT' || type === 'FAT') && acc.fat === 0) acc.fat += g;
    if ((type === 'TOTAL_CARBOHYDRATE' || type === 'CARBOHYDRATE' || type === 'CARBS') && acc.carb === 0) acc.carb += g;
  }
}

async function fetchNutrition(iso, headers) {
  const acc = { intake: 0, protein: 0, fat: 0, carb: 0 };
  const roll = await getJson(`${HEALTH_BASE}/dataTypes/nutrition-log/dataPoints:dailyRollUp`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: civilDayRange(iso), windowSizeDays: 1 }),
  });
  for (const p of roll?.rollupDataPoints || []) if (p.nutritionLog) addNutrients(acc, p.nutritionLog, 'sum');
  // ロールアップが空なら、個別の栄養ログを集計して補う
  if (!acc.intake && !acc.protein && !acc.fat && !acc.carb) {
    const filter = `nutrition_log.interval.civil_start_time >= "${iso}" AND nutrition_log.interval.civil_start_time < "${nextIsoDate(iso)}"`;
    const list = await getJson(`${HEALTH_BASE}/dataTypes/nutrition-log/dataPoints:reconcile?filter=${encodeURIComponent(filter)}`, { headers });
    for (const pt of list?.dataPoints || []) addNutrients(acc, pt.nutritionLog || pt, 'each');
  }
  return { intake: Math.round(acc.intake), protein: Math.round(acc.protein), fat: Math.round(acc.fat), carb: Math.round(acc.carb) };
}

/**
 * 日付（'yyyy-MM-dd'）ごとに睡眠・消費・栄養を取得する。
 * 戻り値: { rows: { 'yyyy-MM-dd': { sleep, burned, intake, protein, fat, carb } | null }, error: string | null }。
 * 3 つの取得のうち失敗したものは空値にして残りを返し、最初のエラー文を error に入れる（meta の health_error にも残す）。
 * 未許可・失効は GoogleAuthError を投げる。
 */
export async function fetchHealthForDates(env, isoDates) {
  const headers = { Authorization: `Bearer ${await accessToken(env, 'health')}`, Accept: 'application/json' };
  const rows = {};
  let error = null;
  const note = (iso, what, e) => {
    console.error('health fetch error', iso, what, String(e));
    error ??= `${String(e.message || e)}（${what}, ${iso}）`;
  };
  for (const iso of isoDates) {
    const [sleep, burned, nut] = await Promise.allSettled([fetchSleepMinutes(iso, headers), fetchBurnedKcal(iso, headers), fetchNutrition(iso, headers)]);
    const auth = [sleep, burned, nut].find((r) => r.status === 'rejected' && r.reason instanceof GoogleAuthError);
    if (auth) throw auth.reason;
    if (sleep.status === 'rejected') note(iso, '睡眠', sleep.reason);
    if (burned.status === 'rejected') note(iso, '消費カロリー', burned.reason);
    if (nut.status === 'rejected') note(iso, '栄養', nut.reason);
    if ([sleep, burned, nut].every((r) => r.status === 'rejected')) {
      rows[iso] = null;
      continue;
    }
    const n = nut.status === 'fulfilled' ? nut.value : { intake: 0, protein: 0, fat: 0, carb: 0 };
    const b = burned.status === 'fulfilled' ? burned.value : 0;
    rows[iso] = {
      sleep: sleep.status === 'fulfilled' ? minutesToSleepText(sleep.value) : '',
      burned: b > 0 ? b : '',
      intake: n.intake > 0 ? n.intake : '',
      protein: n.protein > 0 ? n.protein : '',
      fat: n.fat > 0 ? n.fat : '',
      carb: n.carb > 0 ? n.carb : '',
    };
  }
  if (error) await setMeta(env, 'health_error', error);
  else await deleteMeta(env, 'health_error');
  return { rows, error };
}

/* ---------- スプレッドシートへのコピー ---------- */
const WORKOUT_RANGE = "'Workout Data'!A2:E";
const HEALTH_RANGE = "'Health Data'!A2:H";

/**
 * D1 の内容でシートの 2 行目以降を丸ごと書き直す（アプリ → シートの一方向コピー）。
 * 値は RAW で書くので、'=' で始まるメモが数式になったり '1/2' が日付になったりしない。
 */
export async function mirrorToSheet(env, { workouts, health }) {
  const token = await accessToken(env, 'sheets');
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}/values`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 401 || res.status === 403) throw new GoogleAuthError(`シートに書き込めません（${res.status}）。スプレッドシートへのアクセスを許可し直してください。`);
    if (!res.ok) throw new Error(`シートの更新に失敗しました（${res.status} ${(await res.text()).slice(0, 200)}）`);
  };
  await call(':batchClear', { ranges: [WORKOUT_RANGE, HEALTH_RANGE] });
  const data = [];
  if (workouts.length) data.push({ range: "'Workout Data'!A2", values: workouts.map((r) => [r.date, r.part, r.exercise, r.details, r.memo]) });
  if (health.length) data.push({ range: "'Health Data'!A2", values: health.map(healthSheetValues) });
  if (data.length) await call(':batchUpdate', { valueInputOption: 'RAW', data });
}
