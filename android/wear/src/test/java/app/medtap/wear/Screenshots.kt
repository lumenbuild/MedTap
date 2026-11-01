package app.medtap.wear

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.activity.ComponentActivity
import android.graphics.Canvas
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

/** Renders each watch screen with sample data to PNGs (for a look before installing): ./gradlew :wear:testMedtapDebugUnitTest
 *  Two sizes: the Pixel Watch 4's 41 mm (about 192 dp across) and 45 mm (about 228 dp). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w192dp-h192dp-round-watch-xhdpi")
class Screenshots41 : Screenshots("41")

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w228dp-h228dp-round-watch-xhdpi")
class Screenshots45 : Screenshots("45")

abstract class Screenshots(private val size: String) {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun seed(c: Context) {
        val now = System.currentTimeMillis()
        val h = 3_600_000L
        val doses = JSONArray()
            .put(JSONObject().put("medId", "r").put("name", "Dose").put("at", now - 4 * h).put("amount", "10 mg").put("state", "done"))
            .put(JSONObject().put("medId", "r").put("name", "Dose").put("at", now - 10 * 60_000L).put("amount", "10 mg").put("state", "due"))
            .put(JSONObject().put("medId", "v").put("name", "Dose").put("at", now + 2 * h).put("amount", "1 capsule").put("state", "later"))
            .put(JSONObject().put("medId", "r").put("name", "Dose").put("at", now + 4 * h).put("amount", "5 mg").put("state", "later"))
        val watch = JSONObject().put("doses", doses).put("reminders", JSONArray()).put("snoozeMin", 15)
            .put("sleep", JSONObject().put("score", 82).put("word", "Good").put("asleep", "7h 24m").put("deep", "1h 12m").put("bedtime", now + 9 * h).put("windDown", now + 8 * h + 15 * 60_000L).put("wake", 420).put("ask", true))
            .put("shot", JSONObject().put("name", "Shot").put("at", now + 3 * 24 * h))
            .put("drinks", JSONObject().put("caffeineMg", 190).put("caffeineNow", 120).put("limitMg", 400).put("usual", JSONArray().put(JSONObject().put("name", "Flat white").put("mg", 130))).put("waterMl", 1250).put("waterTarget", 2500).put("waterAdd", 250))
            .put("hr", JSONArray())
        val state = JSONObject().put("t", now).put("app", "MedTap").put("done", 1).put("total", 4)
            .put("wear", JSONObject().put("name", "Focus").put("dosedAt", now - 2 * h).put("at", now + 80 * 60_000L).put("early", now + 50 * 60_000L).put("late", now + 110 * 60_000L))
            .put("bio", JSONObject().put("readiness", 74).put("chips", JSONArray(listOf("Headache", "Nausea", "Tired", "Anxious", "Wearing off"))))
            .put("prn", JSONArray().put(JSONObject().put("id", "p").put("name", "As needed")))
            .put("watch", watch)
        val workout = JSONObject().put("active", true).put("t", now).put("title", "Upper body").put("restUntil", now + 75_000L).put("done", 5).put("total", 12)
            .put("next", JSONObject().put("exercise", "Bench press").put("label", "Set 3 of 4").put("load", "8 × 70 kg").put("setId", "s3"))
        c.getSharedPreferences("medtap.watch", Context.MODE_PRIVATE).edit().putString("json", state.toString()).putString("workout", workout.toString()).apply()
    }

    private fun shot(name: String, content: @Composable () -> Unit) {
        seed(ApplicationProvider.getApplicationContext())
        rule.mainClock.autoAdvance = false
        rule.setContent { MedTapTheme { Box(Modifier.size(androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp.dp).clip(CircleShape).background(C.bg)) { content() } } }
        repeat(6) { rule.mainClock.advanceTimeByFrame() }
        rule.mainClock.advanceTimeBy(1_000)
        repeat(6) { rule.mainClock.advanceTimeByFrame() }
        rule.runOnIdle { }
        val dir = File(System.getProperty("shots.dir") ?: "build/shots").apply { mkdirs() }
        val v = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
        rule.runOnUiThread { v.draw(Canvas(bmp)) }
        FileOutputStream(File(dir, "$size-$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun now() = shot("1-now") { NowPage(0, 0, rememberSwipeDismissableNavController()) {} }
    @Test fun today() = shot("2-today") { TodayPage(0, rememberSwipeDismissableNavController()) }
    @Test fun focus() = shot("3-focus") { FocusPage(0, 0, rememberSwipeDismissableNavController()) }
    @Test fun log() = shot("4-log") { LogPage(0, rememberSwipeDismissableNavController()) }
    @Test fun sleep() = shot("5-sleep") { SleepPage(0, rememberSwipeDismissableNavController()) }
    @Test fun workout() = shot("6-workout") { WorkoutPage(0) }
    @Test fun checkIn() = shot("7-checkin") { CheckInScreen {} }
    @Test fun caffeine() = shot("8-caffeine") { DrinksScreen(0) {} }
    @Test fun settings() = shot("9-settings") { SettingsPage(0) }
    @Test fun dose() = shot("10-dose") { DoseScreen("r", 0) {} }
    @Test fun heart() = shot("11-heart") { HeartRateScreen("Watch") {} }
}
