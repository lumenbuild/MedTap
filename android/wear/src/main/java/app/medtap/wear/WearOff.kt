package app.medtap.wear

import android.app.NotificationManager
import android.content.Context
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status

/**
 * While a stimulant is working: a live countdown to when it usually wears off, on the watch face (an ongoing activity)
 * and in the app. From the phone's wear-off forecast; gone once it's past.
 */
object WearOff {
    private const val ID = 8_100

    /** The window now, if any: name, when it was taken, when it usually wears off, and the early–late range. */
    data class Window(val name: String, val from: Long, val to: Long, val early: Long, val late: Long)

    fun now(context: Context): Window? {
        val d = WatchState.load(context)
        val t = System.currentTimeMillis()
        d.optJSONObject("wear")?.let { w ->
            val at = w.optLong("at")
            if (at > t) return Window(w.optString("name"), w.optLong("dosedAt"), at, w.optLong("early", at), w.optLong("late", at))
        }
        d.optJSONObject("bio")?.optJSONObject("ring")?.let { r ->
            val to = r.optLong("to")
            if (to > t) return Window(r.optString("name"), r.optLong("from"), to, to, to)
        }
        return null
    }

    /** How far through the window (0–1). */
    fun progress(w: Window, now: Long = System.currentTimeMillis()) = ((now - w.from).toFloat() / (w.to - w.from).coerceAtLeast(1)).coerceIn(0f, 1f)

    fun update(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val w = now(context)
        if (w == null || !WatchState.on(context, WatchState.Pref.WEAR_OFF)) { nm.cancel(ID); return }
        Alarms.channels(context)
        val left = w.to - System.currentTimeMillis()
        val open = Alarms.openApp(context, "home/focus", 6)
        val b = NotificationCompat.Builder(context, Alarms.CH_FOCUS).setSmallIcon(R.drawable.ic_dose)
            .setContentTitle("Focus window").setContentText("Usually until ${Alarms.fmtTime(context, w.to)}")
            .setUsesChronometer(true).setChronometerCountDown(true).setWhen(w.to).setShowWhen(true)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(open).setTimeoutAfter(left)
        val status = Status.Builder().addTemplate("#name# · #left#")
            .addPart("name", Status.TextPart(w.name))
            .addPart("left", Status.TimerPart(SystemClock.elapsedRealtime() + left))
            .build()
        OngoingActivity.Builder(context, ID, b).setStaticIcon(R.drawable.ic_dose).setTouchIntent(open).setStatus(status).build().apply(context)
        try { nm.notify(ID, b.build()) } catch (_: SecurityException) { /* notifications not allowed yet */ }
    }
}
