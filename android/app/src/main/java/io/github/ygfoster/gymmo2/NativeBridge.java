package io.github.ygfoster.gymmo2;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Web 側（window.GymMoNative）から呼べるネイティブ機能。
 * JavascriptInterface のメソッドは WebView の別スレッドで呼ばれるので、UI を触るときは runOnUiThread を使う。
 */
final class NativeBridge {
    private final MainActivity activity;
    private final Context app;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
    }

    /** アプリ情報（Web 側がネイティブ版かどうかの判定にも使う） */
    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("native", true);
            o.put("version", BuildConfig.VERSION_NAME);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("notifications", activity.notificationsAllowed());
        } catch (JSONException ignored) {
            // 基本型のみ
        }
        return o.toString();
    }

    /** 休憩タイマーの状態を受け取り、通知とアラームに反映する */
    @JavascriptInterface
    public void timerSync(String json) {
        try {
            TimerState incoming = TimerState.fromJson(json);
            TimerState current = TimerState.load(app);
            // ネイティブ側（通知ボタン）のほうが新しい状態なら、古い Web 側の状態では上書きしない
            if (incoming.updatedAt < current.updatedAt) return;
            // Web 側が先に「終了」を検知して送ってきた場合も、バックグラウンドなら終了通知を必ず出す
            boolean finishedNow = "done".equals(incoming.status) && "running".equals(current.status);
            incoming.save(app);
            TimerNotifier.apply(app, incoming);
            if (finishedNow) TimerNotifier.postDoneIfBackground(app, incoming);
        } catch (JSONException e) {
            // 不正な入力は無視
        }
    }

    /** 通知のボタンなどでネイティブ側が変えた状態を、まとめて受け取る（JSON 配列） */
    @JavascriptInterface
    public String pollEvents() {
        return TimerState.drainEvents(app);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return activity.notificationsAllowed();
    }

    @JavascriptInterface
    public void requestNotifications() {
        activity.runOnUiThread(activity::requestNotificationPermission);
    }

    /** システムバーの文字色と背景を、Web のテーマに合わせる */
    @JavascriptInterface
    public void setTheme(boolean dark, String bgHex) {
        int bg;
        try {
            bg = Color.parseColor(bgHex);
        } catch (IllegalArgumentException e) {
            bg = dark ? Color.BLACK : 0xFFF2F2F7;
        }
        final int color = bg;
        activity.runOnUiThread(() -> activity.applyTheme(dark, color));
    }

    /** CSV などをダウンロードフォルダへ保存する（WebView は blob: のダウンロードに対応していないため） */
    @JavascriptInterface
    public void saveFile(String name, String mime, String text) {
        String safeName = name == null ? "gymmo2.txt" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
        try {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            ContentResolver r = app.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
            v.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "text/csv" : mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("保存先を作成できません");
            try (OutputStream out = r.openOutputStream(uri)) {
                if (out == null) throw new IOException("書き込めません");
                out.write(bytes);
            }
            toast("ダウンロードに保存しました: " + safeName);
        } catch (IOException | RuntimeException e) {
            toast("保存できませんでした");
        }
    }

    private void toast(String msg) {
        activity.runOnUiThread(() -> Toast.makeText(app, msg, Toast.LENGTH_LONG).show());
    }
}
