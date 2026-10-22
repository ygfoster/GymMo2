package io.github.ygfoster.gymmo2;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import java.util.Arrays;
import java.util.Locale;

/**
 * 休憩タイマーの通知とアラーム。
 * - 進行中: 通知欄に「カウントダウン」（システムが毎秒描画するので、アプリが止まっていても進む）
 * - 終了: AlarmManager の正確なアラームで、画面オフ・Doze 中でも秒単位で鳴らす
 * - 通知のボタン: 一時停止 / 再開 / +30 秒 / リセット（Web 側が動いていなくても操作できる）
 */
final class TimerNotifier {
    static final String CH_RUNNING = "rest_running";
    static final String CH_DONE = "rest_done";
    static final int ID_RUNNING = 1001;
    static final int ID_DONE = 1002;

    static final String ACT_ALARM = "io.github.ygfoster.gymmo2.REST_ALARM";
    static final String ACT_PAUSE = "io.github.ygfoster.gymmo2.REST_PAUSE";
    static final String ACT_RESUME = "io.github.ygfoster.gymmo2.REST_RESUME";
    static final String ACT_ADD30 = "io.github.ygfoster.gymmo2.REST_ADD30";
    static final String ACT_RESET = "io.github.ygfoster.gymmo2.REST_RESET";

    private TimerNotifier() {}

    /* ---------- チャンネル ---------- */
    static void ensureChannels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);

        NotificationChannel running = new NotificationChannel(CH_RUNNING, "休憩タイマー（進行中）", NotificationManager.IMPORTANCE_LOW);
        running.setDescription("休憩中の残り時間を通知欄に表示します");
        running.setShowBadge(false);
        running.setSound(null, null);
        running.enableVibration(false);

        NotificationChannel done = new NotificationChannel(CH_DONE, "休憩終了", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("休憩が終わったときに音と振動でお知らせします");
        done.enableVibration(true);
        done.setVibrationPattern(new long[] {0, 260, 120, 260, 120, 420});
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        done.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), attrs);

        nm.createNotificationChannels(Arrays.asList(running, done));
    }

    /* ---------- 状態を反映 ---------- */
    /** Web 側（または通知ボタン）から受け取った状態を、通知とアラームに反映する */
    static void apply(Context c, TimerState s) {
        ensureChannels(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        switch (s.status) {
            case "running":
                scheduleAlarm(c, s.endsAt);
                if (s.notify) nm.notify(ID_RUNNING, buildRunning(c, s));
                else nm.cancel(ID_RUNNING);
                nm.cancel(ID_DONE);
                break;
            case "paused":
                cancelAlarm(c);
                if (s.notify) nm.notify(ID_RUNNING, buildPaused(c, s));
                else nm.cancel(ID_RUNNING);
                break;
            case "done":
                cancelAlarm(c);
                nm.cancel(ID_RUNNING);
                break;
            default:
                cancelAlarm(c);
                nm.cancel(ID_RUNNING);
                nm.cancel(ID_DONE);
        }
    }

    /** アラーム発火: 休憩終了 */
    static void onAlarm(Context c) {
        TimerState s = TimerState.load(c);
        if (!"running".equals(s.status)) return;
        long now = System.currentTimeMillis();
        if (now < s.endsAt - 1500) { // 時刻がずれて早く来た場合は撃ち直す
            scheduleAlarm(c, s.endsAt);
            return;
        }
        s.status = "done";
        s.remainingSec = 0;
        s.endsAt = 0;
        s.updatedAt = now;
        s.save(c);
        TimerState.pushEvent(c, s);

        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.cancel(ID_RUNNING);
        postDoneIfBackground(c, s);
        MainActivity.deliverEvents();
    }

    /** 終了通知（音と振動）。アプリを見ているときは Web 側が音と振動で知らせるので出さない。 */
    static void postDoneIfBackground(Context c, TimerState s) {
        if (!s.notify || MainActivity.isInForeground()) return;
        ensureChannels(c);
        c.getSystemService(NotificationManager.class).notify(ID_DONE, buildDone(c, s));
    }

    /** 通知のボタン操作 */
    static void onAction(Context c, String action) {
        TimerState s = TimerState.load(c);
        long now = System.currentTimeMillis();
        switch (action) {
            case ACT_PAUSE:
                if (!"running".equals(s.status)) return;
                s.remainingSec = Math.max(0, (s.endsAt - now) / 1000.0);
                s.status = "paused";
                s.endsAt = 0;
                break;
            case ACT_RESUME:
                if (!"paused".equals(s.status)) return;
                s.status = "running";
                s.endsAt = now + (long) (s.remainingSec * 1000);
                break;
            case ACT_ADD30:
                if ("running".equals(s.status)) {
                    s.endsAt += 30_000;
                    s.totalSec = Math.max(s.totalSec, (s.endsAt - now) / 1000.0);
                } else if ("paused".equals(s.status)) {
                    s.remainingSec += 30;
                    s.totalSec = Math.max(s.totalSec, s.remainingSec);
                } else {
                    return;
                }
                break;
            case ACT_RESET:
                s.status = "idle";
                s.endsAt = 0;
                s.remainingSec = s.totalSec;
                break;
            default:
                return;
        }
        s.updatedAt = now;
        s.save(c);
        TimerState.pushEvent(c, s);
        apply(c, s);
        MainActivity.deliverEvents();
    }

    /* ---------- アラーム ---------- */
    private static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, TimerReceiver.class).setAction(ACT_ALARM);
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void scheduleAlarm(Context c, long at) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        long when = Math.max(at, System.currentTimeMillis() + 300);
        PendingIntent pi = alarmIntent(c);
        try {
            if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    static void cancelAlarm(Context c) {
        c.getSystemService(AlarmManager.class).cancel(alarmIntent(c));
    }

    /* ---------- 通知の組み立て ---------- */
    private static PendingIntent openApp(Context c, TimerState s) {
        Intent i = new Intent(c, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (s.logDate != null && !s.logDate.isEmpty()) i.putExtra(MainActivity.EXTRA_ROUTE, "/log/" + s.logDate);
        return PendingIntent.getActivity(c, 2, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification.Action action(Context c, String act, String title, int reqCode) {
        Intent i = new Intent(c, TimerReceiver.class).setAction(act);
        PendingIntent pi = PendingIntent.getBroadcast(c, reqCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat_timer), title, pi).build();
    }

    private static String title(String prefix, TimerState s) {
        return (s.label == null || s.label.isEmpty()) ? prefix : prefix + " · " + s.label;
    }

    private static Notification buildRunning(Context c, TimerState s) {
        Notification.Builder b = new Notification.Builder(c, CH_RUNNING)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(c.getColor(R.color.accent))
                .setContentTitle(title("休憩中", s))
                .setContentText("終了時にお知らせします")
                .setWhen(s.endsAt)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_STOPWATCH)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(c, s))
                .addAction(action(c, ACT_PAUSE, "一時停止", 11))
                .addAction(action(c, ACT_ADD30, "+30秒", 12))
                .addAction(action(c, ACT_RESET, "リセット", 13));
        promote(b);
        return b.build();
    }

    private static Notification buildPaused(Context c, TimerState s) {
        Notification.Builder b = new Notification.Builder(c, CH_RUNNING)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(c.getColor(R.color.accent))
                .setContentTitle(title("一時停止中", s))
                .setContentText("残り " + formatClock(s.remainingSec))
                .setShowWhen(false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_STOPWATCH)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openApp(c, s))
                .addAction(action(c, ACT_RESUME, "再開", 14))
                .addAction(action(c, ACT_ADD30, "+30秒", 12))
                .addAction(action(c, ACT_RESET, "リセット", 13));
        return b.build();
    }

    private static Notification buildDone(Context c, TimerState s) {
        return new Notification.Builder(c, CH_DONE)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(c.getColor(R.color.accent))
                .setContentTitle("休憩終了")
                .setContentText("次のセットを始めましょう")
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setTimeoutAfter(90_000)
                .setContentIntent(openApp(c, s))
                .build();
    }

    /**
     * Android 16 以降: 進行中の通知を、ステータスバーなどに目立たせる「ライブアップデート」にする。
     * コンパイル時の SDK に API がなくても動くようにリフレクションで呼び、非対応端末では何もしない。
     */
    private static void promote(Notification.Builder b) {
        if (Build.VERSION.SDK_INT < 36) return;
        try {
            Notification.Builder.class.getMethod("setRequestPromotedOngoing", boolean.class).invoke(b, true);
        } catch (Throwable e) {
            // 同じ意味の extra を直接立てておく（API 名が違う端末向けの保険）
            try {
                b.getExtras().putBoolean("android.requestPromotedOngoing", true);
            } catch (Throwable ignored) {
                // 通常の通知として動く
            }
        }
    }

    static String formatClock(double sec) {
        long s = Math.max(0, Math.round(sec));
        return String.format(Locale.JAPAN, "%02d:%02d", s / 60, s % 60);
    }
}
