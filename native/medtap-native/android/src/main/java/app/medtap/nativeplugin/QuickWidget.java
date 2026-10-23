package app.medtap.nativeplugin;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** 5. Quick log: up to four one-tap buttons (as-needed medicines, coffee, a check-in). */
public class QuickWidget extends BaseWidget {
    private static final int[] BTN = { R.id.mw_q0, R.id.mw_q1, R.id.mw_q2, R.id.mw_q3 };

    @Override
    RemoteViews render(Context ctx, JSONObject d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mw_quick);
        JSONArray q = d.optJSONArray("quick");
        for (int i = 0; i < BTN.length; i++) {
            JSONObject it = q != null ? q.optJSONObject(i) : null;
            if (it == null) { v.setViewVisibility(BTN[i], View.INVISIBLE); continue; }
            v.setViewVisibility(BTN[i], View.VISIBLE);
            String kind = it.optString("kind"), label = it.optString("label");
            v.setTextViewText(BTN[i], label);
            try {
                if ("open".equals(kind)) v.setOnClickPendingIntent(BTN[i], WidgetStore.open(ctx, null, it.optString("route"), 50 + i));
                else if ("dose".equals(kind)) v.setOnClickPendingIntent(BTN[i], WidgetStore.action(ctx, new JSONObject().put("kind", "dose").put("medId", it.optString("id")).put("toast", "Logged " + label), 50 + i));
                else v.setOnClickPendingIntent(BTN[i], WidgetStore.action(ctx, new JSONObject().put("kind", "chip").put("chip", it.optString("chip")).put("toast", label + " logged"), 50 + i));
            } catch (Exception ignored) { }
        }
        return v;
    }
}
