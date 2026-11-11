package com.m3athrazaq.qirtas;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * A reminder's alarm went off: show its notification. After the phone restarts or the app is
 * updated: set every reminder's alarm again (and show the ones that came due meanwhile).
 */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Reminders.ACTION_FIRE.equals(action)) {
            int id = intent.getIntExtra("id", Integer.MIN_VALUE);
            if (id != Integer.MIN_VALUE) Reminders.fire(context, id);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Reminders.restore(context, "boot");
        } else if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Reminders.restore(context, "update");
        }
    }
}
