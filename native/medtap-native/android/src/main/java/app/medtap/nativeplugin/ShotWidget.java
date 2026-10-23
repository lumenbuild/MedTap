package app.medtap.nativeplugin;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** 3. Shot week: this week's shots, the next one, how today usually feels, and what's left in the vial or pen. */
public class ShotWidget extends BaseWidget {
    private static final int[] DOTS = { R.id.mw_d0, R.id.mw_d1, R.id.mw_d2, R.id.mw_d3, R.id.mw_d4, R.id.mw_d5, R.id.mw_d6 };
    private static final int[] LABELS = { R.id.mw_d0_l, R.id.mw_d1_l, R.id.mw_d2_l, R.id.mw_d3_l, R.id.mw_d4_l, R.id.mw_d5_l, R.id.mw_d6_l };

    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        JSONObject s = d.optJSONObject("shot");
        if (s == null) return empty(ctx, R.layout.mw_shot, R.id.mw_title, "No injection scheduled");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_shot);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, "/protocol", 2));
        v.setTextViewText(R.id.mw_title, s.optString("name"));
        v.setTextViewText(R.id.mw_next, "Next " + s.optString("next"));
        JSONArray days = s.optJSONArray("days");
        for (int i = 0; i < 7; i++) {
            JSONObject x = days != null ? days.optJSONObject(i) : null;
            v.setTextViewText(LABELS[i], x == null ? "" : x.optString("label"));
            String st = x == null ? "off" : x.optString("state");
            int res = "taken".equals(st) || "extra".equals(st) ? R.drawable.mw_day_done
                : "missed".equals(st) || "skipped".equals(st) || "partial".equals(st) ? R.drawable.mw_day_missed
                : "today".equals(st) ? R.drawable.mw_day_today
                : "upcoming".equals(st) ? R.drawable.mw_day_planned : R.drawable.mw_day_none;
            v.setImageViewResource(DOTS[i], res);
        }
        String feel = s.optString("feel", ""), left = s.optString("left", "");
        v.setViewVisibility(R.id.mw_feel, feel.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.mw_feel, "Today: " + feel);
        v.setTextViewText(R.id.mw_left, left);
        return v;
    }
}
