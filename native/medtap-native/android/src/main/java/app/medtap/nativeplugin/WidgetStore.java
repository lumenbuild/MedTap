package app.medtap.nativeplugin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What the home-screen widgets show (one payload from the app, see src/logic/widgets.ts), and the taps on them that
 * the app still has to log (protein, water, an as-needed medicine, a coffee). Taps are kept here until the app
 * takes them, so none is lost while it isn't running.
 */
public final class WidgetStore {
    static final String PREFS = "medtap.widget";
    @SuppressWarnings("unchecked")
    static final Class<? extends BaseWidget>[] ALL = new Class[] {
        DoseWidget.class, WearWidget.class, ShotWidget.class, IntakeWidget.class, QuickWidget.class, WeightWidget.class, TrainingWidget.class, GlanceWidget.class,
    };
    /** Set by the plugin while the app runs, so a tap is logged at once. */
    static Runnable listener;

    private WidgetStore() {}

    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json).apply();
        refreshAll(ctx);
    }

    static JSONObject load(Context ctx) {
        try { return new JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", "{}")); }
        catch (Exception e) { return new JSONObject(); }
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        JSONObject d = load(ctx);
        for (Class<? extends BaseWidget> c : ALL) {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, c));
            if (ids.length == 0) continue;
            try {
                BaseWidget w = c.getDeclaredConstructor().newInstance();
                for (int id : ids) mgr.updateAppWidget(id, w.render(ctx, d));
            } catch (Exception ignored) { /* a widget that can't draw keeps its last look */ }
        }
    }

    static synchronized void enqueue(Context ctx, JSONObject action) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray arr = new JSONArray(p.getString("actions", "[]"));
            arr.put(action);
            p.edit().putString("actions", arr.toString()).apply();
        } catch (Exception ignored) { }
        if (listener != null) listener.run();
    }

    /** The waiting taps (oldest first), cleared. */
    static synchronized String take(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String s = p.getString("actions", "[]");
        p.edit().putString("actions", "[]").apply();
        return s;
    }

    /** Open the app (optionally straight into logging a medicine, or on a page). */
    static PendingIntent open(Context ctx, String medId, String route, int code) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent();
        i.setAction(Intent.ACTION_MAIN);
        if (medId != null) i.putExtra("medtap.logMed", medId);
        if (route != null) i.putExtra("medtap.route", route);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A tap that's logged without opening the app (see WidgetActionReceiver). */
    static PendingIntent action(Context ctx, JSONObject a, int code) {
        Intent i = new Intent(ctx, WidgetActionReceiver.class);
        i.setAction("app.medtap.WIDGET_ACTION." + code);
        i.putExtra("a", a.toString());
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
