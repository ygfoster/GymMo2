/**
 * GymMo2 API（Apps Script ウェブアプリ）
 *
 * - 通信はすべて POST（本文は JSON 文字列）。パスコードは URL ではなく本文で送る。
 * - 認証: CONFIG.API_TOKEN（Config.gs）と一致すること。Config.gs は git に含まれない。
 * - 保存先: CONFIG.SPREADSHEET_ID のシート（複製した「fitbitデータ_GymMo2」）。元の GymMo のシートには触れない。
 *
 * アクション:
 *   ping                                    → 認証確認
 *   bootstrap                               → ワークアウト全行 + ヘルス全行（シートを読むだけなので高速）
 *   health   { date: 'YYYY-MM-DD' }         → その日のヘルスデータを Google ヘルス API から取得してシートに転記し、1 行返す
 *   saveDay  { date, rows: [...] }          → その日のワークアウト行を置き換え
 *   deleteDay{ date }                       → その日のワークアウト行を削除
 */

var SHEET_HEALTH = 'Health Data';
var SHEET_TRAINING = 'Workout Data';

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, app: 'GymMo2 API', note: 'POST のみ対応しています。' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'リクエストを解析できませんでした' });
  }
  if (!body || !safeEquals_(body.token, CONFIG.API_TOKEN)) {
    Utilities.sleep(400); // 総当たりを少し遅くする
    return json_({ ok: false, code: 'AUTH', error: 'パスコードが違います' });
  }
  try {
    switch (body.action) {
      case 'ping':
        return json_({ ok: true, time: Date.now() });
      case 'bootstrap':
        return json_(handleBootstrap_());
      case 'health':
        return json_(handleHealth_(body.date));
      case 'saveDay':
        return json_(withLock_(function () { return handleSaveDay_(body.date, body.rows); }));
      case 'deleteDay':
        return json_(withLock_(function () { return handleDeleteDay_(body.date); }));
      default:
        return json_({ ok: false, error: '不明な操作です' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- スプレッドシート ---------- */
function spreadsheet_() {
  // 必ず Config のシート ID を明示的に開く（元のシートを誤って書き換えないため、URL へのフォールバックはしない）
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function healthSheet_(ss) {
  return ss.getSheetByName(SHEET_HEALTH) || ss.getSheets()[0];
}

function trainingSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_TRAINING);
  if (sheet) return sheet;
  var sheets = ss.getSheets();
  if (sheets.length >= 2) return sheets[1];
  sheet = ss.insertSheet(SHEET_TRAINING);
  sheet.appendRow(['日付', 'トレーニング部位', '種目', '重量 × 回数', 'トレーニングメモ']);
  return sheet;
}

function readTraining_(ss) {
  var sheet = trainingSheet_(ss);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, 5).getDisplayValues();
  var out = [];
  rows.forEach(function (r) {
    var date = normalizeDateKey_(r[0]);
    if (!date) return;
    out.push({ date: date, part: r[1], exercise: r[2], details: r[3], memo: r[4] });
  });
  return out;
}

function readHealth_(ss) {
  var sheet = healthSheet_(ss);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, 8).getDisplayValues();
  var out = [];
  rows.forEach(function (r) {
    var date = normalizeDateKey_(r[0]);
    if (!date) return;
    out.push({ date: date, sleep: r[1], protein: r[2], fat: r[3], carb: r[4], intake: r[5], burned: r[6] });
  });
  return out;
}

/** 指定日（'yyyy/MM/dd'）の Health Data 行を { rowIndex(1始まり), rec } で返す。無ければ null。 */
function findHealthRow_(sheet, slashKey) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var values = sheet.getRange(1, 1, last, 8).getDisplayValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (normalizeDateKey_(values[i][0]) === slashKey) {
      var r = values[i];
      return { rowIndex: i + 1, rec: { sleep: r[1], protein: r[2], fat: r[3], carb: r[4], intake: r[5], burned: r[6] } };
    }
  }
  return null;
}

/** Health Data シートに 1 日分を書き込む（既存行があれば更新、無ければ追加）。表記は元のシートと同じ。 */
function upsertHealthRow_(ss, slashKey, rec) {
  var sheet = healthSheet_(ss);
  var found = findHealthRow_(sheet, slashKey);
  var row = [
    isValidSleep_(rec.sleep) ? String(rec.sleep) : '記録なし',
    formatGrams_(rec.protein),
    formatGrams_(rec.fat),
    formatGrams_(rec.carb),
    Math.round(parseNum_(rec.intake)),
    Math.round(parseNum_(rec.burned)),
    formatDiff_(rec.intake, rec.burned),
  ];
  if (found) {
    sheet.getRange(found.rowIndex, 2, 1, 7).setValues([row]);
  } else {
    sheet.appendRow([toHealthSheetDate_(slashKey)].concat(row, ['']));
  }
}

/* ---------- ハンドラ ---------- */
function handleBootstrap_() {
  var ss = spreadsheet_();
  return { ok: true, training: readTraining_(ss), health: readHealth_(ss), serverTime: Date.now() };
}

function handleHealth_(dateIso) {
  if (!isValidIsoDate_(dateIso)) throw new Error('日付の形式が正しくありません');
  var key = normalizeDateKey_(dateIso);
  var ss = spreadsheet_();
  var sheet = healthSheet_(ss);
  var saved = findHealthRow_(sheet, key);
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');

  // 過去日で睡眠と消費カロリーがすでに揃っていれば、API を呼ばずにシートの値を返す
  if (key !== today && saved && isValidSleep_(saved.rec.sleep) && isValidNumberMetric_(saved.rec.burned)) {
    return { ok: true, row: toSheetRow_(key, saved.rec), source: 'sheet' };
  }

  var results = fetchHealthForDates_([dateIso]);
  if (results._authError) {
    return { ok: true, row: saved ? toSheetRow_(key, saved.rec) : null, authWarning: results._errorMsg, source: 'sheet' };
  }
  var api = results[dateIso];
  var merged = mergeHealthRecords_(saved && saved.rec, api);
  if (hasAnyValidHealthMetric_(api)) {
    withLock_(function () { upsertHealthRow_(ss, key, merged); });
  }
  return { ok: true, row: hasAnyValidHealthMetric_(merged) ? toSheetRow_(key, merged) : null, source: 'api' };
}

function handleSaveDay_(dateIso, rows) {
  if (!isValidIsoDate_(dateIso)) throw new Error('日付の形式が正しくありません');
  if (!Array.isArray(rows)) throw new Error('rows が配列ではありません');
  var key = normalizeDateKey_(dateIso);
  var clean = rows.slice(0, LIMITS.rows).map(sanitizeTrainingRow_).filter(function (r) { return r; });
  var ss = spreadsheet_();
  var sheet = trainingSheet_(ss);

  deleteTrainingRowsOfDay_(sheet, key);

  if (clean.length) {
    var start = Math.max(sheet.getLastRow(), 1) + 1;
    var need = start + clean.length - 1;
    if (need > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), need - sheet.getMaxRows());
    var range = sheet.getRange(start, 1, clean.length, 5);
    // 文字列として書き込む（'=' や '+' で始まるメモが数式として解釈されるのを防ぎ、日付表記も崩さない）
    range.setNumberFormat('@');
    range.setValues(clean.map(function (r) { return [key, r.part, r.exercise, r.details, r.memo]; }));
  }
  return { ok: true, count: clean.length };
}

function handleDeleteDay_(dateIso) {
  if (!isValidIsoDate_(dateIso)) throw new Error('日付の形式が正しくありません');
  var ss = spreadsheet_();
  var removed = deleteTrainingRowsOfDay_(trainingSheet_(ss), normalizeDateKey_(dateIso));
  return { ok: true, removed: removed };
}

function deleteTrainingRowsOfDay_(sheet, slashKey) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var dates = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  var targets = [];
  dates.forEach(function (r, i) {
    if (normalizeDateKey_(r[0]) === slashKey) targets.push(i + 2);
  });
  groupConsecutive_(targets).forEach(function (g) {
    sheet.deleteRows(g.start, g.count);
  });
  return targets.length;
}
