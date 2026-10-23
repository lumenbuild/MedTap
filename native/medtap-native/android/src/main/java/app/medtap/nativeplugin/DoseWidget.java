package app.medtap.nativeplugin;

import android.content.Context;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

/**
 * 1. Next dose: a ring of today's doses done, the next one with a live countdown and what to take or draw, and Log
 * (opens the app straight into logging it, so its reminders are cleared). Shows "Done" once today is complete.
 */
public class DoseWidget extends BaseWidget {
    /** Kept for older callers: the plugin saves through WidgetStore. */
    static void save(Context ctx, String json) { WidgetStore.save(ctx, json); }

    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.medtap_widget);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetStore.open(ctx, null, null, 0));
        int done = d.optInt("done", 0), total = d.optInt("total", 0);
        v.setProgressBar(R.id.widget_ring, 100, total > 0 ? Math.round(100f * done / total) : 0, false);
        v.setTextViewText(R.id.widget_ring_text, total > 0 ? done + "/" + total : "–");
        String title = d.optString("title", "");
        if (title.isEmpty()) {
            v.setTextViewText(R.id.widget_label, d.optString("app", "Next dose"));
            v.setTextViewText(R.id.widget_title, "Open the app to set up");
            v.setViewVisibility(R.id.widget_countdown, View.GONE);
            v.setTextViewText(R.id.widget_when, "");
            v.setTextViewText(R.id.widget_detail, "");
            v.setViewVisibility(R.id.widget_log, View.GONE);
            return v;
        }
        v.setTextViewText(R.id.widget_label, d.optString("label", "Next"));
        v.setTextViewText(R.id.widget_title, title);
        v.setTextViewText(R.id.widget_when, d.optString("when", ""));
        v.setTextViewText(R.id.widget_detail, d.optString("detail", ""));
        long due = d.optLong("dueAt", 0), left = due - System.currentTimeMillis();
        if (due > 0 && left > 0) {
            v.setViewVisibility(R.id.widget_countdown, View.VISIBLE);
            v.setChronometer(R.id.widget_countdown, SystemClock.elapsedRealtime() + left, "in %s", true);
            v.setChronometerCountDown(R.id.widget_countdown, true);
        } else v.setViewVisibility(R.id.widget_countdown, View.GONE);
        boolean allDone = total > 0 && done >= total;
        String logId = d.optString("logId", "");
        v.setViewVisibility(R.id.widget_log, View.VISIBLE);
        v.setTextViewText(R.id.widget_log, allDone ? "Done ✓" : "Log");
        v.setOnClickPendingIntent(R.id.widget_log, WidgetStore.open(ctx, allDone || logId.isEmpty() ? null : logId, null, 1));
        return v;
    }
}
