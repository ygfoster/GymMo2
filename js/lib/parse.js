// シート上の文字列表現 ⇄ アプリ内部のデータ構造の変換。
// ワークアウトの書式は元の GymMo と同一（"1セット目: 50kg × 11回"）なので、両アプリが同じ行を読み書きできる。
import { parseSheetDate, toSheetDate } from './dates.js';

/** 既定の部位（設定で名前の変更・追加・削除ができる。「その他」は常にある固定の受け皿） */
export const DEFAULT_PARTS = ['胸', '背中', '脚', '肩', '腕'];
export const OTHER_PART = 'その他';

let knownParts = DEFAULT_PARTS.slice();

/** 設定で編集された部位の一覧を登録する（store が設定を読むたびに呼ぶ） */
export function setKnownParts(names) {
  knownParts = (names || []).map((n) => String(n).trim()).filter(Boolean);
}

export const getKnownParts = () => knownParts.slice();

/** 表記ゆれの吸収（足→脚）。空は '' を返す。 */
export function normPart(p) {
  const s = String(p ?? '').trim();
  return s === '足' && knownParts.includes('脚') ? '脚' : s;
}

/** 表示・集計用の部位。登録されていない部位（削除した部位を含む）は「その他」にまとめる */
export function partCategory(p) {
  const n = normPart(p);
  return knownParts.includes(n) ? n : OTHER_PART;
}

/**
 * 種目名の表記ゆれをそろえる。末尾の「ロー」は「ロウ」に統一する（例: スミスベントロー → スミスベントロウ）。
 * 「ローイング」「ロープ〜」など、末尾以外の「ロー」は変えない。半角の「ﾛｰ」や長音の代わりのハイフンも対象。
 */
export function normalizeExerciseName(name) {
  const s = String(name ?? '').trim();
  return s.replace(/(?:ロ|ﾛ)[ーｰ－\-]$/u, 'ロウ');
}

/** "105 g" / "+617 kcal" / "-1319 kcal" / "2,378" → 数値。解釈不能は null。 */
export function parseNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[−–—]/g, '-').replace(/,/g, '').trim();
  const m = /^[+-]?\d+(\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** "6時間32分" / "7時間" / "45分" / "6:32" → 分。"記録なし" などは null。 */
export function parseSleep(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d+)\s*時間\s*(?:(\d+)\s*分)?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0);
  m = /^(\d+)\s*分$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

/** 睡眠分 → "6時間32分" */
export function formatSleep(min) {
  if (min === null || min === undefined) return '--';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

const SET_LINE = /[:：]\s*([0-9]+(?:\.[0-9]+)?|-)\s*(?:kg)?\s*[×xX✕＊*ﾗ]\s*([0-9]+(?:\.[0-9]+)?|-)\s*(?:回)?/;

function cleanNum(s) {
  if (s === '-' || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "1セット目: 50kg × 11回\n2セット目: - × 9回" → [{w:50,r:11},{w:null,r:9}] */
export function parseSets(text) {
  if (!text) return [];
  const sets = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const m = SET_LINE.exec(line);
    if (m) sets.push({ w: cleanNum(m[1]), r: cleanNum(m[2]) });
  }
  return sets;
}

const fmtNum = (n) => String(Number(n.toFixed(2)));

/** 入力済みのセットのみを連番で書き出す。 */
export function formatSets(sets) {
  return sets
    .filter((s) => s.w != null || s.r != null)
    .map((s, i) => `${i + 1}セット目: ${s.w != null ? fmtNum(s.w) + 'kg' : '-'} × ${s.r != null ? fmtNum(s.r) + '回' : '-'}`)
    .join('\n');
}

/** 入力欄の文字列 → 数値 or null（0・負数・非数は null） */
export function toNumberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ワークアウト行 [{date, part, exercise, details, memo}] を日付ごとにまとめる。
 * 戻り値: { 'YYYY-MM-DD': { date, part, exercises: [{ id, name, part, sets, memo, raw }] } }
 */
export function rowsToTraining(rows) {
  const out = {};
  for (const row of rows || []) {
    const date = parseSheetDate(row.date);
    if (!date) continue;
    const day = (out[date] ||= { date, part: '', exercises: [] });
    const part = normPart(row.part);
    const sets = parseSets(row.details);
    const details = String(row.details ?? '').trim();
    day.exercises.push({
      id: `${date}#${day.exercises.length}`,
      name: normalizeExerciseName(row.exercise) || '種目不明',
      part,
      sets,
      memo: String(row.memo ?? '').trim(),
      raw: sets.length === 0 && details ? details : '',
    });
    if (!day.part && part) day.part = part;
  }
  return out;
}

/** アプリの 1 日分 → 保存用の行配列（シートの書式）。 */
export function trainingToRows(day) {
  const rows = [];
  for (const ex of day.exercises) {
    const name = normalizeExerciseName(ex.name);
    const details = formatSets(ex.sets);
    const memo = (ex.memo || '').trim();
    if (!name && !details && !memo) continue;
    rows.push({ date: toSheetDate(day.date), part: day.part, exercise: name || '種目不明', details, memo });
  }
  return rows;
}

/** ヘルスの 1 行 → 正規化レコード。数値は null（未取得）か number。 */
export function normalizeHealthRow(row) {
  const date = parseSheetDate(row.date);
  if (!date) return null;
  const rec = {
    date,
    sleepMin: parseSleep(row.sleep),
    protein: parseNumber(row.protein),
    fat: parseNumber(row.fat),
    carb: parseNumber(row.carb),
    intake: parseNumber(row.intake),
    burned: parseNumber(row.burned),
  };
  return rec;
}

const FIELDS = ['sleepMin', 'protein', 'fat', 'carb', 'intake', 'burned'];

/** 「意味のある値」か。0 は未記録扱い（元アプリと同じ判断）。 */
export const isMeaningful = (v) => v !== null && v !== undefined && v !== 0 && Number.isFinite(v);

/** 同じ日付のレコードを統合。後勝ちだが、意味のある値だけで上書きする。 */
export function mergeHealth(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = { date: b.date || a.date };
  for (const f of FIELDS) out[f] = isMeaningful(b[f]) ? b[f] : isMeaningful(a[f]) ? a[f] : (b[f] ?? a[f] ?? null);
  return out;
}

export function rowsToHealth(rows) {
  const map = {};
  for (const row of rows || []) {
    const rec = normalizeHealthRow(row);
    if (rec) map[rec.date] = mergeHealth(map[rec.date], rec);
  }
  return map;
}
