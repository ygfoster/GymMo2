// 純粋関数（副作用なし）。旧バックエンド（backend/src/Lib.gs）の規則をそのまま移植したもの。
// シートと同じ書式でデータを持つので、アプリ側（web/js/lib/parse.js）は以前と同じ形の行を受け取れる。

export const TZ_OFFSET_MS = 9 * 3600 * 1000; // Asia/Tokyo（夏時間なし）

const pad2 = (n) => (n < 10 ? '0' : '') + n;

/** Date → 日本時間の 'yyyy/MM/dd' */
export function jstKey(date = new Date()) {
  const j = new Date(date.getTime() + TZ_OFFSET_MS);
  return `${j.getUTCFullYear()}/${pad2(j.getUTCMonth() + 1)}/${pad2(j.getUTCDate())}`;
}

/** Date / 'YYYY-MM-DD' / 'YYYY/M/D' / ISO 文字列 → 'yyyy/MM/dd'。解釈できなければ ''。 */
export function normalizeDateKey(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? '' : jstKey(val);
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(String(val).trim());
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}/${pad2(mo)}/${pad2(d)}`;
}

/** 'yyyy/MM/dd' → 'yyyy-MM-dd' */
export const toIso = (slashKey) => String(slashKey).replace(/\//g, '-');

/** 'yyyy/MM/dd' → 'yyyy/M/d'（Health Data シートの既存表記に合わせる） */
export function toHealthSheetDate(slashKey) {
  const p = String(slashKey).split('/');
  return `${Number(p[0])}/${Number(p[1])}/${Number(p[2])}`;
}

export const isValidIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && normalizeDateKey(s) !== '';

/** 'yyyy-MM-dd' の翌日 */
export function nextIsoDate(iso) {
  const p = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 今日（日本時間）を含む直近 n 日の 'yyyy-MM-dd'（古い順） */
export function recentIsoDates(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(toIso(jstKey(new Date(now.getTime() - i * 86400000))));
  return out;
}

export function parseNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^-0-9.]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

export function isValidSleep(v) {
  if (!v) return false;
  const s = String(v).trim();
  return s !== '' && s !== '記録なし' && s !== '-' && s !== '--' && s !== '0' && s !== '0時間0分';
}

export function isValidNumberMetric(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '--' || s === '...' || s.includes('#') || s === 'NaN') return false;
  return parseNum(s) > 0;
}

export function hasAnyValidHealthMetric(rec) {
  if (!rec) return false;
  return (
    isValidSleep(rec.sleep) ||
    isValidNumberMetric(rec.intake) ||
    isValidNumberMetric(rec.burned) ||
    isValidNumberMetric(rec.protein) ||
    isValidNumberMetric(rec.fat) ||
    isValidNumberMetric(rec.carb)
  );
}

export const formatGrams = (v) => `${Math.round(parseNum(v))} g`;

export function formatDiff(intake, burned) {
  const diff = Math.round(parseNum(intake) - parseNum(burned));
  return `${diff > 0 ? '+' : ''}${diff} kcal`;
}

export const minutesToSleepText = (minutes) => (minutes > 0 ? `${Math.floor(minutes / 60)}時間${minutes % 60}分` : '');

/** 保存済みの値と API の値を統合する。API 側に意味のある値があればそれを優先。 */
export function mergeHealthRecords(savedRec, apiRec) {
  const base = savedRec || { sleep: '', protein: '', fat: '', carb: '', intake: '', burned: '' };
  if (!apiRec) return base;
  return {
    sleep: isValidSleep(apiRec.sleep) ? apiRec.sleep : base.sleep,
    protein: isValidNumberMetric(apiRec.protein) ? apiRec.protein : base.protein,
    fat: isValidNumberMetric(apiRec.fat) ? apiRec.fat : base.fat,
    carb: isValidNumberMetric(apiRec.carb) ? apiRec.carb : base.carb,
    intake: isValidNumberMetric(apiRec.intake) ? apiRec.intake : base.intake,
    burned: isValidNumberMetric(apiRec.burned) ? apiRec.burned : base.burned,
  };
}

/** 保存・返却用の 1 日分（Health Data シートの表示形式） */
export function toSheetRow(slashKey, rec) {
  return {
    date: slashKey,
    sleep: isValidSleep(rec.sleep) ? String(rec.sleep) : '記録なし',
    protein: formatGrams(rec.protein),
    fat: formatGrams(rec.fat),
    carb: formatGrams(rec.carb),
    intake: String(Math.round(parseNum(rec.intake))),
    burned: String(Math.round(parseNum(rec.burned))),
  };
}

/** Health Data シートの 1 行（A〜H 列） */
export const healthSheetValues = (r) => [toHealthSheetDate(r.date), r.sleep, r.protein, r.fat, r.carb, r.intake, r.burned, formatDiff(r.intake, r.burned)];

export const LIMITS = { part: 40, exercise: 120, details: 2000, memo: 4000, rows: 100 };

/**
 * 種目名の表記ゆれをそろえる（アプリ側 web/js/lib/parse.js の normalizeExerciseName と同じ規則）。
 * 末尾の「ロー」だけを「ロウ」にする（例: スミスベントロー → スミスベントロウ）。「ローイング」などは変えない。
 */
export const TRAILING_RO = /(?:ロ|ﾛ)[ーｰ－-]$/;
export function normalizeExerciseName(name) {
  return String(name ?? '').trim().replace(TRAILING_RO, 'ロウ');
}

/** クライアントから届いたワークアウト行を検証・整形。不正なら null。 */
export function sanitizeTrainingRow(row) {
  if (!row || typeof row !== 'object') return null;
  const cut = (v, n) => String(v ?? '').slice(0, n);
  const exercise = normalizeExerciseName(cut(row.exercise, LIMITS.exercise));
  const details = cut(row.details, LIMITS.details).trim();
  const memo = cut(row.memo, LIMITS.memo).trim();
  if (!exercise && !details && !memo) return null;
  return { part: cut(row.part, LIMITS.part).trim(), exercise: exercise || '種目不明', details, memo };
}

/** 名前の一括変更リクエストを検証する。不正なら例外。 */
export const RENAME_FIELDS = ['part', 'exercise'];
export function sanitizeRenameRequest(field, from, to) {
  if (!RENAME_FIELDS.includes(field)) throw new Error('変更できない項目です');
  if (!Array.isArray(from) || !from.length || from.length > 10) throw new Error('変更前の名前が正しくありません');
  const list = [...new Set(from.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (!list.length) throw new Error('変更前の名前が正しくありません');
  const next = String(to ?? '').trim().slice(0, LIMITS[field]);
  if (!next) throw new Error('新しい名前を入力してください');
  return { field, from: list, to: next };
}

/** 長さ以外に漏れる情報がないよう、定数時間で比較する */
export function safeEquals(a, b) {
  a = String(a ?? '');
  b = String(b ?? '');
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Google ヘルス API の「暦日」範囲 */
export function civilDayRange(iso) {
  const s = iso.split('-').map(Number);
  const e = nextIsoDate(iso).split('-').map(Number);
  return {
    start: { date: { year: s[0], month: s[1], day: s[2] }, time: { hours: 0, minutes: 0, seconds: 0 } },
    end: { date: { year: e[0], month: e[1], day: e[2] }, time: { hours: 0, minutes: 0, seconds: 0 } },
  };
}
