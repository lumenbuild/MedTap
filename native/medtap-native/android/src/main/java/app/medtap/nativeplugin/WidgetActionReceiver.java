package app.medtap.nativeplugin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;
import org.json.JSONObject;

/**
 * A widget tap logged without opening the app: queued with its time for the app to log (with the same double-log
 * guard as a tag), and shown on the widgets straight away (protein and water totals).
 */
public class WidgetActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            JSONObject a = new JSONObject(intent.getStringExtra("a"));
            a.put("at", System.currentTimeMillis());
            WidgetStore.enqueue(ctx, a);
            JSONObject d = WidgetStore.load(ctx);
            String kind = a.optString("kind");
            if ("intake".equals(kind) && d.has("intake")) {
                JSONObject in = d.getJSONObject("intake");
                String key = "proteinG".equals(a.optString("field")) ? "protein" : "water";
                in.put(key, in.optDouble(key, 0) + a.optDouble("amount", 0));
                WidgetStore.save(ctx, d.toString());
            } else WidgetStore.refreshAll(ctx);
            Toast.makeText(ctx, a.optString("toast", "Logged"), Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) { /* malformed: ignore */ }
    }
}
