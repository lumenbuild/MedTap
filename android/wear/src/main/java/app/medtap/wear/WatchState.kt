package app.medtap.wear

import android.content.Context
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * What the phone last sent (the same as its home-screen widget: next dose and as-needed medicines), kept on the watch
 * so the tile and app show it without waiting for the phone. Logging sends a message back; the phone app logs it.
 */
object WatchState {
    private const val PREFS = "medtap.watch"
    const val STATE_PATH = "/medtap/state"
    const val LOG_PATH = "/medtap/log"
    const val WORKOUT_PATH = "/medtap/workout"
    const val SET_PATH = "/medtap/set"
    /** A workout the phone never closed stops showing after this long. */
    private const val WORKOUT_STALE_MS = 3 * 60 * 60 * 1000L

    fun save(context: Context, json: String) = store(context, "json", json)
    fun saveWorkout(context: Context, json: String) = store(context, "workout", json)

    private fun store(context: Context, key: String, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key, json).apply()
        TileService.getUpdater(context).requestUpdate(DoseTileService::class.java)
        DoseComplicationService.refresh(context)
        listener?.invoke()
    }

    fun load(context: Context): JSONObject = read(context, "json")

    /** The workout going on the phone, or null when there's none (or it's stale). */
    fun workout(context: Context): JSONObject? {
        val w = read(context, "workout")
        if (!w.optBoolean("active") || System.currentTimeMillis() - w.optLong("t") > WORKOUT_STALE_MS) return null
        return w
    }

    private fun read(context: Context, key: String): JSONObject =
        try { JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }

    /** Set by the open app so it redraws when the phone sends something new. */
    @Volatile var listener: (() -> Unit)? = null

    /** Read the phone's latest state directly (when the watch was off while it changed). */
    suspend fun refresh(context: Context) {
        try {
            val items = Wearable.getDataClient(context).dataItems.await()
            try {
                for (item in items) {
                    val json = com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap.getString("json") ?: continue
                    when (item.uri.path) { STATE_PATH -> save(context, json); WORKOUT_PATH -> saveWorkout(context, json) }
                }
            } finally { items.release() }
        } catch (_: Exception) { /* no phone connection */ }
    }

    /** Send "log this medicine now" to the phone. True when a connected phone received it. */
    suspend fun log(context: Context, medId: String): Boolean =
        send(context, LOG_PATH, JSONObject().put("medId", medId).put("at", System.currentTimeMillis()))

    /** Send "this set is done" to the phone, which ticks it and starts the rest. */
    suspend fun setDone(context: Context, setId: String): Boolean =
        send(context, SET_PATH, JSONObject().put("setId", setId).put("at", System.currentTimeMillis()))

    private suspend fun send(context: Context, path: String, o: JSONObject): Boolean {
        val body = o.toString().toByteArray(Charsets.UTF_8)
        return try {
            val nodes = Wearable.getNodeClient(context).connectedNodes.await()
            var sent = false
            for (n in nodes) {
                try { Wearable.getMessageClient(context).sendMessage(n.id, path, body).await(); sent = true } catch (_: Exception) {}
            }
            sent
        } catch (_: Exception) { false }
    }
}
