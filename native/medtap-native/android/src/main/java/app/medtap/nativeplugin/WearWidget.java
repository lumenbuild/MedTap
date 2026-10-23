package app.medtap.nativeplugin;

import android.content.Context;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** 2. Focus window: today's dose to the likely drop, with now marked. */
public class WearWidget extends BaseWidget {
    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        JSONObject w = d.optJSONObject("wear");
        if (w == null) return empty(ctx, R.layout.mw_wear, R.id.mw_title, "No forecast yet today");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_wear);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, null, 0));
        long now = System.currentTimeMillis(), at = w.optLong("at");
        v.setTextViewText(R.id.mw_label, w.optString("name"));
        v.setTextViewText(R.id.mw_title, now < at ? "Focus likely to " + time(at) : "Likely wearing off");
        v.setImageViewBitmap(R.id.mw_bar, Draw.timeBar(ctx, w.optLong("dosedAt"), w.optLong("early"), w.optLong("late"), now));
        v.setTextViewText(R.id.mw_detail, "Dose " + time(w.optLong("dosedAt")) + " · drop " + time(w.optLong("early")) + "–" + time(w.optLong("late")));
        return v;
    }
}
