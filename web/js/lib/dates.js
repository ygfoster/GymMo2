// 日付ユーティリティ。アプリ内部の日付は常に 'YYYY-MM-DD'（端末ローカル日付）のキーで扱う。
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export const WEEKDAYS_LONG = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

export const pad2 = (n) => String(n).padStart(2, '0');

export function toKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' → ローカル 0 時の Date。不正値は null。 */
export function fromKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const todayKey = () => toKey(new Date());

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function diffDays(a, b) {
  const da = fromKey(a);
  const db = fromKey(b);
  return Math.round((da - db) / 86400000);
}

export function addMonths(key, n) {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toKey(d);
}

/** 月曜始まりの週の開始日 */
export function startOfWeek(key) {
  const d = fromKey(key);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toKey(d);
}

export function weekKeys(key) {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function startOfMonth(key) {
  return key.slice(0, 8) + '01';
}

/** 月カレンダー用。月曜始まり、前後月の日付で埋めた 7 の倍数のセル配列。 */
export function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = -lead; i < days + ((7 - ((lead + days) % 7)) % 7); i++) {
    const d = new Date(year, month, 1 + i);
    cells.push({ key: toKey(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

export function weekdayOf(key) {
  return fromKey(key).getDay();
}

export function relativeLabel(key, today = todayKey()) {
  const d = diffDays(key, today);
  if (d === 0) return '今日';
  if (d === -1) return '昨日';
  if (d === 1) return '明日';
  return null;
}

/** 10月22日 */
export function formatMD(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 10/22(木) */
export function formatShort(key) {
  const d = fromKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

/** 2026年10月22日 */
export function formatYMD(key) {
  const d = fromKey(key);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatWeekdayLong(key) {
  return WEEKDAYS_LONG[fromKey(key).getDay()];
}

export function formatMonthTitle(year, month) {
  return `${year}年${month + 1}月`;
}

/**
 * シート由来の日付表現（'2026/10/8'、'2026/10/08'、'2026-10-08'、ISO 文字列、Date）を 'YYYY-MM-DD' に揃える。
 * 解釈できなければ null。
 */
export function parseSheetDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toKey(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : toKey(d);
  }
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（シート書き込み用。ワークアウト行は 0 埋め） */
export function toSheetDate(key) {
  return key.replace(/-/g, '/');
}

/** from から to まで（両端含む）のキー配列 */
export function rangeKeys(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}
