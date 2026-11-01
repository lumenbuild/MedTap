package app.medtap.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountDownTimeReference
import androidx.wear.watchface.complications.data.GoalProgressComplicationData
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import java.time.Instant

object Complications {
    private val all = listOf(DoseComplicationService::class.java, DoneComplicationService::class.java, SleepComplicationService::class.java,
        FocusComplicationService::class.java, ShotComplicationService::class.java)

    /** Redraw every complication on any watch face using one (something changed). */
    fun refreshAll(context: Context) {
        for (c in all) try { ComplicationDataSourceUpdateRequester.create(context, ComponentName(context, c)).requestUpdateAll() } catch (_: Exception) {}
    }

    fun text(s: String) = PlainComplicationText.Builder(s).build()
    /** A one-colour icon: watch faces tint it to match, and most slots (Pixel faces included) show it beside the text. */
    fun icon(c: Context, res: Int) = MonochromaticImage.Builder(android.graphics.drawable.Icon.createWithResource(c, res)).build()
    fun open(c: Context, route: String?) = PendingIntent.getActivity(c, route.hashCode(), Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .apply { if (route != null) putExtra("route", route) }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun countdown(at: Long) = TimeDifferenceComplicationText.Builder(TimeDifferenceStyle.SHORT_DUAL_UNIT, CountDownTimeReference(Instant.ofEpochMilli(at)))
        .setMinimumTimeUnit(java.util.concurrent.TimeUnit.MINUTES).build()
}

/** Shared: build for the requested type, or nothing when there's nothing to show. */
abstract class SimpleComplication : ComplicationDataSourceService() {
    abstract fun build(type: ComplicationType): ComplicationData?
    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        listener.onComplicationData(build(request.complicationType) ?: NoDataComplicationData())
    }
}

/** Doses done today out of those planned, as a ring. */
class DoneComplicationService : SimpleComplication() {
    override fun getPreviewData(type: ComplicationType) = make(type, 2, 3)
    override fun build(type: ComplicationType): ComplicationData? { val (done, total) = WatchState.doneCount(this); return if (total == 0) null else make(type, done, total) }
    private fun make(type: ComplicationType, done: Int, total: Int): ComplicationData? {
        val desc = Complications.text("$done of $total doses today")
        val tap = Complications.open(this, "home/today")
        val img = Complications.icon(this, R.drawable.ic_c_done)
        return when (type) {
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(done.toFloat(), 0f, total.toFloat(), desc).setText(Complications.text("$done/$total")).setTapAction(tap).setMonochromaticImage(img).build()
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(Complications.text("$done/$total"), desc).setTitle(Complications.text("Doses")).setTapAction(tap).setMonochromaticImage(img).build()
            ComplicationType.GOAL_PROGRESS -> if (android.os.Build.VERSION.SDK_INT >= 33) GoalProgressComplicationData.Builder(done.toFloat(), total.toFloat(), desc)
                .setText(Complications.text("$done/$total")).setTitle(Complications.text("Doses")).setTapAction(tap).setMonochromaticImage(img).build() else null
            else -> null
        }
    }
}

/** Last night's sleep score. */
class SleepComplicationService : SimpleComplication() {
    override fun getPreviewData(type: ComplicationType) = make(type, 82, "Good")
    override fun build(type: ComplicationType): ComplicationData? {
        val s = WatchState.watch(this).optJSONObject("sleep") ?: return null
        if (!s.has("score")) return null
        return make(type, s.optInt("score"), s.optString("word"))
    }
    private fun make(type: ComplicationType, score: Int, word: String): ComplicationData? {
        val desc = Complications.text("Sleep score $score, $word")
        val tap = Complications.open(this, "home/sleep")
        val img = Complications.icon(this, R.drawable.ic_c_sleep)
        return when (type) {
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(score.toFloat(), 0f, 100f, desc).setText(Complications.text("$score")).setTitle(Complications.text("Sleep")).setTapAction(tap).setMonochromaticImage(img).build()
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(Complications.text("$score"), desc).setTitle(Complications.text("Sleep")).setTapAction(tap).setMonochromaticImage(img).build()
            else -> null
        }
    }
}

/** The focus window: how far through it, and the time left (counts down on its own). */
class FocusComplicationService : SimpleComplication() {
    override fun getPreviewData(type: ComplicationType): ComplicationData? = when (type) {
        ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(0.6f, 0f, 1f, Complications.text("Focus 60% through")).setText(Complications.text("1h 20m")).build()
        ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(Complications.text("1h 20m"), Complications.text("Focus left")).setTitle(Complications.text("Focus")).build()
        ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(Complications.text("Focus until 3:40 pm"), Complications.text("Focus window")).build()
        else -> null
    }
    override fun build(type: ComplicationType): ComplicationData? {
        val w = WearOff.now(this) ?: return null
        val desc = Complications.text("Focus usually until ${Alarms.fmtTime(this, w.to)}")
        val tap = Complications.open(this, "home/focus")
        val img = Complications.icon(this, R.drawable.ic_c_focus)
        return when (type) {
            ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(WearOff.progress(w), 0f, 1f, desc).setText(Complications.countdown(w.to)).setTitle(Complications.text("Focus")).setTapAction(tap).setMonochromaticImage(img).build()
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(Complications.countdown(w.to), desc).setTitle(Complications.text("Focus")).setTapAction(tap).setMonochromaticImage(img).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(Complications.text("Focus until ${Alarms.fmtTime(this, w.to)}"), desc).setTitle(Complications.countdown(w.to)).setTapAction(tap).setMonochromaticImage(img).build()
            else -> null
        }
    }
}

/** Days to the next injection ("Today" on the day). */
class ShotComplicationService : SimpleComplication() {
    override fun getPreviewData(type: ComplicationType) = make(type, "3d", "Next shot in 3 days")
    override fun build(type: ComplicationType): ComplicationData? {
        val s = WatchState.watch(this).optJSONObject("shot") ?: return null
        val at = s.optLong("at")
        val cal = java.util.Calendar.getInstance()
        val today = cal.apply { set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0) }.timeInMillis
        val days = Math.floorDiv(at - today, 86_400_000L).toInt()
        val short = when { days <= 0 -> "Today"; days == 1 -> "1d"; else -> "${days}d" }
        val words = when { days <= 0 -> "Shot today"; days == 1 -> "Shot tomorrow"; else -> "Shot in $days days" }
        return make(type, short, words)
    }
    private fun make(type: ComplicationType, short: String, words: String): ComplicationData? {
        val tap = Complications.open(this, "home/today")
        val img = Complications.icon(this, R.drawable.ic_c_shot)
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(Complications.text(short), Complications.text(words)).setTitle(Complications.text("Shot")).setTapAction(tap).setMonochromaticImage(img).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(Complications.text(words), Complications.text(words)).setTapAction(tap).setMonochromaticImage(img).build()
            else -> null
        }
    }
}
