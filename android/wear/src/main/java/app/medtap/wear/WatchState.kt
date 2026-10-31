package app.medtap.wear

import android.content.Context
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the phone last sent (the same as its home-screen widget, plus a `watch` section: today's doses, reminders,
 * sleep, drinks and heart-rate checks), kept on the watch so the app, tiles and complications work without the phone.
 * Everything the watch logs goes through an outbox: sent straight away when the phone is reachable, otherwise kept and
 * sent when it's back (tried again every 15 minutes, and whenever the phone sends something).
 */
object WatchState {
    private const val PREFS = "medtap.watch"
    const val STATE_PATH = "/medtap/state"
    const val LOG_PATH = "/medtap/log"
    const val WORKOUT_PATH = "/medtap/workout"
    const val SET_PATH = "/medtap/set"
    /** A check-in, a test result, a drink, water, a heart-rate reading, how last night was, or a skipped dose. */
    const val CHECKIN_PATH = "/medtap/checkin"
    /** A workout the phone never closed stops showing after this long. */
    private const val WORKOUT_STALE_MS = 3 * 60 * 60 * 1000L
    private const val DAY = 24 * 60 * 60 * 1000L

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, json: String) { store(context, "json", json); Alarms.plan(context); WearOff.update(context) }
    fun saveWorkout(context: Context, json: String) { store(context, "workout", json); Alarms.planRest(context) }

    private fun store(context: Context, key: String, json: String) {
        prefs(context).edit().putString(key, json).apply()
        refreshSurfaces(context)
    }

    /** Redraw the tiles, complications and the open app. */
    fun refreshSurfaces(context: Context) {
        for (t in listOf(DoseTileService::class.java, FocusTileService::class.java, SleepTileService::class.java))
            try { TileService.getUpdater(context).requestUpdate(t) } catch (_: Exception) {}
        Complications.refreshAll(context)
        listener?.invoke()
    }

    fun load(context: Context): JSONObject = read(context, "json")
    fun watch(context: Context): JSONObject = load(context).optJSONObject("watch") ?: JSONObject()

    /** The workout going on the phone, or null when there's none (or it's stale). */
    fun workout(context: Context): JSONObject? {
        val w = read(context, "workout")
        if (!w.optBoolean("active") || System.currentTimeMillis() - w.optLong("t") > WORKOUT_STALE_MS) return null
        return w
    }

    private fun read(context: Context, key: String): JSONObject =
        try { JSONObject(prefs(context).getString(key, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }

    /** Set by the open app so it redraws when something changes. */
    @Volatile var listener: (() -> Unit)? = null

    /** Read the phone's latest state directly (when the watch was off while it changed), and send anything waiting. */
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
        flush(context)
    }

    // ── Doses: what the phone said, plus what was logged here and not yet reflected ────────────────────────────────

    data class Dose(val medId: String, val name: String, val at: Long?, val amount: String, val state: String)

    /** Today's doses (oldest first), with the ones logged or skipped on the watch marked, even before the phone knows. */
    fun doses(context: Context): List<Dose> {
        val arr = watch(context).optJSONArray("doses") ?: return emptyList()
        val list = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map {
            Dose(it.optString("medId"), it.optString("name"), if (it.isNull("at") || !it.has("at")) null else it.optLong("at"), it.optString("amount"), it.optString("state"))
        }.toMutableList()
        for ((medId, kind) in localMarks(context)) {
            val k = list.indexOfFirst { it.medId == medId && (it.state == "due" || it.state == "later" || it.state == "missed") }
            if (k >= 0) list[k] = list[k].copy(state = kind)
        }
        return list
    }

    /** The next dose to take: the earliest due, else the next later today. */
    fun nextDose(context: Context): Dose? {
        val ds = doses(context)
        return ds.firstOrNull { it.state == "due" } ?: ds.firstOrNull { it.state == "later" }
    }

    /** Doses done today of those planned (counting the ones logged here). */
    fun doneCount(context: Context): Pair<Int, Int> {
        val ds = doses(context)
        if (ds.isEmpty()) { val d = load(context); return d.optInt("done") to d.optInt("total") }
        return ds.count { it.state == "done" || it.state == "skipped" } to ds.size
    }

    /** Logs and skips made on the watch since the phone last sent its state (oldest first). */
    private fun localMarks(context: Context): List<Pair<String, String>> {
        val t = load(context).optLong("t")
        val arr = try { JSONArray(prefs(context).getString("marks", "[]")) } catch (_: Exception) { JSONArray() }
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
            .filter { it.optLong("at") > t - 60_000 || !it.optBoolean("sent") }
            .map { it.optString("medId") to it.optString("kind") }
    }

    @Synchronized
    private fun mark(context: Context, medId: String, kind: String, sent: Boolean) {
        val now = System.currentTimeMillis()
        val arr = try { JSONArray(prefs(context).getString("marks", "[]")) } catch (_: Exception) { JSONArray() }
        val keep = JSONArray()
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.takeIf { now - it.optLong("at") < DAY }?.let { keep.put(it) }
        keep.put(JSONObject().put("medId", medId).put("kind", kind).put("at", now).put("sent", sent))
        prefs(context).edit().putString("marks", keep.toString()).apply()
    }

    // ── Sending, with the outbox ─────────────────────────────────────────────────────────────────────────────────

    enum class Sent { SENT, QUEUED }

    /** Log this medicine now. */
    suspend fun log(context: Context, medId: String): Sent {
        val r = send(context, LOG_PATH, JSONObject().put("medId", medId))
        mark(context, medId, "done", r == Sent.SENT); refreshSurfaces(context)
        return r
    }

    /** Skip the dose that was due at `dueAt`. */
    suspend fun skip(context: Context, medId: String, dueAt: Long): Sent {
        val r = send(context, CHECKIN_PATH, JSONObject().put("skip", medId).put("dueAt", dueAt))
        mark(context, medId, "skipped", r == Sent.SENT); refreshSurfaces(context)
        return r
    }

    /** "This set is done": the phone ticks it and starts the rest. */
    suspend fun setDone(context: Context, setId: String): Sent = send(context, SET_PATH, JSONObject().put("setId", setId))

    /** A check-in: {"focus": 4}, {"mood", "energy", "chips"}, a test, a drink, water, {"hrBpm"} or {"sleepQuality"}. */
    suspend fun checkIn(context: Context, o: JSONObject): Sent = send(context, CHECKIN_PATH, o)

    private suspend fun send(context: Context, path: String, o: JSONObject): Sent {
        if (!o.has("at")) o.put("at", System.currentTimeMillis())
        if (deliver(context, path, o.toString())) { flush(context); return Sent.SENT }
        enqueue(context, path, o.toString())
        return Sent.QUEUED
    }

    private suspend fun deliver(context: Context, path: String, body: String): Boolean = try {
        val nodes = Wearable.getNodeClient(context).connectedNodes.await()
        var sent = false
        for (n in nodes) {
            try { Wearable.getMessageClient(context).sendMessage(n.id, path, body.toByteArray(Charsets.UTF_8)).await(); sent = true } catch (_: Exception) {}
        }
        sent
    } catch (_: Exception) { false }

    @Synchronized
    private fun enqueue(context: Context, path: String, body: String) {
        val arr = outbox(context)
        arr.put(JSONObject().put("path", path).put("body", body))
        prefs(context).edit().putString("outbox", arr.toString()).apply()
        Alarms.retrySoon(context)
        listener?.invoke()
    }

    private fun outbox(context: Context): JSONArray = try { JSONArray(prefs(context).getString("outbox", "[]")) } catch (_: Exception) { JSONArray() }

    /** How many things are waiting for the phone. */
    fun waiting(context: Context): Int = outbox(context).length()

    private val flushLock = kotlinx.coroutines.sync.Mutex()

    /** Send what's waiting, oldest first; what still can't go stays. */
    suspend fun flush(context: Context) = flushLock.withLockIfFree {
        val items = outbox(context)
        if (items.length() == 0) return@withLockIfFree
        val left = JSONArray()
        var reachable = true
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            if (reachable && deliver(context, it.optString("path"), it.optString("body"))) continue
            reachable = false
            left.put(it)
        }
        synchronized(this) {
            // Anything added while sending stays too.
            val now = outbox(context)
            for (i in items.length() until now.length()) left.put(now.optJSONObject(i))
            prefs(context).edit().putString("outbox", left.toString()).apply()
        }
        if (left.length() > 0) Alarms.retrySoon(context)
        if (left.length() != items.length()) {
            // Sent: the local marks now just wait for the phone's new state.
            val arr = try { JSONArray(prefs(context).getString("marks", "[]")) } catch (_: Exception) { JSONArray() }
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.put("sent", true)
            prefs(context).edit().putString("marks", arr.toString()).apply()
            listener?.invoke()
        }
    }

    private suspend fun kotlinx.coroutines.sync.Mutex.withLockIfFree(block: suspend () -> Unit) {
        if (!tryLock()) return
        try { block() } finally { unlock() }
    }

    // ── The watch's own settings ─────────────────────────────────────────────────────────────────────────────────

    enum class Pref(val key: String, val label: String, val detail: String) {
        WIND_DOWN("windDown", "Wind-down buzz", "45 min before tonight's bedtime"),
        MORNING("morningAsk", "How did you sleep?", "Asks in the morning"),
        HR("hrChecks", "Heart rate after a dose", "A reading 45 min after a stimulant"),
        WEAR_OFF("wearOffLive", "Wear-off countdown", "Live on the watch face"),
        REST_BUZZ("restBuzz", "Buzz when rest ends", "During a workout"),
    }

    fun on(context: Context, p: Pref): Boolean = prefs(context).getBoolean(p.key, true)
    fun set(context: Context, p: Pref, v: Boolean) { prefs(context).edit().putBoolean(p.key, v).apply(); Alarms.plan(context); Alarms.planRest(context); WearOff.update(context) }

    /** Small things the watch remembers: alarms already handled, the morning question answered. */
    fun flag(context: Context, key: String): Long = prefs(context).getLong("f.$key", 0L)
    fun setFlag(context: Context, key: String, v: Long = System.currentTimeMillis()) { prefs(context).edit().putLong("f.$key", v).apply() }
    fun string(context: Context, key: String): String? = prefs(context).getString("s.$key", null)
    fun setString(context: Context, key: String, v: String) { prefs(context).edit().putString("s.$key", v).apply() }
}
