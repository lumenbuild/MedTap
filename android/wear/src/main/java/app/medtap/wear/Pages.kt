package app.medtap.wear

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.ToggleChipDefaults
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Say how it went: sent to the phone, or kept until it's near. */
fun confirm(ctx: Context, r: WatchState.Sent, what: String) {
    Alarms.buzz(ctx, longArrayOf(0, 40))
    Toast.makeText(ctx, if (r == WatchState.Sent.SENT) "$what ✓" else "$what ✓ · sends when your phone's near", Toast.LENGTH_SHORT).show()
}

private fun stateColor(state: String) = when (state) { "done" -> C.good; "skipped" -> C.muted; "due" -> C.meds; "missed" -> C.act; else -> C.primary }
private fun stateWord(state: String) = when (state) { "done" -> "Done"; "skipped" -> "Skipped"; "due" -> "Due now"; "missed" -> "Missed"; else -> "Later" }

// ── Now ─────────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun NowPage(version: Int, tick: Int, nav: NavHostController, goTo: (Tab) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val now = System.currentTimeMillis()
    val next = remember(version, tick) { WatchState.nextDose(ctx) }
    val (done, total) = remember(version, tick) { WatchState.doneCount(ctx) }
    val fallback = remember(version) { WatchState.load(ctx) }
    val wear = remember(version, tick) { WearOff.now(ctx) }
    val waiting = remember(version) { WatchState.waiting(ctx) }
    val d = dims()
    Page(top = (d.w * 0.1f).dp) {
        item {
            Ring(if (total > 0) done.toFloat() / total else 0f, C.meds, share = 0.56f) {
                when {
                    next != null -> {
                        Label(if (next.state == "due") "Due now" else "Next · ${Alarms.fmtTime(ctx, next.at ?: now)}", if (next.state == "due") C.meds else C.muted)
                        Big(next.name, size = 18)
                        Small(if (next.state == "later" && next.at != null) "in ${fmtLeft(next.at - now)}" else next.amount)
                    }
                    total > 0 && done >= total -> { Label("Today", C.good); Big("All done", 20); Small("$done of $total") }
                    fallback.optString("title").isNotEmpty() -> { Label(fallback.optString("label", "Next")); Big(fallback.optString("title"), 18); Small(fallback.optString("when")) }
                    else -> { Label(ctx.getString(R.string.app_name)); Small("Open the app on your phone to set up") }
                }
            }
        }
        if (next != null) item {
            Button(onClick = { scope.launch { confirm(ctx, WatchState.log(ctx, next.medId), "Logged") } }, modifier = Modifier.fillMaxWidth(if (d.small) 0.62f else 0.7f).height(if (d.small) 42.dp else 48.dp),
                colors = ButtonDefaults.buttonColors(backgroundColor = if (next.state == "due") C.meds else C.primary, contentColor = if (next.state == "due") C.text else C.onPrimary)) {
                Text("Log ${next.amount}", fontWeight = FontWeight.Bold)
            }
        }
        if (total > 0) item { Small("$done of $total today") }
        if (wear != null) item { Action("Focus: ${fmtLeft(wear.to - now)} left", C.mind, "Until ${Alarms.fmtTime(ctx, wear.to)}") { goTo(Tab.FOCUS) } }
        if (waiting > 0) item { Small("$waiting waiting for your phone", C.act) }
    }
}

// ── Today ───────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun TodayPage(version: Int, nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val doses = remember(version) { WatchState.doses(ctx) }
    val d = remember(version) { WatchState.load(ctx) }
    val prn = remember(version) { d.optJSONArray("prn") }
    val shot = remember(version) { WatchState.watch(ctx).optJSONObject("shot") }
    Page {
        item { Label("Today", C.meds) }
        if (doses.isEmpty()) item { Small("Nothing planned today") }
        for (x in doses) item {
            Action(x.name, stateColor(x.state), "${x.at?.let { Alarms.fmtTime(ctx, it) } ?: "Next"} · ${x.amount} · ${stateWord(x.state)}") {
                if (x.state != "done" && x.state != "skipped") nav.navigate("dose/${x.medId}/${x.at ?: 0}")
            }
        }
        if (prn != null && prn.length() > 0) {
            item { Spacer(Modifier.height(4.dp)); Label("As needed") }
            for (k in 0 until prn.length()) prn.optJSONObject(k)?.let { m ->
                item { Action("Log ${m.optString("name")}", C.pep) { scope.launch { confirm(ctx, WatchState.log(ctx, m.optString("id")), "Logged") } } }
            }
        }
        if (shot != null) item {
            val days = Math.floorDiv(shot.optLong("at") - startOfToday(), 86_400_000L)
            Small("${shot.optString("name")}: ${when { days <= 0 -> "today"; days == 1L -> "tomorrow"; else -> "in $days days" }}", C.pep)
        }
    }
}

fun startOfToday(): Long = java.util.Calendar.getInstance().apply {
    set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
}.timeInMillis

/** One dose: Log or Skip. */
@Composable
fun DoseScreen(medId: String, at: Long, back: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val dose = remember { WatchState.doses(ctx).firstOrNull { it.medId == medId && (it.at ?: 0L) == at } }
    Page {
        item { Label(if (at > 0) Alarms.fmtTime(ctx, at) else "Next", C.meds) }
        item { Big(dose?.name ?: "Dose", 20) }
        dose?.let { item { Small(it.amount) } }
        item { Action("Log", C.meds, filled = true) { scope.launch { confirm(ctx, WatchState.log(ctx, medId), "Logged"); back() } } }
        item { Action("Skip", C.muted) { scope.launch { confirm(ctx, WatchState.skip(ctx, medId, at), "Skipped"); back() } } }
    }
}

// ── Focus ───────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun FocusPage(version: Int, tick: Int, nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val w = remember(version, tick) { WearOff.now(ctx) }
    val readiness = remember(version) { WatchState.load(ctx).optJSONObject("bio")?.optInt("readiness", -1)?.takeIf { it >= 0 } }
    var rated by remember { mutableStateOf<Int?>(null) }
    val now = System.currentTimeMillis()
    Page(top = (dims().w * 0.1f).dp) {
        item {
            if (w != null) Ring(WearOff.progress(w, now), C.mind, share = 0.6f) {
                Label(w.name, C.mind); Big(fmtLeft(w.to - now), 22); Small("until ${Alarms.fmtTime(ctx, w.to)}")
            } else Column(horizontalAlignment = Alignment.CenterHorizontally) { Label("Focus", C.mind); Small("No focus window now") }
        }
        if (w != null && w.late - w.early > 10 * 60_000L) item { Small("Wears off ${fmtRange(ctx, w.early, w.late)}") }
        readiness?.let { item { Small("Readiness $it", C.good) } }
        item { Scale("Focus now?", rated, C.mind) { v -> rated = v; scope.launch { confirm(ctx, WatchState.checkIn(ctx, JSONObject().put("focus", v)), "Focus $v") } } }
        item { Action("Reaction test", C.mind, "30 seconds") { nav.navigate("reaction") } }
        item { Action("Full brain test", C.mind, "Reaction + memory · 2 min") { nav.navigate("brain") } }
        item { Action("Heart rate", C.heart, "20-second reading") { nav.navigate("hr?note=${android.net.Uri.encode(if (w != null) "${fmtLeft(now - w.from)} after a dose" else "Watch")}") } }
    }
}

// ── Log ─────────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun LogPage(version: Int, nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val drinks = remember(version) { WatchState.watch(ctx).optJSONObject("drinks") ?: JSONObject() }
    val add = drinks.optInt("waterAdd", 250)
    Page {
        item { Label("Log", C.primary) }
        item { Action("Check in", C.mind, "Mood, focus, energy, symptoms") { nav.navigate("checkin") } }
        item { Action("Caffeine", C.act, "${drinks.optInt("caffeineMg")} mg today") { nav.navigate("drinks") } }
        item {
            Action("Water +$add mL", C.body, drinks.optInt("waterMl").let { ml -> if (drinks.has("waterTarget")) "$ml of ${drinks.optInt("waterTarget")} mL" else "$ml mL today" }) {
                scope.launch { confirm(ctx, WatchState.checkIn(ctx, JSONObject().put("waterMl", add)), "Water +$add") }
            }
        }
        if (WatchState.watch(ctx).has("sleep")) item { Action("How did you sleep?", C.sleep) { nav.navigate("sleepask") } }
    }
}

/** Mood, focus and energy (1–5) and symptoms, saved together. */
@Composable
fun CheckInScreen(back: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var mood by remember { mutableStateOf<Int?>(null) }
    var focus by remember { mutableStateOf<Int?>(null) }
    var energy by remember { mutableStateOf<Int?>(null) }
    var chips by remember { mutableStateOf(setOf<String>()) }
    val options = remember {
        val arr = WatchState.load(ctx).optJSONObject("bio")?.optJSONArray("chips")
        if (arr != null && arr.length() > 0) (0 until arr.length()).map { arr.optString(it) } else listOf("Headache", "Nausea", "Tired", "Anxious", "Wearing off", "Heart racing")
    }
    Page {
        item { Label("Check in", C.mind) }
        item { Scale("Mood", mood, C.good) { mood = it } }
        item { Scale("Focus", focus, C.mind) { focus = it } }
        item { Scale("Energy", energy, C.act) { energy = it } }
        item { Spacer(Modifier.height(2.dp)) }
        for (c in options) item {
            ToggleChip(checked = c in chips, onCheckedChange = { on -> chips = if (on) chips + c else chips - c }, label = { Text(c) }, modifier = Modifier.fillMaxWidth(),
                toggleControl = { androidx.wear.compose.material.Checkbox(checked = c in chips) },
                colors = ToggleChipDefaults.toggleChipColors(checkedStartBackgroundColor = C.surface, checkedEndBackgroundColor = C.heart.copy(alpha = 0.35f), uncheckedStartBackgroundColor = C.surface, uncheckedEndBackgroundColor = C.surface))
        }
        item {
            Action("Save", C.primary, filled = true) {
                if (mood == null && focus == null && energy == null && chips.isEmpty()) { back(); return@Action }
                val o = JSONObject()
                mood?.let { o.put("mood", it) }; focus?.let { o.put("focus", it) }; energy?.let { o.put("energy", it) }
                if (chips.isNotEmpty()) o.put("chips", org.json.JSONArray(chips.toList()))
                scope.launch { confirm(ctx, WatchState.checkIn(ctx, o), "Saved"); back() }
            }
        }
    }
}

/** Caffeine today and in your system now, and one tap for a usual drink. */
@Composable
fun DrinksScreen(version: Int, back: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val d = remember(version) { WatchState.watch(ctx).optJSONObject("drinks") ?: JSONObject() }
    val limit = d.optInt("limitMg", 0)
    val usual = remember(version) {
        val arr = d.optJSONArray("usual")
        val mine = if (arr != null) (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map { it.optString("name") to it.optInt("mg") } else emptyList()
        (mine + listOf("Coffee" to 95, "Espresso" to 65, "Tea" to 45, "Energy drink" to 80)).distinctBy { it.first.lowercase() }.take(5)
    }
    Page {
        item { Label("Caffeine", C.act) }
        item { Big("${d.optInt("caffeineMg")} mg", 24) }
        if (limit > 0) item { Bar(d.optInt("caffeineMg") / limit.toFloat(), if (d.optInt("caffeineMg") > limit) C.heart else C.act) }
        item { Small("${d.optInt("caffeineNow")} mg active now${if (limit > 0) " · limit $limit" else ""}") }
        for ((name, mg) in usual) item {
            Action(name, C.act, "$mg mg") { scope.launch { confirm(ctx, WatchState.checkIn(ctx, JSONObject().put("caffeineMg", mg).put("drink", name)), name); back() } }
        }
    }
}

// ── Sleep ───────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun SleepPage(version: Int, nav: NavHostController) {
    val ctx = LocalContext.current
    val s = remember(version) { WatchState.watch(ctx).optJSONObject("sleep") ?: JSONObject() }
    val now = System.currentTimeMillis()
    Page(top = (dims().w * 0.1f).dp) {
        item {
            Ring(if (s.has("score")) s.optInt("score") / 100f else 0f, C.sleep, share = 0.6f) {
                Label("Last night", C.sleep)
                Big(if (s.has("score")) "${s.optInt("score")}" else "—", 30)
                Small(s.optString("word").ifEmpty { "No night yet" })
            }
        }
        s.optString("asleep").takeIf { it.isNotEmpty() }?.let { a -> item { Small(a + (s.optString("deep").takeIf { it.isNotEmpty() }?.let { " · deep $it" } ?: ""), C.text) } }
        s.optString("debt").takeIf { it.isNotEmpty() }?.let { item { Small(it, C.act) } }
        val bed = s.optLong("bedtime"); val wind = s.optLong("windDown")
        if (bed > now) item { Action("Bed ${Alarms.fmtTime(ctx, bed)}", C.sleep, if (wind > now) "Wind down at ${Alarms.fmtTime(ctx, wind)}" else "Tonight") {} }
        if (s.optBoolean("ask", false) && now - WatchState.flag(ctx, "sleepAnswered") > 12 * 3_600_000L) item { Action("How did you sleep?", C.sleep, "One tap") { nav.navigate("sleepask") } }
    }
}

@Composable
fun SleepAskScreen(back: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    Page {
        item { Label("How did you sleep?", C.sleep) }
        for ((v, w) in listOf(5 to "Great", 4 to "Good", 3 to "OK", 2 to "Poor", 1 to "Awful")) item {
            Action(w, C.sleep) {
                WatchState.setFlag(ctx, "sleepAnswered")
                scope.launch { confirm(ctx, WatchState.checkIn(ctx, JSONObject().put("sleepQuality", v)), "Saved"); back() }
            }
        }
    }
}

// ── Workout ─────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun WorkoutPage(version: Int) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val w = remember(version) { WatchState.workout(ctx) } ?: return Page { item { Small("No workout going") } }
    val until = w.optLong("restUntil")
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var buzzed by remember(until) { mutableStateOf(false) }
    val restFor = remember(until) { (until - System.currentTimeMillis()).coerceAtLeast(1L) }
    LaunchedEffect(until) {
        while (until > System.currentTimeMillis()) { delay(250); now = System.currentTimeMillis() }
        now = System.currentTimeMillis()
        if (until > 0 && !buzzed && System.currentTimeMillis() - until < 5_000) { buzzed = true; Alarms.buzz(ctx, longArrayOf(0, 400, 150, 400)) }
    }
    val next = w.optJSONObject("next")
    Page {
        item { Label(w.optString("title", "Workout"), C.act) }
        if (until > now) item {
            val left = ((until - now) / 1000L).toInt()
            Ring(((until - now).toFloat() / restFor), C.act, share = if (dims().small) 0.46f else 0.56f) { Label("Rest"); Big("%d:%02d".format(left / 60, left % 60), 28) }
        }
        if (next != null) {
            item { Big(next.optString("exercise"), 18) }
            item { Small("${next.optString("label")} · ${next.optString("load")}", C.text) }
            item {
                Action("Set done", C.act, filled = true) { scope.launch { confirm(ctx, WatchState.setDone(ctx, next.optString("setId")), "Set done") } }
            }
        } else item { Small("Every set done. Finish on your phone.") }
        item { Small("${w.optInt("done")} of ${w.optInt("total")} sets") }
    }
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
fun SettingsPage(version: Int) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var v by remember { mutableStateOf(0) }
    val waiting = remember(version, v) { WatchState.waiting(ctx) }
    val reminders = remember(version) { (WatchState.watch(ctx).optJSONArray("reminders")?.length() ?: 0) > 0 }
    Page {
        item { Label("Settings") }
        for (p in WatchState.Pref.entries) item {
            val on = remember(v) { WatchState.on(ctx, p) }
            ToggleChip(checked = on, onCheckedChange = { WatchState.set(ctx, p, it); v++ }, label = { Text(p.label) }, secondaryLabel = { Text(p.detail, color = C.muted) },
                toggleControl = { androidx.wear.compose.material.Switch(checked = on) }, modifier = Modifier.fillMaxWidth(),
                colors = ToggleChipDefaults.toggleChipColors(checkedStartBackgroundColor = C.surface, checkedEndBackgroundColor = C.surface, uncheckedStartBackgroundColor = C.surface, uncheckedEndBackgroundColor = C.surface,
                    checkedToggleControlColor = C.primary))
        }
        item { Small(if (reminders) "Dose reminders: on this watch" else "Dose reminders on the watch: turn on in the phone app, Settings → Watch") }
        if (Build.VERSION.SDK_INT >= 31 && !ctx.getSystemService(android.app.AlarmManager::class.java).canScheduleExactAlarms()) item {
            Action("Allow on-time alarms", C.act, "So reminders aren't late") {
                ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
        item {
            Action(if (waiting == 0) "Everything's on your phone" else "$waiting waiting · send now", if (waiting == 0) C.good else C.act) {
                scope.launch { WatchState.refresh(ctx); v++; Toast.makeText(ctx, if (WatchState.waiting(ctx) == 0) "Sent ✓" else "Phone not reachable yet", Toast.LENGTH_SHORT).show() }
            }
        }
    }
}

