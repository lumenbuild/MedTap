package app.medtap.nativeplugin;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** 8. Today at a glance: doses done, the next one, steps and the newest "What changed". */
public class GlanceWidget extends BaseWidget {
    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_glance);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, null, 8));
        int done = d.optInt("done", 0), total = d.optInt("total", 0);
        v.setProgressBar(R.id.mw_ring, 100, total > 0 ? Math.round(100f * done / total) : 0, false);
        v.setTextViewText(R.id.mw_ring_text, total > 0 ? done + "/" + total : "–");
        JSONObject g = d.optJSONObject("glance");
        v.setTextViewText(R.id.mw_next, g == null ? "Open the app to set up" : g.optString("next"));
        String steps = g == null ? "" : g.optString("steps", ""), change = g == null ? "" : g.optString("change", "");
        v.setViewVisibility(R.id.mw_steps, steps.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.mw_steps, steps);
        v.setViewVisibility(R.id.mw_change, change.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.mw_change, change);
        return v;
    }
}
