package app.medtap.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.CircularProgressIndicator
import androidx.wear.protolayout.material.ProgressIndicatorColors
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/** A tile with the next dose (or, during a workout, the next set); tapping it opens the app. */
class DoseTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val d = WatchState.load(this)
        val title = d.optString("title", "")
        val open = ModifiersBuilders.Clickable.Builder().setId("open").setOnClick(
            ActionBuilders.LaunchAction.Builder().setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder().setPackageName(packageName).setClassName(MainActivity::class.java.name).build()
            ).build()
        ).build()
        val device = requestParams.deviceConfiguration
        fun line(s: String, typo: Int, color: Int) = Text.Builder(this, s).setTypography(typo).setColor(argb(color)).setMaxLines(2).build()
        val col = LayoutElementBuilders.Column.Builder()
        val workout = WatchState.workout(this)
        val now = System.currentTimeMillis()
        val ring = d.optJSONObject("bio")?.optJSONObject("ring")?.takeIf { it.optLong("to") > now && workout == null }
        val nextSet = workout?.optJSONObject("next")
        if (workout != null && nextSet != null) {
            col.addContent(line(workout.optString("title", "Workout"), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line(nextSet.optString("exercise"), Typography.TYPOGRAPHY_TITLE3, 0xFFFFFFFF.toInt()))
            col.addContent(line("${nextSet.optString("label")} · ${nextSet.optString("load")}", Typography.TYPOGRAPHY_BODY2, 0xFFFFFFFF.toInt()))
            col.addContent(line("Tap for Done and rest", Typography.TYPOGRAPHY_CAPTION2, 0xFF8AB4F8.toInt()))
        } else if (ring != null) {
            // Biohacking tools: how far through today's stimulant, with when it usually wears off.
            val fmt = android.text.format.DateFormat.getTimeFormat(this)
            col.addContent(line(ring.optString("name"), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line("until ${fmt.format(java.util.Date(ring.optLong("to")))}", Typography.TYPOGRAPHY_TITLE3, 0xFFFFFFFF.toInt()))
            if (title.isNotEmpty()) col.addContent(line("Next: $title ${d.optString("when", "")}".trim(), Typography.TYPOGRAPHY_CAPTION2, 0xFFBBBBBB.toInt()))
        } else if (title.isEmpty()) {
            col.addContent(line(getString(R.string.app_name), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line("Open the app on your phone to set up", Typography.TYPOGRAPHY_BODY1, 0xFFFFFFFF.toInt()))
        } else {
            col.addContent(line(d.optString("label", "Next"), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line(title, Typography.TYPOGRAPHY_TITLE3, 0xFFFFFFFF.toInt()))
            d.optString("when", "").takeIf { it.isNotEmpty() }?.let { col.addContent(line(it, Typography.TYPOGRAPHY_BODY2, 0xFFFFFFFF.toInt())) }
            col.addContent(line("Tap to log", Typography.TYPOGRAPHY_CAPTION2, 0xFF8AB4F8.toInt()))
        }
        val box = LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand())
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).setPadding(
                ModifiersBuilders.Padding.Builder().setAll(dp(if (device.screenWidthDp > 200) 16f else 12f)).build()).build())
            .addContent(col.build())
        if (ring != null) {
            val from = ring.optLong("from"); val to = ring.optLong("to")
            val p = ((now - from).toFloat() / (to - from).toFloat()).coerceIn(0f, 1f)
            box.addContent(CircularProgressIndicator.Builder().setProgress(p).setCircularProgressIndicatorColors(ProgressIndicatorColors(argb(0xFF8AB4F8.toInt()), argb(0xFF333333.toInt()))).build())
        }
        val root = box.build()
        val tile = TileBuilders.Tile.Builder().setResourcesVersion("1").setFreshnessIntervalMillis(if (ring != null) 5 * 60_000L else 15 * 60_000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(root)).build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion("1").build())
}
