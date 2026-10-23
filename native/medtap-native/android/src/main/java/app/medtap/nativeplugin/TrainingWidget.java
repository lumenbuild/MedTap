package app.medtap.nativeplugin;

import android.content.Context;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** 7. Training: readiness as a ring and the first lift of the last session at today's target. */
public class TrainingWidget extends BaseWidget {
    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        JSONObject t = d.optJSONObject("training");
        if (t == null) return empty(ctx, R.layout.mw_training, R.id.mw_title, "Turn on Training in the app");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_training);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, "/training", 7));
        int score = t.optInt("score", -1);
        v.setProgressBar(R.id.mw_ring, 100, Math.max(0, score), false);
        v.setTextViewText(R.id.mw_score, score >= 0 ? String.valueOf(score) : "–");
        v.setTextViewText(R.id.mw_label, t.has("label") ? "Ready to train · " + t.optString("label") : "Ready to train");
        v.setTextViewText(R.id.mw_title, t.optString("lift", "Start a workout"));
        v.setTextViewText(R.id.mw_detail, t.optString("target", ""));
        return v;
    }
}
