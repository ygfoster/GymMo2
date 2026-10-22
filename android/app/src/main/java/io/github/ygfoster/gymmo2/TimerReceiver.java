package io.github.ygfoster.gymmo2;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** アラーム（休憩終了）と、通知のボタン操作を受け取る。アプリが終了していても動く。 */
public class TimerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (TimerNotifier.ACT_ALARM.equals(action)) {
            TimerNotifier.onAlarm(context);
        } else {
            TimerNotifier.onAction(context, action);
        }
    }
}
