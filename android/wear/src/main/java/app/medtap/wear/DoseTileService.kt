package app.medtap.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
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
        val nextSet = workout?.optJSONObject("next")
        if (workout != null && nextSet != null) {
            col.addContent(line(workout.optString("title", "Workout"), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line(nextSet.optString("exercise"), Typography.TYPOGRAPHY_TITLE3, 0xFFFFFFFF.toInt()))
            col.addContent(line("${nextSet.optString("label")} · ${nextSet.optString("load")}", Typography.TYPOGRAPHY_BODY2, 0xFFFFFFFF.toInt()))
            col.addContent(line("Tap for Done and rest", Typography.TYPOGRAPHY_CAPTION2, 0xFF8AB4F8.toInt()))
        } else if (title.isEmpty()) {
            col.addContent(line(getString(R.string.app_name), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line("Open the app on your phone to set up", Typography.TYPOGRAPHY_BODY1, 0xFFFFFFFF.toInt()))
        } else {
            col.addContent(line(d.optString("label", "Next"), Typography.TYPOGRAPHY_CAPTION1, 0xFFBBBBBB.toInt()))
            col.addContent(line(title, Typography.TYPOGRAPHY_TITLE3, 0xFFFFFFFF.toInt()))
            d.optString("when", "").takeIf { it.isNotEmpty() }?.let { col.addContent(line(it, Typography.TYPOGRAPHY_BODY2, 0xFFFFFFFF.toInt())) }
            col.addContent(line("Tap to log", Typography.TYPOGRAPHY_CAPTION2, 0xFF8AB4F8.toInt()))
        }
        val root = LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand())
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(open).setPadding(
                ModifiersBuilders.Padding.Builder().setAll(dp(if (device.screenWidthDp > 200) 16f else 12f)).build()).build())
            .addContent(col.build()).build()
        val tile = TileBuilders.Tile.Builder().setResourcesVersion("1").setFreshnessIntervalMillis(15 * 60_000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(root)).build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion("1").build())
}
