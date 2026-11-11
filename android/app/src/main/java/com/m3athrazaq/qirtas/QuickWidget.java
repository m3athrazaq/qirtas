package com.m3athrazaq.qirtas;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** Home-screen widget: a quick note, today's page, a new page and search, one tap each.
 *  Each button opens the app on a qirtas:// address, the same ones the launcher shortcuts use. */
public class QuickWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick);
            views.setOnClickPendingIntent(R.id.widget_capture, open(context, "capture", 1));
            views.setOnClickPendingIntent(R.id.widget_today, open(context, "today", 2));
            views.setOnClickPendingIntent(R.id.widget_new, open(context, "new", 3));
            views.setOnClickPendingIntent(R.id.widget_search, open(context, "search", 4));
            manager.updateAppWidget(widgetId, views);
        }
    }

    private static PendingIntent open(Context context, String action, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("qirtas://" + action));
        intent.setComponent(new ComponentName(context, MainActivity.class));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
