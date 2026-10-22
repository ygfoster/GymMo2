/**
 * 純粋関数（副作用なし）。Node からもテストできるよう、末尾で module.exports を条件付きで公開している。
 * 名前の末尾に _ が付く関数は Apps Script のエディタ実行メニューや外部から呼べない「非公開」扱い。
 */
var TZ = 'Asia/Tokyo';

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Date / 'YYYY-MM-DD' / 'YYYY/M/D' / ISO 文字列 → 'yyyy/MM/dd'。解釈できなければ ''。 */
function normalizeDateKey_(val) {
  if (val === null || val === undefined || val === '') return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, TZ, 'yyyy/MM/dd');
  }
  var s = String(val).trim();
  var m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(s);
  if (!m) return '';
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '/' + pad2_(mo) + '/' + pad2_(d);
}

/** 'yyyy/MM/dd' → 'yyyy-MM-dd' */
function toIso_(slashKey) {
  return String(slashKey).replace(/\//g, '-');
}

/** 'yyyy/MM/dd' → 'yyyy/M/d'（Health Data シートの既存表記に合わせる） */
function toHealthSheetDate_(slashKey) {
  var p = String(slashKey).split('/');
  return Number(p[0]) + '/' + Number(p[1]) + '/' + Number(p[2]);
}

function isValidIsoDate_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && normalizeDateKey_(s) !== '';
}

/** 'yyyy-MM-dd' の翌日 */
function nextIsoDate_(iso) {
  var p = iso.split('-').map(Number);
  var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
  return dt.getUTCFullYear() + '-' + pad2_(dt.getUTCMonth() + 1) + '-' + pad2_(dt.getUTCDate());
}

function parseNum_(v) {
  if (v === undefined || v === null || v === '') return 0;
  var n = parseFloat(String(v).replace(/[^-0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function isValidSleep_(v) {
  if (!v) return false;
  var s = String(v).trim();
  return s !== '' && s !== '記録なし' && s !== '-' && s !== '--' && s !== '0' && s !== '0時間0分';
}

function isValidNumberMetric_(v) {
  if (v === undefined || v === null) return false;
  var s = String(v).trim();
  if (s === '' || s === '-' || s === '--' || s === '...' || s.indexOf('#') !== -1 || s === 'NaN') return false;
  return parseNum_(s) > 0;
}

function hasAnyValidHealthMetric_(rec) {
  if (!rec) return false;
  return (
    isValidSleep_(rec.sleep) ||
    isValidNumberMetric_(rec.intake) ||
    isValidNumberMetric_(rec.burned) ||
    isValidNumberMetric_(rec.protein) ||
    isValidNumberMetric_(rec.fat) ||
    isValidNumberMetric_(rec.carb)
  );
}

function formatGrams_(v) {
  return Math.round(parseNum_(v)) + ' g';
}

function formatDiff_(intake, burned) {
  var diff = Math.round(parseNum_(intake) - parseNum_(burned));
  return (diff > 0 ? '+' : '') + diff + ' kcal';
}

function minutesToSleepText_(minutes) {
  if (!(minutes > 0)) return '';
  return Math.floor(minutes / 60) + '時間' + (minutes % 60) + '分';
}

/**
 * シートの値（表示文字列）とAPIの値を統合する。API 側に意味のある値があればそれを優先。
 * 戻り値は数値/文字列が混在する生レコード（sheet 書き込み・クライアント返却用に toSheetRow_ で整形する）。
 */
function mergeHealthRecords_(sheetRec, apiRec) {
  var base = sheetRec || { sleep: '', protein: '', fat: '', carb: '', intake: '', burned: '' };
  if (!apiRec) return base;
  return {
    sleep: isValidSleep_(apiRec.sleep) ? apiRec.sleep : base.sleep,
    protein: isValidNumberMetric_(apiRec.protein) ? apiRec.protein : base.protein,
    fat: isValidNumberMetric_(apiRec.fat) ? apiRec.fat : base.fat,
    carb: isValidNumberMetric_(apiRec.carb) ? apiRec.carb : base.carb,
    intake: isValidNumberMetric_(apiRec.intake) ? apiRec.intake : base.intake,
    burned: isValidNumberMetric_(apiRec.burned) ? apiRec.burned : base.burned,
  };
}

/** クライアントに返す 1 日分の行（Health Data シートの表示形式に揃える） */
function toSheetRow_(slashKey, rec) {
  return {
    date: slashKey,
    sleep: isValidSleep_(rec.sleep) ? String(rec.sleep) : '記録なし',
    protein: formatGrams_(rec.protein),
    fat: formatGrams_(rec.fat),
    carb: formatGrams_(rec.carb),
    intake: String(Math.round(parseNum_(rec.intake))),
    burned: String(Math.round(parseNum_(rec.burned))),
  };
}

var LIMITS = { part: 40, exercise: 120, details: 2000, memo: 4000, rows: 100 };

/** クライアントから届いたワークアウト行を検証・整形。不正なら null。 */
function sanitizeTrainingRow_(row) {
  if (!row || typeof row !== 'object') return null;
  var cut = function (v, n) {
    return String(v === undefined || v === null ? '' : v).slice(0, n);
  };
  var exercise = normalizeExerciseName_(cut(row.exercise, LIMITS.exercise));
  var details = cut(row.details, LIMITS.details).trim();
  var memo = cut(row.memo, LIMITS.memo).trim();
  if (!exercise && !details && !memo) return null;
  return { part: cut(row.part, LIMITS.part).trim(), exercise: exercise || '種目不明', details: details, memo: memo };
}

/**
 * シートに「文字列として」書き込むための値。
 * setValues は '=' で始まる文字列を数式として評価し、'1/2' を日付に、'+3' を数値に変換してしまう。
 * 先頭にアポストロフィを付けると、Sheets は常にテキストとして保存する（アポストロフィ自体は値に含まれない）。
 */
function asTextCell_(v) {
  var s = String(v === undefined || v === null ? '' : v);
  return s === '' ? '' : "'" + s;
}

/**
 * 種目名の表記ゆれをそろえる（アプリ側 js/lib/parse.js の normalizeExerciseName と同じ規則）。
 * 末尾の「ロー」だけを「ロウ」にする（例: スミスベントロー → スミスベントロウ）。「ローイング」などは変えない。
 */
var TRAILING_RO_ = /(?:ロ|ﾛ)[ーｰ－\-]$/;
function normalizeExerciseName_(name) {
  var s = String(name === undefined || name === null ? '' : name).trim();
  return s.replace(TRAILING_RO_, 'ロウ');
}

/**
 * 1 列分の表示値（[[v],[v],...]、先頭はデータ 1 行目）から、書き換えが必要な行を探す。
 * mapFn(値) が元と異なる値を返した行を { index(0始まり), value } で返す。
 */
function planColumnRewrite_(values, mapFn) {
  var out = [];
  values.forEach(function (r, i) {
    var cur = String(r[0] === undefined || r[0] === null ? '' : r[0]);
    if (!cur.trim()) return;
    var next = mapFn(cur);
    if (next !== null && next !== undefined && next !== cur) out.push({ index: i, value: next });
  });
  return out;
}

/** 名前の一括変更リクエストを検証する。不正なら例外。 */
var RENAME_FIELDS_ = { part: 2, exercise: 3 };
function sanitizeRenameRequest_(field, from, to) {
  if (!Object.prototype.hasOwnProperty.call(RENAME_FIELDS_, field)) throw new Error('変更できない項目です');
  if (!Array.isArray(from) || !from.length || from.length > 10) throw new Error('変更前の名前が正しくありません');
  var list = [];
  from.forEach(function (v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s && list.indexOf(s) === -1) list.push(s);
  });
  if (!list.length) throw new Error('変更前の名前が正しくありません');
  var next = String(to === undefined || to === null ? '' : to).trim().slice(0, LIMITS[field]);
  if (!next) throw new Error('新しい名前を入力してください');
  return { column: RENAME_FIELDS_[field], from: list, to: next };
}

/** 連続する行番号をまとめて [{start, count}] にする（降順で返し、下から削除できるようにする） */
function groupConsecutive_(rowNumbers) {
  var sorted = rowNumbers.slice().sort(function (a, b) { return a - b; });
  var groups = [];
  sorted.forEach(function (n) {
    var last = groups[groups.length - 1];
    if (last && n === last.start + last.count) last.count += 1;
    else groups.push({ start: n, count: 1 });
  });
  return groups.reverse();
}

/** 長さ以外に漏れる情報がないよう、定数時間で比較する */
function safeEquals_(a, b) {
  a = String(a === undefined || a === null ? '' : a);
  b = String(b === undefined || b === null ? '' : b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeDateKey_: normalizeDateKey_, toIso_: toIso_, toHealthSheetDate_: toHealthSheetDate_, isValidIsoDate_: isValidIsoDate_,
    nextIsoDate_: nextIsoDate_, parseNum_: parseNum_, isValidSleep_: isValidSleep_, isValidNumberMetric_: isValidNumberMetric_,
    hasAnyValidHealthMetric_: hasAnyValidHealthMetric_, formatGrams_: formatGrams_, formatDiff_: formatDiff_,
    minutesToSleepText_: minutesToSleepText_, mergeHealthRecords_: mergeHealthRecords_, toSheetRow_: toSheetRow_,
    sanitizeTrainingRow_: sanitizeTrainingRow_, asTextCell_: asTextCell_, groupConsecutive_: groupConsecutive_, safeEquals_: safeEquals_,
    normalizeExerciseName_: normalizeExerciseName_, planColumnRewrite_: planColumnRewrite_, sanitizeRenameRequest_: sanitizeRenameRequest_,
  };
}
