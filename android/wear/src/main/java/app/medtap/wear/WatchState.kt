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

    fun save(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("json", json).apply()
        TileService.getUpdater(context).requestUpdate(DoseTileService::class.java)
    }

    fun load(context: Context): JSONObject =
        try { JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("json", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }

    /** Read the phone's latest state directly (when the watch was off while it changed). */
    suspend fun refresh(context: Context) {
        try {
            val items = Wearable.getDataClient(context).dataItems.await()
            try {
                for (item in items) if (item.uri.path == STATE_PATH) {
                    com.google.android.gms.wearable.DataMapItem.fromDataItem(item).dataMap.getString("json")?.let { save(context, it) }
                }
            } finally { items.release() }
        } catch (_: Exception) { /* no phone connection */ }
    }

    /** Send "log this medicine now" to the phone. True when a connected phone received it. */
    suspend fun log(context: Context, medId: String): Boolean {
        val body = JSONObject().put("medId", medId).put("at", System.currentTimeMillis()).toString().toByteArray(Charsets.UTF_8)
        return try {
            val nodes = Wearable.getNodeClient(context).connectedNodes.await()
            var sent = false
            for (n in nodes) {
                try { Wearable.getMessageClient(context).sendMessage(n.id, LOG_PATH, body).await(); sent = true } catch (_: Exception) {}
            }
            sent
        } catch (_: Exception) { false }
    }
}
