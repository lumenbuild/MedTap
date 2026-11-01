package app.medtap.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text

/** The phone app's dark look on the watch: black, deep surfaces, one colour per area. */
object C {
    val bg = Color(Palette.BG); val surface = Color(Palette.SURFACE); val fill = Color(Palette.FILL)
    val text = Color(Palette.TEXT); val muted = Color(Palette.MUTED)
    val primary = Color(Palette.PRIMARY); val onPrimary = Color(Palette.ON_PRIMARY)
    val meds = Color(Palette.MEDS); val sleep = Color(Palette.SLEEP); val heart = Color(Palette.HEART); val act = Color(Palette.ACT)
    val body = Color(Palette.BODY); val pep = Color(Palette.PEP); val mind = Color(Palette.MIND); val good = Color(Palette.GOOD)
}

@Composable
fun MedTapTheme(content: @Composable () -> Unit) = MaterialTheme(
    colors = Colors(primary = C.primary, primaryVariant = C.primary, onPrimary = C.onPrimary, secondary = C.mind, onSecondary = C.text,
        surface = C.surface, onSurface = C.text, onSurfaceVariant = C.muted, background = C.bg, onBackground = C.text, error = C.heart),
    content = content,
)

/** Sizes that follow the screen, so a Pixel Watch 4's 41 mm (about 192 dp across) and 45 mm (about 228 dp) both use
 *  the round display fully: margins from Wear OS's percentages, rings and buttons as a share of the width. */
class Dims(val w: Float) {
    val side: Dp get() = (w * 0.052f).dp
    val top: Dp get() = (w * 0.14f).dp
    val bottom: Dp get() = (w * 0.24f).dp
    /** A ring that's this share of the screen across. */
    fun ring(share: Float): Dp = (w * share).dp
    /** One of five buttons in a row, fitting inside the curve at mid-height. */
    val pick: Dp get() = ((w * 0.84f - 4 * 3f) / 5f).coerceIn(28f, 42f).dp
    val small: Boolean get() = w < 210f
}

@Composable
fun dims() = Dims(LocalConfiguration.current.screenWidthDp.toFloat())

/** A scrolling page of the app, with the scroll position on the edge. `top` overrides the top margin (a page that opens
 *  with a ring sits it just under the time). */
@Composable
fun Page(top: Dp? = null, content: ScalingLazyListScope.() -> Unit) {
    val d = dims()
    val state = rememberScalingLazyListState(initialCenterItemIndex = 0)
    Scaffold(positionIndicator = { PositionIndicator(scalingLazyListState = state) }) {
        ScalingLazyColumn(state = state, autoCentering = null, modifier = Modifier.fillMaxSize().background(C.bg),
            contentPadding = PaddingValues(start = d.side, end = d.side, top = top ?: d.top, bottom = d.bottom),
            verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally, content = content)
    }
}

@Composable
fun Label(s: String, color: Color = C.muted) = Text(s.uppercase(), color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp, textAlign = TextAlign.Center)

@Composable
fun Big(s: String, size: Int = 26, color: Color = C.text) = Text(s, color = color, fontSize = size.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = (size + 2).sp)

@Composable
fun Small(s: String, color: Color = C.muted) = Text(s, color = color, fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 16.sp)

/** A full-width button with a coloured dot for its area. */
@Composable
fun Action(label: String, color: Color = C.primary, sub: String? = null, filled: Boolean = false, onClick: () -> Unit) = Chip(
    onClick = onClick, modifier = Modifier.fillMaxWidth(),
    label = { Text(label, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (filled) C.onPrimary else C.text) },
    secondaryLabel = sub?.let { { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (filled) C.onPrimary.copy(alpha = 0.8f) else C.muted) } },
    icon = if (filled) null else ({ Box(Modifier.size(10.dp).clip(RoundedCornerShape(5.dp)).background(color)) }),
    colors = if (filled) ChipDefaults.primaryChipColors(backgroundColor = color, contentColor = C.onPrimary) else ChipDefaults.secondaryChipColors(backgroundColor = C.surface, contentColor = C.text),
)

/** A row of 1–5 round buttons, the chosen one filled. */
@Composable
fun Scale(label: String, value: Int?, color: Color, onPick: (Int) -> Unit) = Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
    Small(label)
    val size = dims().pick
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.padding(top = 2.dp)) {
        for (v in 1..5) Button(onClick = { onPick(v) }, modifier = Modifier.size(size).semantics { contentDescription = "$label $v of 5" },
            colors = ButtonDefaults.buttonColors(backgroundColor = if (value == v) color else C.fill, contentColor = if (value == v) C.bg else C.text)) {
            Text("$v", fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}

/** A ring with something in the middle (progress 0–1), `share` of the screen across. */
@Composable
fun Ring(progress: Float, color: Color, share: Float = 0.6f, stroke: Dp = 8.dp, content: @Composable () -> Unit) = Box(Modifier.size(dims().ring(share)), contentAlignment = Alignment.Center) {
    CircularProgressIndicator(progress = progress.coerceIn(0f, 1f), modifier = Modifier.fillMaxSize(), indicatorColor = color, trackColor = C.fill, strokeWidth = stroke)
    Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
}

/** A thin bar (progress 0–1). */
@Composable
fun Bar(progress: Float, color: Color) = Box(Modifier.fillMaxWidth(0.8f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(C.fill)) {
    Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(3.dp)).background(color))
}

/** "2:36–3:36 pm": a time range kept short for the watch. */
fun fmtRange(c: android.content.Context, a: Long, b: Long): String {
    val x = Alarms.fmtTime(c, a); val y = Alarms.fmtTime(c, b)
    val sx = x.split(' '); val sy = y.split(' ')
    return if (sx.size == 2 && sy.size == 2 && sx[1] == sy[1]) "${sx[0]}–${sy[0]} ${sy[1].lowercase()}" else "$x–$y"
}

fun fmtLeft(ms: Long): String {
    val m = (ms / 60_000L).coerceAtLeast(0)
    return if (m >= 60) "${m / 60}h ${m % 60}m" else "$m min"
}
