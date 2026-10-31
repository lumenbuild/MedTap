package app.medtap.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountDownTimeReference
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import java.time.Instant

/** A watch-face complication: a countdown to the next dose (it ticks on its own), or the rest left during a workout.
 *  Tapping it opens the app. */
class DoseComplicationService : ComplicationDataSourceService() {
    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        listener.onComplicationData(build(request.complicationType))
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? = when (type) {
        ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(PlainComplicationText.Builder("2h 15m").build(), PlainComplicationText.Builder("Next dose").build())
            .setTitle(PlainComplicationText.Builder("Dose").build()).build()
        ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(PlainComplicationText.Builder("Morning tablet in 2h 15m").build(), PlainComplicationText.Builder("Next dose").build()).build()
        ComplicationType.RANGED_VALUE -> RangedValueComplicationData.Builder(0.4f, 0f, 1f, PlainComplicationText.Builder("Effect 40%").build())
            .setText(PlainComplicationText.Builder("1:10").build()).build()
        else -> null
    }

    private fun build(type: ComplicationType): ComplicationData? {
        val tap = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
        val now = System.currentTimeMillis()
        val workout = WatchState.workout(this)
        val restUntil = workout?.optLong("restUntil") ?: 0L
        val d = WatchState.load(this)
        val title = d.optString("title", "")
        val dueAt = d.optLong("dueAt", 0L)
        val describe = PlainComplicationText.Builder(if (restUntil > now) "Rest left" else "Next dose").build()
        // The text: a live countdown when there's a time to count to, else the plain words.
        val (short, label) = when {
            restUntil > now -> countdown(restUntil) to "Rest"
            dueAt > now -> countdown(dueAt) to d.optString("label", "Dose").take(7)
            title.isNotEmpty() -> PlainComplicationText.Builder(title.take(7)).build() to "Dose"
            else -> PlainComplicationText.Builder("—").build() to "Dose"
        }
        // Biohacking tools: how far through today's stimulant, as a ring, with when it usually wears off.
        val ring = d.optJSONObject("bio")?.optJSONObject("ring")?.takeIf { it.optLong("to") > now }
        return when (type) {
            ComplicationType.RANGED_VALUE -> {
                if (ring == null) RangedValueComplicationData.Builder(0f, 0f, 1f, describe).setText(short).setTapAction(tap).build()
                else {
                    val from = ring.optLong("from"); val to = ring.optLong("to")
                    val p = ((now - from).toFloat() / (to - from).toFloat()).coerceIn(0f, 1f)
                    val until = android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date(to)).replace(" ", "").lowercase()
                    RangedValueComplicationData.Builder(p, 0f, 1f, PlainComplicationText.Builder("${ring.optString("name")} until $until").build())
                        .setText(PlainComplicationText.Builder(until).build()).setTitle(PlainComplicationText.Builder(ring.optString("name").take(7)).build()).setTapAction(tap).build()
                }
            }
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(short, describe)
                .setTitle(PlainComplicationText.Builder(label).build()).setTapAction(tap).build()
            ComplicationType.LONG_TEXT -> {
                val words = when {
                    restUntil > now -> "Rest, then ${workout?.optJSONObject("next")?.optString("exercise") ?: "next set"}"
                    title.isNotEmpty() -> "$title ${d.optString("when", "")}".trim()
                    else -> "Open the app on your phone to set up"
                }
                LongTextComplicationData.Builder(PlainComplicationText.Builder(words).build(), describe)
                    .setTitle(short).setTapAction(tap).build()
            }
            else -> null
        }
    }

    private fun countdown(at: Long) = TimeDifferenceComplicationText.Builder(TimeDifferenceStyle.SHORT_DUAL_UNIT, CountDownTimeReference(Instant.ofEpochMilli(at)))
        .setMinimumTimeUnit(java.util.concurrent.TimeUnit.MINUTES).build()

    companion object {
        /** Redraw this complication on any watch face using it (the phone sent something new). */
        fun refresh(context: Context) {
            try { ComplicationDataSourceUpdateRequester.create(context, ComponentName(context, DoseComplicationService::class.java)).requestUpdateAll() } catch (_: Exception) {}
        }
    }
}
