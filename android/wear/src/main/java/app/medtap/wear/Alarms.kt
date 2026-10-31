package app.medtap.wear

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * The watch's own alarms, so it buzzes without the phone nearby: dose reminders (Log, Snooze, Skip), the wind-down
 * buzz and the morning "How did you sleep?", a heart-rate check 45 minutes after a stimulant dose, the end of a rest
 * between sets, and trying the outbox again. All planned from the phone's last state; planned again whenever it changes.
 */
object Alarms {
    const val CH_DOSES = "doses"
    const val CH_NUDGES = "nudges"
    const val CH_FOCUS = "focus"
    private const val HOUR = 3_600_000L
    private const val RC_WIND = 7_001
    private const val RC_MORNING = 7_002
    private const val RC_REST = 7_003
    private const val RC_RETRY = 7_004
    const val N_WIND = 8_001
    const val N_MORNING = 8_002
    const val N_REST = 8_003

    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_DOSES, "Dose reminders", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_NUDGES, "Sleep, heart rate and rest", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_FOCUS, "Wear-off countdown", NotificationManager.IMPORTANCE_LOW))
    }

    private fun intent(c: Context, kind: String, extras: JSONObject = JSONObject()) =
        Intent(c, AlarmReceiver::class.java).setAction("app.medtap.wear.$kind").putExtra("kind", kind).putExtra("data", extras.toString())

    private fun pending(c: Context, code: Int, i: Intent, flags: Int = PendingIntent.FLAG_UPDATE_CURRENT) =
        PendingIntent.getBroadcast(c, code, i, flags or PendingIntent.FLAG_IMMUTABLE)

    private fun at(c: Context, t: Long, pi: PendingIntent, exact: Boolean = true) {
        val am = c.getSystemService(AlarmManager::class.java)
        try {
            if (exact && (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms())) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
        } catch (_: SecurityException) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi) }
    }

    private fun cancel(c: Context, code: Int, kind: String) {
        val pi = PendingIntent.getBroadcast(c, code, intent(c, kind), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE) ?: return
        c.getSystemService(AlarmManager::class.java).cancel(pi)
    }

    /** Plan everything from the phone's last state. */
    fun plan(c: Context) {
        val w = WatchState.watch(c)
        val now = System.currentTimeMillis()
        // Dose reminders: replace the last set.
        val before = (WatchState.string(c, "doseAlarms") ?: "").split(',').mapNotNull { it.toIntOrNull() }
        for (id in before) cancel(c, id, "dose")
        val ids = ArrayList<Int>()
        val rs = w.optJSONArray("reminders") ?: JSONArray()
        for (i in 0 until rs.length()) {
            val r = rs.optJSONObject(i) ?: continue
            if (r.optLong("at") <= now) continue
            val id = r.optInt("id")
            at(c, r.optLong("at"), pending(c, id, intent(c, "dose", r)))
            ids.add(id)
        }
        WatchState.setString(c, "doseAlarms", ids.joinToString(","))

        // Sleep: the wind-down buzz tonight and the morning question.
        val sleep = w.optJSONObject("sleep")
        val wind = sleep?.optLong("windDown") ?: 0L
        if (sleep != null && wind > now && WatchState.on(c, WatchState.Pref.WIND_DOWN))
            at(c, wind, pending(c, RC_WIND, intent(c, "wind", JSONObject().put("bedtime", sleep.optLong("bedtime")))))
        else cancel(c, RC_WIND, "wind")
        if (sleep != null && sleep.has("wake") && WatchState.on(c, WatchState.Pref.MORNING)) {
            val cal = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
            var t = cal.timeInMillis + (sleep.optInt("wake") + 30) * 60_000L
            if (t <= now) t += 24 * HOUR
            at(c, t, pending(c, RC_MORNING, intent(c, "morning")), exact = false)
        } else cancel(c, RC_MORNING, "morning")

        // Heart rate 45 minutes after each stimulant dose (while it's still 30–90 minutes after).
        val hr = w.optJSONArray("hr") ?: JSONArray()
        if (WatchState.on(c, WatchState.Pref.HR)) for (i in 0 until hr.length()) {
            val h = hr.optJSONObject(i) ?: continue
            val doseAt = h.optLong("at")
            if (WatchState.flag(c, "hr.${h.optString("doseId")}") > 0 || now > doseAt + 80 * 60_000L) continue
            at(c, maxOf(doseAt + 45 * 60_000L, now + 30_000L), pending(c, h.optString("doseId").hashCode(), intent(c, "hr", h)))
        }
    }

    /** A buzz when the rest between sets ends (the phone's workout). */
    fun planRest(c: Context) {
        val w = WatchState.workout(c)
        val until = w?.optLong("restUntil") ?: 0L
        if (until > System.currentTimeMillis() && WatchState.on(c, WatchState.Pref.REST_BUZZ))
            at(c, until, pending(c, RC_REST, intent(c, "rest", JSONObject().put("until", until))))
        else cancel(c, RC_REST, "rest")
    }

    /** Try the outbox again in 15 minutes. */
    fun retrySoon(c: Context) = at(c, System.currentTimeMillis() + 15 * 60_000L, pending(c, RC_RETRY, intent(c, "retry")), exact = false)

    /** A dose reminder again after the snooze. */
    fun snooze(c: Context, r: JSONObject) {
        val min = WatchState.watch(c).optInt("snoozeMin", 15).coerceAtLeast(1)
        at(c, System.currentTimeMillis() + min * 60_000L, pending(c, r.optInt("id") xor 0x2000_0000, intent(c, "dose", r)))
    }

    fun buzz(c: Context, pattern: LongArray = longArrayOf(0, 180, 120, 180)) {
        try {
            val v = c.getSystemService(VibratorManager::class.java).defaultVibrator
            v.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } catch (_: Exception) {}
    }

    fun openApp(c: Context, route: String? = null, code: Int = 0): PendingIntent =
        PendingIntent.getActivity(c, code, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .apply { if (route != null) putExtra("route", route) }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun action(c: Context, kind: String, data: JSONObject, code: Int): PendingIntent = pending(c, code, intent(c, kind, data))

    fun fmtTime(c: Context, t: Long): String = android.text.format.DateFormat.getTimeFormat(c).format(java.util.Date(t))
}

/** Each alarm, and the buttons on its notification. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED || i.action == Intent.ACTION_MY_PACKAGE_REPLACED) { Alarms.channels(c); Alarms.plan(c); Alarms.planRest(c); WearOff.update(c); return }
        val data = try { JSONObject(i.getStringExtra("data") ?: "{}") } catch (_: Exception) { JSONObject() }
        val nm = c.getSystemService(NotificationManager::class.java)
        Alarms.channels(c)
        when (i.getStringExtra("kind")) {
            "dose" -> remind(c, data)
            "log", "skip" -> async {
                val id = data.optInt("id")
                nm.cancel(id)
                if (i.getStringExtra("kind") == "log") WatchState.log(c, data.optString("medId")) else WatchState.skip(c, data.optString("medId"), data.optLong("dueAt"))
            }
            "snooze" -> { nm.cancel(data.optInt("id")); Alarms.snooze(c, data) }
            "wind" -> {
                Alarms.buzz(c, longArrayOf(0, 300, 200, 300))
                val bed = data.optLong("bedtime")
                nm.notify(Alarms.N_WIND, NotificationCompat.Builder(c, Alarms.CH_NUDGES).setSmallIcon(R.drawable.ic_dose)
                    .setContentTitle("Time to wind down").setContentText(if (bed > 0) "Bed at ${Alarms.fmtTime(c, bed)} for your sleep target" else "Screens down, lights low")
                    .setContentIntent(Alarms.openApp(c, "home/sleep", 1)).setAutoCancel(true).setTimeoutAfter(90 * 60_000L).build())
            }
            "morning" -> {
                val w = WatchState.load(c)
                val asked = w.optJSONObject("watch")?.optJSONObject("sleep")?.optBoolean("ask", true) ?: true
                val fresh = System.currentTimeMillis() - w.optLong("t") < 6 * 3_600_000L
                if ((fresh && !asked) || System.currentTimeMillis() - WatchState.flag(c, "sleepAnswered") < 12 * 3_600_000L) { Alarms.plan(c); return }
                val b = NotificationCompat.Builder(c, Alarms.CH_NUDGES).setSmallIcon(R.drawable.ic_dose)
                    .setContentTitle("How did you sleep?").setContentText("One tap").setContentIntent(Alarms.openApp(c, "sleepask", 2)).setAutoCancel(true).setTimeoutAfter(4 * 3_600_000L)
                for ((v, label) in listOf(2 to "Poor", 3 to "OK", 4 to "Good", 5 to "Great"))
                    b.addAction(0, label, Alarms.action(c, "slept", JSONObject().put("v", v), 9_000 + v))
                nm.notify(Alarms.N_MORNING, b.build())
                Alarms.plan(c) // tomorrow's
            }
            "slept" -> async { nm.cancel(Alarms.N_MORNING); WatchState.setFlag(c, "sleepAnswered"); WatchState.checkIn(c, JSONObject().put("sleepQuality", data.optInt("v"))) }
            "hr" -> {
                val key = "hr.${data.optString("doseId")}"
                if (WatchState.flag(c, key) > 0) return
                WatchState.setFlag(c, key)
                val mins = ((System.currentTimeMillis() - data.optLong("at")) / 60_000L).toInt()
                Alarms.buzz(c, longArrayOf(0, 120))
                val open = Alarms.openApp(c, "hr?note=${android.net.Uri.encode("$mins min after a dose")}", 3)
                nm.notify(key.hashCode(), NotificationCompat.Builder(c, Alarms.CH_NUDGES).setSmallIcon(R.drawable.ic_dose)
                    .setContentTitle("Heart-rate check").setContentText("Dose $mins min ago. Sit still for 20 seconds.")
                    .setContentIntent(open).addAction(0, "Measure", open).setAutoCancel(true).setTimeoutAfter(45 * 60_000L).build())
            }
            "rest" -> {
                val w = WatchState.workout(c) ?: return
                if (w.optLong("restUntil") != data.optLong("until")) return
                Alarms.buzz(c, longArrayOf(0, 400, 150, 400))
                val next = w.optJSONObject("next")
                nm.notify(Alarms.N_REST, NotificationCompat.Builder(c, Alarms.CH_NUDGES).setSmallIcon(R.drawable.ic_dose)
                    .setContentTitle("Rest's over").setContentText(next?.let { "${it.optString("exercise")} · ${it.optString("label")}" } ?: "Next set")
                    .setContentIntent(Alarms.openApp(c, null, 4)).setAutoCancel(true).setTimeoutAfter(5 * 60_000L).build())
            }
            "retry" -> async { WatchState.flush(c) }
        }
    }

    private fun remind(c: Context, r: JSONObject) {
        val medId = r.optString("medId")
        val dueAt = r.optLong("dueAt")
        // Already logged or skipped (on the phone or here): no buzz.
        val ds = WatchState.doses(c).filter { it.medId == medId }
        val slot = ds.minByOrNull { kotlin.math.abs((it.at ?: Long.MAX_VALUE / 2) - dueAt) }
        if (slot != null && (slot.state == "done" || slot.state == "skipped")) return
        val id = r.optInt("id")
        val snooze = WatchState.watch(c).optInt("snoozeMin", 15)
        val n = NotificationCompat.Builder(c, Alarms.CH_DOSES).setSmallIcon(R.drawable.ic_dose)
            .setContentTitle(r.optString("name")).setContentText("${r.optString("amount")} · due ${Alarms.fmtTime(c, dueAt)}")
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(Alarms.openApp(c, "home/today", 5)).setAutoCancel(true)
            .addAction(0, "Log", Alarms.action(c, "log", r, id xor 0x1000_0000))
            .addAction(0, if (snooze % 60 == 0) "In ${snooze / 60} h" else "In $snooze min", Alarms.action(c, "snooze", r, id xor 0x0800_0000))
            .addAction(0, "Skip", Alarms.action(c, "skip", r, id xor 0x0400_0000))
            .build()
        c.getSystemService(NotificationManager::class.java).notify(id, n)
    }

    private fun async(block: suspend () -> Unit) {
        val done = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { try { block() } finally { done.finish() } }
    }
}
