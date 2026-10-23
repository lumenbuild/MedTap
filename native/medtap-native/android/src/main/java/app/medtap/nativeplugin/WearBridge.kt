package app.medtap.nativeplugin

import android.content.Context
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import org.json.JSONObject

/**
 * Wear OS: the phone sends the watch what the widget shows (next dose, as-needed buttons), and the watch sends back
 * "log this medicine" taps. Taps are queued here until the app logs them (straight away if it's open), so a tap from
 * the wrist is never lost even with the phone locked. Nothing goes beyond the paired watch.
 */
object WearBridge {
    private const val PREFS = "medtap.wear"
    private const val QUEUE = "queue"
    const val STATE_PATH = "/medtap/state"
    const val LOG_PATH = "/medtap/log"

    /** Called with the widget's JSON each time it changes. Fails quietly when there's no watch or no Play services. */
    @JvmStatic
    fun push(context: Context, json: String) {
        try {
            val req = PutDataMapRequest.create(STATE_PATH)
            req.dataMap.putString("json", json)
            req.dataMap.putLong("t", System.currentTimeMillis())
            Wearable.getDataClient(context).putDataItem(req.asPutDataRequest().setUrgent())
        } catch (_: Exception) { /* no watch support on this phone */ }
    }

    @JvmStatic
    @Synchronized
    fun enqueue(context: Context, item: JSONObject) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(p.getString(QUEUE, "[]"))
        arr.put(item)
        p.edit().putString(QUEUE, arr.toString()).apply()
        listener?.invoke()
    }

    /** The queued taps (oldest first), cleared. */
    @JvmStatic
    @Synchronized
    fun take(context: Context): String {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val s = p.getString(QUEUE, "[]") ?: "[]"
        p.edit().putString(QUEUE, "[]").apply()
        return s
    }

    /** Set by the plugin while the app runs, so a tap is handled at once. */
    @JvmStatic
    var listener: (() -> Unit)? = null
}

/** Receives the watch's "log" messages: {"medId": "...", "at": 1730000000000}. */
class MedTapWearListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WearBridge.LOG_PATH) return
        try {
            val o = JSONObject(String(event.data, Charsets.UTF_8))
            if (!o.has("at")) o.put("at", System.currentTimeMillis())
            WearBridge.enqueue(applicationContext, o)
        } catch (_: Exception) { /* malformed: ignore */ }
    }
}
