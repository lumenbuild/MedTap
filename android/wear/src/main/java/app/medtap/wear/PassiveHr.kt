package app.medtap.wear

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerService
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Heart rate in the background, from the watch's own all-day readings (Health Services passive monitoring): kept on
 * the watch for a few hours and sent to the phone in batches, so the phone has today's heart rate as it happens, and
 * the reading 45 minutes after a dose is taken from it, with nothing to start or hold still for.
 */
object PassiveHr {
    private const val PREFS = "passive_hr"
    private const val KEEP_MS = 6 * 3_600_000L
    private const val SEND_EVERY_MS = 10 * 60_000L

    /** The sensor permission, and the one that lets it run with the app closed (Wear OS 6 names both health.*). */
    fun fgPermission(c: Context) =
        if (Build.VERSION.SDK_INT >= 36 && c.applicationInfo.targetSdkVersion >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
    fun bgPermission(c: Context) =
        if (Build.VERSION.SDK_INT >= 36 && c.applicationInfo.targetSdkVersion >= 36) "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND" else "android.permission.BODY_SENSORS_BACKGROUND"
    private fun granted(c: Context, p: String) = ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED
    fun allowed(c: Context) = granted(c, fgPermission(c)) && (Build.VERSION.SDK_INT < 33 || granted(c, bgPermission(c)))

    /** Start (or keep) the background feed when it's allowed and heart rate is on; stop it when it's turned off. */
    fun sync(c: Context) {
        val client = HealthServices.getClient(c).passiveMonitoringClient
        try {
            if (allowed(c) && WatchState.on(c, WatchState.Pref.HR)) {
                client.setPassiveListenerServiceAsync(PassiveHrService::class.java, PassiveListenerConfig.builder().setDataTypes(setOf(DataType.HEART_RATE_BPM)).build())
            } else client.clearPassiveListenerServiceAsync()
        } catch (_: Exception) { /* no Health Services on this watch */ }
    }

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun buffer(c: Context): JSONArray = try { JSONArray(prefs(c).getString("buf", "[]")) } catch (_: Exception) { JSONArray() }

    /** New readings from the sensor: kept (the last 6 hours), and sent to the phone every 10 minutes or so. */
    @Synchronized
    fun add(c: Context, samples: List<Pair<Long, Int>>) {
        if (samples.isEmpty()) return
        val now = System.currentTimeMillis()
        val old = buffer(c)
        val keep = JSONArray()
        for (i in 0 until old.length()) { val o = old.optJSONObject(i) ?: continue; if (o.optLong("t") > now - KEEP_MS) keep.put(o) }
        val pending = try { JSONArray(prefs(c).getString("pending", "[]")) } catch (_: Exception) { JSONArray() }
        for ((t, bpm) in samples) { val o = JSONObject().put("t", t).put("bpm", bpm); keep.put(o); pending.put(o) }
        prefs(c).edit().putString("buf", keep.toString()).putString("pending", pending.toString()).apply()
        if (now - prefs(c).getLong("sentAt", 0L) >= SEND_EVERY_MS) send(c)
    }

    /** Send what's waiting as one batch (the watch's outbox keeps it if the phone isn't near). */
    fun send(c: Context) {
        val pending = synchronized(this) {
            val p = try { JSONArray(prefs(c).getString("pending", "[]")) } catch (_: Exception) { JSONArray() }
            prefs(c).edit().putString("pending", "[]").putLong("sentAt", System.currentTimeMillis()).apply()
            p
        }
        if (pending.length() == 0) return
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { WatchState.checkIn(c, JSONObject().put("hrSamples", pending)) }
    }

    /** The median of the readings between two times, from the feed (null with fewer than 3). */
    fun medianBetween(c: Context, from: Long, to: Long): Int? {
        val b = buffer(c)
        val v = ArrayList<Int>()
        for (i in 0 until b.length()) { val o = b.optJSONObject(i) ?: continue; val t = o.optLong("t"); if (t in from..to) v.add(o.optInt("bpm")) }
        if (v.size < 3) return null
        v.sort()
        return v[v.size / 2]
    }
}

/** Receives the watch's background heart-rate readings. */
class PassiveHrService : PassiveListenerService() {
    override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
        val boot = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
        val out = ArrayList<Pair<Long, Int>>()
        for (p in dataPoints.getData(DataType.HEART_RATE_BPM)) {
            if (p.value in 30.0..230.0) out.add(p.getTimeInstant(boot).toEpochMilli() to Math.round(p.value).toInt())
        }
        PassiveHr.add(this, out)
    }
}
