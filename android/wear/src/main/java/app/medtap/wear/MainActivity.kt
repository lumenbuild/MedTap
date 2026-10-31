package app.medtap.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.navArgument
import androidx.wear.compose.material.HorizontalPageIndicator
import androidx.wear.compose.material.PageIndicatorState
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The watch app: swipe between pages (the workout while one's going, Now, Today, Focus, Log, Sleep, Settings); each
 * opens its own screens (check-in, drinks, tests, heart rate). Works from the phone's last state when it isn't nearby.
 */
class MainActivity : ComponentActivity() {
    /** Bumped whenever the state changes, so the screens redraw. */
    private val version = mutableIntStateOf(0)
    private val route = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Alarms.channels(this)
        route.value = intent?.getStringExtra("route")
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            registerForActivityResult(ActivityResultContracts.RequestPermission()) { WearOff.update(this) }.launch(Manifest.permission.POST_NOTIFICATIONS)
        setContent { MedTapTheme { App(version.intValue, route.value) { route.value = null } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        route.value = intent.getStringExtra("route")
    }

    override fun onResume() {
        super.onResume()
        WatchState.listener = { runOnUiThread { version.intValue++ } }
        lifecycleScope.launch { WatchState.refresh(this@MainActivity); version.intValue++ }
    }

    override fun onPause() { WatchState.listener = null; super.onPause() }
}

enum class Tab(val key: String) { WORKOUT("workout"), NOW("now"), TODAY("today"), FOCUS("focus"), LOG("log"), SLEEP("sleep"), SETTINGS("settings") }

@Composable
fun App(version: Int, openRoute: String?, routeDone: () -> Unit) {
    val nav = rememberSwipeDismissableNavController()
    // A clock for the countdowns.
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(15_000); tick++ } }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val tabs = remember(version, tick) {
        buildList {
            if (WatchState.workout(ctx) != null) add(Tab.WORKOUT)
            add(Tab.NOW); add(Tab.TODAY); add(Tab.FOCUS); add(Tab.LOG)
            if (WatchState.watch(ctx).has("sleep")) add(Tab.SLEEP)
            add(Tab.SETTINGS)
        }
    }
    val pager = rememberPagerState { tabs.size }
    LaunchedEffect(openRoute) {
        val r = openRoute ?: return@LaunchedEffect
        nav.popBackStack("home", false)
        if (r.startsWith("home/")) { val k = tabs.indexOfFirst { it.key == r.removePrefix("home/") }; if (k >= 0) pager.scrollToPage(k) }
        else nav.navigate(r)
        routeDone()
    }
    SwipeDismissableNavHost(navController = nav, startDestination = "home") {
        composable("home") { Home(tabs, pager, nav, version, tick) }
        composable("checkin") { CheckInScreen { nav.popBackStack() } }
        composable("drinks") { DrinksScreen(version) { nav.popBackStack() } }
        composable("sleepask") { SleepAskScreen { nav.popBackStack() } }
        composable("reaction") { BrainTestScreen(full = false) { nav.popBackStack() } }
        composable("brain") { BrainTestScreen(full = true) { nav.popBackStack() } }
        composable("hr?note={note}", arguments = listOf(navArgument("note") { type = NavType.StringType; defaultValue = "Watch" })) { e -> HeartRateScreen(e.arguments?.getString("note") ?: "Watch") { nav.popBackStack() } }
        composable("dose/{medId}/{at}") { e -> DoseScreen(e.arguments?.getString("medId") ?: "", e.arguments?.getString("at")?.toLongOrNull() ?: 0L) { nav.popBackStack() } }
    }
}

@Composable
private fun Home(tabs: List<Tab>, pager: PagerState, nav: NavHostController, version: Int, tick: Int) {
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { k ->
            when (tabs[k]) {
                Tab.WORKOUT -> WorkoutPage(version)
                Tab.NOW -> NowPage(version, tick, nav) { t -> scope.launch { val i = tabs.indexOf(t); if (i >= 0) pager.animateScrollToPage(i) } }
                Tab.TODAY -> TodayPage(version, nav)
                Tab.FOCUS -> FocusPage(version, tick, nav)
                Tab.LOG -> LogPage(version, nav)
                Tab.SLEEP -> SleepPage(version, nav)
                Tab.SETTINGS -> SettingsPage(version)
            }
        }
        TimeText()
        val indicator = remember(pager, tabs.size) {
            object : PageIndicatorState {
                override val pageOffset: Float get() = pager.currentPageOffsetFraction
                override val selectedPage: Int get() = pager.currentPage
                override val pageCount: Int get() = tabs.size
            }
        }
        HorizontalPageIndicator(pageIndicatorState = indicator, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp))
    }
}
