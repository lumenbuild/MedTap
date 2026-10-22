package app.medtap.nativeplugin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: the next dose with a live countdown, what to take or draw, and one-tap buttons for up to two
 * as-needed medicines. The app writes what to show (setWidget) whenever its data changes; buttons open the app's
 * Log dose for that medicine.
 */
public class DoseWidget extends AppWidgetProvider {
    private static final String PREFS = "medtap.widget";

    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, DoseWidget.class));
        for (int id : ids) mgr.updateAppWidget(id, render(ctx));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, render(ctx));
    }

    private static PendingIntent open(Context ctx, String medId, int code) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent();
        i.setAction(Intent.ACTION_MAIN);
        if (medId != null) i.putExtra("medtap.logMed", medId);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static RemoteViews render(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.medtap_widget);
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject d;
        try { d = new JSONObject(p.getString("data", "{}")); } catch (Exception e) { d = new JSONObject(); }
        v.setOnClickPendingIntent(R.id.widget_root, open(ctx, null, 0));
        String title = d.optString("title", "");
        if (title.isEmpty()) {
            v.setTextViewText(R.id.widget_label, d.optString("app", "Next dose"));
            v.setTextViewText(R.id.widget_title, "Open the app to set up");
            v.setViewVisibility(R.id.widget_countdown, View.GONE);
            v.setTextViewText(R.id.widget_when, "");
            v.setTextViewText(R.id.widget_detail, "");
        } else {
            v.setTextViewText(R.id.widget_label, d.optString("label", "Next"));
            v.setTextViewText(R.id.widget_title, title);
            v.setTextViewText(R.id.widget_when, d.optString("when", ""));
            v.setTextViewText(R.id.widget_detail, d.optString("detail", ""));
            long due = d.optLong("dueAt", 0);
            long left = due - System.currentTimeMillis();
            if (due > 0 && left > 0) {
                v.setViewVisibility(R.id.widget_countdown, View.VISIBLE);
                v.setChronometer(R.id.widget_countdown, SystemClock.elapsedRealtime() + left, "in %s", true);
                v.setChronometerCountDown(R.id.widget_countdown, true);
            } else {
                v.setViewVisibility(R.id.widget_countdown, View.GONE);
            }
            String logId = d.optString("logId", "");
            v.setOnClickPendingIntent(R.id.widget_root, open(ctx, logId.isEmpty() ? null : logId, 1));
        }
        JSONArray prn = d.optJSONArray("prn");
        int[] buttons = { R.id.widget_prn1, R.id.widget_prn2 };
        for (int k = 0; k < buttons.length; k++) {
            JSONObject b = prn != null ? prn.optJSONObject(k) : null;
            if (b == null) { v.setViewVisibility(buttons[k], View.GONE); continue; }
            v.setViewVisibility(buttons[k], View.VISIBLE);
            v.setTextViewText(buttons[k], "Log " + b.optString("name"));
            v.setOnClickPendingIntent(buttons[k], open(ctx, b.optString("id"), 10 + k));
        }
        return v;
    }
}
