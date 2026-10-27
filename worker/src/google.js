// Google との連携: OAuth（初回の許可とトークン更新）・Google ヘルス API v4 の取得・スプレッドシートへのコピー。
// 取得ロジックは元の GymMo と同じ API・同じ解釈（睡眠・消費カロリー・栄養ログ）。
import { civilDayRange, nextIsoDate, minutesToSleepText, healthSheetValues } from './lib.js';
import { getMeta, setMeta, deleteMeta } from './db.js';

const HEALTH_BASE = 'https://health.googleapis.com/v4/users/me';
export const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
  // 記録をスプレッドシートへ自動コピーするため
  'https://www.googleapis.com/auth/spreadsheets',
];

export class GoogleAuthError extends Error {}

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
  await setMeta(env, 'google_access_token', JSON.stringify({ token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 }));
  await setMeta(env, 'google_scopes', json.scope || '');
  await deleteMeta(env, 'google_auth_error');
}

/** 有効なアクセストークン（期限が近ければ更新）。未許可・失効なら GoogleAuthError。 */
export async function accessToken(env) {
  const cached = JSON.parse((await getMeta(env, 'google_access_token')) || 'null');
  if (cached?.token && cached.exp > Date.now()) return cached.token;
  const refresh = await getMeta(env, 'google_refresh_token');
  if (!refresh) throw new GoogleAuthError('Google との連携がまだ許可されていません');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const msg = `Google の許可が切れています（${json.error || res.status}）。もう一度許可してください。`;
    if (json.error === 'invalid_grant') await setMeta(env, 'google_auth_error', msg);
    throw new GoogleAuthError(msg);
  }
  await setMeta(env, 'google_access_token', JSON.stringify({ token: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 }));
  return json.access_token;
}

/* ---------- Google ヘルス API v4 ---------- */
const getJson = async (url, init) => {
  const res = await fetch(url, init);
  if (res.status === 401) throw new GoogleAuthError('Google ヘルスの許可が切れています');
  if (!res.ok) return null;
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
 * 戻り値: { 'yyyy-MM-dd': { sleep, burned, intake, protein, fat, carb } | null }。未許可・失効は GoogleAuthError。
 */
export async function fetchHealthForDates(env, isoDates) {
  const headers = { Authorization: `Bearer ${await accessToken(env)}`, Accept: 'application/json' };
  const results = {};
  for (const iso of isoDates) {
    try {
      const [sleep, burned, nut] = await Promise.all([fetchSleepMinutes(iso, headers), fetchBurnedKcal(iso, headers), fetchNutrition(iso, headers)]);
      results[iso] = {
        sleep: minutesToSleepText(sleep),
        burned: burned > 0 ? burned : '',
        intake: nut.intake > 0 ? nut.intake : '',
        protein: nut.protein > 0 ? nut.protein : '',
        fat: nut.fat > 0 ? nut.fat : '',
        carb: nut.carb > 0 ? nut.carb : '',
      };
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      console.error('health fetch error', iso, String(e));
      results[iso] = null;
    }
  }
  return results;
}

/* ---------- スプレッドシートへのコピー ---------- */
const WORKOUT_RANGE = "'Workout Data'!A2:E";
const HEALTH_RANGE = "'Health Data'!A2:H";

/**
 * D1 の内容でシートの 2 行目以降を丸ごと書き直す（アプリ → シートの一方向コピー）。
 * 値は RAW で書くので、'=' で始まるメモが数式になったり '1/2' が日付になったりしない。
 */
export async function mirrorToSheet(env, { workouts, health }) {
  const token = await accessToken(env);
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
