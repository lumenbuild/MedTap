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
    const val STATE_PATH = "/medtap/state"
    const val LOG_PATH = "/medtap/log"
    /** The workout in progress (next set, rest end), and the watch's "set done" taps. */
    const val WORKOUT_PATH = "/medtap/workout"
    const val SET_PATH = "/medtap/set"
    /** From the watch: a focus rating or a noted symptom, or a reaction test result (biohacking tools). */
    const val CHECKIN_PATH = "/medtap/checkin"
    const val LOGS = "queue"
    const val SETS = "sets"
    const val CHECKINS = "checkins"

    /** Called with the widget's JSON each time it changes. Fails quietly when there's no watch or no Play services. */
    @JvmStatic
    fun push(context: Context, json: String) = put(context, STATE_PATH, json)

    /** The workout screen's state for the watch ("{}" when there's no workout going). */
    @JvmStatic
    fun pushWorkout(context: Context, json: String) = put(context, WORKOUT_PATH, json)

    private fun put(context: Context, path: String, json: String) {
        try {
            val req = PutDataMapRequest.create(path)
            req.dataMap.putString("json", json)
            req.dataMap.putLong("t", System.currentTimeMillis())
            Wearable.getDataClient(context).putDataItem(req.asPutDataRequest().setUrgent())
        } catch (_: Exception) { /* no watch support on this phone */ }
    }

    /** Queue a tap (`queue` is LOGS or SETS) and tell the app if it's running. */
    @JvmStatic
    @Synchronized
    fun enqueue(context: Context, queue: String, item: JSONObject) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(p.getString(queue, "[]"))
        arr.put(item)
        p.edit().putString(queue, arr.toString()).apply()
        listener?.invoke(queue)
    }

    /** The queued taps (oldest first), cleared. */
    @JvmStatic
    @Synchronized
    fun take(context: Context, queue: String): String {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val s = p.getString(queue, "[]") ?: "[]"
        p.edit().putString(queue, "[]").apply()
        return s
    }

    /** Set by the plugin while the app runs, so a tap is handled at once (called with the queue's name). */
    @JvmStatic
    var listener: ((String) -> Unit)? = null
}

/** Receives the watch's messages: "log" {"medId": "...", "at": 1730000000000}, "set done" {"setId": "...", "at": ...} and
 *  "check-in" (mood/focus/energy/chips, a test, a drink, water, heart rate, how last night was, or a skipped dose; the
 *  app reads the fields). Messages the watch kept while the phone was away arrive with the time they were made. */
class MedTapWearListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        val queue = when (event.path) { WearBridge.LOG_PATH -> WearBridge.LOGS; WearBridge.SET_PATH -> WearBridge.SETS; WearBridge.CHECKIN_PATH -> WearBridge.CHECKINS; else -> return }
        try {
            val o = JSONObject(String(event.data, Charsets.UTF_8))
            if (!o.has("at")) o.put("at", System.currentTimeMillis())
            WearBridge.enqueue(applicationContext, queue, o)
        } catch (_: Exception) { /* malformed: ignore */ }
    }
}
