package app.medtap.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.ChipColors
import androidx.wear.protolayout.material.CircularProgressIndicator
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.ProgressIndicatorColors
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.EdgeContentLayout
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future

/** Shared tile pieces: text, the "open the app" tap, chips, and the tile itself. */
abstract class BaseTile : TileService() {
    protected val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    protected fun text(s: String, typo: Int, color: Int, lines: Int = 1): LayoutElementBuilders.LayoutElement =
        Text.Builder(this, s).setTypography(typo).setColor(argb(color)).setMaxLines(lines).build()

    protected fun column(vararg items: LayoutElementBuilders.LayoutElement?) = LayoutElementBuilders.Column.Builder().apply {
        for (x in items) if (x != null) addContent(x)
    }.setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER).build()

    protected fun open(route: String?) = ModifiersBuilders.Clickable.Builder().setId("open:$route").setOnClick(
        ActionBuilders.LaunchAction.Builder().setAndroidActivity(
            ActionBuilders.AndroidActivity.Builder().setPackageName(packageName).setClassName(MainActivity::class.java.name)
                .apply { if (route != null) addKeyToExtraMapping("route", ActionBuilders.AndroidStringExtra.Builder().setValue(route).build()) }.build()
        ).build()
    ).build()

    /** A tap the tile handles itself (it's asked for again with this id). */
    protected fun load(id: String) = ModifiersBuilders.Clickable.Builder().setId(id).setOnClick(ActionBuilders.LoadAction.Builder().build()).build()

    protected fun chip(label: String, click: ModifiersBuilders.Clickable, d: DeviceParameters, bg: Int = Palette.PRIMARY, fg: Int = Palette.ON_PRIMARY) =
        CompactChip.Builder(this, label, click, d).setChipColors(ChipColors(argb(bg), argb(fg))).build()

    protected fun ring(p: Float, color: Int) = CircularProgressIndicator.Builder().setProgress(p.coerceIn(0f, 1f))
        .setCircularProgressIndicatorColors(ProgressIndicatorColors(argb(color), argb(Palette.FILL))).build()

    protected fun tile(root: LayoutElementBuilders.LayoutElement, freshMs: Long, tap: ModifiersBuilders.Clickable? = null): TileBuilders.Tile {
        val box = LayoutElementBuilders.Box.Builder().setWidth(androidx.wear.protolayout.DimensionBuilders.expand()).setHeight(androidx.wear.protolayout.DimensionBuilders.expand()).addContent(root)
        if (tap != null) box.setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(tap).build())
        return TileBuilders.Tile.Builder().setResourcesVersion("1").setFreshnessIntervalMillis(freshMs)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(box.build())).build()
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion("1").build())

    protected fun time(t: Long) = Alarms.fmtTime(this, t)
}

/** The next dose with a Log button (or, during a workout, the next set), and today's count. */
class DoseTileService : BaseTile() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> = scope.future {
        val clicked = requestParams.currentState.lastClickableId
        var logged: String? = null
        // Each Log button's id is used once: a tile can be asked for again with the same last click.
        if (clicked.startsWith("log:") && WatchState.string(this@DoseTileService, "tileClick") != clicked) {
            WatchState.setString(this@DoseTileService, "tileClick", clicked)
            val r = WatchState.log(this@DoseTileService, clicked.removePrefix("log:").substringBefore('@'))
            logged = if (r == WatchState.Sent.SENT) "Logged ✓" else "Saved ✓ · sends when your phone's near"
        }
        build(requestParams.deviceConfiguration, logged)
    }

    private fun build(d: DeviceParameters, logged: String?): TileBuilders.Tile {
        val now = System.currentTimeMillis()
        val workout = WatchState.workout(this)
        val nextSet = workout?.optJSONObject("next")
        if (workout != null && nextSet != null) {
            val rest = workout.optLong("restUntil")
            return tile(PrimaryLayout.Builder(d)
                .setPrimaryLabelTextContent(text(workout.optString("title", "Workout"), Typography.TYPOGRAPHY_CAPTION1, Palette.ACT))
                .setContent(column(
                    text(nextSet.optString("exercise"), Typography.TYPOGRAPHY_TITLE3, Palette.TEXT, 2),
                    text("${nextSet.optString("label")} · ${nextSet.optString("load")}", Typography.TYPOGRAPHY_BODY2, Palette.MUTED),
                    if (rest > now) text("Rest until ${time(rest)}", Typography.TYPOGRAPHY_CAPTION2, Palette.ACT) else null))
                .setPrimaryChipContent(chip("Open", open(null), d, Palette.ACT)).build(), 60_000L)
        }
        val next = WatchState.nextDose(this)
        val (done, total) = WatchState.doneCount(this)
        val fallback = WatchState.load(this)
        if (next == null) {
            val title = fallback.optString("title", "")
            val label = when { total > 0 && done >= total -> "All done today"; title.isEmpty() -> getString(R.string.app_name); else -> fallback.optString("label", "Next") }
            return tile(PrimaryLayout.Builder(d)
                .setPrimaryLabelTextContent(text(label, Typography.TYPOGRAPHY_CAPTION1, Palette.GOOD))
                .setContent(column(
                    text(logged ?: if (title.isEmpty()) "Open the app on your phone to set up" else title, Typography.TYPOGRAPHY_TITLE3, Palette.TEXT, 2),
                    fallback.optString("when").takeIf { it.isNotEmpty() && logged == null }?.let { text(it, Typography.TYPOGRAPHY_BODY2, Palette.MUTED) },
                    if (total > 0) text("$done of $total today", Typography.TYPOGRAPHY_CAPTION2, Palette.MUTED) else null))
                .build(), 15 * 60_000L, open(null))
        }
        val due = next.state == "due"
        return tile(PrimaryLayout.Builder(d)
            .setPrimaryLabelTextContent(text(if (due) "Due now" else "Next · ${time(next.at ?: now)}", Typography.TYPOGRAPHY_CAPTION1, if (due) Palette.MEDS else Palette.MUTED))
            .setContent(column(
                text(next.name, Typography.TYPOGRAPHY_TITLE2, Palette.TEXT, 2),
                text(logged ?: next.amount, Typography.TYPOGRAPHY_BODY2, if (logged != null) Palette.GOOD else Palette.MUTED, 2),
                text("$done of $total today", Typography.TYPOGRAPHY_CAPTION2, Palette.MUTED)))
            .setPrimaryChipContent(chip("Log", load("log:${next.medId}@$now"), d, if (due) Palette.MEDS else Palette.PRIMARY, if (due) Palette.TEXT else Palette.ON_PRIMARY))
            .build(), if (due) 5 * 60_000L else 15 * 60_000L, open("home/today"))
    }
}

/** The focus window: a ring from the dose to when it usually wears off, the time left, and the early–late range. */
class FocusTileService : BaseTile() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val d = requestParams.deviceConfiguration
        val w = WearOff.now(this)
        val now = System.currentTimeMillis()
        if (w == null) {
            val readiness = WatchState.load(this).optJSONObject("bio")?.optInt("readiness", -1)?.takeIf { it >= 0 }
            return Futures.immediateFuture(tile(PrimaryLayout.Builder(d)
                .setPrimaryLabelTextContent(text("Focus", Typography.TYPOGRAPHY_CAPTION1, Palette.MIND))
                .setContent(column(text("No focus window now", Typography.TYPOGRAPHY_TITLE3, Palette.TEXT, 2),
                    readiness?.let { text("Readiness $it", Typography.TYPOGRAPHY_BODY2, Palette.MUTED) }))
                .setPrimaryChipContent(chip("Brain test", open("brain"), d, Palette.MIND, Palette.TEXT)).build(), 30 * 60_000L))
        }
        val left = ((w.to - now) / 60_000L).toInt()
        val leftText = if (left >= 60) "${left / 60}h ${left % 60}m left" else "$left min left"
        val range = if (w.late - w.early > 10 * 60_000L) "Wears off ${fmtRange(this, w.early, w.late)}" else "Until ${time(w.to)}"
        return Futures.immediateFuture(tile(EdgeContentLayout.Builder(d)
            .setEdgeContent(ring(WearOff.progress(w, now), Palette.MIND))
            .setPrimaryLabelTextContent(text("Focus", Typography.TYPOGRAPHY_CAPTION1, Palette.MIND))
            .setContent(column(text(leftText, Typography.TYPOGRAPHY_TITLE2, Palette.TEXT), text(range, Typography.TYPOGRAPHY_CAPTION2, Palette.MUTED, 2)))
            .build(), 5 * 60_000L, open("home/focus")))
    }
}

/** Last night's sleep score as a ring, how long and how deep, and tonight's bedtime. */
class SleepTileService : BaseTile() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val d = requestParams.deviceConfiguration
        val s = WatchState.watch(this).optJSONObject("sleep")
        if (s == null) return Futures.immediateFuture(tile(PrimaryLayout.Builder(d)
            .setPrimaryLabelTextContent(text("Sleep", Typography.TYPOGRAPHY_CAPTION1, Palette.SLEEP))
            .setContent(column(text("Turn on Sleep in the phone app", Typography.TYPOGRAPHY_BODY1, Palette.TEXT, 3))).build(), 60 * 60_000L, open(null)))
        val bed = s.optLong("bedtime")
        val lines = listOfNotNull(
            s.optString("asleep").takeIf { it.isNotEmpty() }?.let { a -> a + (s.optString("deep").takeIf { it.isNotEmpty() }?.let { " · deep $it" } ?: "") },
            if (bed > System.currentTimeMillis()) "Bed ${time(bed)}" else s.optString("debt").takeIf { it.isNotEmpty() },
        )
        val score = if (s.has("score")) s.optInt("score") else null
        val content = column(
            text(score?.let { "$it" } ?: "—", Typography.TYPOGRAPHY_DISPLAY3, Palette.TEXT),
            text(s.optString("word").ifEmpty { "No night yet" }, Typography.TYPOGRAPHY_CAPTION1, Palette.SLEEP),
            *lines.map { text(it, Typography.TYPOGRAPHY_CAPTION2, Palette.MUTED) }.toTypedArray())
        return Futures.immediateFuture(tile(EdgeContentLayout.Builder(d)
            .setEdgeContent(ring((score ?: 0) / 100f, Palette.SLEEP))
            .setContent(content).build(), 60 * 60_000L, open("home/sleep")))
    }
}

