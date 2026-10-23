package app.medtap.nativeplugin;

import android.content.Context;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** 6. Weight trend: weekly averages for 8 weeks, the forecast dashed, and when the goal is likely. */
public class WeightWidget extends BaseWidget {
    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        JSONObject w = d.optJSONObject("weight");
        if (w == null) return empty(ctx, R.layout.mw_weight, R.id.mw_title, "Log weight twice");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_weight);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, "/progress", 6));
        v.setTextViewText(R.id.mw_title, w.optString("latest"));
        v.setTextViewText(R.id.mw_text, w.optString("text"));
        v.setImageViewBitmap(R.id.mw_chart, Draw.trend(ctx, arr(w.optJSONArray("points")), arr(w.optJSONArray("forecast"))));
        return v;
    }

    private static double[] arr(JSONArray a) {
        if (a == null) return new double[0];
        double[] out = new double[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = a.optDouble(i);
        return out;
    }
}
