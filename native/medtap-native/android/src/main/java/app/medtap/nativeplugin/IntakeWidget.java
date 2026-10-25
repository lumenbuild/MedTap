package app.medtap.nativeplugin;

import android.content.Context;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** 4. Protein and water: rings towards the day's targets, and + buttons with the person's own amounts (their cup, their
 *  scoop: the ones they last used in the app) without opening it. */
public class IntakeWidget extends BaseWidget {
    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        JSONObject in = d.optJSONObject("intake");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_intake);
        v.setOnClickPendingIntent(R.id.mw_root, WidgetStore.open(ctx, null, null, 0));
        double p = in == null ? 0 : in.optDouble("protein", 0), w = in == null ? 0 : in.optDouble("water", 0);
        double pt = in == null ? 0 : in.optDouble("proteinTarget", 0), wt = in == null ? 0 : in.optDouble("waterTarget", 0);
        v.setProgressBar(R.id.mw_p_ring, 100, pt > 0 ? (int) Math.min(100, Math.round(100 * p / pt)) : 0, false);
        v.setProgressBar(R.id.mw_w_ring, 100, wt > 0 ? (int) Math.min(100, Math.round(100 * w / wt)) : 0, false);
        v.setTextViewText(R.id.mw_p_val, Math.round(p) + (pt > 0 ? "/" + Math.round(pt) : "") + " g");
        v.setTextViewText(R.id.mw_w_val, (w >= 1000 ? (Math.round(w / 100) / 10.0) + " L" : Math.round(w) + " mL"));
        v.setTextViewText(R.id.mw_p_label, "Protein");
        v.setTextViewText(R.id.mw_w_label, wt > 0 ? "Water of " + (Math.round(wt / 100) / 10.0) + " L" : "Water");
        int pa = in == null ? 25 : Math.max(1, in.optInt("proteinAdd", 25)), wa = in == null ? 250 : Math.max(1, in.optInt("waterAdd", 250));
        v.setTextViewText(R.id.mw_p_add, "+" + pa + " g");
        v.setTextViewText(R.id.mw_w_add, "+" + wa + " mL");
        try {
            v.setOnClickPendingIntent(R.id.mw_p_add, WidgetStore.action(ctx, new JSONObject().put("kind", "intake").put("field", "proteinG").put("amount", pa).put("toast", "+" + pa + " g protein"), 40));
            v.setOnClickPendingIntent(R.id.mw_w_add, WidgetStore.action(ctx, new JSONObject().put("kind", "intake").put("field", "waterMl").put("amount", wa).put("toast", "+" + wa + " mL water"), 41));
        } catch (Exception ignored) { }
        return v;
    }
}
