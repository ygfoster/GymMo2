/**
 * Google ヘルス API（v4）連携: OAuth2・データ取得・シートへの定期転記。
 * 取得ロジックは元の GymMo のスクリプトと同じ API・同じ解釈（睡眠・消費カロリー・栄養ログ）を使う。
 *
 * 初回セットアップ（エディタで 1 回だけ）: setup() を実行 → ログの URL を開いて Google ヘルスへのアクセスを許可。
 */
var GOOGLE_HEALTH_BASE = 'https://health.googleapis.com/v4/users/me';
var HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
].join(' ');

/* ---------- OAuth2 ---------- */
function getHealthService_() {
  return OAuth2.createService('GoogleHealth')
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(CONFIG.OAUTH_CLIENT_ID)
    .setClientSecret(CONFIG.OAUTH_CLIENT_SECRET)
    .setCallbackFunction('authCallback')
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope(HEALTH_SCOPES)
    .setParam('prompt', 'consent')
    .setParam('access_type', 'offline');
}

/** OAuth の戻り先（Google の認可画面から自動で呼ばれる） */
function authCallback(request) {
  var ok = getHealthService_().handleCallback(request);
  return HtmlService.createHtmlOutput(
    ok ? '認証が完了しました。このタブを閉じて、GymMo2 に戻ってください。' : '認証に失敗しました。もう一度 setup() を実行してやり直してください。'
  );
}

/** 認証状態の確認と、必要なら認可用 URL をログに出す */
function authorize() {
  var service = getHealthService_();
  if (service.hasAccess()) {
    Logger.log('✅ Google ヘルスへのアクセスは許可済みです。');
  } else {
    Logger.log('次の URL を開いて、Google ヘルスへのアクセスを許可してください:\n' + service.getAuthorizationUrl());
  }
  Logger.log('OAuth リダイレクト URI（Google Cloud Console のクライアントに登録が必要）:\n' + service.getRedirectUri());
}

function resetToken() {
  getHealthService_().reset();
  Logger.log('保存済みの Google ヘルスのトークンを削除しました。');
}

/** 設定の確認・定期同期トリガーの設置・認証状態の確認をまとめて行う。エディタから 1 回実行する。 */
function setup() {
  var missing = ['API_TOKEN', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'SPREADSHEET_ID'].filter(function (k) { return !CONFIG[k]; });
  if (missing.length) throw new Error('Config.gs に未設定の項目があります: ' + missing.join(', '));
  var ss = spreadsheet_();
  Logger.log('✅ 保存先シート: 「' + ss.getName() + '」（' + ss.getSheets().map(function (s) { return s.getName(); }).join(' / ') + '）');
  setupAutoSyncTrigger();
  authorize();
}

/* ---------- 定期同期 ---------- */
/** 1 時間おきに、直近 7 日分を Google ヘルスから取得してシートへ転記する */
function setupAutoSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncRecentHealthDataToSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncRecentHealthDataToSheet').timeBased().everyHours(1).create();
  Logger.log('✅ 1 時間おきの自動同期トリガーを設定しました。');
}

function syncRecentHealthDataToSheet() {
  if (MOVED_TO) return; // 移転後は Cloudflare の Cron が取得してシートへコピーする
  var ss = spreadsheet_();
  var now = new Date();
  var dates = [];
  for (var i = 6; i >= 0; i--) {
    dates.push(Utilities.formatDate(new Date(now.getTime() - i * 86400000), TZ, 'yyyy-MM-dd'));
  }
  var results = fetchHealthForDates_(dates);
  if (results._authError) {
    Logger.log('【要認証】' + results._errorMsg);
    return;
  }
  var sheet = healthSheet_(ss);
  dates.forEach(function (iso) {
    var api = results[iso];
    if (!hasAnyValidHealthMetric_(api)) return;
    var key = normalizeDateKey_(iso);
    var saved = findHealthRow_(sheet, key);
    var merged = mergeHealthRecords_(saved && saved.rec, api);
    withLock_(function () { upsertHealthRow_(ss, key, merged); });
    Logger.log('転記: ' + key);
  });
}

/* ---------- Google ヘルス API v4 ---------- */
function civilDayRange_(iso) {
  var s = iso.split('-').map(Number);
  var e = nextIsoDate_(iso).split('-').map(Number);
  return {
    start: { date: { year: s[0], month: s[1], day: s[2] }, time: { hours: 0, minutes: 0, seconds: 0 } },
    end: { date: { year: e[0], month: e[1], day: e[2] }, time: { hours: 0, minutes: 0, seconds: 0 } },
  };
}

function fetchSleepMinutes_(iso, headers) {
  var filter = 'sleep.interval.civil_end_time >= "' + iso + '" AND sleep.interval.civil_end_time < "' + nextIsoDate_(iso) + '"';
  var url = GOOGLE_HEALTH_BASE + '/dataTypes/sleep/dataPoints:reconcile?filter=' + encodeURIComponent(filter);
  var res = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return 0;
  var points = JSON.parse(res.getContentText()).dataPoints || [];
  var total = 0;
  points.forEach(function (pt) {
    var slp = pt.sleep || pt;
    if (slp && slp.summary && slp.summary.minutesAsleep) total += parseInt(slp.summary.minutesAsleep, 10) || 0;
    else if (slp && slp.minutesAsleep) total += parseInt(slp.minutesAsleep, 10) || 0;
    else if (slp && slp.summary && Array.isArray(slp.summary.stagesSummary)) {
      slp.summary.stagesSummary.forEach(function (st) {
        if (st.type && st.type !== 'AWAKE' && st.type !== 'OUT_OF_BED') total += parseInt(st.minutes, 10) || 0;
      });
    }
  });
  return total;
}

function fetchBurnedKcal_(iso, headers) {
  var url = GOOGLE_HEALTH_BASE + '/dataTypes/total-calories/dataPoints:dailyRollUp';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ range: civilDayRange_(iso), windowSizeDays: 1 }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return 0;
  var data = JSON.parse(res.getContentText());
  var pts = data.rollupDataPoints || data.dailyRollupDataPoints || [];
  var kcal = 0;
  pts.forEach(function (p) {
    if (p.totalCalories && p.totalCalories.kcalSum !== undefined) kcal += Number(p.totalCalories.kcalSum) || 0;
  });
  return Math.round(kcal);
}

function fetchNutrition_(iso, headers) {
  var intake = 0, protein = 0, fat = 0, carb = 0;
  var res = UrlFetchApp.fetch(GOOGLE_HEALTH_BASE + '/dataTypes/nutrition-log/dataPoints:dailyRollUp', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ range: civilDayRange_(iso), windowSizeDays: 1 }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 200) {
    var pts = JSON.parse(res.getContentText()).rollupDataPoints || [];
    pts.forEach(function (p) {
      var nl = p.nutritionLog;
      if (!nl) return;
      if (nl.energy && nl.energy.kcalSum !== undefined) intake += Number(nl.energy.kcalSum) || 0;
      if (nl.totalFat && nl.totalFat.gramsSum !== undefined) fat += Number(nl.totalFat.gramsSum) || 0;
      if (nl.totalCarbohydrate && nl.totalCarbohydrate.gramsSum !== undefined) carb += Number(nl.totalCarbohydrate.gramsSum) || 0;
      if (Array.isArray(nl.nutrients)) {
        nl.nutrients.forEach(function (n) {
          var type = String(n.nutrient || '').toUpperCase();
          var g = n.quantity && n.quantity.gramsSum !== undefined ? Number(n.quantity.gramsSum) : 0;
          if (type === 'PROTEIN') protein += g;
          if ((type === 'TOTAL_FAT' || type === 'FAT') && fat === 0) fat += g;
          if ((type === 'TOTAL_CARBOHYDRATE' || type === 'CARBOHYDRATE' || type === 'CARBS') && carb === 0) carb += g;
        });
      }
    });
  }
  // ロールアップが空なら、個別の栄養ログを集計して補う
  if (intake === 0 && protein === 0 && fat === 0 && carb === 0) {
    var filter = 'nutrition_log.interval.civil_start_time >= "' + iso + '" AND nutrition_log.interval.civil_start_time < "' + nextIsoDate_(iso) + '"';
    var listRes = UrlFetchApp.fetch(GOOGLE_HEALTH_BASE + '/dataTypes/nutrition-log/dataPoints:reconcile?filter=' + encodeURIComponent(filter), {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    });
    if (listRes.getResponseCode() === 200) {
      (JSON.parse(listRes.getContentText()).dataPoints || []).forEach(function (pt) {
        var nl = pt.nutritionLog || pt;
        if (!nl) return;
        if (nl.energy && nl.energy.kcal !== undefined) intake += Number(nl.energy.kcal) || 0;
        if (nl.totalFat && nl.totalFat.grams !== undefined) fat += Number(nl.totalFat.grams) || 0;
        if (nl.totalCarbohydrate && nl.totalCarbohydrate.grams !== undefined) carb += Number(nl.totalCarbohydrate.grams) || 0;
        if (Array.isArray(nl.nutrients)) {
          nl.nutrients.forEach(function (n) {
            var type = String(n.nutrient || '').toUpperCase();
            var g = n.quantity && n.quantity.grams !== undefined ? Number(n.quantity.grams) : 0;
            if (type === 'PROTEIN') protein += g;
            if ((type === 'TOTAL_FAT' || type === 'FAT') && fat === 0) fat += g;
            if ((type === 'TOTAL_CARBOHYDRATE' || type === 'CARBOHYDRATE') && carb === 0) carb += g;
          });
        }
      });
    }
  }
  return { intake: Math.round(intake), protein: Math.round(protein), fat: Math.round(fat), carb: Math.round(carb) };
}

/**
 * 日付（'yyyy-MM-dd'）の配列について睡眠・消費・栄養を取得する。
 * 戻り値: { 'yyyy-MM-dd': { sleep, burned, intake, protein, fat, carb } | null, _authError?, _errorMsg? }
 */
function fetchHealthForDates_(isoDates) {
  var service = getHealthService_();
  if (!service.hasAccess()) {
    return { _authError: true, _errorMsg: 'Google ヘルスの認証が必要です（Apps Script で setup() を実行してください）' };
  }
  var token;
  try {
    token = service.getAccessToken();
  } catch (err) {
    return { _authError: true, _errorMsg: 'トークンの更新に失敗しました: ' + err };
  }
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  var results = {};
  isoDates.forEach(function (iso) {
    try {
      var sleep = fetchSleepMinutes_(iso, headers);
      Utilities.sleep(80);
      var burned = fetchBurnedKcal_(iso, headers);
      Utilities.sleep(80);
      var nut = fetchNutrition_(iso, headers);
      results[iso] = {
        sleep: minutesToSleepText_(sleep),
        burned: burned > 0 ? burned : '',
        intake: nut.intake > 0 ? nut.intake : '',
        protein: nut.protein > 0 ? nut.protein : '',
        fat: nut.fat > 0 ? nut.fat : '',
        carb: nut.carb > 0 ? nut.carb : '',
      };
    } catch (e) {
      console.error('Health fetch error ' + iso + ': ' + e);
      results[iso] = null;
    }
  });
  return results;
}
