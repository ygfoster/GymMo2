package io.github.ygfoster.gymmo2;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 休憩タイマーの状態（Web 側と同じ形）。ネイティブ側は通知とアラームのために保持する。
 * 通知のボタンで状態が変わったときは「イベント」として溜めておき、Web 側が次に起きたときに取り込む。
 */
final class TimerState {
    private static final String PREFS = "gymmo2_timer";
    private static final String KEY_STATE = "state";
    private static final String KEY_EVENTS = "events";
    private static final int MAX_EVENTS = 20;

    String status = "idle"; // idle | running | paused | done
    long endsAt = 0; // running のときの終了時刻（epoch ms）
    double remainingSec = 0; // paused / idle のときの残り
    double totalSec = 0;
    String label = ""; // 部位など
    String logDate = ""; // 通知タップで開く記録画面の日付
    long startedAt = 0;
    long updatedAt = 0;
    boolean notify = true; // 設定「休憩終了を通知」

    static TimerState fromJson(String json) throws JSONException {
        JSONObject o = new JSONObject(json);
        TimerState s = new TimerState();
        s.status = o.optString("status", "idle");
        s.endsAt = o.optLong("endsAt", 0);
        s.remainingSec = o.optDouble("remainingSec", 0);
        s.totalSec = o.optDouble("totalSec", 0);
        s.label = o.optString("label", "");
        s.logDate = o.optString("logDate", "");
        s.startedAt = o.optLong("startedAt", 0);
        s.updatedAt = o.optLong("updatedAt", 0);
        s.notify = o.optBoolean("notify", true);
        return s;
    }

    JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("status", status);
            o.put("endsAt", endsAt);
            o.put("remainingSec", remainingSec);
            o.put("totalSec", totalSec);
            o.put("label", label);
            o.put("logDate", logDate);
            o.put("startedAt", startedAt);
            o.put("updatedAt", updatedAt);
            o.put("notify", notify);
        } catch (JSONException ignored) {
            // 値はすべて基本型なので起こらない
        }
        return o;
    }

    static TimerState load(Context c) {
        String raw = prefs(c).getString(KEY_STATE, null);
        if (raw == null) return new TimerState();
        try {
            return fromJson(raw);
        } catch (JSONException e) {
            return new TimerState();
        }
    }

    void save(Context c) {
        prefs(c).edit().putString(KEY_STATE, toJson().toString()).apply();
    }

    /** ネイティブ側で状態が変わったことを、Web 側へ伝えるために溜める */
    static synchronized void pushEvent(Context c, TimerState s) {
        SharedPreferences p = prefs(c);
        JSONArray arr;
        try {
            arr = new JSONArray(p.getString(KEY_EVENTS, "[]"));
        } catch (JSONException e) {
            arr = new JSONArray();
        }
        arr.put(s.toJson());
        // 古いものから捨てる
        if (arr.length() > MAX_EVENTS) {
            JSONArray trimmed = new JSONArray();
            for (int i = arr.length() - MAX_EVENTS; i < arr.length(); i++) trimmed.put(arr.opt(i));
            arr = trimmed;
        }
        p.edit().putString(KEY_EVENTS, arr.toString()).apply();
    }

    static synchronized String drainEvents(Context c) {
        SharedPreferences p = prefs(c);
        String raw = p.getString(KEY_EVENTS, "[]");
        p.edit().putString(KEY_EVENTS, "[]").apply();
        return raw;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
