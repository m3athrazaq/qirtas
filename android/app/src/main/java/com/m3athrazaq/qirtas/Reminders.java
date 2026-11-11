package com.m3athrazaq.qirtas;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Reminders handed to Android: each one is an exact alarm that wakes the phone and shows a
 * notification at its time, with the app closed too.
 *
 * The list is kept here as well as in the alarms, so the alarms can be set again whenever the app
 * opens, after a restart and after an update (a phone that cleared them, or an app that was stopped,
 * gets them back). Each notification shown is noted with the time it appeared, so the app can tell
 * when the phone held a reminder back and say so.
 */
final class Reminders {
    static final String CHANNEL = "reminders";
    static final String ACTION_FIRE = "com.m3athrazaq.qirtas.REMINDER";
    static final int TEST_ID = 42;

    private static final String PREFS = "qirtas_reminders";
    /** id -> {id, at, title, body, page, ws} */
    private static final String ITEMS = "items";
    /** "id@at" -> {t: when it was shown, r: why late ("boot", "update") or "off" (notifications off)} */
    private static final String SHOWN = "shown";
    /** A reminder that came due this long ago is still shown (late) when its alarm is set again. */
    private static final long RECENT = 10L * 60_000L;
    /** After a restart, reminders missed while the phone was off are shown if they are this recent. */
    private static final long KEEP_PAST = 24L * 3600_000L;
    private static final Object LOCK = new Object();

    private Reminders() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject read(Context c, String key) {
        try {
            return new JSONObject(prefs(c).getString(key, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static void write(Context c, String key, JSONObject value) {
        prefs(c).edit().putString(key, value.toString()).commit();
    }

    private static List<String> keys(JSONObject o) {
        List<String> out = new ArrayList<>();
        Iterator<String> it = o.keys();
        while (it.hasNext()) out.add(it.next());
        return out;
    }

    // ---------------------------------------------------------------- the list

    /**
     * The reminders of one workspace, from the app: they replace that workspace's earlier ones (the
     * others stay), and every alarm is set again. Returns how many are waiting.
     */
    static int set(Context c, String ws, JSONArray list) throws JSONException {
        synchronized (LOCK) {
            JSONObject all = read(c, ITEMS);
            Set<String> incoming = new HashSet<>();
            for (int i = 0; i < list.length(); i++) {
                JSONObject item = list.getJSONObject(i);
                item.put("ws", ws);
                String id = String.valueOf(item.getInt("id"));
                incoming.add(id);
                all.put(id, item);
            }
            for (String k : keys(all)) {
                JSONObject item = all.optJSONObject(k);
                if (item == null || (ws.equals(item.optString("ws")) && !incoming.contains(k))) {
                    cancelAlarm(c, Integer.parseInt(k));
                    all.remove(k);
                }
            }
            write(c, ITEMS, all);
            return armAll(c, all, null);
        }
    }

    /** Forget the reminders: all of them, or those of workspaces not in `keep`. */
    static void clear(Context c, Set<String> keep) {
        synchronized (LOCK) {
            JSONObject all = read(c, ITEMS);
            for (String k : keys(all)) {
                JSONObject item = all.optJSONObject(k);
                String ws = item != null ? item.optString("ws") : "";
                if (keep == null || (!keep.contains(ws) && !"test".equals(ws))) {
                    cancelAlarm(c, Integer.parseInt(k));
                    all.remove(k);
                }
            }
            write(c, ITEMS, all);
            if (keep == null) write(c, SHOWN, new JSONObject());
        }
    }

    /** A notification after `seconds`, through the same path as a reminder (to try them out). */
    static void test(Context c, int seconds, String title, String body) throws JSONException {
        synchronized (LOCK) {
            JSONObject all = read(c, ITEMS);
            JSONObject item = new JSONObject();
            item.put("id", TEST_ID);
            item.put("at", System.currentTimeMillis() + Math.max(1, seconds) * 1000L);
            item.put("title", title);
            item.put("body", body);
            item.put("page", "");
            item.put("ws", "test");
            all.put(String.valueOf(TEST_ID), item);
            write(c, ITEMS, all);
            arm(c, item);
        }
    }

    /**
     * Set the alarms again. `why` is null when the app sets them (a reminder that came due a moment
     * ago and wasn't shown goes off at once); "boot" or "update" after a restart or an update, when
     * the ones whose time passed meanwhile are shown at once.
     */
    static int armAll(Context c, JSONObject all, String why) {
        long now = System.currentTimeMillis();
        JSONObject shown = read(c, SHOWN);
        int waiting = 0;
        boolean changed = false;
        for (String k : keys(all)) {
            JSONObject item = all.optJSONObject(k);
            long at = item != null ? item.optLong("at") : 0;
            if (item == null) {
                all.remove(k);
                changed = true;
            } else if (at > now) {
                arm(c, item);
                waiting++;
            } else if (shown.has(k + "@" + at)) {
                all.remove(k);
                changed = true;
            } else if (why == null && now - at < RECENT) {
                arm(c, item);
            } else if (why != null && now - at < KEEP_PAST) {
                showNow(c, item, why);
                all.remove(k);
                changed = true;
            } else {
                all.remove(k);
                changed = true;
            }
        }
        if (changed) write(c, ITEMS, all);
        return waiting;
    }

    /** After a restart or an update: every reminder waits again. */
    static void restore(Context c, String why) {
        synchronized (LOCK) {
            armAll(c, read(c, ITEMS), why);
        }
    }

    // ---------------------------------------------------------------- alarms

    private static PendingIntent alarmIntent(Context c, int id) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION_FIRE).putExtra("id", id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    private static void arm(Context c, JSONObject item) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        int id = item.optInt("id");
        long at = item.optLong("at");
        PendingIntent pi = alarmIntent(c, id);
        try {
            // Wakes the phone at that minute, also while it is idle
            if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    private static void cancelAlarm(Context c, int id) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(alarmIntent(c, id));
    }

    // ---------------------------------------------------------------- showing

    /** The alarm went off. */
    static void fire(Context c, int id) {
        synchronized (LOCK) {
            JSONObject all = read(c, ITEMS);
            JSONObject item = all.optJSONObject(String.valueOf(id));
            if (item == null) return; // taken off meanwhile
            long at = item.optLong("at");
            if (read(c, SHOWN).has(id + "@" + at)) return; // already shown
            if (at - System.currentTimeMillis() > 60_000) {
                arm(c, item); // moved to a later time: wait for it
                return;
            }
            showNow(c, item, null);
            all.remove(String.valueOf(id));
            write(c, ITEMS, all);
        }
    }

    private static void showNow(Context c, JSONObject item, String why) {
        int id = item.optInt("id");
        long at = item.optLong("at");
        boolean shown = post(c, item);
        JSONObject log = read(c, SHOWN);
        try {
            JSONObject entry = new JSONObject();
            entry.put("t", System.currentTimeMillis());
            if (!shown) entry.put("r", "off");
            else if (why != null) entry.put("r", why);
            log.put(id + "@" + at, entry);
            // The last 200 are enough to tell what happened since the app was last open
            List<String> k = keys(log);
            if (k.size() > 200) {
                k.sort((a, b) -> Long.compare(shownAt(log, a), shownAt(log, b)));
                for (int i = 0; i < k.size() - 200; i++) log.remove(k.get(i));
            }
        } catch (JSONException ignored) {
        }
        write(c, SHOWN, log);
    }

    private static long shownAt(JSONObject log, String key) {
        JSONObject e = log.optJSONObject(key);
        return e != null ? e.optLong("t") : 0;
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, c.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    private static boolean post(Context c, JSONObject item) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        if (!nm.areNotificationsEnabled()) return false;
        ensureChannel(c);
        int id = item.optInt("id");
        String page = item.optString("page", "");
        String title = item.optString("title", c.getString(R.string.app_name));
        String body = item.optString("body", "");
        // Tapping it opens the page (or the app)
        Intent open = page.isEmpty()
            ? new Intent(c, MainActivity.class)
            : new Intent(Intent.ACTION_VIEW, Uri.parse("qirtas://page/" + Uri.encode(page)), c, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_qirtas)
            .setColor(0xFF2A47A8)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setWhen(item.optLong("at", System.currentTimeMillis()))
            .setShowWhen(true)
            .setAutoCancel(true)
            .setContentIntent(content);
        try {
            nm.notify(id, b.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- for the app

    /** What was shown, and when (to tell reminders held back by the phone). */
    static JSONObject shown(Context c) {
        synchronized (LOCK) {
            return read(c, SHOWN);
        }
    }

    /** Can reminders arrive on time with the app closed? */
    static JSObject health(Context c) {
        JSObject o = new JSObject();
        boolean channel = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            NotificationChannel ch = nm != null ? nm.getNotificationChannel(CHANNEL) : null;
            channel = ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        boolean permission = Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        o.put("notifications", permission && NotificationManagerCompat.from(c).areNotificationsEnabled() && channel);
        o.put("exact", canExact(c));
        PowerManager pm = c.getSystemService(PowerManager.class);
        o.put("battery", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName())));
        ActivityManager am = c.getSystemService(ActivityManager.class);
        o.put("restricted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && am != null && am.isBackgroundRestricted());
        o.put("maker", Build.MANUFACTURER);
        o.put("sdk", Build.VERSION.SDK_INT);
        synchronized (LOCK) {
            JSONObject all = read(c, ITEMS);
            long now = System.currentTimeMillis();
            int waiting = 0;
            for (String k : keys(all)) {
                JSONObject item = all.optJSONObject(k);
                if (item != null && item.optLong("at") > now && !"test".equals(item.optString("ws"))) waiting++;
            }
            o.put("waiting", waiting);
        }
        return o;
    }
}
