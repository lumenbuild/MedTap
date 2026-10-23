package app.medtap.nativeplugin;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** A home-screen widget drawn from the app's payload. */
public abstract class BaseWidget extends AppWidgetProvider {
    abstract RemoteViews render(Context ctx, JSONObject d);

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        JSONObject d = WidgetStore.load(ctx);
        for (int id : ids) mgr.updateAppWidget(id, render(ctx, d));
    }

    /** Opens the app on its first screen when there's nothing to show yet. */
    static RemoteViews empty(Context ctx, int layout, int titleId, String text) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout);
        v.setTextViewText(titleId, text);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, null, 0));
        return v;
    }

    static String time(long ms) {
        return new java.text.SimpleDateFormat("h:mm a", java.util.Locale.forLanguageTag("en-AU")).format(new java.util.Date(ms)).toLowerCase(java.util.Locale.ROOT);
    }
}
